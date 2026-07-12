import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { upsertSpec } from "../src/db/index.js";

let client: Client;
let home: string;

const call = async (name: string, args: Record<string, unknown> = {}) => {
  const r = await client.callTool({ name, arguments: args });
  const text = (r.content as any[])[0]?.text ?? "";
  try { return JSON.parse(text); } catch { return text; }
};

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), "keystack-mcp-"));
  const transport = new StdioClientTransport({
    command: "npx",
    args: ["tsx", "src/mcp/server.ts"],
    env: { ...process.env, KEYSTACK_HOME: home },
  });
  client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(transport);
  // Point this process's own db helpers (used only to seed `specs` rows directly, the way
  // keystack-scan.sh does — there is no MCP write-tool for specs, scan-only by design) at the
  // same keystack.db file the spawned server process uses.
  process.env.KEYSTACK_HOME = home;
});

afterAll(async () => {
  await client?.close();
  rmSync(home, { recursive: true, force: true });
});

describe("MCP server", () => {
  it("exposes all registry tools", async () => {
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining([
      "list_projects", "get_project", "search_projects",
      "create_project", "update_project", "scan_repo",
      "list_skills", "get_skill", "upsert_skill",
      "list_prompts", "get_prompt", "upsert_prompt",
    ]));
  });

  it("creates, reads and searches a project", async () => {
    const created = await call("create_project", {
      slug: "demo", name: "Demo", stage: "mvp",
      language: "TypeScript", services: ["resend"],
    });
    expect(created.slug).toBe("demo");

    const got = await call("get_project", { slug: "demo" });
    expect(got.name).toBe("Demo");

    const found = await call("search_projects", { query: "resend" });
    expect(found.map((p: any) => p.slug)).toContain("demo");
  });

  it("rejects duplicate create and missing get", async () => {
    await call("create_project", { slug: "dup", name: "Dup" });
    const dup = await client.callTool({ name: "create_project", arguments: { slug: "dup", name: "Dup" } });
    expect((dup as any).isError).toBe(true);

    const miss = await client.callTool({ name: "get_project", arguments: { slug: "ghost" } });
    expect((miss as any).isError).toBe(true);
  });

  it("updates a project (agent keeps registry alive)", async () => {
    await call("create_project", { slug: "live", name: "Live", stage: "mvp" });
    const upd = await call("update_project", {
      slug: "live", stage: "active", tests_status: "green",
      next_steps: ["ship it"],
    });
    expect(upd.stage).toBe("active");
    expect(upd.tests_status).toBe("green");
    expect(upd.next_steps).toEqual(["ship it"]);
  });

  it("scans this repo and proposes stack", async () => {
    const scan = await call("scan_repo", { path: process.cwd() });
    expect(scan.language).toBe("TypeScript");
    expect(scan.frameworks).toEqual(expect.arrayContaining(["MCP SDK"]));
  });

  it("upserts skills and prompts", async () => {
    await call("upsert_skill", { slug: "sk", name: "Sk", what_it_does: "stuff" });
    expect((await call("list_skills")).map((s: any) => s.slug)).toContain("sk");

    await call("upsert_prompt", { slug: "pr", name: "Pr", body: "do X" });
    expect((await call("get_prompt", { slug: "pr" })).body).toBe("do X");
  });

  it("get_project keeps returning the FORGE wave1 dev-state fields untouched by a partial update", async () => {
    await call("create_project", { slug: "state1", name: "State1" });
    const upd = await call("update_project", { slug: "state1", stage: "active" });
    // partial update only touched `stage` — track/health_score/has_* must not be reset/clobbered
    expect(upd.track).toBe("B");
    expect(upd.health_score).toBe(0);
    expect(upd.has_architecture).toBe(false);
    const got = await call("get_project", { slug: "state1" });
    expect(got.track).toBe("B");
    expect(got.stage).toBe("active");
  });
});

describe("specs registry (FORGE wave1 §5)", () => {
  it("get_project returns specs[] and open_specs for a mix of open and closed specs", async () => {
    await call("create_project", { slug: "specy", name: "Specy" });
    upsertSpec({ project_slug: "specy", file: ".ai-codex/specs/spec-open.md", title: "Open one", stories_total: 4, stories_done: 2 });
    upsertSpec({ project_slug: "specy", file: ".ai-codex/specs/spec-closed.md", title: "Closed one", stories_total: 5, stories_done: 5, has_block: false });

    const got = await call("get_project", { slug: "specy" });
    expect(got.specs).toHaveLength(2);
    expect(got.specs.map((s: any) => s.file).sort()).toEqual([
      ".ai-codex/specs/spec-closed.md",
      ".ai-codex/specs/spec-open.md",
    ]);
    const open = got.specs.find((s: any) => s.file === ".ai-codex/specs/spec-open.md");
    expect(open.title).toBe("Open one");
    expect(open.stories_total).toBe(4);
    expect(open.stories_done).toBe(2);
    expect(open.has_block).toBe(false);
    expect(got.open_specs).toBe(1); // only spec-open.md counts as open (4/2), spec-closed.md is 5/5
  });

  it("get_project on a project with no specs returns an empty specs[] and open_specs 0", async () => {
    await call("create_project", { slug: "nospecs", name: "NoSpecs" });
    const got = await call("get_project", { slug: "nospecs" });
    expect(got.specs).toEqual([]);
    expect(got.open_specs).toBe(0);
  });

  it("open-spec criterion: 0/0 open, 5/5 closed, 4/2 open", async () => {
    await call("create_project", { slug: "criteria", name: "Criteria" });
    upsertSpec({ project_slug: "criteria", file: "zero.md", stories_total: 0, stories_done: 0 });
    upsertSpec({ project_slug: "criteria", file: "full.md", stories_total: 5, stories_done: 5 });
    upsertSpec({ project_slug: "criteria", file: "partial.md", stories_total: 4, stories_done: 2 });

    const got = await call("get_project", { slug: "criteria" });
    const byFile = Object.fromEntries(got.specs.map((s: any) => [s.file, s]));
    expect(got.specs).toHaveLength(3);
    expect(got.open_specs).toBe(2); // zero.md (0/0) + partial.md (4/2) are open, full.md (5/5) is closed
    expect(byFile["zero.md"].stories_total).toBe(0);
    expect(byFile["full.md"].stories_done).toBe(5);
  });

  it("list_projects reports open_specs per project via a single aggregate, 0 for a project without specs", async () => {
    await call("create_project", { slug: "withopen", name: "WithOpen" });
    await call("create_project", { slug: "withclosedonly", name: "WithClosedOnly" });
    await call("create_project", { slug: "barespecs", name: "BareSpecs" });
    upsertSpec({ project_slug: "withopen", file: "a.md", stories_total: 3, stories_done: 1 });
    upsertSpec({ project_slug: "withclosedonly", file: "b.md", stories_total: 2, stories_done: 2 });

    const list = await call("list_projects");
    const byslug = Object.fromEntries(list.map((p: any) => [p.slug, p]));
    expect(byslug.withopen.open_specs).toBe(1);
    expect(byslug.withclosedonly.open_specs).toBe(0);
    expect(byslug.barespecs.open_specs).toBe(0); // no specs at all — still present with 0, not missing
  });
});
