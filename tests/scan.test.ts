import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanRepo } from "../src/scan/repo.js";

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "keystack-scan-"));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("scanRepo", () => {
  it("detects a Next.js + Supabase TypeScript project", () => {
    writeFileSync(join(dir, "package.json"), JSON.stringify({
      dependencies: { next: "15", react: "19", "@supabase/supabase-js": "2", tailwindcss: "3" },
      devDependencies: { typescript: "5" },
    }));
    writeFileSync(join(dir, ".env.example"), "SUPABASE_URL=\nRESEND_API_KEY=\nSTRIPE_SECRET=\n");
    mkdirSync(join(dir, "tests"), { recursive: true });

    const r = scanRepo(dir);
    expect(r.language).toBe("TypeScript");
    expect(r.frameworks).toContain("Next.js");
    expect(r.frameworks).toContain("Tailwind");
    expect(r.database).toBe("Supabase/Postgres");
    expect(r.services).toEqual(expect.arrayContaining(["supabase", "resend", "stripe"]));
    expect(r.tests_status).toBe("partial");
    expect(r.detected_from).toContain("package.json");
  });

  it("detects a Python FastAPI project", () => {
    const py = mkdtempSync(join(tmpdir(), "keystack-py-"));
    writeFileSync(join(py, "requirements.txt"), "fastapi\nasyncpg\ncelery\n");
    const r = scanRepo(py);
    expect(r.language).toBe("Python");
    expect(r.frameworks).toContain("FastAPI");
    expect(r.database).toBe("Postgres");
    rmSync(py, { recursive: true, force: true });
  });

  it("returns empty-ish result for an unknown folder", () => {
    const empty = mkdtempSync(join(tmpdir(), "keystack-empty-"));
    const r = scanRepo(empty);
    expect(r.language).toBe("");
    expect(r.frameworks).toEqual([]);
    expect(r.detected_from).toEqual([]);
    rmSync(empty, { recursive: true, force: true });
  });
});
