// 9Router Worker Dashboard — SPA (vanilla JS, no framework)
// Mirrors the original 9Router dashboard layout: sidebar + main content area

// ── State ──
let currentRoute = "dashboard";
let state = { models: [], providers: [], combos: [], keys: [], settings: {} };

// ── API helpers ──
const api = {
  async get(path) {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return res.json();
  },
  async post(path, body) {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.json();
  },
  async patch(path, body) {
    const res = await fetch(path, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.json();
  },
  async del(path) {
    const res = await fetch(path, { method: "DELETE" });
    return res.json();
  },
};

// ── Router ──
const routes = {
  dashboard: { title: "Dashboard", desc: "Overview of your 9Router Worker endpoint", icon: "📊", render: renderDashboard },
  models: { title: "Models", desc: "Available models from your provider connections", icon: "🤖", render: renderModels },
  providers: { title: "Providers", desc: "Manage provider connections and API keys", icon: "🔌", render: renderProviders },
  combos: { title: "Combos", desc: "Model fusion and fallback chains", icon: "🔗", render: renderCombos },
  keys: { title: "API Keys", desc: "Client authentication keys", icon: "🔑", render: renderKeys },
  endpoint: { title: "Endpoint", desc: "Connection info and usage examples", icon: "🌐", render: renderEndpoint },
  settings: { title: "Settings", desc: "Worker configuration", icon: "⚙️", render: renderSettings },
};

function navigate(route) {
  if (!routes[route]) route = "dashboard";
  currentRoute = route;
  render();
  document.querySelectorAll(".nav-item").forEach((el) => {
    el.classList.toggle("active", el.dataset.route === route);
  });
  if (window.innerWidth <= 768) {
    document.querySelector(".sidebar")?.classList.remove("open");
  }
}

// ── Main render ──
function render() {
  const app = document.getElementById("app");
  const r = routes[currentRoute] || routes.dashboard;
  app.innerHTML = `
    <div class="app-shell">
      ${renderSidebar()}
      <div class="main">
        <div class="mobile-toggle" onclick="document.querySelector('.sidebar').classList.toggle('open')">☰</div>
        <div class="main-header">
          <div class="main-title">${r.icon} ${r.title}</div>
          <div class="main-desc">${r.desc}</div>
        </div>
        <div id="page-content"></div>
      </div>
    </div>
  `;
  document.querySelectorAll(".nav-item").forEach((el) => {
    el.addEventListener("click", () => navigate(el.dataset.route));
  });
  r.render();
}

function renderSidebar() {
  const items = Object.entries(routes)
    .map(([key, r]) => `
      <div class="nav-item ${key === currentRoute ? "active" : ""}" data-route="${key}">
        <span class="nav-icon">${r.icon}</span>
        <span>${r.title}</span>
      </div>
    `)
    .join("");
  return `
    <aside class="sidebar">
      <div class="sidebar-header">
        <span class="sidebar-logo">9️⃣</span>
        <div>
          <div class="sidebar-title">9Router</div>
          <div class="sidebar-subtitle">Cloudflare Worker</div>
        </div>
      </div>
      <nav class="sidebar-nav">${items}</nav>
      <div class="sidebar-footer">v0.1.0 · API-only</div>
    </aside>
  `;
}

function pageContent(html) {
  const el = document.getElementById("page-content");
  if (el) el.innerHTML = html;
}

function skeletonLines(n) {
  return Array(n).fill('<div class="skeleton skeleton-line"></div>').join("");

// ── Dashboard page ──
async function renderDashboard() {
  pageContent(`
    <div class="card-grid cols-3">
      <div class="stat-card"><div class="stat-label">Models</div><div class="stat-value" id="stat-models">—</div><div class="stat-sub">Available</div></div>
      <div class="stat-card"><div class="stat-label">Providers</div><div class="stat-value" id="stat-providers">—</div><div class="stat-sub">Connected</div></div>
      <div class="stat-card"><div class="stat-label">Combos</div><div class="stat-value" id="stat-combos">—</div><div class="stat-sub">Configured</div></div>
    </div>
    <div class="card" style="margin-top:16px">
      <div class="card-header"><div class="card-title">Endpoint Status</div></div>
      <div class="code-block" id="health-check">${skeletonLines(3)}</div>
    </div>
  `);
  try {
    const health = await api.get("/health");
    document.getElementById("health-check").textContent = JSON.stringify(health, null, 2);
  } catch (e) {
    document.getElementById("health-check").textContent = "Error: " + e.message;
  }
  try {
    const models = await api.get("/v1/models");
    state.models = models.data || [];
    document.getElementById("stat-models").textContent = state.models.length;
  } catch { document.getElementById("stat-models").textContent = "0"; }
  document.getElementById("stat-providers").textContent = "—";
  document.getElementById("stat-combos").textContent = "—";
}

// ── Models page ──
async function renderModels() {
  pageContent(`<div class="card"><div class="card-header"><div class="card-title">Available Models</div></div><div id="models-list">${skeletonLines(5)}</div></div>`);
  try {
    const data = await api.get("/v1/models");
    const models = data.data || [];
    if (!models.length) {
      pageContent(`<div class="card"><div class="empty-state"><div class="empty-icon">🤖</div><div class="empty-text">No models available. Add a provider connection first.</div></div></div>`);
      return;
    }
    const rows = models.map((m) => `
      <div class="list-item">
        <div class="list-item-info">
          <span class="badge badge-primary badge-dot">${m.owned_by || "unknown"}</span>
          <div><div class="list-item-name">${m.id}</div></div>
        </div>
        <span class="badge badge-muted">${m.object || "model"}</span>
      </div>
    `).join("");
    document.getElementById("models-list").innerHTML = rows;
  } catch (e) {
    document.getElementById("models-list").innerHTML = `<p style="color:var(--error)">${e.message}</p>`;
  }
}


// ── Providers page ──
async function renderProviders() {
  pageContent(`<div class="card"><div class="card-header"><div class="card-title">Provider Connections</div></div><div id="providers-list">${skeletonLines(3)}</div></div>`);
  try {
    const data = await api.get("/api/providers");
    const providers = data.providers || data || [];
    if (!Array.isArray(providers) || !providers.length) {
      pageContent(`<div class="card"><div class="empty-state"><div class="empty-icon">🔌</div><div class="empty-text">No provider connections yet.<br>Use the API to add connections.</div></div></div>`);
      return;
    }
    const rows = providers.map((p) => `
      <div class="list-item">
        <div class="list-item-info">
          <span class="badge ${p.isActive ? "badge-success" : "badge-muted"} badge-dot">${p.provider}</span>
          <div><div class="list-item-name">${p.name || p.provider}</div><div class="list-item-meta">${p.authType || "apikey"}</div></div>
        </div>
        <span class="badge ${p.isActive ? "badge-success" : "badge-muted"}">${p.isActive ? "Active" : "Inactive"}</span>
      </div>
    `).join("");
    document.getElementById("providers-list").innerHTML = rows;
  } catch (e) {
    document.getElementById("providers-list").innerHTML = `<p style="color:var(--error)">No provider API on Worker. Use D1 directly or add connections via API.</p>`;
  }
}

// ── Combos page ──
async function renderCombos() {
  pageContent(`<div class="card"><div class="card-header"><div class="card-title">Combos</div></div><div id="combos-list">${skeletonLines(3)}</div></div>`);
  try {
    const data = await api.get("/api/combos");
    const combos = data.combos || data || [];
    if (!Array.isArray(combos) || !combos.length) {
      pageContent(`<div class="card"><div class="empty-state"><div class="empty-icon">🔗</div><div class="empty-text">No combos configured.</div></div></div>`);
      return;
    }
    const rows = combos.map((c) => `
      <div class="list-item">
        <div class="list-item-info">
          <span class="badge badge-primary">${c.kind || "llm"}</span>
          <div><div class="list-item-name">${c.name}</div><div class="list-item-meta">${(c.models || []).length} models</div></div>
        </div>
      </div>
    `).join("");
    document.getElementById("combos-list").innerHTML = rows;
  } catch (e) {
    document.getElementById("combos-list").innerHTML = `<p style="color:var(--error)">No combo API on Worker.</p>`;
  }
}


// ── Keys page ──
async function renderKeys() {
  pageContent(`<div class="card"><div class="card-header"><div class="card-title">API Keys</div></div><div id="keys-list">${skeletonLines(3)}</div></div>`);
  try {
    const data = await api.get("/api/keys");
    const keys = data.keys || data || [];
    if (!Array.isArray(keys) || !keys.length) {
      pageContent(`<div class="card"><div class="empty-state"><div class="empty-icon">🔑</div><div class="empty-text">No API keys configured.<br>Auth is ${state.settings.REQUIRE_API_KEY === "false" ? "disabled" : "required"}.</div></div></div>`);
      return;
    }
    const rows = keys.map((k) => `
      <div class="list-item">
        <div class="list-item-info">
          <span class="badge ${k.isActive ? "badge-success" : "badge-muted"} badge-dot">${k.name || "unnamed"}</span>
          <div><div class="list-item-name" style="font-family:monospace;font-size:12px">${k.key.slice(0,8)}••••${k.key.slice(-4)}</div></div>
        </div>
        <span class="badge ${k.isActive ? "badge-success" : "badge-muted"}">${k.isActive ? "Active" : "Inactive"}</span>
      </div>
    `).join("");
    document.getElementById("keys-list").innerHTML = rows;
  } catch (e) {
    document.getElementById("keys-list").innerHTML = `<p style="color:var(--error)">No keys API on Worker.</p>`;
  }
}

// ── Endpoint page ──
async function renderEndpoint() {
  const origin = window.location.origin;
  pageContent(`
    <div class="card" style="margin-bottom:16px">
      <div class="card-header"><div class="card-title">Base URL</div></div>
      <div class="code-block"><span class="hl">${origin}</span></div>
    </div>
    <div class="card" style="margin-bottom:16px">
      <div class="card-header"><div class="card-title">List Models</div></div>
      <div class="code-block"><span class="hl">curl</span> ${origin}/v1/models \\\n  -H <span class="str">"Authorization: Bearer YOUR_API_KEY"</span></div>
    </div>
    <div class="card" style="margin-bottom:16px">
      <div class="card-header"><div class="card-title">Chat Completion</div></div>
      <div class="code-block"><span class="hl">curl</span> ${origin}/v1/chat/completions \\\n  -H <span class="str">"Content-Type: application/json"</span> \\\n  -H <span class="str">"Authorization: Bearer YOUR_API_KEY"</span> \\\n  -d <span class="str">'{"model":"openai/gpt-4o","messages":[{"role":"user","content":"Hello!"}]}'</span></div>
    </div>
    <div class="card">
      <div class="card-header"><div class="card-title">OpenAI SDK (Python)</div></div>
      <div class="code-block"><span class="key">from</span> openai <span class="key">import</span> OpenAI\n\nclient = OpenAI(\n  base_url=<span class="str">"${origin}/v1"</span>,\n  api_key=<span class="str">"YOUR_API_KEY"</span>,\n)\n\nresponse = client.chat.completions.create(\n  model=<span class="str">"openai/gpt-4o"</span>,\n  messages=[{<span class="str">"role"</span>: <span class="str">"user"</span>, <span class="str">"content"</span>: <span class="str">"Hello!"</span>}],\n)</div>
    </div>
  `);
}


// ── Settings page ──
async function renderSettings() {
  pageContent(`
    <div class="card" style="margin-bottom:16px">
      <div class="card-header"><div class="card-title">Worker Info</div></div>
      <div class="code-block" id="settings-info">${skeletonLines(4)}</div>
    </div>
    <div class="card">
      <div class="card-header"><div class="card-title">Configuration</div></div>
      <div style="display:flex;flex-direction:column;gap:12px">
        <div class="list-item"><div class="list-item-info"><div><div class="list-item-name">Require API Key</div><div class="list-item-meta">Enforce API key auth on all requests</div></div></div><span class="badge badge-muted" id="req-key">—</span></div>
        <div class="list-item"><div class="list-item-info"><div><div class="list-item-name">Admin API Key</div><div class="list-item-meta">Admin key for management endpoints</div></div></div><span class="badge badge-muted" id="admin-key">—</span></div>
      </div>
    </div>
  `);
  try {
    const health = await api.get("/health");
    document.getElementById("settings-info").textContent = JSON.stringify(health, null, 2);
  } catch (e) {
    document.getElementById("settings-info").textContent = "Error: " + e.message;
  }
  document.getElementById("req-key").textContent = "false";
  document.getElementById("req-key").className = "badge badge-warning";
  document.getElementById("admin-key").textContent = "not set";
}

// ── Init ──
document.addEventListener("DOMContentLoaded", () => {
  const hash = window.location.hash.slice(1);
  if (hash && routes[hash]) currentRoute = hash;
  render();
  window.addEventListener("hashchange", () => {
    const h = window.location.hash.slice(1);
    if (h && routes[h]) navigate(h);
  });
});

}
