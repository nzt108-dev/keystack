/**
 * Unit tests for src/dashboard/flowmap.ts (spec-live-map.md story 1, Фаза A) — the pure read-model
 * over a project's `.flowmap/` artifacts, independent of the HTTP route (see dashboard.map.test.ts
 * for the GET /map/:slug route-level coverage).
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFlowmap, architectureToMermaid, FLOWMAP_STALE_DAYS } from "../src/dashboard/flowmap.js";

function tempProject(): string {
  return mkdtempSync(join(tmpdir(), "keystack-flowmap-unit-"));
}

function writeFlowmap(dir: string, files: { mmd?: string; architecture?: unknown; uiFlow?: unknown }) {
  const fm = join(dir, ".flowmap");
  mkdirSync(fm, { recursive: true });
  if (files.mmd !== undefined) writeFileSync(join(fm, "flowmap.mmd"), files.mmd);
  if (files.architecture !== undefined) writeFileSync(join(fm, "architecture.json"), JSON.stringify(files.architecture));
  if (files.uiFlow !== undefined) writeFileSync(join(fm, "ui-flow.json"), JSON.stringify(files.uiFlow));
  return fm;
}

describe("readFlowmap", () => {
  it("no local_path -> exists:false, all zeros", () => {
    const r = readFlowmap("");
    expect(r.exists).toBe(false);
    expect(r.mmd).toBeNull();
    expect(r.crit).toBe(0);
    expect(r.warn).toBe(0);
  });

  it("local_path with no .flowmap/ dir -> exists:false", () => {
    const dir = tempProject();
    const r = readFlowmap(dir);
    expect(r.exists).toBe(false);
    expect(r.mmd).toBeNull();
    expect(r.generatedAt).toBeNull();
  });

  it(".flowmap/ exists but flowmap.mmd is missing -> exists:true, mmd:null, mmdError set", () => {
    const dir = tempProject();
    mkdirSync(join(dir, ".flowmap"), { recursive: true });
    const r = readFlowmap(dir);
    expect(r.exists).toBe(true);
    expect(r.mmd).toBeNull();
    expect(r.mmdError).toMatch(/не найден/);
  });

  it("flowmap.mmd is whitespace-only -> treated as broken, not a valid map", () => {
    const dir = tempProject();
    writeFlowmap(dir, { mmd: "   \n\t \n" });
    const r = readFlowmap(dir);
    expect(r.exists).toBe(true);
    expect(r.mmd).toBeNull();
    expect(r.mmdError).toMatch(/пуст/);
  });

  it("reads verdict.crit/warn straight from ui-flow.json and issues verbatim", () => {
    const dir = tempProject();
    writeFlowmap(dir, {
      mmd: "flowchart TD\n  a-->b\n",
      uiFlow: {
        stats: { screens: 4, elements: 9, edges: 3 },
        verdict: { crit: 2, warn: 1 },
        issues: [
          { severity: "crit", kind: "dead-end", screenId: "s_x", message: "тупик" },
          { severity: "warn", kind: "orphan", screenId: "s_y", message: "сирота" },
        ],
      },
    });
    const r = readFlowmap(dir);
    expect(r.exists).toBe(true);
    expect(r.mmd).toContain("flowchart TD");
    expect(r.crit).toBe(2);
    expect(r.warn).toBe(1);
    expect(r.issues).toHaveLength(2);
    expect(r.issues[0]).toEqual({ severity: "crit", kind: "dead-end", screenId: "s_x", message: "тупик" });
    expect(r.uiStats).toEqual({ screens: 4, elements: 9, edges: 3 });
  });

  it("ui-flow.json absent -> crit is 0 (no data), not an inferred value", () => {
    const dir = tempProject();
    writeFlowmap(dir, { mmd: "flowchart TD\n  a-->b\n" });
    const r = readFlowmap(dir);
    expect(r.crit).toBe(0);
    expect(r.warn).toBe(0);
    expect(r.uiStats).toBeUndefined();
  });

  it("architecture.json issues (message-only, no severity field) fold into warn and are exposed via archIssues", () => {
    const dir = tempProject();
    writeFlowmap(dir, {
      mmd: "flowchart TD\n  a-->b\n",
      architecture: { stats: { nodes: 3, edges: 2 }, issues: [{ message: "known deps not found" }] },
      uiFlow: { verdict: { crit: 0, warn: 1 }, issues: [] },
    });
    const r = readFlowmap(dir);
    expect(r.warn).toBe(2); // 1 (ui-flow) + 1 (architecture)
    expect(r.archIssues).toEqual(["known deps not found"]);
    expect(r.archStats).toEqual({ nodes: 3, edges: 2 });
  });

  it("malformed JSON in ui-flow.json degrades to 0/0, never throws", () => {
    const dir = tempProject();
    const fm = join(dir, ".flowmap");
    mkdirSync(fm, { recursive: true });
    writeFileSync(join(fm, "flowmap.mmd"), "flowchart TD\n  a-->b\n");
    writeFileSync(join(fm, "ui-flow.json"), "{ this is not valid json");

    expect(() => readFlowmap(dir)).not.toThrow();
    const r = readFlowmap(dir);
    expect(r.crit).toBe(0);
    expect(r.warn).toBe(0);
  });

  it("computes staleDays from the newest artifact mtime and flags it past the threshold", () => {
    const dir = tempProject();
    const fm = writeFlowmap(dir, { mmd: "flowchart TD\n  a-->b\n" });
    const old = new Date(Date.now() - (FLOWMAP_STALE_DAYS + 3) * 86400000);
    utimesSync(join(fm, "flowmap.mmd"), old, old);

    const r = readFlowmap(dir);
    expect(r.staleDays).toBeGreaterThan(FLOWMAP_STALE_DAYS);
  });

  it("a fresh artifact is not flagged stale", () => {
    const dir = tempProject();
    writeFlowmap(dir, { mmd: "flowchart TD\n  a-->b\n" });
    const r = readFlowmap(dir);
    expect(r.staleDays).toBeLessThanOrEqual(FLOWMAP_STALE_DAYS);
  });

  // ---- story 2 finding: generator.ts no longer emits flowmap.mmd for 5/8 Track A projects
  // (mermaid.ts cut during the Excalidraw pivot) — fall back to architecture.json ----------------

  it("no flowmap.mmd but architecture.json present -> mmd is generated, mmdError cleared", () => {
    const dir = tempProject();
    writeFlowmap(dir, {
      architecture: {
        nodes: [
          { id: "s_entry", kind: "client", label: "Посетитель" },
          { id: "s_app", kind: "frontend", label: "Frontend" },
          { id: "s_db", kind: "database", label: "Postgres" },
        ],
        edges: [{ from: "s_entry", to: "s_app", label: "использует" }],
      },
    });
    const r = readFlowmap(dir);
    expect(r.exists).toBe(true);
    expect(r.mmd).toContain("flowchart TD");
    expect(r.mmd).toContain("s_app");
    expect(r.mmdError).toBeUndefined();
  });

  it("real flowmap.mmd always wins over generating one from architecture.json (legacy is richer)", () => {
    const dir = tempProject();
    writeFlowmap(dir, {
      mmd: "flowchart TD\n  s_x-->s_y\n",
      architecture: {
        nodes: [{ id: "s_entry", kind: "client", label: "Посетитель" }],
        edges: [],
      },
    });
    const r = readFlowmap(dir);
    expect(r.mmd).toBe("flowchart TD\n  s_x-->s_y\n");
    expect(r.mmd).not.toContain("s_entry");
  });

  it("architecture.json present but nodes empty -> no synthetic mmd, mmdError from the missing-file path stands", () => {
    const dir = tempProject();
    writeFlowmap(dir, { architecture: { nodes: [], edges: [] } });
    const r = readFlowmap(dir);
    expect(r.mmd).toBeNull();
    expect(r.mmdError).toMatch(/не найден/);
  });
});

describe("architectureToMermaid", () => {
  it("converts nodes/edges to a flowchart with per-kind classDefs, id-sorted and deterministic", () => {
    const arch = {
      nodes: [
        { id: "s_db", kind: "database", label: "Postgres", col: 2, row: 0 },
        { id: "s_entry", kind: "client", label: "Посетитель", col: 0, row: 0 },
        { id: "s_app", kind: "frontend", label: "Frontend", col: 1, row: 0 },
      ],
      edges: [
        { from: "s_entry", to: "s_app", label: "использует" },
        { from: "s_app", to: "s_db" }, // no label
      ],
    };
    const mmd = architectureToMermaid(arch);

    expect(mmd.startsWith("flowchart TD\n")).toBe(true);
    // classDefs present for the 3 kinds involved, in CLASS_DEFS declaration order
    expect(mmd.indexOf("classDef client")).toBeGreaterThan(-1);
    expect(mmd.indexOf("classDef frontend")).toBeGreaterThan(mmd.indexOf("classDef client"));
    expect(mmd.indexOf("classDef db")).toBeGreaterThan(mmd.indexOf("classDef frontend"));
    // nodes emitted in id-sorted order: s_app, s_db, s_entry
    expect(mmd.indexOf('s_app["Frontend"]')).toBeLessThan(mmd.indexOf('s_db["Postgres"]'));
    expect(mmd.indexOf('s_db["Postgres"]')).toBeLessThan(mmd.indexOf('s_entry["Посетитель"]'));
    // edges: labeled and unlabeled forms
    expect(mmd).toContain('s_entry -->|"использует"| s_app');
    expect(mmd).toContain("s_app --> s_db");
    // class assignment lines group ids by class
    expect(mmd).toContain("class s_entry client");
    expect(mmd).toContain("class s_app frontend");
    expect(mmd).toContain("class s_db db");

    // deterministic: same input -> byte-identical output
    expect(architectureToMermaid(arch)).toBe(mmd);
  });

  it("escapes quotes and brackets/parens in labels so Mermaid can't misparse them", () => {
    const arch = {
      nodes: [{ id: "s_svc", kind: "backend", label: 'Backend ("api") (v2) [beta]' }],
      edges: [{ from: "s_svc", to: "s_svc", label: 'loop (retry) "x"' }],
    };
    const mmd = architectureToMermaid(arch);
    expect(mmd).not.toMatch(/"api"/);
    expect(mmd).not.toContain("(v2)");
    expect(mmd).not.toContain("[beta]");
    expect(mmd).toContain("#quot;api#quot;");
    expect(mmd).toContain("#40;v2#41;");
    expect(mmd).toContain("#91;beta#93;");
    expect(mmd).toContain('loop #40;retry#41; #quot;x#quot;');
  });

  it("unknown/unrecognized kind falls back to the neutral 'node' class instead of throwing", () => {
    const arch = {
      nodes: [{ id: "s_mystery", kind: "spaceship", label: "???" }],
      edges: [],
    };
    const mmd = architectureToMermaid(arch);
    expect(mmd).toContain("classDef node");
    expect(mmd).toContain("class s_mystery node");
  });

  it("edges pointing at unknown node ids are dropped, not rendered dangling", () => {
    const arch = {
      nodes: [{ id: "s_a", kind: "client", label: "A" }],
      edges: [{ from: "s_a", to: "s_ghost", label: "x" }],
    };
    const mmd = architectureToMermaid(arch);
    expect(mmd).not.toContain("s_ghost");
    expect(mmd).not.toContain("-->");
  });

  it("no nodes / malformed input -> empty string, never throws", () => {
    expect(architectureToMermaid({ nodes: [], edges: [] })).toBe("");
    expect(architectureToMermaid({})).toBe("");
    expect(architectureToMermaid(null)).toBe("");
    expect(architectureToMermaid(undefined)).toBe("");
  });
});
