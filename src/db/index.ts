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
  stage: string;
  language: string;
  frameworks: string[];
  database: string;
  services: string[];
  tests_status: string;
  tests_note: string;
  github_url: string;
  next_steps: string[];
  keys_ref: string;
  local_path: string;
  last_touched: string | null;
  created_at: string;
}

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

// ---- Projects --------------------------------------------------------------

function rowToProject(r: any): Project {
  return {
    slug: r.slug,
    name: r.name,
    description: r.description,
    stage: r.stage,
    language: r.language,
    frameworks: arr(r.frameworks),
    database: r.database,
    services: arr(r.services),
    tests_status: r.tests_status,
    tests_note: r.tests_note,
    github_url: r.github_url,
    next_steps: arr(r.next_steps),
    keys_ref: r.keys_ref,
    local_path: r.local_path,
    last_touched: r.last_touched,
    created_at: r.created_at,
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
      (slug, name, description, stage, language, frameworks, database, services,
       tests_status, tests_note, github_url, next_steps, keys_ref, local_path,
       last_touched, created_at)
     VALUES
      (@slug, @name, @description, @stage, @language, @frameworks, @database, @services,
       @tests_status, @tests_note, @github_url, @next_steps, @keys_ref, @local_path,
       @last_touched, @created_at)`
  ).run({
    slug: input.slug,
    name: input.name,
    description: input.description ?? "",
    stage: input.stage ?? "idea",
    language: input.language ?? "",
    frameworks: JSON.stringify(input.frameworks ?? []),
    database: input.database ?? "",
    services: JSON.stringify(input.services ?? []),
    tests_status: input.tests_status ?? "none",
    tests_note: input.tests_note ?? "",
    github_url: input.github_url ?? "",
    next_steps: JSON.stringify(input.next_steps ?? []),
    keys_ref: input.keys_ref ?? "",
    local_path: input.local_path ?? "",
    last_touched: now(),
    created_at: now(),
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
  if (patch.stage !== undefined) set("stage", patch.stage);
  if (patch.language !== undefined) set("language", patch.language);
  if (patch.frameworks !== undefined) set("frameworks", JSON.stringify(patch.frameworks));
  if (patch.database !== undefined) set("database", patch.database);
  if (patch.services !== undefined) set("services", JSON.stringify(patch.services));
  if (patch.tests_status !== undefined) set("tests_status", patch.tests_status);
  if (patch.tests_note !== undefined) set("tests_note", patch.tests_note);
  if (patch.github_url !== undefined) set("github_url", patch.github_url);
  if (patch.next_steps !== undefined) set("next_steps", JSON.stringify(patch.next_steps));
  if (patch.keys_ref !== undefined) set("keys_ref", patch.keys_ref);
  if (patch.local_path !== undefined) set("local_path", patch.local_path);
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
