#!/usr/bin/env node
/**
 * KeyStack local dashboard — human-facing view + editing of the registry.
 * Localhost only. Read + write: add/edit/delete projects, skills, prompts.
 * The agent edits via MCP; this is the manual UI.
 */
import Fastify from "fastify";
import {
  listProjects, upsertProject, deleteProject,
  listSkills, upsertSkill, deleteSkill,
  listPrompts, upsertPrompt, deletePrompt,
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
    <div class="actions">
      <button class="btn-edit" data-kind="project" data-slug="${esc(p.slug)}">Edit</button>
      <button class="btn-del" data-kind="project" data-slug="${esc(p.slug)}">Delete</button>
    </div>
  </div>`;
}

// ---- API: read -------------------------------------------------------------
app.get("/api/projects", async () => listProjects());
app.get("/api/skills", async () => listSkills());
app.get("/api/prompts", async () => listPrompts());

// ---- API: write ------------------------------------------------------------
app.post("/api/projects/save", async (req) => upsertProject(req.body as any));
app.post("/api/projects/delete", async (req) => ({ ok: deleteProject((req.body as any).slug) }));
app.post("/api/skills/save", async (req) => upsertSkill(req.body as any));
app.post("/api/skills/delete", async (req) => ({ ok: deleteSkill((req.body as any).slug) }));
app.post("/api/prompts/save", async (req) => upsertPrompt(req.body as any));
app.post("/api/prompts/delete", async (req) => ({ ok: deletePrompt((req.body as any).slug) }));

app.get("/", async (_req, reply) => {
  const projects = listProjects();
  const skills = listSkills();
  const prompts = listPrompts();
  const data = JSON.stringify({ projects, skills, prompts }).replace(/</g, "\\u003c");

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
  .sec-head { display:flex; align-items:center; gap:12px; margin:28px 0 14px; }
  h2 { font-size:13px; text-transform:uppercase; letter-spacing:1px; color:var(--dim); margin:0; }
  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(300px,1fr)); gap:14px; }
  .card,.skill,.prompt { background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:16px; position:relative; }
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
  .skill h4, .prompt h4 { margin:0 0 4px; font-size:14px; }
  .skill p, .prompt p { margin:0; color:var(--dim); font-size:12px; }
  .actions { margin-top:12px; display:flex; gap:8px; }
  button { font:inherit; cursor:pointer; border-radius:7px; border:1px solid var(--line); background:#21242f; color:var(--ink); padding:5px 12px; font-size:12px; }
  button:hover { border-color:var(--accent); }
  .btn-add { background:var(--accent); color:#0e0f13; font-weight:600; border:none; padding:6px 14px; }
  .btn-del:hover { border-color:#c0584a; color:#e08a7c; }
  .empty { color:var(--dim); padding:20px; border:1px dashed var(--line); border-radius:12px; }
  /* modal */
  .overlay { position:fixed; inset:0; background:rgba(0,0,0,.6); display:none; align-items:flex-start; justify-content:center; padding:40px 16px; overflow:auto; z-index:50; }
  .overlay.open { display:flex; }
  .modal { background:var(--panel); border:1px solid var(--line); border-radius:14px; width:560px; max-width:100%; padding:22px 24px; }
  .modal h3 { margin:0 0 16px; }
  .field { margin-bottom:12px; }
  .field label { display:block; font-size:12px; color:var(--dim); margin-bottom:4px; }
  .field input, .field select, .field textarea { width:100%; background:#0e0f13; border:1px solid var(--line); border-radius:7px; color:var(--ink); padding:8px 10px; font:inherit; }
  .field textarea { resize:vertical; min-height:60px; }
  .field input:disabled { opacity:.5; }
  .hint { font-size:11px; color:var(--dim); margin-top:3px; }
  .modal-actions { display:flex; justify-content:flex-end; gap:10px; margin-top:18px; }
  .row2 { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
</style></head><body>
<header><h1>🗂️ KeyStack</h1><span class="sub">live project registry · ${projects.length} projects · ${skills.length} skills · ${prompts.length} prompts</span></header>
<div class="wrap">
  <div class="sec-head"><h2>Projects</h2><button class="btn-add" onclick="openForm('project')">+ Project</button></div>
  ${projects.length ? `<div class="grid">${projects.map(projectCard).join("")}</div>`
    : `<div class="empty">No projects yet.</div>`}

  <div class="sec-head"><h2>Skills</h2><button class="btn-add" onclick="openForm('skill')">+ Skill</button></div>
  ${skills.length ? `<div class="grid">${skills.map((s) =>
    `<div class="skill"><h4>${esc(s.name)}</h4><p>${esc(s.what_it_does || s.description)}</p>
     <div class="actions"><button class="btn-edit" data-kind="skill" data-slug="${esc(s.slug)}">Edit</button>
     <button class="btn-del" data-kind="skill" data-slug="${esc(s.slug)}">Delete</button></div></div>`).join("")}</div>`
    : `<div class="empty">No skills yet.</div>`}

  <div class="sec-head"><h2>Prompts</h2><button class="btn-add" onclick="openForm('prompt')">+ Prompt</button></div>
  ${prompts.length ? `<div class="grid">${prompts.map((p) =>
    `<div class="prompt"><h4>${esc(p.name)}</h4><p>${esc(p.description)} ${p.category ? `· ${esc(p.category)}` : ""}</p>
     <div class="actions"><button class="btn-edit" data-kind="prompt" data-slug="${esc(p.slug)}">Edit</button>
     <button class="btn-del" data-kind="prompt" data-slug="${esc(p.slug)}">Delete</button></div></div>`).join("")}</div>`
    : `<div class="empty">No prompts yet.</div>`}
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
      <div class="field"><label>Stage</label><select id="f_stage">\${opts(['idea','mvp','active','paused','shipped'], d.stage)}</select></div>
      <div class="field"><label>Tests</label><select id="f_tests_status">\${opts(['none','partial','green'], d.tests_status)}</select></div>
    </div>
    <div class="row2">
      <div class="field"><label>Language</label><input id="f_language" value="\${attr(d.language)}"></div>
      <div class="field"><label>Database</label><input id="f_database" value="\${attr(d.database)}"></div>
    </div>
    <div class="field"><label>Frameworks</label><input id="f_frameworks" value="\${attr((d.frameworks||[]).join(', '))}"><div class="hint">comma-separated</div></div>
    <div class="field"><label>Services</label><input id="f_services" value="\${attr((d.services||[]).join(', '))}"><div class="hint">comma-separated</div></div>
    <div class="field"><label>Next steps</label><textarea id="f_next_steps">\${txt((d.next_steps||[]).join('\\n'))}</textarea><div class="hint">one per line</div></div>
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
const ARRAYS = { project:['frameworks','services','next_steps'], skill:['tags'], prompt:['tags'] };
const LINE_ARRAYS = { next_steps:1 };

function attr(s){ return String(s??'').replace(/"/g,'&quot;'); }
function txt(s){ return String(s??'').replace(/</g,'&lt;'); }
function opts(arr, sel){ return arr.map(o=>\`<option \${o===sel?'selected':''}>\${o}</option>\`).join(''); }
function autoslug(){ const s=$('f_slug'); if(s.disabled) return; s.value=slugify($('f_name').value); }

let CUR = 'project';
function openForm(kind, data){
  CUR = kind;
  $('modal').innerHTML = \`<h3>\${data?'Edit':'New'} \${kind}</h3>\${FIELDS[kind](data||{})}
    <div class="modal-actions"><button onclick="closeForm()">Cancel</button>
    <button class="btn-add" onclick="save()">Save</button></div>\`;
  $('overlay').classList.add('open');
}
function closeForm(){ $('overlay').classList.remove('open'); }
$('overlay').addEventListener('click', e => { if(e.target.id==='overlay') closeForm(); });

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
    const sep = LINE_ARRAYS[a] ? /\\n/ : /,/;
    obj[a] = (obj[a]||'').split(sep).map(s=>s.trim()).filter(Boolean);
  }
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
  const b = e.target.closest('button'); if(!b) return;
  if(b.classList.contains('btn-edit')) edit(b.dataset.kind, b.dataset.slug);
  if(b.classList.contains('btn-del')) del(b.dataset.kind, b.dataset.slug);
});
</script>
</body></html>`);
});

app.listen({ port: PORT, host: "127.0.0.1" }).then(() => {
  console.error(`[keystack] dashboard → http://127.0.0.1:${PORT}`);
});
