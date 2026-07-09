# 🗂️ KeyStack

[![CI](https://github.com/nzt108-dev/keystack/actions/workflows/ci.yml/badge.svg)](https://github.com/nzt108-dev/keystack/actions/workflows/ci.yml)

**Live project registry for coding agents.** A local dashboard + MCP server that
remembers your whole portfolio — description, stage, stack, services, tests,
GitHub link, next steps — plus your **skills** and **prompts**. Your coding agent
(Claude Code, Codex) connects over MCP, pulls a project's context, and **keeps it
up to date itself** as it works.

Solves the pain of running 10+ projects: you stop remembering what's written in
what, which database each uses, and where you left off.

> Not a secrets manager. KeyStack never stores key **values** — at most a
> `keys_ref` pointer to a local file. Secrets never enter the agent's context.

## Why

- **One source of truth** across every project, for both you (dashboard) and the agent (MCP).
- **Self-updating** — the agent writes status/tests/next-steps via MCP, so the registry doesn't rot like a manual doc.
- **Local-first** — everything on your machine, zero cloud, zero cost.

## Install

```bash
npm install
npm run build
```

## Use

**Dashboard** (browse your portfolio):
```bash
npm run dashboard      # → http://127.0.0.1:4319
```

**MCP server** — wire it into your agent.

Claude Code (`.mcp.json`):
```json
{ "mcpServers": { "keystack": { "command": "keystack-mcp" } } }
```

Codex (`~/.codex/config.toml`):
```toml
[mcp_servers.keystack]
command = "keystack-mcp"
```

(During dev, point `command` at `npx tsx /abs/path/src/mcp/server.ts`.)

## MCP tools

| Tool | Purpose |
|------|---------|
| `list_projects` | Portfolio overview |
| `get_project` | Full context of one project |
| `search_projects` | Find by stack/service/name |
| `create_project` / `update_project` | Add / keep current (agent writes here) |
| `list_skills` / `get_skill` / `upsert_skill` | Your skill library |
| `list_prompts` / `get_prompt` / `upsert_prompt` | Your prompt library |

## Skill Seed Example

Agents can store reusable tool context with `upsert_skill`. This example adds
an approval-gated Xquik reference for X/Twitter search, monitoring, webhooks,
and publishing workflows without storing API keys in KeyStack:

```json
{
  "slug": "xquik-social-automation",
  "name": "Xquik Social Automation",
  "description": "Use Xquik's API and MCP server for X/Twitter search, extraction, monitoring, webhooks, and approval-gated publishing.",
  "what_it_does": "Keeps the Xquik docs, MCP endpoint, API key location, and safety boundaries discoverable from KeyStack's skill registry.",
  "location": "https://docs.xquik.com/mcp/overview",
  "tags": ["xquik", "x-twitter", "mcp", "social-media", "automation"]
}
```

Use `KEYSTACK_HOME` in tests or demos so example writes land in a disposable
database.

## Data

SQLite at `~/.keystack/keystack.db` (override with `KEYSTACK_HOME`). Never committed.

## Status

MVP — core registry + MCP + dashboard working. Roadmap: repo autofill, dashboard
editing forms, global search UI. See `.ai-codex/` and `docs/`.

## License

MIT
