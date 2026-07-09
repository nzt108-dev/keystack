import { describe, it, expect, beforeEach } from "vitest";
import {
  getDb,
  listProjects, getProject, createProject, updateProject,
  upsertProject, deleteProject, searchProjects,
  listSkills, getSkill, upsertSkill, deleteSkill,
  listPrompts, getPrompt, upsertPrompt, deletePrompt,
} from "../src/db/index.js";

beforeEach(() => {
  getDb().exec("DELETE FROM projects; DELETE FROM skills; DELETE FROM prompts;");
});

describe("projects", () => {
  it("creates a project with defaults and parsed arrays", () => {
    const p = createProject({ slug: "alpha", name: "Alpha" });
    expect(p.slug).toBe("alpha");
    expect(p.stage).toBe("idea");
    expect(p.frameworks).toEqual([]);
    expect(p.created_at).toBeTruthy();
  });

  it("round-trips JSON array columns", () => {
    createProject({ slug: "beta", name: "Beta", frameworks: ["Next.js", "React"], services: ["stripe"] as any });
    const p = getProject("beta")!;
    expect(p.frameworks).toEqual(["Next.js", "React"]);
    // bare strings normalize to ServiceRef objects (backward compatible)
    expect(p.services).toEqual([{ provider: "stripe" }]);
  });

  it("stores services with accounts and tasks with done state", () => {
    createProject({
      slug: "acc", name: "Acc",
      services: [{ provider: "supabase", account: "Supabase 2" }, { provider: "resend" }],
      tasks: [{ text: "schema", done: true }, { text: "auth", done: false }],
    });
    const p = getProject("acc")!;
    expect(p.services).toEqual([{ provider: "supabase", account: "Supabase 2" }, { provider: "resend" }]);
    expect(p.tasks).toEqual([{ text: "schema", done: true }, { text: "auth", done: false }]);
  });

  it("normalizes bare-string tasks to done:false", () => {
    createProject({ slug: "t", name: "T", tasks: ["do thing"] as any });
    expect(getProject("t")!.tasks).toEqual([{ text: "do thing", done: false }]);
  });

  it("stores type, blockers and task categories", () => {
    createProject({
      slug: "m", name: "M", type: "mobile",
      blockers: ["App Store review", "HealthKit entitlement"],
      tasks: [{ text: "login", done: false, category: "frontend" }],
    });
    const p = getProject("m")!;
    expect(p.type).toBe("mobile");
    expect(p.blockers).toEqual(["App Store review", "HealthKit entitlement"]);
    expect(p.tasks[0].category).toBe("frontend");
  });

  it("partial-updates only provided fields and bumps last_touched", async () => {
    const created = createProject({ slug: "g", name: "G", stage: "idea", language: "TS" });
    await new Promise((r) => setTimeout(r, 5));
    const updated = updateProject("g", { stage: "active" })!;
    expect(updated.stage).toBe("active");
    expect(updated.language).toBe("TS"); // untouched
    expect(updated.last_touched! >= created.last_touched!).toBe(true);
  });

  it("upsertProject creates then updates by slug", () => {
    upsertProject({ slug: "u", name: "U", stage: "idea" });
    upsertProject({ slug: "u", name: "U2", stage: "shipped" });
    expect(listProjects()).toHaveLength(1);
    expect(getProject("u")!.stage).toBe("shipped");
    expect(getProject("u")!.name).toBe("U2");
  });

  it("deletes a project", () => {
    createProject({ slug: "d", name: "D" });
    expect(deleteProject("d")).toBe(true);
    expect(getProject("d")).toBeNull();
    expect(deleteProject("missing")).toBe(false);
  });

  it("updateProject on missing slug returns null", () => {
    expect(updateProject("nope", { stage: "active" })).toBeNull();
  });

  it("searches across name, stack and services", () => {
    createProject({ slug: "s1", name: "Shop", frameworks: ["Next.js"], services: ["resend"] });
    createProject({ slug: "s2", name: "Bot", language: "Python" });
    expect(searchProjects("resend").map((p) => p.slug)).toEqual(["s1"]);
    expect(searchProjects("python").map((p) => p.slug)).toEqual(["s2"]);
    expect(searchProjects("nothing")).toHaveLength(0);
  });

  it("never persists secret values — only keys_ref pointer", () => {
    const p = createProject({ slug: "k", name: "K", keys_ref: "~/.secrets/k.enc" });
    expect(p.keys_ref).toBe("~/.secrets/k.enc");
    // schema has no column for secret values at all
    const cols = getDb().prepare("PRAGMA table_info(projects)").all() as { name: string }[];
    expect(cols.some((c) => /value|secret/i.test(c.name))).toBe(false);
  });
});

describe("skills", () => {
  it("upserts and lists skills", () => {
    upsertSkill({ slug: "frontend", name: "Frontend", tags: ["design"] });
    upsertSkill({ slug: "frontend", name: "Frontend Design", what_it_does: "UI gen" });
    const s = getSkill("frontend")!;
    expect(s.name).toBe("Frontend Design");
    expect(s.what_it_does).toBe("UI gen");
    expect(s.tags).toEqual(["design"]); // preserved on update
    expect(listSkills()).toHaveLength(1);
  });

  it("stores external skill references with docs and tags", () => {
    const skill = upsertSkill({
      slug: "xquik-social-automation",
      name: "Xquik Social Automation",
      description: "X/Twitter API and MCP workflows",
      what_it_does: "Tracks Xquik docs, endpoint setup, and approval-gated publishing guidance.",
      location: "https://docs.xquik.com/mcp/overview",
      tags: ["xquik", "x-twitter", "mcp", "automation"],
    });
    expect(skill.location).toBe("https://docs.xquik.com/mcp/overview");
    expect(skill.tags).toEqual(["xquik", "x-twitter", "mcp", "automation"]);
    expect(getSkill("xquik-social-automation")!.what_it_does).toContain("approval-gated");
  });

  it("deletes a skill", () => {
    upsertSkill({ slug: "x", name: "X" });
    expect(deleteSkill("x")).toBe(true);
    expect(getSkill("x")).toBeNull();
  });
});

describe("prompts", () => {
  it("upserts prompt with body and tags", () => {
    upsertPrompt({ slug: "p", name: "P", body: "do X", category: "dev", tags: ["a"] });
    const p = getPrompt("p")!;
    expect(p.body).toBe("do X");
    expect(p.category).toBe("dev");
    expect(p.tags).toEqual(["a"]);
  });

  it("deletes a prompt", () => {
    upsertPrompt({ slug: "p", name: "P" });
    expect(deletePrompt("p")).toBe(true);
    expect(listPrompts()).toHaveLength(0);
  });
});
