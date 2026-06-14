/**
 * Repo autofill — inspect a project folder and propose registry fields.
 * Pure read, no writes. The agent/human confirms before create_project.
 *
 * Detects: language, frameworks, database (from manifest deps),
 * github_url (from git), services (from .env.example), tests presence.
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

export interface RepoScan {
  language: string;
  frameworks: string[];
  database: string;
  services: string[];
  github_url: string;
  tests_status: "none" | "partial";
  detected_from: string[];
}

const read = (p: string): string => {
  try {
    return readFileSync(p, "utf8");
  } catch {
    return "";
  }
};

// service env-prefix → canonical name
const SERVICE_PREFIXES: Record<string, string> = {
  SUPABASE: "supabase", RESEND: "resend", OPENROUTER: "openrouter",
  STRIPE: "stripe", OPENAI: "openai", ANTHROPIC: "anthropic",
  TWILIO: "twilio", FIREBASE: "firebase", TURSO: "turso",
  NOTION: "notion", TELEGRAM: "telegram", VERCEL: "vercel",
  CLOUDFLARE: "cloudflare", AWS: "aws", SENTRY: "sentry",
  POSTMARK: "postmark", GEMINI: "gemini", GROQ: "groq",
};

function detectServicesFromEnv(dir: string): string[] {
  const found = new Set<string>();
  for (const name of [".env.example", ".env.sample", ".env.template"]) {
    const txt = read(join(dir, name));
    if (!txt) continue;
    for (const line of txt.split("\n")) {
      const key = line.split("=")[0]?.trim().toUpperCase() ?? "";
      for (const [prefix, svc] of Object.entries(SERVICE_PREFIXES)) {
        if (key.startsWith(prefix)) found.add(svc);
      }
    }
  }
  return [...found];
}

function detectGithub(dir: string): string {
  try {
    const url = execSync("git remote get-url origin", {
      cwd: dir, stdio: ["ignore", "pipe", "ignore"],
    }).toString().trim();
    if (!url) return "";
    // normalize git@github.com:owner/repo.git and https://github.com:443/owner/repo
    // → https://github.com/owner/repo (tolerate an optional :port)
    const m = url.match(/github\.com(?::\d+)?[/:]([^/]+)\/(.+?)(?:\.git)?$/);
    return m ? `https://github.com/${m[1]}/${m[2]}` : url;
  } catch {
    return "";
  }
}

function detectTests(dir: string): "none" | "partial" {
  for (const d of ["tests", "test", "__tests__", "spec"]) {
    if (existsSync(join(dir, d))) return "partial";
  }
  try {
    if (readdirSync(dir).some((f) => /\.(test|spec)\./.test(f))) return "partial";
  } catch { /* ignore */ }
  return "none";
}

export function scanRepo(dir: string): RepoScan {
  const out: RepoScan = {
    language: "", frameworks: [], database: "", services: [],
    github_url: "", tests_status: "none", detected_from: [],
  };
  const fw = new Set<string>();
  const note = (s: string) => out.detected_from.push(s);

  // --- Node / TypeScript ---
  const pkgRaw = read(join(dir, "package.json"));
  if (pkgRaw) {
    note("package.json");
    try {
      const pkg = JSON.parse(pkgRaw);
      const deps = { ...pkg.dependencies, ...pkg.devDependencies } as Record<string, string>;
      const has = (d: string) => d in deps;
      out.language = has("typescript") || existsSync(join(dir, "tsconfig.json")) ? "TypeScript" : "JavaScript";
      if (has("next")) fw.add("Next.js");
      if (has("react")) fw.add("React");
      if (has("vue")) fw.add("Vue");
      if (has("svelte")) fw.add("Svelte");
      if (has("fastify")) fw.add("Fastify");
      if (has("express")) fw.add("Express");
      if (has("@modelcontextprotocol/sdk")) fw.add("MCP SDK");
      if (has("tailwindcss")) fw.add("Tailwind");
      // database
      if (has("@supabase/supabase-js")) out.database = "Supabase/Postgres";
      else if (has("@libsql/client") || has("@libsql/kysely-libsql")) out.database = "Turso/libSQL";
      else if (has("better-sqlite3") || has("sqlite3")) out.database = "SQLite";
      else if (has("pg") || has("postgres")) out.database = "Postgres";
      else if (has("mysql2") || has("mysql")) out.database = "MySQL";
      else if (has("mongodb") || has("mongoose")) out.database = "MongoDB";
      else if (has("prisma") || has("@prisma/client")) out.database = "Prisma";
    } catch { /* malformed package.json */ }
  }

  // --- Flutter / Dart ---
  if (read(join(dir, "pubspec.yaml"))) {
    note("pubspec.yaml");
    out.language = "Dart";
    fw.add("Flutter");
    const p = read(join(dir, "pubspec.yaml"));
    if (/firebase/i.test(p)) out.database ||= "Firebase";
    if (/supabase/i.test(p)) out.database ||= "Supabase";
  }

  // --- Python ---
  const pyReq = read(join(dir, "requirements.txt"));
  const pyProj = read(join(dir, "pyproject.toml"));
  if (pyReq || pyProj) {
    note(pyReq ? "requirements.txt" : "pyproject.toml");
    out.language ||= "Python";
    const blob = (pyReq + "\n" + pyProj).toLowerCase();
    if (blob.includes("fastapi")) fw.add("FastAPI");
    if (blob.includes("django")) fw.add("Django");
    if (blob.includes("flask")) fw.add("Flask");
    if (blob.includes("celery")) fw.add("Celery");
    if (!out.database) {
      if (blob.includes("asyncpg") || blob.includes("psycopg")) out.database = "Postgres";
      else if (blob.includes("sqlalchemy")) out.database = "SQL (SQLAlchemy)";
    }
  }

  // --- Rust / Go ---
  if (read(join(dir, "Cargo.toml"))) { note("Cargo.toml"); out.language ||= "Rust"; }
  if (read(join(dir, "go.mod"))) { note("go.mod"); out.language ||= "Go"; }

  out.frameworks = [...fw];
  out.services = detectServicesFromEnv(dir);
  if (out.services.length) note(".env.example");
  out.github_url = detectGithub(dir);
  if (out.github_url) note("git remote");
  out.tests_status = detectTests(dir);

  return out;
}
