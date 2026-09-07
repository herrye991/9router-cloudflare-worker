// 9Router Worker Dashboard — SPA matching original 9Router UI
let currentRoute = "endpoint";
let authed = false;

const api = {
  async get(p){const r=await fetch(p);if(!r.ok)throw new Error(r.status);return r.json()},
  async post(p,b){const r=await fetch(p,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(b)});return r.json()},
};

const navItems = [
  {route:"endpoint",label:"Endpoint & Key",icon:"api"},
  {route:"providers",label:"Providers",icon:"dns"},
  {route:"models",label:"Models",icon:"smart_toy"},
  {route:"combos",label:"Combo & Vision Adapter",icon:"layers"},
  {route:"usage",label:"Usage",icon:"bar_chart"},
  {route:"settings",label:"Settings",icon:"settings"},
];

function navigate(route){
  currentRoute = route;
  renderDashboard();
  document.querySelectorAll(".nav-item").forEach(el=>{
    el.classList.toggle("active", el.dataset.route === route);
  });
  if(window.innerWidth <= 768) document.querySelector(".sidebar")?.classList.remove("open");
}

function el(id){return document.getElementById(id)}
function skel(n){return Array(n).fill('<div class="skeleton skeleton-line"></div>').join("")}
function setContent(html){const e=el("page-content");if(e)e.innerHTML=html}

// ── Login ──
function renderLogin(){
  document.getElementById("app").innerHTML = `
    <div class="auth-bg">
      <div class="auth-glow"></div>
      <div class="auth-glow-2"></div>
      <div class="auth-card">
        <div class="auth-logo">9️⃣</div>
        <div class="auth-title">9Router</div>
        <div class="auth-sub">Cloudflare Worker — Dashboard</div>
        <form id="login-form" style="display:flex;flex-direction:column;gap:16px">
          <div class="field">
            <label class="label">Password</label>
            <input class="input" type="password" id="pw" placeholder="Enter password" autofocus />
          </div>
          <div id="login-error"></div>
          <button class="btn btn-primary" type="submit" id="login-btn" style="justify-content:center">Login</button>
        </form>
        <div class="auth-hint">Default password is <code style="background:var(--surface-2);padding:2px 6px;border-radius:4px">123456</code></div>
      </div>
    </div>`;
  document.getElementById("login-form").addEventListener("submit", doLogin);
}

async function doLogin(e){
  e.preventDefault();
  const btn = el("login-btn");
  const pw = el("pw").value;
  const err = el("login-error");
  btn.disabled = true; btn.textContent = "Logging in...";
  err.innerHTML = "";
  try{
    const data = await api.post("/api/auth/login", {password: pw});
    if(data.success){
      authed = true;
      renderDashboard();
    } else {
      err.innerHTML = `<div class="auth-error"><span class="material-symbols-outlined" style="font-size:14px">error</span>${typeof data.error === "string" ? data.error : (data.error?.message || JSON.stringify(data.error)) || "Invalid password"}</div>`;
    }
  } catch(ex){
    err.innerHTML = `<div class="auth-error"><span class="material-symbols-outlined" style="font-size:14px">error</span>Login not available on Worker</div>`;
  }
  btn.disabled = false; btn.textContent = "Login";
}

// ── Dashboard shell ──
function renderDashboard(){
  const r = navItems.find(n=>n.route===currentRoute) || navItems[0];
  document.getElementById("app").innerHTML = `
    <div class="app-shell">
      <aside class="sidebar">
        <div class="sidebar-header"><span class="sidebar-logo">9️⃣</span><div><div class="sidebar-title">9Router</div><div class="sidebar-subtitle">Cloudflare Worker</div></div></div>
        <nav class="sidebar-nav">
          ${navItems.map(n=>`<div class="nav-item ${n.route===currentRoute?"active":""}" data-route="${n.route}"><span class="material-symbols-outlined">${n.icon}</span><span>${n.label}</span></div>`).join("")}
        </nav>
        <div class="sidebar-footer">v0.1.0 · Worker Edition</div>
      </aside>
      <div class="main">
        <div class="main-scroll">
          <div class="mobile-toggle" onclick="document.querySelector('.sidebar').classList.toggle('open')"><span class="material-symbols-outlined">menu</span></div>
          <div class="main-inner">
            <div class="page-header"><div class="page-title"><span class="material-symbols-outlined">${r.icon}</span>${r.label}</div><div class="page-desc">${routeDesc(currentRoute)}</div></div>
            <div id="page-content">${skel(4)}</div>
          </div>
        </div>
      </div>
    </div>`;
  document.querySelectorAll(".nav-item").forEach(n=>n.addEventListener("click",()=>navigate(n.dataset.route)));
  (pages[currentRoute] || pages.endpoint)();
}

