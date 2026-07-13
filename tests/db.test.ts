import { describe, it, expect, beforeEach } from "vitest";
import {
  getDb,
  listProjects, getProject, createProject, updateProject,
  upsertProject, deleteProject, searchProjects,
  listSkills, getSkill, upsertSkill, deleteSkill,
  listPrompts, getPrompt, upsertPrompt, deletePrompt,
  upsertSpec, listSpecsByProject, deleteSpecsNotIn,
} from "../src/db/index.js";

beforeEach(() => {
  getDb().exec("DELETE FROM projects; DELETE FROM skills; DELETE FROM prompts; DELETE FROM specs;");
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

describe("projects — FORGE wave1 contract fields (§2.2)", () => {
  it("defaults new contract fields on create", () => {
    const p = createProject({ slug: "w1", name: "W1" });
    expect(p.track).toBe("B");
    expect(p.has_architecture).toBe(false);
    expect(p.has_invariants).toBe(false);
    expect(p.has_design_md).toBe(false);
    expect(p.has_ci).toBe(false);
    expect(p.tests_count).toBe(0);
    expect(p.tests_green).toBe(false);
    expect(p.last_audit_date).toBe("");
    expect(p.open_crit).toBe(0);
    expect(p.open_high).toBe(0);
    expect(p.health_score).toBe(0);
  });

  it("stores and round-trips explicit contract fields", () => {
    const p = createProject({
      slug: "w2", name: "W2", track: "A",
      has_architecture: true, has_invariants: true, has_design_md: true, has_ci: true,
      tests_count: 42, tests_green: true,
      last_audit_date: "2026-07-06", open_crit: 1, open_high: 3, health_score: 77,
    });
    expect(p.track).toBe("A");
    expect(p.has_architecture).toBe(true);
    expect(p.has_invariants).toBe(true);
    expect(p.has_design_md).toBe(true);
    expect(p.has_ci).toBe(true);
    expect(p.tests_count).toBe(42);
    expect(p.tests_green).toBe(true);
    expect(p.last_audit_date).toBe("2026-07-06");
    expect(p.open_crit).toBe(1);
    expect(p.open_high).toBe(3);
    expect(p.health_score).toBe(77);
  });

  it("partial-updates contract fields without touching the rest", () => {
    createProject({ slug: "w3", name: "W3" });
    const upd = updateProject("w3", { has_ci: true, tests_count: 10, tests_green: true, health_score: 55 })!;
    expect(upd.has_ci).toBe(true);
    expect(upd.tests_count).toBe(10);
    expect(upd.tests_green).toBe(true);
    expect(upd.health_score).toBe(55);
    expect(upd.track).toBe("B"); // untouched
    expect(upd.has_architecture).toBe(false); // untouched
  });
});

describe("specs", () => {
  it("upserts a spec and reads it back with defaults", () => {
    const s = upsertSpec({ project_slug: "faithly", file: ".ai-codex/specs/spec-x.md" });
    expect(s.project_slug).toBe("faithly");
    expect(s.file).toBe(".ai-codex/specs/spec-x.md");
    expect(s.title).toBe("");
    expect(s.stories_total).toBe(0);
    expect(s.stories_done).toBe(0);
    expect(s.has_block).toBe(false);
    expect(s.scanned_at).toBeTruthy(); // defaults to now() when not provided
  });

  it("upserts by (project_slug, file) — no duplicate rows, last write wins", () => {
    upsertSpec({ project_slug: "faithly", file: "a.md", title: "A", stories_total: 5, stories_done: 1 });
    upsertSpec({
      project_slug: "faithly", file: "a.md", title: "A v2",
      stories_total: 5, stories_done: 3, has_block: true,
    });
    const rows = listSpecsByProject("faithly");
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe("A v2");
    expect(rows[0].stories_done).toBe(3);
    expect(rows[0].has_block).toBe(true);
  });

  it("the same filename in different projects does not collide", () => {
    upsertSpec({ project_slug: "faithly", file: "spec-x.md" });
    upsertSpec({ project_slug: "crewup", file: "spec-x.md" });
    expect(listSpecsByProject("faithly")).toHaveLength(1);
    expect(listSpecsByProject("crewup")).toHaveLength(1);
  });

  it("lists specs scoped to the requested project only", () => {
    upsertSpec({ project_slug: "faithly", file: "a.md" });
    upsertSpec({ project_slug: "faithly", file: "b.md" });
    upsertSpec({ project_slug: "crewup", file: "c.md" });
    expect(listSpecsByProject("faithly").map((s) => s.file).sort()).toEqual(["a.md", "b.md"]);
  });

  it("deleteSpecsNotIn removes vanished spec files but keeps the rest", () => {
    upsertSpec({ project_slug: "faithly", file: "a.md" });
    upsertSpec({ project_slug: "faithly", file: "b.md" });
    upsertSpec({ project_slug: "faithly", file: "c.md" });
    upsertSpec({ project_slug: "crewup", file: "a.md" }); // different project, must survive

    const deleted = deleteSpecsNotIn("faithly", ["a.md", "c.md"]);

    expect(deleted).toBe(1);
    expect(listSpecsByProject("faithly").map((s) => s.file).sort()).toEqual(["a.md", "c.md"]);
    expect(listSpecsByProject("crewup")).toHaveLength(1); // untouched
  });

  it("deleteSpecsNotIn with an empty file list clears all specs for that project only", () => {
    upsertSpec({ project_slug: "faithly", file: "a.md" });
    upsertSpec({ project_slug: "crewup", file: "z.md" });
    deleteSpecsNotIn("faithly", []);
    expect(listSpecsByProject("faithly")).toHaveLength(0);
    expect(listSpecsByProject("crewup")).toHaveLength(1);
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
