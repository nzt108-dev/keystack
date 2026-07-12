/**
 * keystack-seed.ts — FORGE wave1 story 3: seed the live registry from the
 * "## 🗂️ Проекты" table in ~/.claude/CLAUDE.md, and stamp `track` on every row.
 *
 * Deterministic, idempotent, rerunnable — NOT a one-shot command:
 *   - create if the slug is missing, upsert-by-slug (never duplicates)
 *   - existing rows: only fill CONTENT fields that are currently empty
 *     (local_path, description, language, frameworks, database, services,
 *     github_url, tests_status) — never overwrite something already there
 *   - `track` is always (re)written for every row in TRACK_A / the rest,
 *     since that's the new dev-state field this story is responsible for
 *     populating, not user content being clobbered
 *   - language/frameworks/database/services/github_url/tests_status are
 *     filled via `scanRepo()` (read-only manifest inspection — package.json /
 *     pubspec.yaml / requirements.txt / git remote / .env.example), never
 *     typed in by hand from the CLAUDE.md "Стек" column (which is prose, not
 *     a source of truth for these fields — see spec-forge-wave1.md story 3)
 *
 * Usage:
 *   npx tsx scripts/keystack-seed.ts            # apply
 *   npx tsx scripts/keystack-seed.ts --dry-run   # print what would change, no writes
 *
 * Source of truth for the row list: ~/.claude/CLAUDE.md "## 🗂️ Проекты" table,
 * transcribed by hand below (parsing markdown tables reliably from bash/node
 * for a one-time seed isn't worth the fragility — story 5's
 * keystack-export-table.sh makes CLAUDE.md GENERATED from this DB going
 * forward, so this hand-transcription is a one-time bootstrap, not a
 * recurring sync path).
 */
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { getProject, createProject, updateProject } from "../src/db/index.js";
import { scanRepo } from "../src/scan/repo.js";

const PROJECTS_DIR = join(homedir(), "Projects");
const DRY_RUN = process.argv.includes("--dry-run");

const TRACK_A = new Set([
  "botseller",
  "crewup", // alias — lives in the DB as `spotbench` (ex-CrewUp rebrand), see ALIASES below
  "faithly",
  "iwanttoeatair",
  "brieftube",
  "darshan",
  "astro-psiholog",
  "architect-portfolio",
]);

/** CLAUDE.md slug -> actual DB slug, for projects that were renamed after the table row was
 * written. Only `crewup` -> `spotbench` today (ex-CrewUp/getspotbench.com rebrand, project
 * already existed in the DB as `spotbench` before this seed ran — do not create a duplicate). */
const ALIASES: Record<string, string> = {
  crewup: "spotbench",
};

interface SeedRow {
  slug: string;      // slug as it appears in the CLAUDE.md table (pre-alias)
  folder: string;     // folder name, relative to ~/Projects unless it starts with "/"
  description: string; // CLAUDE.md "Суть" column, used to fill an EMPTY description only
}

// One row per line of the CLAUDE.md "## 🗂️ Проекты" table, in table order.
const ROWS: SeedRow[] = [
  { slug: "botseller", folder: "botseller_saas", description: "Multi-tenant платформа продажи Telegram-ботов" },
  { slug: "fast-lending", folder: "fast-lending", description: "AI-автообзвон лидов + no-code лендинги" },
  { slug: "obsidian-second-mind", folder: "obsidian-second-mind", description: "MCP-сервер: Obsidian vault как Second Brain" },
  // brieftube is a two-folder monorepo (youtube-parser + yt-saas-frontend) — local_path is the
  // PRIMARY folder only (youtube-parser); the frontend folder is not a separate keystack row.
  { slug: "brieftube", folder: "youtube-parser", description: "Telegram детокс-дайджест (пивот №2)" },
  { slug: "architect-portfolio", folder: "architect-portfolio", description: "Портфолио nzt108.dev + Admin Panel + Activity API" },
  { slug: "darshan", folder: "darshan", description: "AI-платформа духовного роста" },
  { slug: "auto-transport", folder: "auto-transport-marketplace", description: "Маркетплейс автотранспорта" },
  { slug: "flow", folder: "flow", description: "Flutter ADHD-компаньон + Obsidian sync; центральный inbox задач ВСЕХ проектов" },
  { slug: "crewup", folder: "Crewup", description: "B2B маркетплейс подрядчиков (Канада), getspotbench.com" },
  { slug: "faithly", folder: "Faithly", description: "Соцсеть для христиан и церквей" },
  { slug: "vocab-lock", folder: "vocab-lock", description: "iOS Lock Screen виджет английских слов" },
  // Special case (spec §1): CLAUDE.md's "Стек" column for this row literally reads "/Applications"
  // (the built app is installed there) — that is NOT a tech stack and must not be stored as one.
  // local_path is the SOURCE folder, ~/Projects/keywordista.
  { slug: "keywordista", folder: "keywordista", description: "Self-hosted ASO-трекер App Store" },
  { slug: "ai-content-fabric", folder: "ai-content-fabric", description: "AI-конвейер Shorts/Reels (вселенная ИЗНАНКА/Nox)" },
  { slug: "content-fabric-saas", folder: "content-fabric-saas", description: "Подписочная AI-генерация контента" },
  { slug: "cover-ai", folder: "cover-ai", description: "AI-генератор обложек (Reve API)" },
  { slug: "astro-psiholog", folder: "astro-psiholog-web", description: "Сайт психолога (Next.js-rewrite, Flutter заморожен)" },
  { slug: "dance-studio", folder: "dance-studio-website", description: "Сайт танцевальной студии" },
  { slug: "earbridge", folder: "earbridge", description: "Flutter-приложение" },
  { slug: "iwanttoeatair", folder: "IWANTTOEATAIR", description: "Интернет-магазин одежды" },
  { slug: "jinn-core", folder: "jinn-core", description: "Quant trading framework" },
  { slug: "make-money-bot", folder: "make_money_bot", description: "TG-бот партнёрских программ" },
  { slug: "flipradar", folder: "norcal_deals", description: "Агрегатор скидок Сев. Калифорния" },
  { slug: "open-design", folder: "open-design", description: "Local-first дизайн-инструмент" },
  { slug: "sendler-bot", folder: "sendler_bot", description: "TG-бот массовых рассылок" },
  { slug: "social-leads", folder: "social-leads-parser", description: "Парсер лидов из соцсетей" },
  { slug: "zillow-landing", folder: "zillow-landing", description: "Лендинг лидогенерации" },
  { slug: "zillow-parser", folder: "zillow-parser", description: "Парсер Zillow с AI-анализом" },
  { slug: "keystack", folder: "keystack", description: "Витрина проектов для агентов через MCP" },
  { slug: "yarus", folder: "yarus", description: "Рогалик-сансара" },
  { slug: "compression-research", folder: "compression-capability-dissociation", description: "Research сжатия LLM" },
];

