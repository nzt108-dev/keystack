/**
 * Data layer for KeyStack. Wraps better-sqlite3 with typed repositories
 * for projects, skills and prompts. JSON columns are (de)serialized here.
 */
import Database from "better-sqlite3";
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { SCHEMA } from "./schema.js";

// ---- Types -----------------------------------------------------------------

export interface Project {
  slug: string;
  name: string;
  description: string;
  type: string;
  stage: string;
  blockers: string[];
  language: string;
  frameworks: string[];
  database: string;
  services: ServiceRef[];
  tasks: Task[];
  tests_status: string;
  tests_note: string;
  github_url: string;
  next_steps: string[];
  keys_ref: string;
  local_path: string;
  last_touched: string | null;
  created_at: string;

  // FORGE wave1 contract (§2.2) — filled by keystack-scan.sh, read by MCP/dashboard.
  track: string;                   // 'A' | 'B'
  has_architecture: boolean;
  has_invariants: boolean;
  has_design_md: boolean;
  has_ci: boolean;
  tests_count: number;
  tests_green: boolean;
  last_audit_date: string;
  open_crit: number;
  open_high: number;
  health_score: number;
}

/** A service used by a project, plus which account (e.g. supabase · "Supabase 2"). */
export interface ServiceRef { provider: string; account?: string; }

/** A project task with done state and optional category (frontend/backend/design/…). */
export interface Task { text: string; done: boolean; category?: string; }

export interface Skill {
  slug: string;
  name: string;
  description: string;
  what_it_does: string;
  location: string;
  tags: string[];
  created_at: string;
  updated_at: string;
}

export interface Prompt {
  slug: string;
  name: string;
  description: string;
  category: string;
  body: string;
  tags: string[];
  created_at: string;
  updated_at: string;
}

// ---- Connection ------------------------------------------------------------

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;
  const dir = process.env.KEYSTACK_HOME || join(homedir(), ".keystack");
  mkdirSync(dir, { recursive: true });
  _db = new Database(join(dir, "keystack.db"));
  _db.pragma("journal_mode = WAL");
  _db.exec(SCHEMA);
  // Migration: add columns to pre-existing DBs (CREATE TABLE IF NOT EXISTS won't).
  const cols = (_db.prepare("PRAGMA table_info(projects)").all() as { name: string }[]).map((c) => c.name);
  const addCol = (name: string, def: string) => {
    if (!cols.includes(name)) _db!.exec(`ALTER TABLE projects ADD COLUMN ${name} ${def}`);
  };
  addCol("tasks", "TEXT DEFAULT '[]'");
  addCol("type", "TEXT DEFAULT ''");
  addCol("blockers", "TEXT DEFAULT '[]'");
  // FORGE wave1 contract (§2.2) — dev-state fields on pre-existing DBs.
  addCol("track", "TEXT DEFAULT 'B'");
  addCol("has_architecture", "INTEGER DEFAULT 0");
  addCol("has_invariants", "INTEGER DEFAULT 0");
  addCol("has_design_md", "INTEGER DEFAULT 0");
  addCol("has_ci", "INTEGER DEFAULT 0");
  addCol("tests_count", "INTEGER DEFAULT 0");
  addCol("tests_green", "INTEGER DEFAULT 0");
  addCol("last_audit_date", "TEXT DEFAULT ''");
  addCol("open_crit", "INTEGER DEFAULT 0");
  addCol("open_high", "INTEGER DEFAULT 0");
  addCol("health_score", "INTEGER DEFAULT 0");
  // `specs` table itself is created by the CREATE TABLE IF NOT EXISTS in SCHEMA above —
  // no ALTER TABLE needed for a wholly new table.
  return _db;
}

