/**
 * SQLite schema for the KeyStack registry.
 * JSON-encoded TEXT columns hold arrays/objects (frameworks, services, next_steps, tags).
 * Secret VALUES are never stored — `keys_ref` is only a path pointer.
 */

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  slug         TEXT UNIQUE NOT NULL,
  name         TEXT NOT NULL,
  description  TEXT DEFAULT '',
  type         TEXT DEFAULT '',              -- mobile | web | saas | bot | cli | api | library | desktop
  stage        TEXT DEFAULT 'idea',          -- idea | mvp | active | paused | shipped
  blockers     TEXT DEFAULT '[]',            -- JSON array of blocker strings (must-know before launch)
  language     TEXT DEFAULT '',
  frameworks   TEXT DEFAULT '[]',            -- JSON array
  database     TEXT DEFAULT '',
  services     TEXT DEFAULT '[]',            -- JSON array of {provider, account?}
  tasks        TEXT DEFAULT '[]',            -- JSON array of {text, done}
  tests_status TEXT DEFAULT 'none',          -- none | partial | green
  tests_note   TEXT DEFAULT '',
  github_url   TEXT DEFAULT '',
  next_steps   TEXT DEFAULT '[]',            -- JSON array (legacy / "what's ahead")
  keys_ref     TEXT DEFAULT '',              -- path pointer only, NEVER values
  local_path   TEXT DEFAULT '',
  last_touched TEXT,                         -- ISO timestamp
  created_at   TEXT NOT NULL,

  -- FORGE wave1 contract (§2.2): dev-state registry fields, filled by keystack-scan.sh
  track            TEXT DEFAULT 'B',         -- 'A' (full protocol) | 'B' (experiments)
  has_architecture INTEGER DEFAULT 0,        -- 0/1
  has_invariants   INTEGER DEFAULT 0,        -- 0/1
  has_design_md    INTEGER DEFAULT 0,        -- 0/1
  has_ci           INTEGER DEFAULT 0,        -- 0/1
  tests_count      INTEGER DEFAULT 0,
  tests_green      INTEGER DEFAULT 0,        -- 0/1
  last_audit_date  TEXT DEFAULT '',
  open_crit        INTEGER DEFAULT 0,
  open_high        INTEGER DEFAULT 0,
  health_score     INTEGER DEFAULT 0
);

-- FORGE wave1: spec/story registry, one row per .ai-codex/specs/*.md file (read-model — the
-- .md file is the source of truth, this table is a scan of it; never write status back).
CREATE TABLE IF NOT EXISTS specs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  project_slug  TEXT NOT NULL,
  file          TEXT NOT NULL,               -- path relative to project root
  title         TEXT DEFAULT '',
  stories_total INTEGER DEFAULT 0,
  stories_done  INTEGER DEFAULT 0,
  has_block     INTEGER DEFAULT 0,           -- 0/1
  updated_at    TEXT DEFAULT '',             -- spec file mtime, ISO UTC
  scanned_at    TEXT DEFAULT '',             -- last scan timestamp, ISO UTC
  UNIQUE(project_slug, file)
);

CREATE TABLE IF NOT EXISTS skills (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  slug         TEXT UNIQUE NOT NULL,
  name         TEXT NOT NULL,
  description  TEXT DEFAULT '',
  what_it_does TEXT DEFAULT '',
  location     TEXT DEFAULT '',              -- where the skill lives (path / repo)
  tags         TEXT DEFAULT '[]',            -- JSON array
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS prompts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  slug         TEXT UNIQUE NOT NULL,
  name         TEXT NOT NULL,
  description  TEXT DEFAULT '',
  category     TEXT DEFAULT '',
  body         TEXT DEFAULT '',
  tags         TEXT DEFAULT '[]',            -- JSON array
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_projects_slug ON projects(slug);
CREATE INDEX IF NOT EXISTS idx_skills_slug   ON skills(slug);
CREATE INDEX IF NOT EXISTS idx_prompts_slug  ON prompts(slug);
CREATE INDEX IF NOT EXISTS idx_specs_project_slug ON specs(project_slug);
`;
