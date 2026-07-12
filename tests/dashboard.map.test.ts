/**
 * Route tests for GET /map/:slug + GET /vendor/mermaid.min.js + the "Карта" card link on GET /
 * (spec-live-map.md story 1, Фаза A). Driven via Fastify's app.inject() against the real route
 * tree in src/dashboard/server.ts — no port bound (see the isMain guard at the bottom of that
 * file, added specifically so this suite can import `app` safely).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDb, createProject, updateProject } from "../src/db/index.js";
import { app } from "../src/dashboard/server.js";

let root: string;
let n = 0;

beforeEach(() => {
  getDb().exec("DELETE FROM projects;");
  root = mkdtempSync(join(tmpdir(), "keystack-map-route-"));
});

function projectDir(): string {
  n += 1;
  const dir = join(root, `p${n}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeFlowmap(dir: string, files: { mmd?: string; architecture?: unknown; uiFlow?: unknown }) {
  const fm = join(dir, ".flowmap");
  mkdirSync(fm, { recursive: true });
  if (files.mmd !== undefined) writeFileSync(join(fm, "flowmap.mmd"), files.mmd);
  if (files.architecture !== undefined) writeFileSync(join(fm, "architecture.json"), JSON.stringify(files.architecture));
  if (files.uiFlow !== undefined) writeFileSync(join(fm, "ui-flow.json"), JSON.stringify(files.uiFlow));
  return fm;
}

describe("GET /map/:slug", () => {
  it("404s with a plain-language message for an unknown slug, doesn't throw", async () => {
    const res = await app.inject({ method: "GET", url: "/map/does-not-exist" });
    expect(res.statusCode).toBe(404);
    expect(res.body).toContain("не найден");
  });

  it("shows the 'run /sync' placard when .flowmap/ is entirely absent — not an error page", async () => {
    const dir = projectDir();
    createProject({ slug: "no-map", name: "No Map", local_path: dir, track: "A" });

    const res = await app.inject({ method: "GET", url: "/map/no-map" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("не сгенерирована");
    expect(res.body).not.toContain("mermaid-render");
  });

  it("renders 200 with a mermaid container + verdict counts + issue messages when .flowmap/ is complete", async () => {
    const dir = projectDir();
    writeFlowmap(dir, {
      mmd: "flowchart TD\n  a-->b\n",
      architecture: { stats: { nodes: 3, edges: 2 }, issues: [] },
      uiFlow: {
        stats: { screens: 5, elements: 10, edges: 4 },
        verdict: { crit: 1, warn: 2 },
        issues: [
          { severity: "crit", kind: "broken-nav", screenId: "s_a", message: "ведёт на несуществующий роут" },
          { severity: "warn", kind: "orphan", screenId: "s_b", message: "сирота без входящих переходов" },
        ],
      },
    });
    createProject({ slug: "has-map", name: "Has Map", local_path: dir, track: "A" });

    const res = await app.inject({ method: "GET", url: "/map/has-map" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("mermaid-render");
    expect(res.body).toContain("1 CRIT");
    expect(res.body).toContain("2 WARN");
    expect(res.body).toContain("несуществующий роут");
    expect(res.body).toContain("сирота без входящих переходов");
  });

  it("architecture.json issues (no severity field) fold into WARN, never CRIT", async () => {
    const dir = projectDir();
    writeFlowmap(dir, {
      mmd: "flowchart TD\n  a-->b\n",
      architecture: { stats: { nodes: 1, edges: 0 }, issues: [{ message: "known deps not found in manifest" }] },
    });
    createProject({ slug: "arch-only", name: "Arch Only", local_path: dir, track: "B" });

    const res = await app.inject({ method: "GET", url: "/map/arch-only" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("0 CRIT");
    expect(res.body).toContain("1 WARN");
    expect(res.body).toContain("known deps not found in manifest");
  });

  it("architecture.json only (no flowmap.mmd) -> 200 with a generated mermaid diagram, not the error placard (story 2 finding)", async () => {
    const dir = projectDir();
    writeFlowmap(dir, {
      architecture: {
        stats: { nodes: 2, edges: 1 },
        nodes: [
          { id: "s_entry", kind: "client", label: "Посетитель" },
          { id: "s_app", kind: "frontend", label: "Frontend" },
        ],
        edges: [{ from: "s_entry", to: "s_app", label: "использует" }],
        issues: [],
      },
    });
    createProject({ slug: "arch-map-only", name: "Arch Map Only", local_path: dir, track: "A" });

    const res = await app.inject({ method: "GET", url: "/map/arch-map-only" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("mermaid-render");
    expect(res.body).toContain("flowchart TD");
    expect(res.body).toContain("s_app");
  });

  it("shows an error placard (not a crash) for an empty flowmap.mmd", async () => {
    const dir = projectDir();
    writeFlowmap(dir, { mmd: "   \n  \n" });
    createProject({ slug: "empty-mmd", name: "Empty Mmd", local_path: dir, track: "B" });

    const res = await app.inject({ method: "GET", url: "/map/empty-mmd" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("map-error");
    expect(res.body).not.toContain("mermaid-render");
  });

  it("shows an error placard when flowmap.mmd is missing but .flowmap/ exists", async () => {
    const dir = projectDir();
    mkdirSync(join(dir, ".flowmap"), { recursive: true });
    createProject({ slug: "no-mmd", name: "No Mmd", local_path: dir, track: "B" });

    const res = await app.inject({ method: "GET", url: "/map/no-mmd" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("map-error");
  });

  it("shows a stale badge when the newest artifact is older than 7 days", async () => {
    const dir = projectDir();
    const fm = writeFlowmap(dir, { mmd: "flowchart TD\n  a-->b\n" });
    const old = new Date(Date.now() - 10 * 86400000);
    utimesSync(join(fm, "flowmap.mmd"), old, old);
    createProject({ slug: "stale-map", name: "Stale Map", local_path: dir, track: "B" });

    const res = await app.inject({ method: "GET", url: "/map/stale-map" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("устарела");
  });

  it("does not show the stale badge for a freshly generated map", async () => {
    const dir = projectDir();
    writeFlowmap(dir, { mmd: "flowchart TD\n  a-->b\n" });
    createProject({ slug: "fresh-map", name: "Fresh Map", local_path: dir, track: "B" });

    const res = await app.inject({ method: "GET", url: "/map/fresh-map" });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain("устарела");
  });
});

describe("GET /vendor/mermaid.min.js", () => {
  it("serves the vendored bundle with a JS content-type, no CDN involved", async () => {
    const res = await app.inject({ method: "GET", url: "/vendor/mermaid.min.js" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("javascript");
    expect(res.body.length).toBeGreaterThan(100_000); // real mermaid bundle, not a stub
    expect(res.body).toContain("mermaid");
  });
});

describe("project card 'Карта' link + CRIT badge (main SPA, GET /)", () => {
  it("shows a map link with a CRIT badge when has_flowmap and map_crit>0", async () => {
    const dir = projectDir();
    createProject({ slug: "card-map", name: "Card Map", local_path: dir, track: "A" });
    updateProject("card-map", { has_flowmap: true, map_crit: 2, map_warn: 1 });

    const res = await app.inject({ method: "GET", url: "/" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('href="/map/card-map"');
    expect(res.body).toContain("2 CRIT");
  });

  it("shows a map link without a CRIT badge when map_crit is 0", async () => {
    const dir = projectDir();
    createProject({ slug: "card-map-clean", name: "Card Map Clean", local_path: dir, track: "A" });
    updateProject("card-map-clean", { has_flowmap: true, map_crit: 0, map_warn: 0 });

    const res = await app.inject({ method: "GET", url: "/" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('href="/map/card-map-clean"');
    expect(res.body).not.toContain("CRIT</b>");
  });

  it("hides the map link entirely when has_flowmap is false", async () => {
    const dir = projectDir();
    createProject({ slug: "card-no-map", name: "Card No Map", local_path: dir, track: "B" });

    const res = await app.inject({ method: "GET", url: "/" });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain('href="/map/card-no-map"');
  });
});
