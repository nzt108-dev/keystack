/**
 * Migration test: an existing `~/.keystack/keystack.db` built with the pre-wave1 schema
 * (no track, no has_ / tests_ / health_score columns, no `specs` table) must upgrade in place
 * — existing project rows survive, new columns appear with contract defaults, `specs` exists.
 *
 * This is a dedicated file (not part of db.test.ts) so it gets its own fresh module registry
 * and its own KEYSTACK_HOME temp dir (via tests/setup.ts) — the fixture DB must be written to
 * disk with the OLD schema *before* the data layer's getDb() ever opens/migrates it.
 */
import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { join } from "node:path";

describe("schema migration (old DB -> FORGE wave1 contract)", () => {
  it("adds new projects columns + specs table without losing existing data", async () => {
    const dbPath = join(process.env.KEYSTACK_HOME!, "keystack.db");

    // 1. Build a fixture DB using the OLD (pre-wave1) schema, with one existing project row.
    const old = new Database(dbPath);
    old.exec(`
      CREATE TABLE projects (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        slug         TEXT UNIQUE NOT NULL,
        name         TEXT NOT NULL,
        description  TEXT DEFAULT '',
        type         TEXT DEFAULT '',
        stage        TEXT DEFAULT 'idea',
        blockers     TEXT DEFAULT '[]',
        language     TEXT DEFAULT '',
        frameworks   TEXT DEFAULT '[]',
        database     TEXT DEFAULT '',
        services     TEXT DEFAULT '[]',
        tasks        TEXT DEFAULT '[]',
        tests_status TEXT DEFAULT 'none',
        tests_note   TEXT DEFAULT '',
        github_url   TEXT DEFAULT '',
        next_steps   TEXT DEFAULT '[]',
        keys_ref     TEXT DEFAULT '',
        local_path   TEXT DEFAULT '',
        last_touched TEXT,
        created_at   TEXT NOT NULL
      );
      CREATE TABLE skills (
        id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
        description TEXT DEFAULT '', what_it_does TEXT DEFAULT '', location TEXT DEFAULT '',
        tags TEXT DEFAULT '[]', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE prompts (
        id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
        description TEXT DEFAULT '', category TEXT DEFAULT '', body TEXT DEFAULT '',
        tags TEXT DEFAULT '[]', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
    `);
    old
      .prepare(
        `INSERT INTO projects (slug, name, stage, language, local_path, created_at, last_touched)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run("legacy", "Legacy Project", "active", "Python", "/tmp/legacy", "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");
    old.close();

    // 2. Fresh import of the data layer -> getDb() opens this exact file and must migrate it.
    const { getDb, getProject } = await import("../src/db/index.js");
    const db = getDb();

    // Existing data intact.
    const p = getProject("legacy")!;
    expect(p).toBeTruthy();
    expect(p.name).toBe("Legacy Project");
    expect(p.stage).toBe("active");
    expect(p.language).toBe("Python");
    expect(p.local_path).toBe("/tmp/legacy");

    // New columns present with contract defaults (§2.2).
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

    // spec-live-map.md story 1 columns on pre-existing DBs.
    expect(p.has_flowmap).toBe(false);
    expect(p.map_crit).toBe(0);
    expect(p.map_warn).toBe(0);

    // `specs` table created by the migration.
    const specsCols = (db.prepare("PRAGMA table_info(specs)").all() as { name: string }[]).map((c) => c.name);
    expect(specsCols).toEqual(
      expect.arrayContaining([
        "project_slug", "file", "title", "stories_total", "stories_done",
        "has_block", "updated_at", "scanned_at",
      ])
    );

    // specs table is actually usable post-migration.
    const { upsertSpec, listSpecsByProject } = await import("../src/db/index.js");
    upsertSpec({ project_slug: "legacy", file: ".ai-codex/specs/spec-x.md", title: "X" });
    expect(listSpecsByProject("legacy")).toHaveLength(1);
  });
});
