#!/usr/bin/env node
/**
 * KeyStack local dashboard — the human-facing view of the registry.
 * Localhost only. Read-first in this MVP slice (projects/skills/prompts grid);
 * editing forms land in the next iteration. The agent writes via MCP.
 */
import Fastify from "fastify";
import {
  listProjects,
  listSkills,
  listPrompts,
  type Project,
} from "../db/index.js";

const app = Fastify({ logger: false });
const PORT = Number(process.env.KEYSTACK_PORT ?? 4319);

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!
  );

const stageColor: Record<string, string> = {
  idea: "#8a8a8a", mvp: "#d9a441", active: "#4a9d6b",
  paused: "#b06a4a", shipped: "#4a7dd9",
};

function projectCard(p: Project): string {
  const chips = [p.language, ...p.frameworks, p.database].filter(Boolean)
    .map((t) => `<span class="chip">${esc(t)}</span>`).join("");
  const services = p.services.map((s) => `<span class="svc">${esc(s)}</span>`).join("");
  const next = p.next_steps.slice(0, 3).map((n) => `<li>${esc(n)}</li>`).join("");
  return `<div class="card">
    <div class="card-head">
      <h3>${esc(p.name)}</h3>
      <span class="stage" style="background:${stageColor[p.stage] ?? "#666"}">${esc(p.stage)}</span>
    </div>
    <p class="desc">${esc(p.description) || "<i>no description</i>"}</p>
    <div class="chips">${chips}</div>
    ${services ? `<div class="svcs">🔌 ${services}</div>` : ""}
    <div class="meta">
      <span class="tests tests-${esc(p.tests_status)}">tests: ${esc(p.tests_status)}</span>
      ${p.github_url ? `<a href="${esc(p.github_url)}" target="_blank">GitHub ↗</a>` : ""}
    </div>
    ${next ? `<div class="next"><b>Next:</b><ul>${next}</ul></div>` : ""}
  </div>`;
}

app.get("/api/projects", async () => listProjects());
app.get("/api/skills", async () => listSkills());
app.get("/api/prompts", async () => listPrompts());

app.get("/", async (_req, reply) => {
  const projects = listProjects();
  const skills = listSkills();
  const prompts = listPrompts();
  reply.type("text/html").send(`<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>KeyStack</title>
<style>
  :root { --bg:#0e0f13; --panel:#171922; --ink:#e7e7ea; --dim:#9a9aa6; --line:#262833; --accent:#d9a441; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--ink); font:14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif; }
  header { padding:24px 28px; border-bottom:1px solid var(--line); display:flex; align-items:baseline; gap:14px; }
  header h1 { margin:0; font-size:20px; letter-spacing:.5px; }
  header .sub { color:var(--dim); }
  .wrap { padding:24px 28px; max-width:1200px; margin:0 auto; }
  h2 { font-size:13px; text-transform:uppercase; letter-spacing:1px; color:var(--dim); margin:28px 0 14px; }
  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(300px,1fr)); gap:14px; }
  .card { background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:16px; }
  .card-head { display:flex; justify-content:space-between; align-items:center; gap:8px; }
  .card h3 { margin:0; font-size:15px; }
  .stage { font-size:11px; padding:2px 9px; border-radius:20px; color:#0e0f13; font-weight:600; }
  .desc { color:var(--dim); margin:8px 0 12px; min-height:20px; }
  .chips { display:flex; flex-wrap:wrap; gap:6px; }
  .chip { background:#21242f; border:1px solid var(--line); padding:2px 9px; border-radius:6px; font-size:12px; }
  .svcs { margin-top:10px; color:var(--dim); font-size:12px; }
  .svc { color:var(--accent); margin-right:6px; }
  .meta { display:flex; gap:14px; align-items:center; margin-top:12px; font-size:12px; }
  .meta a { color:var(--accent); text-decoration:none; }
  .tests-green { color:#5fc98a; } .tests-partial { color:#d9a441; } .tests-none { color:var(--dim); }
  .next { margin-top:12px; font-size:12px; color:var(--dim); border-top:1px solid var(--line); padding-top:10px; }
  .next ul { margin:4px 0 0; padding-left:18px; }
  .empty { color:var(--dim); padding:20px; border:1px dashed var(--line); border-radius:12px; }
  .skill, .prompt { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:12px 14px; }
  .skill h4, .prompt h4 { margin:0 0 4px; font-size:14px; }
  .skill p, .prompt p { margin:0; color:var(--dim); font-size:12px; }
</style></head><body>
<header><h1>🗂️ KeyStack</h1><span class="sub">live project registry · ${projects.length} projects · ${skills.length} skills · ${prompts.length} prompts</span></header>
<div class="wrap">
  <h2>Projects</h2>
  ${projects.length ? `<div class="grid">${projects.map(projectCard).join("")}</div>`
    : `<div class="empty">No projects yet. Add one via the MCP tool <code>create_project</code> or your agent.</div>`}

  <h2>Skills</h2>
  ${skills.length ? `<div class="grid">${skills.map((s) =>
    `<div class="skill"><h4>${esc(s.name)}</h4><p>${esc(s.what_it_does || s.description)}</p></div>`).join("")}</div>`
    : `<div class="empty">No skills stored yet.</div>`}

  <h2>Prompts</h2>
  ${prompts.length ? `<div class="grid">${prompts.map((p) =>
    `<div class="prompt"><h4>${esc(p.name)}</h4><p>${esc(p.description)} ${p.category ? `· ${esc(p.category)}` : ""}</p></div>`).join("")}</div>`
    : `<div class="empty">No prompts stored yet.</div>`}
</div></body></html>`);
});

app.listen({ port: PORT, host: "127.0.0.1" }).then(() => {
  console.error(`[keystack] dashboard → http://127.0.0.1:${PORT}`);
});
