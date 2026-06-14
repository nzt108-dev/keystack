import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

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
});
