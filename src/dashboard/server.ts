#!/usr/bin/env node
/**
 * KeyStack local dashboard — human-facing view + editing of the registry.
 * Localhost only. Read + write: add/edit/delete projects, skills, prompts.
 * The agent edits via MCP; this is the manual UI.
 */
import Fastify from "fastify";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  listProjects, upsertProject, deleteProject, getProject,
  listSkills, upsertSkill, deleteSkill,
  listPrompts, upsertPrompt, deletePrompt,
  countOpenSpecsByProject,
  type Project,
} from "../db/index.js";
import { readFlowmap, FLOWMAP_STALE_DAYS, type FlowmapSummary } from "./flowmap.js";

const HERE = dirname(fileURLToPath(import.meta.url));

// FORGE wave1 §5 (open_specs) + owner-requested traffic light on health_score — dashboard
// display only, same "open" predicate as the MCP payload (src/mcp/server.ts isSpecOpen).
type ProjectWithSpecs = Project & { open_specs: number };
function withOpenSpecs(projects: Project[]): ProjectWithSpecs[] {
  const openMap = countOpenSpecsByProject();
  return projects.map((p) => ({ ...p, open_specs: openMap[p.slug] ?? 0 }));
}
function healthColor(score: number): string {
  if (score < 50) return "#ef4444";
  if (score < 80) return "#f59e0b";
  return "#22c55e";
}

const app = Fastify({ logger: false });
const PORT = Number(process.env.KEYSTACK_PORT ?? 4319);

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!
  );

const stageColor: Record<string, string> = {
  idea: "#64748b", mvp: "#f59e0b", active: "#22c55e",
  paused: "#f97316", shipped: "#3b82f6",
};

