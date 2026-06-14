#!/usr/bin/env node
/**
 * KeyStack MCP server (stdio).
 * Exposes the local project/skill/prompt registry to coding agents.
 *
 * Read tools let the agent pull context; write tools let it keep the
 * registry alive (update status, tests, next steps). Secret VALUES are
 * never exposed — only the `keys_ref` pointer.
 *
 * NOTE: stdout is the JSON-RPC channel — never console.log here. Logs → stderr.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  listProjects,
  getProject,
  createProject,
  updateProject,
  searchProjects,
  listSkills,
  getSkill,
  upsertSkill,
  listPrompts,
  getPrompt,
  upsertPrompt,
} from "../db/index.js";
import { scanRepo } from "../scan/repo.js";

const server = new McpServer({ name: "keystack", version: "0.1.0" });

const json = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});
const fail = (msg: string) => ({
  content: [{ type: "text" as const, text: `Error: ${msg}` }],
  isError: true,
});

// ---- Projects: read --------------------------------------------------------

server.registerTool(
  "list_projects",
  {
    description:
      "Overview of all projects in the registry (name, slug, stage, stack, services, last touched). Call this to see the whole portfolio map.",
    inputSchema: {},
  },
  async () => json(listProjects())
);

server.registerTool(
  "get_project",
  {
    description:
      "Full context for one project by slug: description, stage, stack (language/frameworks/db), services, tests, next steps, github, keys_ref. Use at the start of work on a project.",
    inputSchema: { slug: z.string().describe("Project slug") },
  },
  async ({ slug }) => {
    const p = getProject(slug);
    return p ? json(p) : fail(`No project '${slug}'. Use list_projects to see slugs.`);
  }
);

server.registerTool(
  "search_projects",
  {
    description:
      "Find projects by free text across name, language, frameworks, database and services. E.g. 'which project uses Resend?'",
    inputSchema: { query: z.string().describe("Search text") },
  },
  async ({ query }) => json(searchProjects(query))
);

// ---- Projects: write (keep the registry alive) -----------------------------

server.registerTool(
  "create_project",
  {
    description: "Add a new project to the registry.",
    inputSchema: {
      slug: z.string(),
      name: z.string(),
      description: z.string().optional(),
      type: z.string().optional().describe("Product type: mobile | web | saas | bot | cli | api | library | desktop"),
      stage: z.enum(["idea", "mvp", "active", "paused", "shipped"]).optional(),
      blockers: z.array(z.string()).optional().describe("Must-know blockers before launch (from .ai-codex / sessions)"),
      language: z.string().optional(),
      frameworks: z.array(z.string()).optional(),
      database: z.string().optional(),
      services: z.array(z.union([
        z.string(),
        z.object({ provider: z.string(), account: z.string().optional() }),
      ])).optional().describe("Services used, optionally with which account, e.g. {provider:'supabase', account:'Supabase 2'}"),
      tasks: z.array(z.union([
        z.string(),
        z.object({ text: z.string(), done: z.boolean(), category: z.string().optional() }),
      ])).optional().describe("Tasks with done state and optional category (frontend/backend/design/devops/qa)"),
      github_url: z.string().optional(),
      local_path: z.string().optional(),
      keys_ref: z.string().optional().describe("Path pointer to local key file — NOT key values"),
    },
  },
  async (args) => {
    if (getProject(args.slug)) return fail(`Project '${args.slug}' already exists.`);
    return json(createProject(args as any));
  }
);

server.registerTool(
  "update_project",
  {
    description:
      "Update fields of an existing project — only pass what changed. Use this to keep the registry current: stage, tests, next steps, stack, services.",
    inputSchema: {
      slug: z.string(),
      description: z.string().optional(),
      type: z.string().optional().describe("Product type: mobile | web | saas | bot | cli | api | library | desktop"),
      stage: z.enum(["idea", "mvp", "active", "paused", "shipped"]).optional(),
      blockers: z.array(z.string()).optional().describe("Must-know blockers before launch"),
      language: z.string().optional(),
      frameworks: z.array(z.string()).optional(),
      database: z.string().optional(),
      services: z.array(z.union([
        z.string(),
        z.object({ provider: z.string(), account: z.string().optional() }),
      ])).optional(),
      tasks: z.array(z.union([
        z.string(),
        z.object({ text: z.string(), done: z.boolean(), category: z.string().optional() }),
      ])).optional().describe("Replace task list (done state + optional category). Keeps progress current."),
      tests_status: z.enum(["none", "partial", "green"]).optional(),
      tests_note: z.string().optional(),
      github_url: z.string().optional(),
      next_steps: z.array(z.string()).optional(),
      keys_ref: z.string().optional(),
    },
  },
  async ({ slug, ...patch }) => {
    const r = updateProject(slug, patch as any);
    return r ? json(r) : fail(`No project '${slug}'.`);
  }
);

// ---- Repo autofill ---------------------------------------------------------

server.registerTool(
  "scan_repo",
  {
    description:
      "Inspect a local project folder and propose registry fields (language, frameworks, database, services, github_url, tests). Read-only — does NOT save. Use it, then confirm and call create_project / update_project with the results.",
    inputSchema: { path: z.string().describe("Absolute path to the project folder") },
  },
  async ({ path }) => {
    try {
      return json(scanRepo(path));
    } catch (e) {
      return fail(`Could not scan '${path}': ${(e as Error).message}`);
    }
  }
);

// ---- Skills ----------------------------------------------------------------

server.registerTool(
  "list_skills",
  { description: "List all stored skills (name, description, what it does, location).", inputSchema: {} },
  async () => json(listSkills())
);

server.registerTool(
  "get_skill",
  { description: "Get one skill by slug.", inputSchema: { slug: z.string() } },
  async ({ slug }) => {
    const s = getSkill(slug);
    return s ? json(s) : fail(`No skill '${slug}'.`);
  }
);

server.registerTool(
  "upsert_skill",
  {
    description: "Add or update a skill in the registry (so you remember what skills you have).",
    inputSchema: {
      slug: z.string(),
      name: z.string(),
      description: z.string().optional(),
      what_it_does: z.string().optional(),
      location: z.string().optional(),
      tags: z.array(z.string()).optional(),
    },
  },
  async (args) => json(upsertSkill(args))
);

// ---- Prompts ---------------------------------------------------------------

server.registerTool(
  "list_prompts",
  { description: "List all stored prompts (name, description, category).", inputSchema: {} },
  async () => json(listPrompts())
);

server.registerTool(
  "get_prompt",
  { description: "Get one prompt by slug, including its full body.", inputSchema: { slug: z.string() } },
  async ({ slug }) => {
    const p = getPrompt(slug);
    return p ? json(p) : fail(`No prompt '${slug}'.`);
  }
);

server.registerTool(
  "upsert_prompt",
  {
    description: "Add or update a reusable prompt in the registry.",
    inputSchema: {
      slug: z.string(),
      name: z.string(),
      description: z.string().optional(),
      category: z.string().optional(),
      body: z.string().optional(),
      tags: z.array(z.string()).optional(),
    },
  },
  async (args) => json(upsertPrompt(args))
);

// ---- Boot ------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[keystack] MCP server ready on stdio");
}

main().catch((err) => {
  console.error("[keystack] fatal:", err);
  process.exit(1);
});
