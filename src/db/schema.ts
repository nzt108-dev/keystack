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
  stage        TEXT DEFAULT 'idea',          -- idea | mvp | active | paused | shipped
  language     TEXT DEFAULT '',
  frameworks   TEXT DEFAULT '[]',            -- JSON array
  database     TEXT DEFAULT '',
  services     TEXT DEFAULT '[]',            -- JSON array of provider names
  tests_status TEXT DEFAULT 'none',          -- none | partial | green
  tests_note   TEXT DEFAULT '',
  github_url   TEXT DEFAULT '',
  next_steps   TEXT DEFAULT '[]',            -- JSON array
  keys_ref     TEXT DEFAULT '',              -- path pointer only, NEVER values
  local_path   TEXT DEFAULT '',
  last_touched TEXT,                         -- ISO timestamp
  created_at   TEXT NOT NULL
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
`;