function routeDesc(r){
  const d = {endpoint:"Your API endpoint URL, keys, and usage examples",providers:"Manage provider connections",models:"Available models from your connections",combos:"Model fusion and fallback chains",usage:"Request statistics",settings:"Worker configuration"};
  return d[r] || "";
}

// ── Pages ──
const pages = {
  endpoint: renderEndpoint,
  providers: renderProviders,
  models: renderModels,
  combos: renderCombos,
  usage: renderUsage,
  settings: renderSettings,
};

async function renderEndpoint(){
  const origin = window.location.origin;
  setContent(`
    <div class="card" style="margin-bottom:16px">
      <div class="card-header"><div class="card-title"><span class="material-symbols-outlined">link</span>Base URL</div></div>
      <div class="code-block"><span class="hl">${origin}</span></div>
    </div>
    <div class="card" style="margin-bottom:16px">
      <div class="card-header"><div class="card-title"><span class="material-symbols-outlined">terminal</span>List Models</div></div>
      <div class="code-block"><span class="hl">curl</span> ${origin}/v1/models \\\n  -H <span class="str">"Authorization: Bearer YOUR_API_KEY"</span></div>
    </div>
    <div class="card" style="margin-bottom:16px">
      <div class="card-header"><div class="card-title"><span class="material-symbols-outlined">chat</span>Chat Completion</div></div>
      <div class="code-block"><span class="hl">curl</span> ${origin}/v1/chat/completions \\\n  -H <span class="str">"Content-Type: application/json"</span> \\\n  -H <span class="str">"Authorization: Bearer YOUR_API_KEY"</span> \\\n  -d <span class="str">'{"model":"openai/gpt-4o","messages":[{"role":"user","content":"Hello!"}]}'</span></div>
    </div>
    <div class="card">
      <div class="card-header"><div class="card-title"><span class="material-symbols-outlined">code</span>OpenAI SDK (Python)</div></div>
      <div class="code-block"><span class="key">from</span> openai <span class="key">import</span> OpenAI\n\nclient = OpenAI(\n  base_url=<span class="str">"${origin}/v1"</span>,\n  api_key=<span class="str">"YOUR_API_KEY"</span>,\n)\n\nresponse = client.chat.completions.create(\n  model=<span class="str">"openai/gpt-4o"</span>,\n  messages=[{<span class="str">"role"</span>:<span class="str">"user"</span>,<span class="str">"content"</span>:<span class="str">"Hello!"</span>}],\n)</div>
    </div>
  `);
}

async function renderProviders(){
  setContent(`<div class="card"><div class="card-header"><div class="card-title"><span class="material-symbols-outlined">dns</span>Provider Connections</div></div><div id="prov-list">${skel(3)}</div></div>`);
  try{
    const data = await api.get("/api/providers");
    const list = data.providers || data || [];
    if(!Array.isArray(list)||!list.length){setContent(`<div class="card"><div class="empty-state"><span class="material-symbols-outlined">dns</span><div class="empty-text">No provider connections yet.</div></div></div>`);return}
    el("prov-list").innerHTML = list.map(p=>`<div class="list-item"><div class="list-item-info"><span class="badge ${p.isActive?"badge-success":"badge-muted"} badge-dot">${p.provider}</span><div><div class="list-item-name">${p.name||p.provider}</div><div class="list-item-meta">${p.authType||"apikey"}</div></div></div><span class="badge ${p.isActive?"badge-success":"badge-muted"}">${p.isActive?"Active":"Inactive"}</span></div>`).join("");
  }catch(e){el("prov-list").innerHTML=`<div class="empty-state"><span class="material-symbols-outlined">error</span><div class="empty-text">Provider management not available on Worker.<br>Use the D1 database or API to add connections.</div></div>`}
}

async function renderModels(){
  setContent(`<div class="card"><div class="card-header"><div class="card-title"><span class="material-symbols-outlined">smart_toy</span>Available Models</div></div><div id="mod-list">${skel(4)}</div></div>`);
  try{
    const data = await api.get("/v1/models");
    const models = data.data || [];
    if(!models.length){setContent(`<div class="card"><div class="empty-state"><span class="material-symbols-outlined">smart_toy</span><div class="empty-text">No models available. Add a provider connection first.</div></div></div>`);return}
    el("mod-list").innerHTML = models.map(m=>`<div class="list-item"><div class="list-item-info"><span class="badge badge-brand badge-dot">${m.owned_by||"unknown"}</span><div class="list-item-name">${m.id}</div></div><span class="badge badge-muted">${m.object||"model"}</span></div>`).join("");
  }catch(e){el("mod-list").innerHTML=`<p style="color:var(--danger)">${e.message}</p>`}
}