// A few acronyms that Title-Case-from-slug would otherwise mangle (ai -> Ai, tg -> Tg, ...).
const ACRONYMS: Record<string, string> = { ai: "AI", tg: "TG", cli: "CLI", ios: "iOS", aso: "ASO" };
function titleCase(slug: string): string {
  return slug
    .split("-")
    .map((w) => ACRONYMS[w.toLowerCase()] ?? w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function log(...args: unknown[]) {
  console.log(...args);
}

function main() {
  let created = 0;
  let updated = 0;
  let trackSet = 0;
  const missingPaths: string[] = [];

  for (const row of ROWS) {
    const dbSlug = ALIASES[row.slug] ?? row.slug;
    const local_path = row.folder.startsWith("/") ? row.folder : join(PROJECTS_DIR, row.folder);
    const track: "A" | "B" = TRACK_A.has(row.slug) ? "A" : "B";
    const dirExists = existsSync(local_path);
    if (!dirExists) missingPaths.push(`${dbSlug} -> ${local_path}`);

    const existing = getProject(dbSlug);

    if (!existing) {
      const scan = dirExists
        ? scanRepo(local_path)
        : { language: "", frameworks: [], database: "", services: [], github_url: "", tests_status: "none" as const };
      log(`+ create ${dbSlug} (track ${track}) local_path=${local_path}`);
      if (!DRY_RUN) {
        createProject({
          slug: dbSlug,
          name: titleCase(row.slug),
          description: row.description,
          local_path,
          track,
          language: scan.language,
          frameworks: scan.frameworks,
          database: scan.database,
          services: scan.services,
          github_url: scan.github_url,
          tests_status: scan.tests_status,
        });
      }
      created++;
      trackSet++;
      continue;
    }

    // Existing row — only fill CONTENT fields that are currently empty; track is always stamped.
    const patch: Record<string, unknown> = {};
    if (!existing.local_path && dirExists) patch.local_path = local_path;
    if (!existing.description) patch.description = row.description;

    const needsScan =
      !existing.language ||
      existing.frameworks.length === 0 ||
      !existing.database ||
      existing.services.length === 0 ||
      !existing.github_url;
    if (needsScan && dirExists) {
      const scan = scanRepo(local_path);
      if (!existing.language && scan.language) patch.language = scan.language;
      if (existing.frameworks.length === 0 && scan.frameworks.length) patch.frameworks = scan.frameworks;
      if (!existing.database && scan.database) patch.database = scan.database;
      if (existing.services.length === 0 && scan.services.length) patch.services = scan.services;
      if (!existing.github_url && scan.github_url) patch.github_url = scan.github_url;
    }

    if (existing.track !== track) patch.track = track;

    if (Object.keys(patch).length > 0) {
      log(`~ update ${dbSlug}:`, patch.track ? `track=${track}` : "", Object.keys(patch).join(","));
      if (!DRY_RUN) updateProject(dbSlug, patch as any);
      updated++;
      if (patch.track) trackSet++;
    } else {
      log(`= ${dbSlug} unchanged`);
    }
  }

  log("");
  log(`── summary: ${created} created, ${updated} existing rows patched, ${trackSet} track stamps, ${ROWS.length} rows total ──`);
  if (missingPaths.length) {
    log(`local_path not found on disk for ${missingPaths.length} row(s) (not an error, just noted):`);
    for (const m of missingPaths) log(`  ! ${m}`);
  }
  if (DRY_RUN) log("(dry run — no writes made)");
}

main();