const ICON = {
  github: `<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M12 2A10 10 0 0 0 8.84 21.5c.5.08.66-.22.66-.48v-1.7c-2.77.6-3.36-1.34-3.36-1.34-.46-1.16-1.11-1.47-1.11-1.47-.9-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.9 1.52 2.34 1.08 2.91.83.1-.65.35-1.09.63-1.34-2.21-.25-4.54-1.1-4.54-4.92 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02a9.5 9.5 0 0 1 5 0c1.9-1.29 2.74-1.02 2.74-1.02.55 1.37.2 2.39.1 2.64.64.7 1.03 1.59 1.03 2.68 0 3.83-2.34 4.67-4.56 4.92.36.31.68.92.68 1.85v2.74c0 .26.16.57.67.48A10 10 0 0 0 12 2Z"/></svg>`,
  layers: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/></svg>`,
};

function projectCard(p: ProjectWithSpecs): string {
  const color = stageColor[p.stage] ?? "#64748b";
  const chips = [p.language, ...p.frameworks, p.database].filter(Boolean)
    .map((t) => `<span class="chip">${esc(t)}</span>`).join("");
  const services = p.services.map((s) =>
    `<span class="svc">${esc(s.provider)}${s.account ? `<em>·${esc(s.account)}</em>` : ""}</span>`).join("");

  const done = p.tasks.filter((t) => t.done).length;
  const total = p.tasks.length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const catLabel = (c?: string) => c ? `<span class="cat cat-${esc(c)}">${esc(c)}</span>` : "";
  const taskList = p.tasks.slice(0, 8).map((t) =>
    `<li class="${t.done ? "done" : ""}">${t.done ? "✓" : "○"} ${catLabel(t.category)}${esc(t.text)}</li>`).join("");
  const tasksBlock = total ? `<div class="tasks">
      <div class="tasks-head"><span class="next-label">tasks</span><span class="prog-num">${done}/${total}</span></div>
      <div class="bar"><i style="width:${pct}%;background:${color}"></i></div>
      <ul class="tasklist">${taskList}</ul>
    </div>` : (p.next_steps.length ? `<div class="tasks">
      <span class="next-label">next</span>
      <ul class="tasklist">${p.next_steps.slice(0, 4).map((n) => `<li>○ ${esc(n)}</li>`).join("")}</ul>
    </div>` : "");

  const blockersBlock = p.blockers.length ? `<div class="blockers">
      <div class="blk-head">⚠ blockers</div>
      <ul>${p.blockers.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>
    </div>` : "";

  return `<div class="card" data-kind="project" data-slug="${esc(p.slug)}" style="--stage:${color}">
    <div class="card-head">
      <h3>${esc(p.name)}</h3>
      <span class="stage"><i class="dot"></i>${esc(p.stage)}</span>
    </div>
    <div class="card-sub">
      <code class="slug">${esc(p.slug)}</code>
      ${p.type ? `<span class="ptype">${esc(p.type)}</span>` : ""}
    </div>
    <p class="desc">${esc(p.description) || "<i>no description</i>"}</p>
    <div class="chips">${chips || `<span class="chip chip-empty">stack unknown</span>`}</div>
    ${services ? `<div class="svcs">${services}</div>` : ""}
    ${blockersBlock}
    ${tasksBlock}
    <div class="meta">
      <span class="tests tests-${esc(p.tests_status)}"><i class="tdot"></i>tests ${esc(p.tests_status)}</span>
      <span class="health" style="color:${healthColor(p.health_score)}"><i class="tdot" style="background:${healthColor(p.health_score)}"></i>health ${p.health_score}</span>
      ${p.open_specs > 0 ? `<span class="specs">${p.open_specs} open spec${p.open_specs === 1 ? "" : "s"}</span>` : ""}
      ${p.has_flowmap ? `<a href="/map/${esc(p.slug)}">🗺 карта${p.map_crit > 0 ? ` <b class="mapcrit">${p.map_crit} CRIT</b>` : ""}</a>` : ""}
      ${p.github_url ? `<a href="${esc(p.github_url)}" target="_blank" rel="noopener">${ICON.github} repo</a>` : ""}
    </div>
    <div class="actions">
      <button class="btn-edit" data-kind="project" data-slug="${esc(p.slug)}">edit</button>
      <button class="btn-del" data-kind="project" data-slug="${esc(p.slug)}">delete</button>
    </div>
  </div>`;
}

// ---- API: read -------------------------------------------------------------
app.get("/api/projects", async () => withOpenSpecs(listProjects()));
app.get("/api/skills", async () => listSkills());
app.get("/api/prompts", async () => listPrompts());

// ---- vendored mermaid (spec-live-map.md story 1: dashboard must work offline, no CDN) --------
// Sourced from the `mermaid` npm package's browser bundle (dist/mermaid.min.js), committed into
// src/dashboard/vendor/ and copied to dist/dashboard/vendor/ by `npm run build` (see package.json).
let mermaidJsCache: Buffer | null = null;
app.get("/vendor/mermaid.min.js", async (_req, reply) => {
  if (!mermaidJsCache) {
    mermaidJsCache = readFileSync(join(HERE, "vendor", "mermaid.min.js"));
  }
  reply.type("application/javascript; charset=utf-8").send(mermaidJsCache);
});

// ---- /map/:slug — live map page (spec-live-map.md story 1, Фаза A) ----------------------------
function mapPage(project: Project | null, slug: string, flowmap: FlowmapSummary | null): string {
  if (!project) {
    return `<!doctype html><html lang="ru"><head><meta charset="utf-8">
<title>keystack — карта</title>${MAP_STYLE}</head><body>
<div class="map-wrap"><a class="back" href="/">← keystack</a>
<div class="empty">проект «${esc(slug)}» не найден в реестре.</div></div>
</body></html>`;
  }

  const fm = flowmap!;
  const staleBadge = fm.exists && fm.staleDays !== null && fm.staleDays > FLOWMAP_STALE_DAYS
    ? `<span class="badge stale">устарела · ${fm.staleDays} дн.</span>` : "";

  let body: string;
  if (!fm.exists) {
    body = `<div class="empty">🗺 карта не сгенерирована — прогони <code>/sync</code> для этого проекта, чтобы собрать <code>.flowmap/</code> артефакты.</div>`;
  } else {
    const issuesList = [
      ...fm.issues.map((i) => `<li class="issue issue-${i.severity}"><b>${i.severity.toUpperCase()}</b> · ${esc(i.kind)} — ${esc(i.message)}</li>`),
      ...fm.archIssues.map((m) => `<li class="issue issue-warn"><b>WARN</b> · граф — ${esc(m)}</li>`),
    ].join("");

    const statsBits = [
      fm.archStats ? `${fm.archStats.nodes} узлов / ${fm.archStats.edges} рёбер (архитектура)` : "",
      fm.uiStats ? `${fm.uiStats.screens} экранов / ${fm.uiStats.elements} элементов (UI-flow)` : "",
    ].filter(Boolean).join(" · ");

    const mmdBlock = fm.mmd
      ? `<div id="mermaid-render" class="mermaid-box"><span class="map-loading">рендер…</span></div>
         <script type="application/json" id="mmd-data">${JSON.stringify(fm.mmd).replace(/</g, "\\u003c")}</script>
         <script src="/vendor/mermaid.min.js"></script>
         <script>
           (async () => {
             const raw = document.getElementById('mmd-data');
             const el = document.getElementById('mermaid-render');
             const mmd = raw ? JSON.parse(raw.textContent) : null;
             if (!mmd || !el) return;
             try {
               window.mermaid.initialize({ startOnLoad: false, theme: 'dark', securityLevel: 'loose' });
               const { svg } = await window.mermaid.render('keystack-mmd', mmd);
               el.innerHTML = svg;
             } catch (err) {
               el.outerHTML = '<div class="map-error">⚠ карта повреждена — Mermaid не смог разобрать flowmap.mmd'
                 + (err && err.message ? ': ' + String(err.message).replace(/</g,'&lt;') : '') + '</div>';
             }
           })();
         </script>`
      : `<div class="map-error">⚠ ${esc(fm.mmdError || "flowmap.mmd недоступен")}</div>`;

    body = `<div class="verdict">
        <span class="badge ${fm.crit > 0 ? "crit" : "ok"}">${fm.crit} CRIT</span>
        <span class="badge ${fm.warn > 0 ? "warn" : "ok"}">${fm.warn} WARN</span>
        ${staleBadge}
        ${statsBits ? `<span class="stats">${esc(statsBits)}</span>` : ""}
      </div>
      ${issuesList ? `<ul class="issues">${issuesList}</ul>` : ""}
      ${mmdBlock}`;
  }

  return `<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>keystack — карта · ${esc(project.name)}</title>${MAP_STYLE}</head><body>
<div class="map-wrap">
  <a class="back" href="/">← keystack</a>
  <h1>${esc(project.name)} <code class="slug">${esc(project.slug)}</code></h1>
  ${body}
</div>
</body></html>`;
}

const MAP_STYLE = `<style>
  :root { --bg:#0f172a; --surface:#192234; --ink:#f1f5f9; --dim:#8a98ad; --line:#1f2a3c;
    --accent:#22c55e; --danger:#ef4444; --warnc:#f59e0b;
    --mono:'Fira Code',ui-monospace,SFMono-Regular,Menlo,monospace;
    --sans:-apple-system,Segoe UI,Roboto,sans-serif; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--ink); font:14px/1.55 var(--sans); }
  .map-wrap { max-width:1100px; margin:0 auto; padding:24px 28px 60px; }
  .back { color:var(--dim); text-decoration:none; font:12px var(--mono); }
  .back:hover { color:var(--ink); }
  h1 { font:600 20px var(--sans); margin:14px 0 18px; display:flex; align-items:center; gap:10px; }
  .slug { font:12px var(--mono); color:var(--dim); font-weight:400; }
  .empty { color:var(--dim); padding:22px; border:1px dashed var(--line); border-radius:10px; font:13px var(--mono); }
  .verdict { display:flex; align-items:center; gap:10px; margin-bottom:16px; flex-wrap:wrap; }
  .badge { font:12px var(--mono); padding:3px 10px; border-radius:20px; border:1px solid var(--line); color:var(--dim); }
  .badge.crit { color:#fecaca; background:rgba(239,68,68,.15); border-color:rgba(239,68,68,.4); }
  .badge.warn { color:#fde68a; background:rgba(245,158,11,.15); border-color:rgba(245,158,11,.4); }
  .badge.ok { color:#bbf7d0; background:rgba(34,197,94,.1); border-color:rgba(34,197,94,.3); }
  .badge.stale { color:#c7d2e0; background:rgba(148,163,184,.12); }
  .stats { font:12px var(--mono); color:var(--dim); }
  .issues { list-style:none; margin:0 0 20px; padding:0; }
  .issue { font:12px var(--mono); padding:6px 10px; border-left:2px solid var(--line); margin-bottom:4px; color:var(--dim); }
  .issue-crit { border-color:var(--danger); color:#f3b5b0; }
  .issue-warn { border-color:var(--warnc); color:#fde68a; }
  .mermaid-box { background:var(--surface); border:1px solid var(--line); border-radius:10px; padding:20px; overflow:auto; }
  .map-loading { color:var(--dim); font:12px var(--mono); }
  .map-error { color:#f3b5b0; background:rgba(239,68,68,.08); border:1px solid rgba(239,68,68,.3); border-radius:10px; padding:16px; font:13px var(--mono); }
</style>`;

app.get("/map/:slug", async (req, reply) => {
  const { slug } = req.params as { slug: string };
  const project = getProject(slug);
  if (!project) {
    reply.code(404).type("text/html").send(mapPage(null, slug, null));
    return;
  }
  const flowmap = readFlowmap(project.local_path);
  reply.type("text/html").send(mapPage(project, slug, flowmap));
});

// ---- API: write ------------------------------------------------------------
app.post("/api/projects/save", async (req) => upsertProject(req.body as any));
app.post("/api/projects/delete", async (req) => ({ ok: deleteProject((req.body as any).slug) }));
app.post("/api/skills/save", async (req) => upsertSkill(req.body as any));
app.post("/api/skills/delete", async (req) => ({ ok: deleteSkill((req.body as any).slug) }));
app.post("/api/prompts/save", async (req) => upsertPrompt(req.body as any));
app.post("/api/prompts/delete", async (req) => ({ ok: deletePrompt((req.body as any).slug) }));

app.get("/", async (_req, reply) => {
  const projects = withOpenSpecs(listProjects());
  const skills = listSkills();
  const prompts = listPrompts();
  const data = JSON.stringify({ projects, skills, prompts }).replace(/</g, "\\u003c");

  reply.type("text/html").send(`<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>KeyStack</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;500;600&family=Fira+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  :root {
    --bg:#0f172a; --surface:#192234; --muted:#1a2334; --ink:#f1f5f9; --dim:#8a98ad;
    --line:#1f2a3c; --line2:#2a374d; --accent:#22c55e; --danger:#ef4444;
    --mono:'Fira Code',ui-monospace,SFMono-Regular,Menlo,monospace;
    --sans:'Fira Sans',-apple-system,Segoe UI,Roboto,sans-serif;
  }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--ink); font:14px/1.55 var(--sans);
    background-image:radial-gradient(circle at 50% -20%, #16223a 0%, var(--bg) 55%); min-height:100vh; }
  ::selection { background:rgba(34,197,94,.25); }
  header { padding:20px 28px; border-bottom:1px solid var(--line); display:flex; align-items:center; gap:14px; }
  .brand { display:flex; align-items:center; gap:10px; color:var(--accent); }
  .brand h1 { margin:0; font:600 18px var(--mono); letter-spacing:.5px; color:var(--ink); }
  .prompt-sym { color:var(--accent); font:var(--mono); }
  header .sub { font:12px var(--mono); color:var(--dim); margin-left:auto; display:flex; align-items:center; gap:7px; }
  header .sub .live { width:7px; height:7px; border-radius:50%; background:var(--accent); box-shadow:0 0 8px var(--accent); }
  .wrap { padding:8px 28px 48px; max-width:1240px; margin:0 auto; }
  .sec-head { display:flex; align-items:center; gap:12px; margin:34px 0 16px; }
  h2 { font:600 12px var(--mono); text-transform:uppercase; letter-spacing:1.5px; color:var(--dim); margin:0; }
  h2::before { content:'# '; color:var(--accent); }
  .count { font:11px var(--mono); color:var(--dim); }
  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(310px,1fr)); gap:14px; }
  .card,.skill,.prompt { background:var(--surface); border:1px solid var(--line); border-radius:10px; padding:16px 16px 14px; position:relative; cursor:pointer; transition:border-color .18s, transform .18s, box-shadow .18s; }
  .card button,.skill button,.prompt button,.card a { cursor:pointer; }
  .card { border-left:3px solid var(--stage); }
  .card:hover,.skill:hover,.prompt:hover { border-color:var(--line2); transform:translateY(-2px); box-shadow:0 8px 24px -12px rgba(0,0,0,.6); }
  .card:hover { box-shadow:-3px 8px 24px -12px var(--stage); }
  .card-head { display:flex; justify-content:space-between; align-items:flex-start; gap:8px; }
  .card h3 { margin:0; font:600 15px var(--sans); }
  .stage { font:11px var(--mono); color:var(--stage); display:flex; align-items:center; gap:5px; white-space:nowrap; }
  .stage .dot { width:6px; height:6px; border-radius:50%; background:var(--stage); }
  .card-sub { display:flex; align-items:center; gap:9px; margin-top:4px; flex-wrap:wrap; }
  .slug { font:11px var(--mono); color:var(--dim); }
  .ptype { font:10px var(--mono); text-transform:uppercase; letter-spacing:.5px; color:#a9b6cb; background:var(--muted); border:1px solid var(--line2); padding:1px 7px; border-radius:4px; }
  .chip-empty { color:#5a6678; font-style:italic; border-style:dashed; }
  .blockers { margin-top:13px; padding:10px 12px; border:1px solid rgba(239,68,68,.35); background:rgba(239,68,68,.07); border-radius:8px; }
  .blk-head { font:10px var(--mono); text-transform:uppercase; letter-spacing:1px; color:#f87171; }
  .blockers ul { margin:6px 0 0; padding-left:16px; font-size:12px; color:#f3b5b0; }
  .blockers li { padding:1px 0; }
  .cat { font:9px var(--mono); text-transform:uppercase; letter-spacing:.5px; padding:0 5px; border-radius:3px; margin-right:5px; background:var(--muted); color:var(--dim); }
  .cat-frontend { color:#93c5fd; background:rgba(59,130,246,.14); }
  .cat-backend { color:#86efac; background:rgba(34,197,94,.14); }
  .cat-design { color:#d8b4fe; background:rgba(168,85,247,.14); }
  .cat-devops { color:#fdba74; background:rgba(249,115,22,.14); }
  .cat-qa { color:#fde047; background:rgba(234,179,8,.14); }
  .cat-infra { color:#67e8f9; background:rgba(6,182,212,.14); }
  .cat-content { color:#f9a8d4; background:rgba(236,72,153,.14); }
  .desc { color:var(--dim); margin:9px 0 12px; min-height:18px; font-size:13px; }
  .chips { display:flex; flex-wrap:wrap; gap:6px; }
  .chip { font:11px var(--mono); background:var(--muted); border:1px solid var(--line); color:#c7d2e0; padding:2px 8px; border-radius:5px; }
  .svcs { display:flex; flex-wrap:wrap; gap:6px; margin-top:9px; }
  .svc { font:11px var(--mono); color:var(--accent); }
  .svc::before { content:'⬡ '; opacity:.7; }
  .svc em { font-style:normal; color:var(--dim); }
  .tasks { margin-top:13px; padding-top:11px; border-top:1px solid var(--line); }
  .tasks-head { display:flex; justify-content:space-between; align-items:center; }
  .prog-num { font:10px var(--mono); color:var(--dim); }
  .bar { height:4px; border-radius:3px; background:var(--muted); margin:7px 0 9px; overflow:hidden; }
  .bar i { display:block; height:100%; border-radius:3px; transition:width .4s ease; }
  .tasklist { list-style:none; margin:0; padding:0; font:11.5px var(--mono); }
  .tasklist li { color:var(--dim); padding:1px 0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .tasklist li.done { color:#5a6678; text-decoration:line-through; }
  .meta { display:flex; gap:16px; align-items:center; margin-top:13px; font:11px var(--mono); }
  .meta a { color:var(--dim); text-decoration:none; display:flex; align-items:center; gap:5px; transition:color .15s; }
  .meta a:hover { color:var(--ink); }
  .tests { display:flex; align-items:center; gap:5px; color:var(--dim); }
  .tests .tdot { width:6px; height:6px; border-radius:50%; background:currentColor; }
  .tests-green { color:#22c55e; } .tests-partial { color:#f59e0b; } .tests-none { color:#5a6678; }
  .health { display:flex; align-items:center; gap:5px; }
  .specs { color:#f59e0b; }
  .mapcrit { color:#f87171; font-weight:600; }
  .next { margin-top:13px; padding-top:11px; border-top:1px solid var(--line); }
  .next-label { font:10px var(--mono); text-transform:uppercase; letter-spacing:1px; color:var(--accent); }
  .next ul { margin:5px 0 0; padding-left:16px; color:var(--dim); font-size:12px; }
  .skill h4, .prompt h4 { margin:0 0 5px; font:600 14px var(--sans); }
  .skill p, .prompt p { margin:0; color:var(--dim); font-size:12px; }
  .tag { font:10px var(--mono); color:var(--dim); }
  .actions { margin-top:13px; display:flex; gap:8px; }
  button { font:12px var(--mono); cursor:pointer; border-radius:6px; border:1px solid var(--line); background:var(--muted); color:var(--dim); padding:5px 12px; transition:.15s; }
  button:hover { border-color:var(--line2); color:var(--ink); }
  .btn-add { background:transparent; color:var(--accent); border-color:rgba(34,197,94,.4); }
  .btn-add:hover { background:rgba(34,197,94,.1); color:var(--accent); border-color:var(--accent); }
  .btn-del:hover { border-color:var(--danger); color:#f7a199; }
  .empty { color:var(--dim); padding:22px; border:1px dashed var(--line); border-radius:10px; font:13px var(--mono); }
  /* modal */
  .overlay { position:fixed; inset:0; background:rgba(8,12,22,.7); backdrop-filter:blur(3px); display:none; align-items:flex-start; justify-content:center; padding:48px 16px; overflow:auto; z-index:50; }
  .overlay.open { display:flex; }
  .modal { background:var(--surface); border:1px solid var(--line2); border-radius:14px; width:580px; max-width:100%; padding:24px 26px; box-shadow:0 24px 60px -20px rgba(0,0,0,.7); }
  .modal h3 { margin:0 0 18px; font:600 15px var(--mono); }
  .modal h3::before { content:'> '; color:var(--accent); }
  .field { margin-bottom:13px; }
  .field label { display:block; font:11px var(--mono); color:var(--dim); margin-bottom:5px; }
  .field input, .field select, .field textarea { width:100%; background:var(--bg); border:1px solid var(--line); border-radius:7px; color:var(--ink); padding:9px 11px; font:13px var(--sans); transition:border-color .15s; }
  .field input:focus, .field select:focus, .field textarea:focus { outline:none; border-color:var(--accent); }
  .field textarea { resize:vertical; min-height:60px; font:12px var(--mono); }
  .field input:disabled { opacity:.45; }
  .hint { font:10px var(--mono); color:var(--dim); margin-top:4px; }
  .modal-actions { display:flex; justify-content:flex-end; gap:10px; margin-top:20px; }
  .row2 { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
  /* detail view */
  .modal.wide { width:680px; border-left:3px solid var(--stage,var(--accent)); }
  .dt h2 { margin:0 0 3px; font:600 19px var(--sans); }
  .dt .card-sub { margin-top:5px; }
  .dt .stage { display:inline-flex; }
  .dt-desc { color:#c7d2e0; margin:14px 0; font-size:14px; line-height:1.65; }
  .dt-grid { display:grid; grid-template-columns:1fr 1fr; gap:14px 22px; margin:18px 0; padding:16px 0; border-top:1px solid var(--line); border-bottom:1px solid var(--line); }
  .dt-grid label { display:block; font:10px var(--mono); text-transform:uppercase; letter-spacing:.5px; color:var(--dim); margin-bottom:5px; }
  .dt-grid .v { font-size:13px; display:flex; flex-wrap:wrap; gap:6px; align-items:center; }
  .dt-grid .mono { font:12px var(--mono); color:#c7d2e0; word-break:break-all; }
  .dt-grid a { color:var(--accent); text-decoration:none; word-break:break-all; }
  .dt-tasks { margin-top:16px; }
  .dt-blabel { display:block; font:10px var(--mono); text-transform:uppercase; letter-spacing:.5px; color:var(--accent); margin-top:16px; }
  .dt-body { background:var(--bg); border:1px solid var(--line); border-radius:8px; padding:13px; font:12px/1.55 var(--mono); color:#c7d2e0; white-space:pre-wrap; word-break:break-word; max-height:380px; overflow:auto; margin:7px 0 0; }
  @media (prefers-reduced-motion:reduce){ *{transition:none!important} }
</style></head><body>
<header>
  <span class="brand">${ICON.layers}<h1>keystack</h1></span>
  <span class="sub"><span class="live"></span>${projects.length} projects · ${skills.length} skills · ${prompts.length} prompts</span>
</header>
<div class="wrap">
  <div class="sec-head"><h2>projects</h2><span class="count">${projects.length}</span><button class="btn-add" onclick="openForm('project')">+ new</button></div>
  ${projects.length ? `<div class="grid">${projects.map(projectCard).join("")}</div>`
    : `<div class="empty">no projects yet — add one or let your agent populate it via MCP.</div>`}

  <div class="sec-head"><h2>skills</h2><span class="count">${skills.length}</span><button class="btn-add" onclick="openForm('skill')">+ new</button></div>
  ${skills.length ? `<div class="grid">${skills.map((s) =>
    `<div class="skill" data-kind="skill" data-slug="${esc(s.slug)}"><h4>${esc(s.name)}</h4><p>${esc(s.what_it_does || s.description)}</p>
     ${s.tags.length ? `<div class="chips" style="margin-top:9px">${s.tags.map((t) => `<span class="chip">${esc(t)}</span>`).join("")}</div>` : ""}
     <div class="actions"><button class="btn-edit" data-kind="skill" data-slug="${esc(s.slug)}">edit</button>
     <button class="btn-del" data-kind="skill" data-slug="${esc(s.slug)}">delete</button></div></div>`).join("")}</div>`
    : `<div class="empty">no skills yet.</div>`}

  <div class="sec-head"><h2>prompts</h2><span class="count">${prompts.length}</span><button class="btn-add" onclick="openForm('prompt')">+ new</button></div>
  ${prompts.length ? `<div class="grid">${prompts.map((p) =>
    `<div class="prompt" data-kind="prompt" data-slug="${esc(p.slug)}"><h4>${esc(p.name)}</h4><p>${esc(p.description)}${p.category ? ` <span class="tag">· ${esc(p.category)}</span>` : ""}</p>
     <div class="actions"><button class="btn-edit" data-kind="prompt" data-slug="${esc(p.slug)}">edit</button>
     <button class="btn-del" data-kind="prompt" data-slug="${esc(p.slug)}">delete</button></div></div>`).join("")}</div>`
    : `<div class="empty">no prompts yet.</div>`}
</div>

<div class="overlay" id="overlay"><div class="modal" id="modal"></div></div>

<script>
const DATA = ${data};
const $ = (id) => document.getElementById(id);
const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');

const FIELDS = {
  project: (d={}) => \`
    <div class="row2">
      <div class="field"><label>Name *</label><input id="f_name" value="\${attr(d.name)}" oninput="autoslug()"></div>
      <div class="field"><label>Slug *</label><input id="f_slug" value="\${attr(d.slug)}" \${d.slug?'disabled':''}></div>
    </div>
    <div class="field"><label>Description</label><textarea id="f_description">\${txt(d.description)}</textarea></div>
    <div class="row2">
      <div class="field"><label>Type</label><select id="f_type">\${opts(['','mobile','web','saas','bot','cli','api','library','desktop'], d.type)}</select></div>
      <div class="field"><label>Stage</label><select id="f_stage">\${opts(['idea','mvp','active','paused','shipped'], d.stage)}</select></div>
    </div>
    <div class="row2">
      <div class="field"><label>Tests</label><select id="f_tests_status">\${opts(['none','partial','green'], d.tests_status)}</select></div>
      <div class="field"><label>Language</label><input id="f_language" value="\${attr(d.language)}"></div>
    </div>
    <div class="row2">
      <div class="field"><label>Frameworks</label><input id="f_frameworks" value="\${attr((d.frameworks||[]).join(', '))}"><div class="hint">comma-separated</div></div>
      <div class="field"><label>Database</label><input id="f_database" value="\${attr(d.database)}"></div>
    </div>
    <div class="field"><label>Services</label><textarea id="f_services">\${txt(svcLines(d.services))}</textarea><div class="hint">one per line — "provider: account" (account optional, e.g. supabase: Supabase 2)</div></div>
    <div class="field"><label>Tasks</label><textarea id="f_tasks" style="min-height:100px">\${txt(taskLines(d.tasks))}</textarea><div class="hint">one per line — "[x] frontend: text" — [x]/[ ] = done/todo, optional category: frontend/backend/design/devops/qa/infra/content</div></div>
    <div class="field"><label>Blockers</label><textarea id="f_blockers">\${txt((d.blockers||[]).join('\\n'))}</textarea><div class="hint">one per line — what must be resolved before launch</div></div>
    <div class="field"><label>GitHub URL</label><input id="f_github_url" value="\${attr(d.github_url)}"></div>
    <div class="row2">
      <div class="field"><label>Local path</label><input id="f_local_path" value="\${attr(d.local_path)}"></div>
      <div class="field"><label>Keys ref (path only)</label><input id="f_keys_ref" value="\${attr(d.keys_ref)}"></div>
    </div>\`,
  skill: (d={}) => \`
    <div class="row2">
      <div class="field"><label>Name *</label><input id="f_name" value="\${attr(d.name)}" oninput="autoslug()"></div>
      <div class="field"><label>Slug *</label><input id="f_slug" value="\${attr(d.slug)}" \${d.slug?'disabled':''}></div>
    </div>
    <div class="field"><label>What it does</label><textarea id="f_what_it_does">\${txt(d.what_it_does)}</textarea></div>
    <div class="field"><label>Description</label><input id="f_description" value="\${attr(d.description)}"></div>
    <div class="field"><label>Location</label><input id="f_location" value="\${attr(d.location)}"></div>
    <div class="field"><label>Tags</label><input id="f_tags" value="\${attr((d.tags||[]).join(', '))}"><div class="hint">comma-separated</div></div>\`,
  prompt: (d={}) => \`
    <div class="row2">
      <div class="field"><label>Name *</label><input id="f_name" value="\${attr(d.name)}" oninput="autoslug()"></div>
      <div class="field"><label>Slug *</label><input id="f_slug" value="\${attr(d.slug)}" \${d.slug?'disabled':''}></div>
    </div>
    <div class="field"><label>Description</label><input id="f_description" value="\${attr(d.description)}"></div>
    <div class="field"><label>Category</label><input id="f_category" value="\${attr(d.category)}"></div>
    <div class="field"><label>Body</label><textarea id="f_body" style="min-height:160px">\${txt(d.body)}</textarea></div>
    <div class="field"><label>Tags</label><input id="f_tags" value="\${attr((d.tags||[]).join(', '))}"><div class="hint">comma-separated</div></div>\`,
};
const ARRAYS = { project:['frameworks'], skill:['tags'], prompt:['tags'] };

function attr(s){ return String(s??'').replace(/"/g,'&quot;'); }
function txt(s){ return String(s??'').replace(/</g,'&lt;'); }
function opts(arr, sel){ return arr.map(o=>\`<option \${o===sel?'selected':''}>\${o}</option>\`).join(''); }
function autoslug(){ const s=$('f_slug'); if(s.disabled) return; s.value=slugify($('f_name').value); }
const CATS=['frontend','backend','design','devops','qa','infra','content'];
function svcLines(a){ return (a||[]).map(s=>s.account?s.provider+': '+s.account:s.provider).join('\\n'); }
function taskLines(a){ return (a||[]).map(t=>'['+(t.done?'x':' ')+'] '+(t.category?t.category+': ':'')+t.text).join('\\n'); }
function parseSvc(v){ return (v||'').split('\\n').map(l=>l.trim()).filter(Boolean).map(l=>{ const i=l.indexOf(':'); return i>0?{provider:l.slice(0,i).trim(),account:l.slice(i+1).trim()}:{provider:l}; }); }
function parseTasks(v){ return (v||'').split('\\n').map(l=>l.trim()).filter(Boolean).map(l=>{ let done=false; const m=l.match(/^\\[([ xX])\\]\\s*(.*)$/); if(m){done=/x/i.test(m[1]); l=m[2];} const cm=l.match(/^(\\w+):\\s*(.*)$/); if(cm&&CATS.includes(cm[1].toLowerCase())) return {text:cm[2],done,category:cm[1].toLowerCase()}; return {text:l,done}; }); }
function lines(v){ return (v||'').split('\\n').map(s=>s.trim()).filter(Boolean); }

let CUR = 'project';
function openForm(kind, data){
  CUR = kind;
  $('modal').className = 'modal';
  $('modal').innerHTML = \`<h3>\${data?'Edit':'New'} \${kind}</h3>\${FIELDS[kind](data||{})}
    <div class="modal-actions"><button onclick="closeForm()">Cancel</button>
    <button class="btn-add" onclick="save()">Save</button></div>\`;
  $('overlay').classList.add('open');
}
function closeForm(){ $('overlay').classList.remove('open'); }
$('overlay').addEventListener('click', e => { if(e.target.id==='overlay') closeForm(); });

// ---- Detail view -----------------------------------------------------------
const STAGE = { idea:'#64748b', mvp:'#f59e0b', active:'#22c55e', paused:'#f97316', shipped:'#3b82f6' };
function h(s){ return String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function catTag(c){ return c?'<span class="cat cat-'+h(c)+'">'+h(c)+'</span>':''; }

function detailProject(p){
  const color = STAGE[p.stage]||'#64748b';
  const stack = [p.language,...(p.frameworks||[]),p.database].filter(Boolean);
  const tasks = p.tasks||[], done = tasks.filter(t=>t.done).length, total = tasks.length;
  const pct = total?Math.round(done/total*100):0;
  const cell = (label,val)=>'<div><label>'+label+'</label><div class="v">'+val+'</div></div>';
  return \`<div class="dt" style="--stage:\${color}">
    <div><h2>\${h(p.name)}</h2>
      <div class="card-sub"><code class="slug">\${h(p.slug)}</code>\${p.type?'<span class="ptype">'+h(p.type)+'</span>':''}<span class="stage"><i class="dot" style="background:\${color}"></i>\${h(p.stage)}</span></div>
    </div>
    <p class="dt-desc">\${h(p.description)||'<i>no description</i>'}</p>
    <div class="dt-grid">
      \${cell('stack', stack.length?stack.map(s=>'<span class="chip">'+h(s)+'</span>').join(''):'—')}
      \${cell('tests', '<span class="tests tests-'+h(p.tests_status)+'"><i class="tdot"></i>'+h(p.tests_status)+(p.tests_note?' · '+h(p.tests_note):'')+'</span>')}
      \${cell('services', (p.services||[]).length?p.services.map(s=>'<span class="svc">'+h(s.provider)+(s.account?'<em>·'+h(s.account)+'</em>':'')+'</span>').join(''):'—')}
      \${cell('github', p.github_url?'<a href="'+h(p.github_url)+'" target="_blank" rel="noopener">'+h(p.github_url)+'</a>':'—')}
      \${cell('local path', '<span class="mono">'+(h(p.local_path)||'—')+'</span>')}
      \${cell('keys ref', '<span class="mono">'+(h(p.keys_ref)||'—')+'</span>')}
      \${cell('created', '<span class="mono">'+((p.created_at||'').slice(0,10)||'—')+'</span>')}
      \${cell('last touched', '<span class="mono">'+((p.last_touched||'').slice(0,10)||'—')+'</span>')}
    </div>
    \${(p.blockers||[]).length?'<div class="blockers"><div class="blk-head">⚠ blockers</div><ul>'+p.blockers.map(b=>'<li>'+h(b)+'</li>').join('')+'</ul></div>':''}
    \${total?'<div class="dt-tasks"><div class="tasks-head"><span class="next-label">tasks</span><span class="prog-num">'+done+'/'+total+' · '+pct+'%</span></div><div class="bar"><i style="width:'+pct+'%;background:'+color+'"></i></div><ul class="tasklist">'+tasks.map(t=>'<li class="'+(t.done?'done':'')+'">'+(t.done?'✓':'○')+' '+catTag(t.category)+h(t.text)+'</li>').join('')+'</ul></div>':''}
    \${(p.next_steps||[]).length?'<div class="dt-tasks"><span class="next-label">next steps</span><ul class="tasklist">'+p.next_steps.map(n=>'<li>○ '+h(n)+'</li>').join('')+'</ul></div>':''}
    <div class="modal-actions"><button onclick="closeForm()">close</button><button onclick="edit('project','\${p.slug}')">edit</button><button class="btn-del" onclick="del('project','\${p.slug}')">delete</button></div>
  </div>\`;
}
function detailSkill(s){
  return \`<div class="dt"><div><h2>\${h(s.name)}</h2><div class="card-sub"><code class="slug">\${h(s.slug)}</code></div></div>
    <p class="dt-desc">\${h(s.what_it_does||s.description)||'—'}</p>
    <div class="dt-grid"><div><label>location</label><div class="v"><span class="mono">\${h(s.location)||'—'}</span></div></div>
      <div><label>description</label><div class="v">\${h(s.description)||'—'}</div></div></div>
    \${(s.tags||[]).length?'<div class="chips">'+s.tags.map(t=>'<span class="chip">'+h(t)+'</span>').join('')+'</div>':''}
    <div class="modal-actions"><button onclick="closeForm()">close</button><button onclick="edit('skill','\${s.slug}')">edit</button><button class="btn-del" onclick="del('skill','\${s.slug}')">delete</button></div></div>\`;
}
function detailPrompt(p){
  return \`<div class="dt"><div><h2>\${h(p.name)}</h2><div class="card-sub"><code class="slug">\${h(p.slug)}</code>\${p.category?'<span class="ptype">'+h(p.category)+'</span>':''}</div></div>
    <p class="dt-desc">\${h(p.description)||'—'}</p>
    \${(p.tags||[]).length?'<div class="chips">'+p.tags.map(t=>'<span class="chip">'+h(t)+'</span>').join('')+'</div>':''}
    <label class="dt-blabel">body</label><pre class="dt-body">\${h(p.body)||'—'}</pre>
    <div class="modal-actions"><button onclick="closeForm()">close</button><button onclick="copyPrompt('\${p.slug}')">copy</button><button onclick="edit('prompt','\${p.slug}')">edit</button><button class="btn-del" onclick="del('prompt','\${p.slug}')">delete</button></div></div>\`;
}
const DETAIL = { project:detailProject, skill:detailSkill, prompt:detailPrompt };
function openDetail(kind, slug){
  const list = DATA[kind==='project'?'projects':kind+'s'];
  const item = list.find(x=>x.slug===slug); if(!item) return;
  $('modal').className = kind==='project' ? 'modal wide' : 'modal';
  $('modal').innerHTML = DETAIL[kind](item);
  $('overlay').classList.add('open');
}
function copyPrompt(slug){ const p=DATA.prompts.find(x=>x.slug===slug); if(p) navigator.clipboard?.writeText(p.body||''); }

function edit(kind, slug){
  const list = DATA[kind==='project'?'projects':kind+'s'];
  openForm(kind, list.find(x=>x.slug===slug));
}
async function save(){
  const kind = CUR;
  const obj = {};
  $('modal').querySelectorAll('[id^=f_]').forEach(el => { obj[el.id.slice(2)] = el.value; });
  if(!obj.name || !obj.slug){ alert('Name and slug required'); return; }
  for(const a of ARRAYS[kind]){
    obj[a] = (obj[a]||'').split(',').map(s=>s.trim()).filter(Boolean);
  }
  if(kind==='project'){ obj.services = parseSvc(obj.services); obj.tasks = parseTasks(obj.tasks); obj.blockers = lines(obj.blockers); }
  await fetch('/api/'+(kind==='project'?'projects':kind+'s')+'/save',
    {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(obj)});
  location.reload();
}
async function del(kind, slug){
  if(!confirm('Delete '+slug+'?')) return;
  await fetch('/api/'+(kind==='project'?'projects':kind+'s')+'/delete',
    {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({slug})});
  location.reload();
}
document.addEventListener('click', e => {
  const b = e.target.closest('button');
  if(b){
    if(b.classList.contains('btn-edit') && b.dataset.slug){ edit(b.dataset.kind, b.dataset.slug); }
    else if(b.classList.contains('btn-del') && b.dataset.slug){ del(b.dataset.kind, b.dataset.slug); }
    return;
  }
  if(e.target.closest('a')) return;             // links (repo) open normally
  if(e.target.closest('.overlay')) return;      // clicks inside/over modal handled elsewhere
  const card = e.target.closest('.card,.skill,.prompt');
  if(card && card.dataset.slug) openDetail(card.dataset.kind, card.dataset.slug);
});
</script>
</body></html>`);
});

// Only bind a port when run directly (`npm run dashboard` / `node dist/dashboard/server.js`) —
// not when imported by tests, which use Fastify's app.inject() against the same route tree.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  app.listen({ port: PORT, host: "127.0.0.1" }).then(() => {
    console.error(`[keystack] dashboard → http://127.0.0.1:${PORT}`);
  });
}

export { app };
