/**
 * Fixture tests for `~/.claude/scripts/keystack-export-table.sh` — the deterministic bash+sqlite3
 * table generator (FORGE wave1 §6, story 5 of .ai-codex/specs/spec-forge-wave1.md).
 *
 * Like scan.fixture.test.ts, the script itself lives outside this repo (~/.claude/scripts/,
 * shared across all projects). This suite drives the real, installed script end-to-end via
 * child_process against a temp CLAUDE.md + this test file's isolated KEYSTACK_HOME (tests/setup.ts),
 * using the CLAUDE_MD / GENERATED_FALLBACK env seams the script exposes for exactly this purpose.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { getDb, createProject } from "../src/db/index.js";

const EXPORT = join(homedir(), ".claude", "scripts", "keystack-export-table.sh");

let root: string;
let n = 0;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "keystack-export-fixture-"));
  getDb(); // create the schema in this file's isolated KEYSTACK_HOME (tests/setup.ts)
});

function tmpFile(name: string): string {
  n += 1;
  return join(root, `f${n}-${name}`);
}

function runExport(args: string[], envOverrides: Record<string, string> = {}): string {
  return execFileSync(EXPORT, args, {
    env: { ...process.env, ...envOverrides },
    encoding: "utf8",
    timeout: 15000,
  });
}

describe("keystack-export-table.sh: marker splice", () => {
  it("replaces only the content between the markers, leaving the rest of the file byte-for-byte intact", () => {
    createProject({
      slug: "export-a",
      name: "Export A",
      description: "First fixture project",
      language: "Python",
      frameworks: ["FastAPI"],
      database: "Postgres",
      local_path: "/Users/nzt108/Projects/export-a",
      track: "B",
    });
    createProject({
      slug: "export-b",
      name: "Export B",
      description: "Second fixture project",
      language: "TypeScript",
      frameworks: ["Next.js", "React"],
      database: "",
      local_path: "/Users/nzt108/Projects/export-b",
      track: "A",
    });

    const claudeMd = tmpFile("CLAUDE.md");
    const before = [
      "# CLAUDE.md — fixture",
      "",
      "## Some other section",
      "unrelated content that must not move",
      "",
      "## 🗂️ Проекты",
      "",
      "<!-- keystack:begin -->",
      "OLD STALE TABLE CONTENT",
      "<!-- keystack:end -->",
      "",
      "Каноническая строка после таблицы — must stay untouched.",
      "",
    ].join("\n");
    writeFileSync(claudeMd, before);

    const generatedFallback = tmpFile("fallback-unused.md");
    runExport([], { CLAUDE_MD: claudeMd, GENERATED_FALLBACK: generatedFallback });

    const after = readFileSync(claudeMd, "utf8");

    // Content strictly outside the markers is untouched.
    expect(after).toContain("# CLAUDE.md — fixture");
    expect(after).toContain("## Some other section");
    expect(after).toContain("unrelated content that must not move");
    expect(after).toContain("## 🗂️ Проекты");
    expect(after).toContain("Каноническая строка после таблицы — must stay untouched.");

    // Stale table content between the markers is gone, replaced by the generated one.
    expect(after).not.toContain("OLD STALE TABLE CONTENT");
    expect(after).toContain("<!-- keystack:begin -->");
    expect(after).toContain("<!-- keystack:end -->");
    expect(after).toContain("| Slug | Папка | Суть | Стек |");
    expect(after).toContain("| `export-a` | `export-a` | First fixture project | FastAPI, Python, Postgres |");
    expect(after).toContain("| `export-b` | `export-b` | Second fixture project | Next.js, React, TypeScript |");

    // The markers still bracket exactly one table (no duplication / nesting).
    expect(after.match(/<!-- keystack:begin -->/g)).toHaveLength(1);
    expect(after.match(/<!-- keystack:end -->/g)).toHaveLength(1);

    // No fallback file was written — the real target had valid markers.
    expect(existsSync(generatedFallback)).toBe(false);
  });

  it("is idempotent: running it twice in a row converges on the same output", () => {
    createProject({
      slug: "export-idem",
      name: "Idem",
      description: "Idempotency check",
      language: "Python",
      frameworks: [],
      database: "",
      local_path: "/Users/nzt108/Projects/export-idem",
      track: "B",
    });

    const claudeMd = tmpFile("CLAUDE.md");
    writeFileSync(
      claudeMd,
      ["## 🗂️ Проекты", "", "<!-- keystack:begin -->", "anything", "<!-- keystack:end -->", ""].join("\n")
    );

    runExport([], { CLAUDE_MD: claudeMd });
    const first = readFileSync(claudeMd, "utf8");
    runExport([], { CLAUDE_MD: claudeMd });
    const second = readFileSync(claudeMd, "utf8");

    expect(second).toBe(first);
  });
});

describe("keystack-export-table.sh: missing markers edge case", () => {
  it("leaves CLAUDE.md completely untouched and writes the table to the fallback file instead", () => {
    createProject({
      slug: "export-nomarkers",
      name: "No Markers",
      description: "Should not be spliced anywhere in CLAUDE.md",
      language: "",
      frameworks: [],
      database: "",
      local_path: "/Users/nzt108/Projects/export-nomarkers",
      track: "B",
    });

    const claudeMd = tmpFile("CLAUDE.md");
    const original = "# CLAUDE.md — no markers here at all\n\nJust some prose.\n";
    writeFileSync(claudeMd, original);

    const generatedFallback = tmpFile("fallback.md");
    // spawnSync (not execFileSync) because this edge case exits 0 by design (a handled outcome,
    // not a failure) — execFileSync only surfaces stderr via the thrown error on a nonzero exit.
    const result = spawnSync(EXPORT, [], {
      env: { ...process.env, CLAUDE_MD: claudeMd, GENERATED_FALLBACK: generatedFallback },
      encoding: "utf8",
      timeout: 15000,
    });
    const stderr = result.stderr ?? "";

    // CLAUDE.md is byte-for-byte untouched.
    expect(readFileSync(claudeMd, "utf8")).toBe(original);

    // The table landed in the fallback file instead, with a warning on stderr.
    expect(existsSync(generatedFallback)).toBe(true);
    const fallbackContent = readFileSync(generatedFallback, "utf8");
    expect(fallbackContent).toContain("| Slug | Папка | Суть | Стек |");
    expect(fallbackContent).toContain("export-nomarkers");
    expect(stderr.toLowerCase()).toContain("warning");
  });

  it("also takes the fallback path when CLAUDE_MD points at a nonexistent file", () => {
    const claudeMd = join(root, "does-not-exist", "CLAUDE.md");
    const generatedFallback = tmpFile("fallback2.md");

    expect(() => runExport([], { CLAUDE_MD: claudeMd, GENERATED_FALLBACK: generatedFallback })).not.toThrow();
    expect(existsSync(claudeMd)).toBe(false);
    expect(existsSync(generatedFallback)).toBe(true);
  });
});

describe("keystack-export-table.sh: --dry-run", () => {
  it("prints the table to stdout and touches neither CLAUDE_MD nor the fallback file", () => {
    createProject({
      slug: "export-dry",
      name: "Dry Run",
      description: "Dry run project",
      language: "Python",
      frameworks: ["FastAPI"],
      database: "",
      local_path: "/Users/nzt108/Projects/export-dry",
      track: "B",
    });

    const claudeMd = tmpFile("CLAUDE.md");
    writeFileSync(claudeMd, "<!-- keystack:begin -->\nold\n<!-- keystack:end -->\n");
    const generatedFallback = tmpFile("fallback3.md");

    const out = runExport(["--dry-run"], { CLAUDE_MD: claudeMd, GENERATED_FALLBACK: generatedFallback });

    expect(out).toContain("| Slug | Папка | Суть | Стек |");
    expect(out).toContain("export-dry");
    expect(readFileSync(claudeMd, "utf8")).toBe("<!-- keystack:begin -->\nold\n<!-- keystack:end -->\n");
    expect(existsSync(generatedFallback)).toBe(false);
  });
});

describe("keystack-export-table.sh: Стек column composition", () => {
  it("dedupes overlapping frameworks/language/database and skips empty fields", () => {
    createProject({
      slug: "export-stack",
      name: "Stack Compose",
      description: "Stack composition check",
      language: "Dart / Python",
      frameworks: ["Flutter", "FastAPI"],
      database: "SQLite",
      local_path: "/Users/nzt108/Projects/export-stack",
      track: "B",
    });
    createProject({
      slug: "export-stack-empty",
      name: "Stack Empty",
      description: "No stack info at all",
      language: "",
      frameworks: [],
      database: "",
      local_path: "/Users/nzt108/Projects/export-stack-empty",
      track: "B",
    });

    const out = runExport(["--dry-run"]);

    expect(out).toContain("| `export-stack` | `export-stack` | Stack composition check | Flutter, FastAPI, Dart, Python, SQLite |");
    expect(out).toContain("| `export-stack-empty` | `export-stack-empty` | No stack info at all |  |");
  });
});

describe("keystack-export-table.sh: Папка derives from basename(local_path)", () => {
  it("uses only the folder's basename, not the full path or any VPS/monorepo annotation", () => {
    createProject({
      slug: "export-folder",
      name: "Folder Check",
      description: "some project",
      local_path: "/Users/nzt108/Projects/some_weird_folder_name",
      track: "B",
    });

    const out = runExport(["--dry-run"]);

    expect(out).toContain("| `export-folder` | `some_weird_folder_name` | some project |");
    expect(out).not.toContain("/Users/nzt108/Projects/some_weird_folder_name");
  });

  it("an empty local_path renders an empty Папка cell, not an error", () => {
    createProject({
      slug: "export-nopath",
      name: "No Path",
      description: "no local path set",
      local_path: "",
      track: "B",
    });

    expect(() => runExport(["--dry-run"])).not.toThrow();
    const out = runExport(["--dry-run"]);
    expect(out).toContain("| `export-nopath` | `` | no local path set |");
  });
});