async function renderCombos(){
  setContent(`<div class="card"><div class="card-header"><div class="card-title"><span class="material-symbols-outlined">layers</span>Combos</div></div><div id="combo-list">${skel(3)}</div></div>`);
  try{
    const data = await api.get("/api/combos");
    const list = data.combos || data || [];
    if(!Array.isArray(list)||!list.length){setContent(`<div class="card"><div class="empty-state"><span class="material-symbols-outlined">layers</span><div class="empty-text">No combos configured.</div></div></div>`);return}
    el("combo-list").innerHTML = list.map(c=>`<div class="list-item"><div class="list-item-info"><span class="badge badge-brand">${c.kind||"llm"}</span><div><div class="list-item-name">${c.name}</div><div class="list-item-meta">${(c.models||[]).length} models</div></div></div></div>`).join("");
  }catch(e){el("combo-list").innerHTML=`<div class="empty-state"><span class="material-symbols-outlined">error</span><div class="empty-text">Combo management not available on Worker.</div></div>`}
}

async function renderUsage(){
  setContent(`
    <div class="card-grid cols-3">
      <div class="stat-card"><div class="stat-label">Total Requests</div><div class="stat-value" id="stat-req">—</div><div class="stat-sub">All time</div></div>
      <div class="stat-card"><div class="stat-label">Active Models</div><div class="stat-value" id="stat-mod">—</div><div class="stat-sub">In use</div></div>
      <div class="stat-card"><div class="stat-label">Providers</div><div class="stat-value" id="stat-prov">—</div><div class="stat-sub">Connected</div></div>
    </div>
    <div class="card" style="margin-top:16px">
      <div class="card-header"><div class="card-title"><span class="material-symbols-outlined">info</span>Usage Tracking</div></div>
      <div class="empty-state"><span class="material-symbols-outlined">bar_chart</span><div class="empty-text">Usage tracking is not available on the Worker edition.<br>The original 9Router tracks requests, tokens, and latency in SQLite.</div></div>
    </div>
  `);
  try{const m=await api.get("/v1/models");el("stat-mod").textContent=(m.data||[]).length}catch{el("stat-mod").textContent="0"}
  el("stat-req").textContent="—"; el("stat-prov").textContent="—";
}

async function renderSettings(){
  setContent(`
    <div class="card" style="margin-bottom:16px">
      <div class="card-header"><div class="card-title"><span class="material-symbols-outlined">cloud</span>Worker Info</div></div>
      <div class="code-block" id="settings-info">${skel(4)}</div>
    </div>
    <div class="card">
      <div class="card-header"><div class="card-title"><span class="material-symbols-outlined">tune</span>Configuration</div></div>
      <div style="display:flex;flex-direction:column;gap:12px">
        <div class="list-item"><div class="list-item-info"><div><div class="list-item-name">Require API Key</div><div class="list-item-meta">Enforce API key auth on all requests</div></div></div><span class="badge badge-warning">false</span></div>
        <div class="list-item"><div class="list-item-info"><div><div class="list-item-name">Admin API Key</div><div class="list-item-meta">Admin key for management endpoints</div></div></div><span class="badge badge-muted">not set</span></div>
        <div class="list-item"><div class="list-item-info"><div><div class="list-item-name">D1 Database</div><div class="list-item-meta">Cloudflare D1 binding</div></div></div><span class="badge badge-success badge-dot">connected</span></div>
      </div>
    </div>
  `);
  try{const h=await api.get("/health");el("settings-info").textContent=JSON.stringify(h,null,2)}catch(e){el("settings-info").textContent="Error: "+e.message}
}

// ── Init ──
document.addEventListener("DOMContentLoaded", async ()=>{
  const hash = window.location.hash.slice(1);
  if(hash && navItems.find(n=>n.route===hash)) currentRoute = hash;
  try{
    const r = await fetch("/api/auth/status");
    if(!r.ok) throw new Error("no auth");
    const data = await r.json();
    if(data.authenticated || data.requireLogin === false){
      authed = true;
      renderDashboard();
    } else {
      renderLogin();
    }
  } catch(e){
    authed = true;
    renderDashboard();
  }
  window.addEventListener("hashchange", ()=>{
    const h = window.location.hash.slice(1);
    if(h && navItems.find(n=>n.route===h)) navigate(h);
  });
});