const now = () => new Date().toISOString();
const arr = (s: unknown): string[] => {
  try {
    const v = JSON.parse(String(s ?? "[]"));
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};

/** Accept strings or {provider,account} objects → normalized ServiceRef[] (backward compatible). */
function normServices(input: unknown): ServiceRef[] {
  let v: any = input;
  if (typeof v === "string") { try { v = JSON.parse(v || "[]"); } catch { v = []; } }
  if (!Array.isArray(v)) return [];
  return v.map((it) =>
    typeof it === "string" ? { provider: it } : { provider: String(it?.provider ?? ""), account: it?.account || undefined }
  ).filter((s) => s.provider);
}

function normTasks(input: unknown): Task[] {
  let v: any = input;
  if (typeof v === "string") { try { v = JSON.parse(v || "[]"); } catch { v = []; } }
  if (!Array.isArray(v)) return [];
  return v.map((it) =>
    typeof it === "string"
      ? { text: it, done: false }
      : { text: String(it?.text ?? ""), done: !!it?.done, category: it?.category || undefined }
  ).filter((t) => t.text);
}

// ---- Projects --------------------------------------------------------------

function rowToProject(r: any): Project {
  return {
    slug: r.slug,
    name: r.name,
    description: r.description,
    type: r.type ?? "",
    stage: r.stage,
    blockers: arr(r.blockers),
    language: r.language,
    frameworks: arr(r.frameworks),
    database: r.database,
    services: normServices(r.services),
    tasks: normTasks(r.tasks),
    tests_status: r.tests_status,
    tests_note: r.tests_note,
    github_url: r.github_url,
    next_steps: arr(r.next_steps),
    keys_ref: r.keys_ref,
    local_path: r.local_path,
    last_touched: r.last_touched,
    created_at: r.created_at,

    track: r.track ?? "B",
    has_architecture: !!r.has_architecture,
    has_invariants: !!r.has_invariants,
    has_design_md: !!r.has_design_md,
    has_ci: !!r.has_ci,
    tests_count: r.tests_count ?? 0,
    tests_green: !!r.tests_green,
    last_audit_date: r.last_audit_date ?? "",
    open_crit: r.open_crit ?? 0,
    open_high: r.open_high ?? 0,
    health_score: r.health_score ?? 0,
  };
}

export function listProjects(): Project[] {
  return getDb()
    .prepare("SELECT * FROM projects ORDER BY last_touched DESC, created_at DESC")
    .all()
    .map(rowToProject);
}

export function getProject(slug: string): Project | null {
  const r = getDb().prepare("SELECT * FROM projects WHERE slug = ?").get(slug);
  return r ? rowToProject(r) : null;
}

export function createProject(input: Partial<Project> & { slug: string; name: string }): Project {
  const db = getDb();
  db.prepare(
    `INSERT INTO projects
      (slug, name, description, type, stage, blockers, language, frameworks, database, services, tasks,
       tests_status, tests_note, github_url, next_steps, keys_ref, local_path,
       last_touched, created_at,
       track, has_architecture, has_invariants, has_design_md, has_ci,
       tests_count, tests_green, last_audit_date, open_crit, open_high, health_score)
     VALUES
      (@slug, @name, @description, @type, @stage, @blockers, @language, @frameworks, @database, @services, @tasks,
       @tests_status, @tests_note, @github_url, @next_steps, @keys_ref, @local_path,
       @last_touched, @created_at,
       @track, @has_architecture, @has_invariants, @has_design_md, @has_ci,
       @tests_count, @tests_green, @last_audit_date, @open_crit, @open_high, @health_score)`
  ).run({
    slug: input.slug,
    name: input.name,
    description: input.description ?? "",
    type: input.type ?? "",
    stage: input.stage ?? "idea",
    blockers: JSON.stringify(input.blockers ?? []),
    language: input.language ?? "",
    frameworks: JSON.stringify(input.frameworks ?? []),
    database: input.database ?? "",
    services: JSON.stringify(normServices(input.services)),
    tasks: JSON.stringify(normTasks(input.tasks)),
    tests_status: input.tests_status ?? "none",
    tests_note: input.tests_note ?? "",
    github_url: input.github_url ?? "",
    next_steps: JSON.stringify(input.next_steps ?? []),
    keys_ref: input.keys_ref ?? "",
    local_path: input.local_path ?? "",
    last_touched: now(),
    created_at: now(),
    track: input.track ?? "B",
    has_architecture: input.has_architecture ? 1 : 0,
    has_invariants: input.has_invariants ? 1 : 0,
    has_design_md: input.has_design_md ? 1 : 0,
    has_ci: input.has_ci ? 1 : 0,
    tests_count: input.tests_count ?? 0,
    tests_green: input.tests_green ? 1 : 0,
    last_audit_date: input.last_audit_date ?? "",
    open_crit: input.open_crit ?? 0,
    open_high: input.open_high ?? 0,
    health_score: input.health_score ?? 0,
  });
  return getProject(input.slug)!;
}

/** Partial update — only provided fields change. Bumps last_touched. */
export function updateProject(slug: string, patch: Partial<Project>): Project | null {
  const existing = getProject(slug);
  if (!existing) return null;

  const fields: string[] = [];
  const params: Record<string, unknown> = { slug };
  const set = (col: string, val: unknown) => {
    fields.push(`${col} = @${col}`);
    params[col] = val;
  };

  if (patch.name !== undefined) set("name", patch.name);
  if (patch.description !== undefined) set("description", patch.description);
  if (patch.type !== undefined) set("type", patch.type);
  if (patch.stage !== undefined) set("stage", patch.stage);
  if (patch.blockers !== undefined) set("blockers", JSON.stringify(patch.blockers));
  if (patch.language !== undefined) set("language", patch.language);
  if (patch.frameworks !== undefined) set("frameworks", JSON.stringify(patch.frameworks));
  if (patch.database !== undefined) set("database", patch.database);
  if (patch.services !== undefined) set("services", JSON.stringify(normServices(patch.services)));
  if (patch.tasks !== undefined) set("tasks", JSON.stringify(normTasks(patch.tasks)));
  if (patch.tests_status !== undefined) set("tests_status", patch.tests_status);
  if (patch.tests_note !== undefined) set("tests_note", patch.tests_note);
  if (patch.github_url !== undefined) set("github_url", patch.github_url);
  if (patch.next_steps !== undefined) set("next_steps", JSON.stringify(patch.next_steps));
  if (patch.keys_ref !== undefined) set("keys_ref", patch.keys_ref);
  if (patch.local_path !== undefined) set("local_path", patch.local_path);
  if (patch.track !== undefined) set("track", patch.track);
  if (patch.has_architecture !== undefined) set("has_architecture", patch.has_architecture ? 1 : 0);
  if (patch.has_invariants !== undefined) set("has_invariants", patch.has_invariants ? 1 : 0);
  if (patch.has_design_md !== undefined) set("has_design_md", patch.has_design_md ? 1 : 0);
  if (patch.has_ci !== undefined) set("has_ci", patch.has_ci ? 1 : 0);
  if (patch.tests_count !== undefined) set("tests_count", patch.tests_count);
  if (patch.tests_green !== undefined) set("tests_green", patch.tests_green ? 1 : 0);
  if (patch.last_audit_date !== undefined) set("last_audit_date", patch.last_audit_date);
  if (patch.open_crit !== undefined) set("open_crit", patch.open_crit);
  if (patch.open_high !== undefined) set("open_high", patch.open_high);
  if (patch.health_score !== undefined) set("health_score", patch.health_score);
  set("last_touched", now());

  getDb()
    .prepare(`UPDATE projects SET ${fields.join(", ")} WHERE slug = @slug`)
    .run(params);
  return getProject(slug);
}

/** Create if the slug is new, otherwise update. Convenience for dashboard forms. */
export function upsertProject(input: Partial<Project> & { slug: string; name: string }): Project {
  return getProject(input.slug) ? updateProject(input.slug, input)! : createProject(input);
}

export function deleteProject(slug: string): boolean {
  return getDb().prepare("DELETE FROM projects WHERE slug = ?").run(slug).changes > 0;
}

/** Free-text search across name, slug, language, frameworks and services. */
export function searchProjects(query: string): Project[] {
  const q = `%${query.toLowerCase()}%`;
  return getDb()
    .prepare(
      `SELECT * FROM projects
       WHERE lower(name) LIKE ? OR lower(slug) LIKE ? OR lower(language) LIKE ?
          OR lower(frameworks) LIKE ? OR lower(services) LIKE ? OR lower(database) LIKE ?
       ORDER BY last_touched DESC`
    )
    .all(q, q, q, q, q, q)
    .map(rowToProject);
}

// ---- Skills ----------------------------------------------------------------

function rowToSkill(r: any): Skill {
  return { ...r, tags: arr(r.tags) };
}

export function listSkills(): Skill[] {
  return getDb().prepare("SELECT * FROM skills ORDER BY name").all().map(rowToSkill);
}

export function getSkill(slug: string): Skill | null {
  const r = getDb().prepare("SELECT * FROM skills WHERE slug = ?").get(slug);
  return r ? rowToSkill(r) : null;
}

export function deleteSkill(slug: string): boolean {
  return getDb().prepare("DELETE FROM skills WHERE slug = ?").run(slug).changes > 0;
}

/** Insert or update by slug. */
export function upsertSkill(s: Partial<Skill> & { slug: string; name: string }): Skill {
  const db = getDb();
  const existing = getSkill(s.slug);
  if (existing) {
    db.prepare(
      `UPDATE skills SET name=@name, description=@description, what_it_does=@what_it_does,
        location=@location, tags=@tags, updated_at=@updated_at WHERE slug=@slug`
    ).run({
      slug: s.slug,
      name: s.name,
      description: s.description ?? existing.description,
      what_it_does: s.what_it_does ?? existing.what_it_does,
      location: s.location ?? existing.location,
      tags: JSON.stringify(s.tags ?? existing.tags),
      updated_at: now(),
    });
  } else {
    db.prepare(
      `INSERT INTO skills (slug, name, description, what_it_does, location, tags, created_at, updated_at)
       VALUES (@slug, @name, @description, @what_it_does, @location, @tags, @created_at, @updated_at)`
    ).run({
      slug: s.slug,
      name: s.name,
      description: s.description ?? "",
      what_it_does: s.what_it_does ?? "",
      location: s.location ?? "",
      tags: JSON.stringify(s.tags ?? []),
      created_at: now(),
      updated_at: now(),
    });
  }
  return getSkill(s.slug)!;
}

// ---- Prompts ---------------------------------------------------------------

function rowToPrompt(r: any): Prompt {
  return { ...r, tags: arr(r.tags) };
}

export function listPrompts(): Prompt[] {
  return getDb().prepare("SELECT * FROM prompts ORDER BY name").all().map(rowToPrompt);
}

export function getPrompt(slug: string): Prompt | null {
  const r = getDb().prepare("SELECT * FROM prompts WHERE slug = ?").get(slug);
  return r ? rowToPrompt(r) : null;
}

export function deletePrompt(slug: string): boolean {
  return getDb().prepare("DELETE FROM prompts WHERE slug = ?").run(slug).changes > 0;
}

/** Insert or update by slug. */
export function upsertPrompt(p: Partial<Prompt> & { slug: string; name: string }): Prompt {
  const db = getDb();
  const existing = getPrompt(p.slug);
  if (existing) {
    db.prepare(
      `UPDATE prompts SET name=@name, description=@description, category=@category,
        body=@body, tags=@tags, updated_at=@updated_at WHERE slug=@slug`
    ).run({
      slug: p.slug,
      name: p.name,
      description: p.description ?? existing.description,
      category: p.category ?? existing.category,
      body: p.body ?? existing.body,
      tags: JSON.stringify(p.tags ?? existing.tags),
      updated_at: now(),
    });
  } else {
    db.prepare(
      `INSERT INTO prompts (slug, name, description, category, body, tags, created_at, updated_at)
       VALUES (@slug, @name, @description, @category, @body, @tags, @created_at, @updated_at)`
    ).run({
      slug: p.slug,
      name: p.name,
      description: p.description ?? "",
      category: p.category ?? "",
      body: p.body ?? "",
      tags: JSON.stringify(p.tags ?? []),
      created_at: now(),
      updated_at: now(),
    });
  }
  return getPrompt(p.slug)!;
}

// ---- Specs (FORGE wave1 — read-model of .ai-codex/specs/*.md, filled by keystack-scan.sh) --

export interface Spec {
  project_slug: string;
  file: string;           // path relative to project root, e.g. ".ai-codex/specs/spec-x.md"
  title: string;
  stories_total: number;
  stories_done: number;
  has_block: boolean;
  updated_at: string;      // spec file mtime, ISO UTC
  scanned_at: string;      // last scan timestamp, ISO UTC
}

function rowToSpec(r: any): Spec {
  return {
    project_slug: r.project_slug,
    file: r.file,
    title: r.title ?? "",
    stories_total: r.stories_total ?? 0,
    stories_done: r.stories_done ?? 0,
    has_block: !!r.has_block,
    updated_at: r.updated_at ?? "",
    scanned_at: r.scanned_at ?? "",
  };
}

/** Insert or update by (project_slug, file) — the scan's unit of identity for a spec. */
export function upsertSpec(s: Partial<Spec> & { project_slug: string; file: string }): Spec {
  const db = getDb();
  db.prepare(
    `INSERT INTO specs (project_slug, file, title, stories_total, stories_done, has_block, updated_at, scanned_at)
     VALUES (@project_slug, @file, @title, @stories_total, @stories_done, @has_block, @updated_at, @scanned_at)
     ON CONFLICT(project_slug, file) DO UPDATE SET
       title = @title,
       stories_total = @stories_total,
       stories_done = @stories_done,
       has_block = @has_block,
       updated_at = @updated_at,
       scanned_at = @scanned_at`
  ).run({
    project_slug: s.project_slug,
    file: s.file,
    title: s.title ?? "",
    stories_total: s.stories_total ?? 0,
    stories_done: s.stories_done ?? 0,
    has_block: s.has_block ? 1 : 0,
    updated_at: s.updated_at ?? "",
    scanned_at: s.scanned_at ?? now(),
  });
  return rowToSpec(
    db.prepare("SELECT * FROM specs WHERE project_slug = ? AND file = ?").get(s.project_slug, s.file)
  );
}

export function listSpecsByProject(project_slug: string): Spec[] {
  return getDb()
    .prepare("SELECT * FROM specs WHERE project_slug = ? ORDER BY file")
    .all(project_slug)
    .map(rowToSpec);
}

/**
 * "Open" spec count per project slug, in one GROUP BY (not N+1) — for list_projects.
 * A spec is open when stories_done < stories_total, OR stories_total == 0 (no story table yet).
 * Projects with zero specs are simply absent from the returned map (caller defaults to 0).
 */
export function countOpenSpecsByProject(): Record<string, number> {
  const rows = getDb()
    .prepare(
      `SELECT project_slug,
              SUM(CASE WHEN stories_total = 0 OR stories_done < stories_total THEN 1 ELSE 0 END) AS open_count
       FROM specs
       GROUP BY project_slug`
    )
    .all() as { project_slug: string; open_count: number }[];
  const map: Record<string, number> = {};
  for (const r of rows) map[r.project_slug] = r.open_count;
  return map;
}

/** Delete specs for a project whose file is no longer present on disk (rescan cleanup). */
export function deleteSpecsNotIn(project_slug: string, files: string[]): number {
  const db = getDb();
  if (files.length === 0) {
    return db.prepare("DELETE FROM specs WHERE project_slug = ?").run(project_slug).changes as number;
  }
  const placeholders = files.map(() => "?").join(", ");
  return db
    .prepare(`DELETE FROM specs WHERE project_slug = ? AND file NOT IN (${placeholders})`)
    .run(project_slug, ...files).changes as number;
}
