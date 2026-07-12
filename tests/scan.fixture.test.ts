/**
 * Fixture tests for `scripts/keystack-scan.sh` — the deterministic bash+sqlite3
 * dev-state scanner (FORGE wave1 §2.4, story 2 of .ai-codex/specs/spec-forge-wave1.md).
 *
 * The script is vendored into this repo (scripts/keystack-scan.sh) and symlinked from
 * ~/.claude/scripts/ (shared across all of the user's projects — installed by /sync, run nightly
 * by a LaunchAgent), so this suite drives the real script end-to-end via child_process against a
 * temp project tree + the isolated per-file KEYSTACK_HOME that tests/setup.ts already points at.
 * That is the "read model" this repo owns: the scan.sh writes rows, this repo's db/index.ts reads
 * them back for assertions.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getDb, createProject, getProject, listSpecsByProject } from "../src/db/index.js";

const SCAN = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "keystack-scan.sh");

let root: string;
let n = 0;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "keystack-scan-fixture-"));
  getDb(); // create the schema in this file's isolated KEYSTACK_HOME (tests/setup.ts) before scan.sh touches it
});

/** A fresh, empty project directory under the fixture root. */
function projectDir(): string {
  n += 1;
  const dir = join(root, `p${n}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** >2KB filler so a doc clears the has_architecture/has_invariants size gate. */
function bigDoc(withTemplateMarker = false): string {
  const marker = withTemplateMarker ? "<!-- TEMPLATE -->\n" : "";
  return marker + "# Doc\n" + "x".repeat(2200);
}

/** Today's date in the LOCAL calendar day (matches how the script's `date -j -f "%Y-%m-%d"` /
 * `date -d` parse a bare date string — local midnight, not UTC — so this must not use
 * toISOString(), which is UTC and can be a different calendar day near midnight). */
function localDateStr(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function runScan(args: string[], envOverrides: Record<string, string> = {}): string {
  return execFileSync(SCAN, args, {
    env: { ...process.env, ...envOverrides },
    encoding: "utf8",
    timeout: 30000,
  });
}

describe("has_architecture / has_invariants (§2.4: file exists, >2KB, no TEMPLATE marker)", () => {
  it("flags real docs and reports 0 for missing .ai-codex entirely (no error)", () => {
    const dir = projectDir();
    mkdirSync(join(dir, ".ai-codex"), { recursive: true });
    writeFileSync(join(dir, ".ai-codex", "architecture.md"), bigDoc());
    writeFileSync(join(dir, ".ai-codex", "invariants.md"), bigDoc());
    createProject({ slug: "docs-good", name: "Docs Good", local_path: dir, track: "B" });

    runScan([dir, "--fast"]);

    const p = getProject("docs-good")!;
    expect(p.has_architecture).toBe(true);
    expect(p.has_invariants).toBe(true);
  });

  it("does not flag a template-marked or too-small doc", () => {
    const dir = projectDir();
    mkdirSync(join(dir, ".ai-codex"), { recursive: true });
    writeFileSync(join(dir, ".ai-codex", "architecture.md"), bigDoc(true)); // big but TEMPLATE-marked
    writeFileSync(join(dir, ".ai-codex", "invariants.md"), "# Invariants\ntoo short");
    createProject({ slug: "docs-bad", name: "Docs Bad", local_path: dir, track: "B" });

    runScan([dir, "--fast"]);

    const p = getProject("docs-bad")!;
    expect(p.has_architecture).toBe(false);
    expect(p.has_invariants).toBe(false);
  });

  it("a project with no .ai-codex/ at all scans to zeros, not an error", () => {
    const dir = projectDir();
    createProject({ slug: "no-codex", name: "No Codex", local_path: dir, track: "B" });

    expect(() => runScan([dir, "--fast"])).not.toThrow();

    const p = getProject("no-codex")!;
    expect(p.has_architecture).toBe(false);
    expect(p.has_invariants).toBe(false);
  });
});

describe("has_design_md (only for frontend stacks)", () => {
  it("frontend frameworks + design.md present -> 1", () => {
    const dir = projectDir();
    writeFileSync(join(dir, "design.md"), "# Design tokens");
    createProject({ slug: "frontend-design", name: "FE", local_path: dir, frameworks: ["Next.js", "React"], track: "A" });

    runScan([dir, "--fast"]);

    expect(getProject("frontend-design")!.has_design_md).toBe(true);
  });

  it("non-frontend frameworks ignore an existing design.md", () => {
    const dir = projectDir();
    writeFileSync(join(dir, "design.md"), "# Design tokens");
    createProject({ slug: "backend-design", name: "BE", local_path: dir, frameworks: ["FastAPI", "Celery"], track: "B" });

    runScan([dir, "--fast"]);

    expect(getProject("backend-design")!.has_design_md).toBe(false);
  });
});

describe("has_ci (.github/workflows/*.yml)", () => {
  it("detects a workflow file", () => {
    const dir = projectDir();
    mkdirSync(join(dir, ".github", "workflows"), { recursive: true });
    writeFileSync(join(dir, ".github", "workflows", "ci.yml"), "name: CI\non: push\njobs: {}\n");
    createProject({ slug: "with-ci", name: "CI", local_path: dir, track: "B" });

    runScan([dir, "--fast"]);

    expect(getProject("with-ci")!.has_ci).toBe(true);
  });

  it("no workflows dir -> 0", () => {
    const dir = projectDir();
    createProject({ slug: "no-ci", name: "NoCI", local_path: dir, track: "B" });

    runScan([dir, "--fast"]);

    expect(getProject("no-ci")!.has_ci).toBe(false);
  });
});

describe("has_flowmap / map_crit / map_warn (spec-live-map.md story 1)", () => {
  function writeFlowmap(dir: string, files: { mmd?: string; architecture?: unknown; uiFlow?: unknown }) {
    const fm = join(dir, ".flowmap");
    mkdirSync(fm, { recursive: true });
    if (files.mmd !== undefined) writeFileSync(join(fm, "flowmap.mmd"), files.mmd);
    if (files.architecture !== undefined) writeFileSync(join(fm, "architecture.json"), JSON.stringify(files.architecture));
    if (files.uiFlow !== undefined) writeFileSync(join(fm, "ui-flow.json"), JSON.stringify(files.uiFlow));
  }

  it("no .flowmap/ at all -> zeros, not an error", () => {
    const dir = projectDir();
    createProject({ slug: "map-none", name: "MapNone", local_path: dir, track: "B" });

    expect(() => runScan([dir, "--fast"])).not.toThrow();

    const p = getProject("map-none")!;
    expect(p.has_flowmap).toBe(false);
    expect(p.map_crit).toBe(0);
    expect(p.map_warn).toBe(0);
  });

  it("has_flowmap=1 with ui-flow.json verdict read as-is (crit/warn straight from the generator)", () => {
    const dir = projectDir();
    writeFlowmap(dir, {
      mmd: "flowchart TD\n  a-->b\n",
      uiFlow: { verdict: { crit: 1, warn: 2 }, issues: [] },
    });
    createProject({ slug: "map-uiflow", name: "MapUiFlow", local_path: dir, track: "A" });

    runScan([dir, "--fast"]);

    const p = getProject("map-uiflow")!;
    expect(p.has_flowmap).toBe(true);
    expect(p.map_crit).toBe(1);
    expect(p.map_warn).toBe(2);
  });

  it("architecture.json issues (no severity field in that contract) fold into map_warn, never map_crit", () => {
    const dir = projectDir();
    writeFlowmap(dir, {
      mmd: "flowchart TD\n  a-->b\n",
      architecture: { issues: [{ message: "known deps not found" }, { message: "another note" }] },
    });
    createProject({ slug: "map-archissues", name: "MapArchIssues", local_path: dir, track: "B" });

    runScan([dir, "--fast"]);

    const p = getProject("map-archissues")!;
    expect(p.has_flowmap).toBe(true);
    expect(p.map_crit).toBe(0);
    expect(p.map_warn).toBe(2); // 2 architecture issues, no ui-flow.json at all
  });

  it("both ui-flow.json warn and architecture.json issues combine into map_warn", () => {
    const dir = projectDir();
    writeFlowmap(dir, {
      mmd: "flowchart TD\n  a-->b\n",
      architecture: { issues: [{ message: "note" }] },
      uiFlow: { verdict: { crit: 0, warn: 3 }, issues: [] },
    });
    createProject({ slug: "map-combined", name: "MapCombined", local_path: dir, track: "B" });

    runScan([dir, "--fast"]);

    const p = getProject("map-combined")!;
    expect(p.map_crit).toBe(0);
    expect(p.map_warn).toBe(4); // 3 (ui-flow) + 1 (architecture)
  });

  it(".flowmap/ present but empty (no artifacts yet) -> has_flowmap=1, crit/warn 0", () => {
    const dir = projectDir();
    mkdirSync(join(dir, ".flowmap"), { recursive: true });
    createProject({ slug: "map-empty-dir", name: "MapEmptyDir", local_path: dir, track: "B" });

    runScan([dir, "--fast"]);

    const p = getProject("map-empty-dir")!;
    expect(p.has_flowmap).toBe(true);
    expect(p.map_crit).toBe(0);
    expect(p.map_warn).toBe(0);
  });
});

describe("tests_count (per-stack pattern, no double counting across test dirs)", () => {
  it("JS/TS stack: sums it()/test() across tests/ and src/__tests__/", () => {
    const dir = projectDir();
    mkdirSync(join(dir, "tests"), { recursive: true });
    mkdirSync(join(dir, "src", "__tests__"), { recursive: true });
    writeFileSync(join(dir, "tests", "a.test.ts"), `it("one", () => {});\ntest("two", () => {});\n`);
    writeFileSync(join(dir, "src", "__tests__", "b.test.ts"), `it("three", () => {});\n`);
    createProject({ slug: "js-tests", name: "JS", local_path: dir, track: "B" });

    runScan([dir, "--fast"]);

    expect(getProject("js-tests")!.tests_count).toBe(3);
  });

  it("Python stack (requirements.txt present): counts def test_ only", () => {
    const dir = projectDir();
    writeFileSync(join(dir, "requirements.txt"), "pytest\n");
    mkdirSync(join(dir, "tests"), { recursive: true });
    writeFileSync(
      join(dir, "tests", "test_x.py"),
      "def test_one():\n    assert True\n\ndef test_two():\n    assert True\n"
    );
    createProject({ slug: "py-tests", name: "PY", local_path: dir, track: "B" });

    runScan([dir, "--fast"]);

    expect(getProject("py-tests")!.tests_count).toBe(2);
  });
});

describe("tests_green + --fast", () => {
  it("--fast never runs the suite: tests_green stays 0 even though tests_count>0", () => {
    const dir = projectDir();
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "x", scripts: { test: 'node -e "process.exit(0)"' } }));
    mkdirSync(join(dir, "tests"), { recursive: true });
    writeFileSync(join(dir, "tests", "a.test.js"), `test("x", () => {});\n`);
    createProject({ slug: "fast-skip", name: "FastSkip", local_path: dir, track: "B" });

    runScan([dir, "--fast"]);

    const p = getProject("fast-skip")!;
    expect(p.tests_count).toBe(1);
    expect(p.tests_green).toBe(false);
  });

  it("runs npm test and marks green on exit 0", () => {
    const dir = projectDir();
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "x", scripts: { test: 'node -e "process.exit(0)"' } }));
    mkdirSync(join(dir, "tests"), { recursive: true });
    writeFileSync(join(dir, "tests", "a.test.js"), `test("x", () => {});\n`);
    createProject({ slug: "green", name: "Green", local_path: dir, track: "A" });

    runScan([dir]); // no --fast: actually runs the suite

    expect(getProject("green")!.tests_green).toBe(true);
  });

  it("marks red on a nonzero exit code (does not guess a fix)", () => {
    const dir = projectDir();
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "x", scripts: { test: 'node -e "process.exit(1)"' } }));
    mkdirSync(join(dir, "tests"), { recursive: true });
    writeFileSync(join(dir, "tests", "a.test.js"), `test("x", () => {});\n`);
    createProject({ slug: "red", name: "Red", local_path: dir, track: "B" });

    runScan([dir]);

    expect(getProject("red")!.tests_green).toBe(false);
  });

  it("a hanging test run is killed by the timeout, marked red, and does not hang the scan", () => {
    const dir = projectDir();
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name: "x", scripts: { test: 'node -e "setInterval(()=>{}, 1000)"' } })
    );
    mkdirSync(join(dir, "tests"), { recursive: true });
    writeFileSync(join(dir, "tests", "a.test.js"), `test("x", () => {});\n`);
    createProject({ slug: "hang", name: "Hang", local_path: dir, track: "B" });

    const start = Date.now();
    // KEYSTACK_SCAN_TIMEOUT is a test-only seam (default 120s in production) so this case doesn't
    // need to wait out the real timeout to prove the kill works.
    runScan([dir], { KEYSTACK_SCAN_TIMEOUT: "2" });
    const elapsed = Date.now() - start;

    expect(getProject("hang")!.tests_green).toBe(false);
    expect(elapsed).toBeLessThan(15000);
  });
});

describe("health_score (§4.2)", () => {
  it("Track A: 20*arch + 15*inv + 15*ci + min(20,tcount)*tgreen + 15*audit_fresh + 15*clean", () => {
    const dir = projectDir();
    mkdirSync(join(dir, ".ai-codex"), { recursive: true });
    mkdirSync(join(dir, ".github", "workflows"), { recursive: true });
    mkdirSync(join(dir, "tests"), { recursive: true });
    writeFileSync(join(dir, ".ai-codex", "architecture.md"), bigDoc());
    writeFileSync(join(dir, ".ai-codex", "invariants.md"), bigDoc());
    writeFileSync(join(dir, ".github", "workflows", "ci.yml"), "name: CI\n");
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "x", scripts: { test: 'node -e "process.exit(0)"' } }));
    // 25 test( occurrences -> min(20,25) = 20 points, not 25
    writeFileSync(join(dir, "tests", "a.test.js"), Array.from({ length: 25 }, (_, i) => `test("t${i}", () => {});`).join("\n"));

    createProject({
      slug: "score-a", name: "ScoreA", local_path: dir, track: "A",
      open_crit: 0, open_high: 0, last_audit_date: localDateStr(),
    });

    runScan([dir]); // full run: tests actually execute -> green

    const p = getProject("score-a")!;
    expect(p.tests_count).toBe(25);
    expect(p.tests_green).toBe(true);
    // 20(arch) + 15(inv) + 15(ci) + 20(tests, capped) + 15(audit_fresh) + 15(clean) = 100
    expect(p.health_score).toBe(100);
  });

  it("Track A: open CRIT/HIGH and a stale (or missing) audit zero out their 15-point terms", () => {
    const dir = projectDir();
    createProject({
      slug: "score-a-dirty", name: "ScoreADirty", local_path: dir, track: "A",
      open_crit: 1, open_high: 0, last_audit_date: "",
    });

    runScan([dir, "--fast"]);

    // no docs, no ci, no tests, crit>0, no audit date -> everything zero
    expect(getProject("score-a-dirty")!.health_score).toBe(0);
  });

  it("Track B: 50*inv + min(50, 5*tcount)*tgreen (softer formula, arch/ci/audit irrelevant)", () => {
    const dir = projectDir();
    mkdirSync(join(dir, ".ai-codex"), { recursive: true });
    mkdirSync(join(dir, "tests"), { recursive: true });
    writeFileSync(join(dir, ".ai-codex", "invariants.md"), bigDoc());
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "x", scripts: { test: 'node -e "process.exit(0)"' } }));
    // 12 tests -> 5*12=60, capped at 50
    writeFileSync(join(dir, "tests", "a.test.js"), Array.from({ length: 12 }, (_, i) => `test("t${i}", () => {});`).join("\n"));
    createProject({ slug: "score-b", name: "ScoreB", local_path: dir, track: "B" });

    runScan([dir]);

    const p = getProject("score-b")!;
    expect(p.tests_count).toBe(12);
    expect(p.tests_green).toBe(true);
    expect(p.health_score).toBe(100); // 50(inv) + 50(capped tests) = 100
  });
});

describe("spec parser: title, stories_total/done, has_block, upsert + cleanup", () => {
  function specGood(): string {
    return [
      "# Spec: Good Fixture Spec",
      "",
      "## Что делает",
      "- does a thing",
      "",
      "## 🚦 Clarify-гейт",
      "",
      "- Вопросы **BLOCK**: нет.",
      "",
      "## Стори",
      "",
      "| # | Стори | Сложность | Статус |",
      "|---|-------|-----------|--------|",
      "| 1 | one | S | ✅ |",
      "| 2 | two | S | ⬜ |",
      "| 3 | three | S | ⬜ |",
      "",
      "## DoD",
      "- [x] this checkbox uses ✅-adjacent markup but is OUTSIDE the Стори block and must not count: ✅",
      "",
    ].join("\n");
  }

  function specBlocked(): string {
    return [
      "# Spec: Blocked Fixture Spec",
      "",
      "## 🚦 Clarify-гейт",
      "",
      "- Вопросы **BLOCK** (без ответа пользователя исполнение не начинать):",
      "  1. need an answer first",
      "",
      "## Стори",
      "",
      "| # | Стори | Сложность | Статус |",
      "|---|-------|-----------|--------|",
      "| 1 | one | S | ⬜ |",
      "",
    ].join("\n");
  }

  function specNoStoriTable(): string {
    return ["# Spec: No Table Spec", "", "## Поведение", "- does a thing", "", "## DoD", "- [ ] done"].join("\n");
  }

  function specTemplate(): string {
    return ["# Spec: [название фичи]", "", "> Файл: `.ai-codex/specs/spec-[feature-slug].md`", "", "## Что делает"].join("\n");
  }

  it("counts ⬜/✅ only inside the Стори table block, reads has_block, and skips an unfilled template", () => {
    const dir = projectDir();
    const specsDir = join(dir, ".ai-codex", "specs");
    mkdirSync(specsDir, { recursive: true });
    writeFileSync(join(specsDir, "spec-good.md"), specGood());
    writeFileSync(join(specsDir, "spec-blocked.md"), specBlocked());
    writeFileSync(join(specsDir, "spec-no-table.md"), specNoStoriTable());
    writeFileSync(join(specsDir, "spec-template.md"), specTemplate());
    createProject({ slug: "spec-proj", name: "SpecProj", local_path: dir, track: "B" });

    runScan([dir, "--fast"]);

    const specs = listSpecsByProject("spec-proj");
    const byFile = Object.fromEntries(specs.map((s) => [s.file, s]));

    expect(byFile[".ai-codex/specs/spec-good.md"].title).toBe("Good Fixture Spec");
    expect(byFile[".ai-codex/specs/spec-good.md"].stories_total).toBe(3); // NOT 4 — the DoD ✅ is excluded
    expect(byFile[".ai-codex/specs/spec-good.md"].stories_done).toBe(1);
    expect(byFile[".ai-codex/specs/spec-good.md"].has_block).toBe(false);

    expect(byFile[".ai-codex/specs/spec-blocked.md"].has_block).toBe(true);

    expect(byFile[".ai-codex/specs/spec-no-table.md"].stories_total).toBe(0);
    expect(byFile[".ai-codex/specs/spec-no-table.md"].stories_done).toBe(0);

    // the unfilled template must not have been inserted at all
    expect(byFile[".ai-codex/specs/spec-template.md"]).toBeUndefined();
    expect(specs).toHaveLength(3);
  });

  it("a vanished spec file is removed from the DB on rescan", () => {
    const dir = projectDir();
    const specsDir = join(dir, ".ai-codex", "specs");
    mkdirSync(specsDir, { recursive: true });
    writeFileSync(join(specsDir, "spec-a.md"), specGood());
    writeFileSync(join(specsDir, "spec-b.md"), specBlocked());
    createProject({ slug: "spec-vanish", name: "SpecVanish", local_path: dir, track: "B" });

    runScan([dir, "--fast"]);
    expect(listSpecsByProject("spec-vanish")).toHaveLength(2);

    // remove a single spec file, then rescan
    rmSync(join(specsDir, "spec-b.md"));
    runScan([dir, "--fast"]);

    const remaining = listSpecsByProject("spec-vanish");
    expect(remaining).toHaveLength(1);
    expect(remaining[0].file).toBe(".ai-codex/specs/spec-a.md");
  });

  it("specs/done/ subfolder is not scanned", () => {
    const dir = projectDir();
    const specsDir = join(dir, ".ai-codex", "specs");
    mkdirSync(join(specsDir, "done"), { recursive: true });
    writeFileSync(join(specsDir, "spec-active.md"), specGood());
    writeFileSync(join(specsDir, "done", "spec-archived.md"), specBlocked());
    createProject({ slug: "spec-done-folder", name: "SpecDone", local_path: dir, track: "B" });

    runScan([dir, "--fast"]);

    const specs = listSpecsByProject("spec-done-folder");
    expect(specs.map((s) => s.file)).toEqual([".ai-codex/specs/spec-active.md"]);
  });
});

describe("--all", () => {
  it("scans every project with a non-empty local_path and reports a summary", () => {
    const dir1 = projectDir();
    const dir2 = projectDir();
    createProject({ slug: "all-1", name: "All1", local_path: dir1, track: "B" });
    createProject({ slug: "all-2", name: "All2", local_path: dir2, track: "B" });
    createProject({ slug: "all-3-no-path", name: "All3", local_path: "", track: "B" }); // must be skipped, not errored

    const out = runScan(["--all", "--fast"]);

    expect(out).toContain("all-1");
    expect(out).toContain("all-2");
    expect(out).not.toContain("all-3-no-path");
    expect(out).toMatch(/summary: \d+ ok, \d+ error/);
  });

  it("a project whose local_path no longer exists on disk is reported as an error but does not abort the sweep", () => {
    const dir = projectDir();
    createProject({ slug: "all-missing", name: "AllMissing", local_path: join(dir, "gone"), track: "B" });
    const dirOk = projectDir();
    createProject({ slug: "all-after-missing", name: "AllAfterMissing", local_path: dirOk, track: "B" });

    const out = runScan(["--all", "--fast"]);

    expect(out).toMatch(/error\(s\)/);
    // the project after the broken one still got scanned
    expect(getProject("all-after-missing")!.health_score).toBeDefined();
  });
});
