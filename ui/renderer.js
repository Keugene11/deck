// Sidebar of projects, tab bar of terminals. Every Claude tab runs
// `claude --dangerously-skip-permissions` in its project's folder.
const $ = sel => document.querySelector(sel);
const store = {
  get(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} },
};

const THEME = {
  background: '#1e1e1e', foreground: '#cccccc', cursor: '#aeafad', cursorAccent: '#1e1e1e',
  selectionBackground: '#264f78',
  black: '#000000', red: '#cd3131', green: '#0dbc79', yellow: '#e5e510', blue: '#2472c8',
  magenta: '#bc3fbc', cyan: '#11a8cd', white: '#e5e5e5',
  brightBlack: '#666666', brightRed: '#f14c4c', brightGreen: '#23d18b', brightYellow: '#f5f543',
  brightBlue: '#3b8eea', brightMagenta: '#d670d6', brightCyan: '#29b8db', brightWhite: '#e5e5e5',
};

let projects = [];
let tabs = [];            // { id, project, kind, term, fit, el, tabEl, exited }
let activeId = null;
let fontSize = store.get('fontSize', 14);
const lastUsed = store.get('lastUsed', {});   // project path -> timestamp
let nextId = 1;

// ---------- projects ----------

async function loadProjects() {
  const found = await window.deck.listProjects();
  // Folders opened from elsewhere through Open Folder stay listed too.
  const extra = store.get('extraFolders', []).filter(e => !found.some(p => p.path === e.path));
  projects = [...found, ...extra.map(e => ({ ...e, mtime: 0 }))];
  renderProjects();
}

function sortedProjects() {
  return [...projects].sort((a, b) =>
    (lastUsed[b.path] || 0) - (lastUsed[a.path] || 0) || b.mtime - a.mtime);
}

function renderProjects() {
  const q = $('#search').value.trim().toLowerCase();
  const list = $('#projects');
  list.innerHTML = '';
  const current = activeTab()?.project.path;
  const shown = sortedProjects().filter(p => !q || p.name.toLowerCase().includes(q));
  for (const p of shown) {
    const li = document.createElement('li');
    if (p.path === current) li.classList.add('current');
    const mine = tabs.filter(t => t.project.path === p.path);
    const open = mine.length;
    const state = ['done', 'working'].find(s => mine.some(t => t.state === s));
    li.innerHTML = `<span class="name"></span>${state ? `<span class="dot ${state}" title="${state === 'done' ? 'Claude finished' : 'Claude is working'}"></span>` : ''}${open ? `<span class="count">${open}</span>` : ''}<button class="add" title="New Claude tab here">+</button>`;
    li.querySelector('.name').textContent = p.name;
    li.title = p.path;
    li.onclick = () => openProject(p);
    li.querySelector('.add').onclick = e => { e.stopPropagation(); newTab(p, 'claude'); };
    list.appendChild(li);
  }
  if (q && !projects.some(p => p.name.toLowerCase() === q)) {
    const li = document.createElement('li');
    li.className = 'create';
    li.innerHTML = '<span class="name"></span>';
    li.querySelector('.name').textContent = `Create "${$('#search').value.trim()}"`;
    li.onclick = () => createProject($('#search').value);
    list.appendChild(li);
  }
}

// Clicking a project jumps to its newest tab, or opens one if it has none.
function openProject(p) {
  const existing = tabs.filter(t => t.project.path === p.path).pop();
  if (existing) activate(existing.id); else newTab(p, 'claude');
}

async function createProject(name) {
  name = name.trim();
  if (!name) return;
  const p = await window.deck.createProject(name);
  $('#search').value = '';
  await loadProjects();
  newTab(projects.find(x => x.path === p.path) || { ...p, mtime: Date.now() }, 'claude');
}

$('#search').addEventListener('input', renderProjects);
$('#search').addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    const q = $('#search').value.trim();
    const first = sortedProjects().find(p => p.name.toLowerCase().includes(q.toLowerCase()));
    if (q && !first) createProject(q);
    else if (first) { $('#search').value = ''; renderProjects(); openProject(first); }
  } else if (e.key === 'Escape') {
    $('#search').value = ''; renderProjects(); activeTab()?.term.focus();
  }
});
async function openFolder() {
  const p = await window.deck.pickFolder();
  if (!p) return;
  if (!projects.some(x => x.path === p.path)) {
    store.set('extraFolders', [...store.get('extraFolders', []), { name: p.name, path: p.path }]);
  }
  await loadProjects();
  openProject(projects.find(x => x.path === p.path) || p);
}
$('#new-project').onclick = openFolder;

// ---------- tabs ----------

const activeTab = () => tabs.find(t => t.id === activeId);

function labelFor(project, kind) {
  const same = tabs.filter(t => t.project.path === project.path && t.kind === kind).length;
  return project.name + (same ? ` ${same + 1}` : '');
}

async function newTab(project, kind = 'claude', focus = true) {
  const id = `t${nextId++}`;
  const el = document.createElement('div');
  el.className = 'term';
  $('#terminals').appendChild(el);

  const term = new Terminal({
    fontFamily: '"Cascadia Mono", Consolas, "Courier New", monospace',
    fontSize, lineHeight: 1.15, theme: THEME, cursorBlink: true,
    scrollback: 10000, allowProposedApi: true,
    scrollSensitivity: 4, fastScrollSensitivity: 12, smoothScrollDuration: 0,
  });
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open(el);
  term.attachCustomKeyEventHandler(e => terminalKey(e, term));
  term.onData(d => {
    const t = tabs.find(x => x.id === id);
    if (t?.exited) { if (d === '\r') restart(t); return; }
    window.deck.write(id, d);
  });
  term.onResize(({ cols, rows }) => window.deck.resize(id, cols, rows));
  term.onTitleChange(title => { tab.tabEl.title = title; });
  el.addEventListener('contextmenu', async e => {
    e.preventDefault();
    if (term.hasSelection()) { window.deck.writeClipboard(term.getSelection()); term.clearSelection(); }
    else term.paste(await window.deck.readClipboard());
  });

  const tabEl = document.createElement('div');
  tabEl.className = 'tab';
  tabEl.innerHTML = `<span class="dot"></span><span class="label"></span><span class="kind">${kind === 'shell' ? 'pwsh' : ''}</span><button class="close" title="Close (Ctrl+Shift+W)">×</button>`;
  tabEl.querySelector('.label').textContent = labelFor(project, kind);
  tabEl.onclick = () => activate(id);
  tabEl.onauxclick = e => { if (e.button === 1) closeTab(id); };
  tabEl.querySelector('.close').onclick = e => { e.stopPropagation(); closeTab(id); };
  $('#tabs').appendChild(tabEl);

  const tab = { id, project, kind, term, fit, el, tabEl, exited: false, state: 'idle' };
  tabs.push(tab);
  new ResizeObserver(() => { if (el.classList.contains('active')) safeFit(tab); }).observe(el);

  lastUsed[project.path] = Date.now();
  store.set('lastUsed', lastUsed);
  if (focus || !activeId) activate(id);
  safeFit(tab);
  await window.deck.spawn({ id, cwd: project.path, cols: term.cols, rows: term.rows, kind });
  saveSession();
  return tab;
}

function restart(t) {
  t.exited = false;
  t.tabEl.classList.remove('exited');
  t.term.reset();
  window.deck.spawn({ id: t.id, cwd: t.project.path, cols: t.term.cols, rows: t.term.rows, kind: t.kind });
}

function safeFit(t) { try { t.fit.fit(); } catch {} }

function activate(id) {
  activeId = id;
  for (const t of tabs) {
    const on = t.id === id;
    t.el.classList.toggle('active', on);
    t.tabEl.classList.toggle('active', on);
  }
  const t = activeTab();
  $('#empty').style.display = t ? 'none' : '';
  if (t) {
    if (t.state === 'done') setState(t, 'idle');
    requestAnimationFrame(() => { safeFit(t); t.term.focus(); });
    t.tabEl.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  $('#title-path').textContent = t ? t.project.path : '';
  renderProjects();
}

function closeTab(id) {
  const i = tabs.findIndex(t => t.id === id);
  if (i < 0) return;
  const [t] = tabs.splice(i, 1);
  window.deck.kill(id);
  t.term.dispose(); t.el.remove(); t.tabEl.remove();
  if (activeId === id) activate(tabs[Math.min(i, tabs.length - 1)]?.id ?? null);
  else renderProjects();
  saveSession();
}

function cycle(dir) {
  if (!tabs.length) return;
  const i = tabs.findIndex(t => t.id === activeId);
  activate(tabs[(i + dir + tabs.length) % tabs.length].id);
}

function setFontSize(n) {
  fontSize = Math.max(8, Math.min(24, n));
  store.set('fontSize', fontSize);
  for (const t of tabs) { t.term.options.fontSize = fontSize; safeFit(t); }
}

window.deck.onData((id, data) => {
  const t = tabs.find(x => x.id === id);
  if (!t) return;
  t.term.write(data);
});

// Claude's own hooks report each tab's turns (see hookSettings in main.js): a sent
// prompt makes the tab "working"; Claude stopping or asking for attention makes it
// "done" until you look at it.
function setState(t, state) {
  if (state === 'done' && t.id === activeId && document.hasFocus()) state = 'idle';
  t.state = state;
  t.tabEl.classList.toggle('working', state === 'working');
  t.tabEl.classList.toggle('done', state === 'done');
  renderProjects();
}
window.deck.onClaudeEvent((id, event) => {
  const t = tabs.find(x => x.id === id);
  if (t && !t.exited) setState(t, event === 'prompt' ? 'working' : 'done');
});
window.addEventListener('focus', () => { const t = activeTab(); if (t?.state === 'done') setState(t, 'idle'); });
window.deck.onExit((id, code) => {
  const t = tabs.find(x => x.id === id);
  if (!t) return;
  t.exited = true;
  t.tabEl.classList.add('exited');
  setState(t, 'idle');
  t.term.write(`\r\n\x1b[90m[exited${code ? ` with code ${code}` : ''}. Press Enter to start again, Ctrl+Shift+W to close.]\x1b[0m\r\n`);
});

// Open tabs come back (as fresh sessions) next time Deck starts.
function saveSession() { store.set('session', tabs.map(t => ({ path: t.project.path, kind: t.kind }))); }

// ---------- keys ----------

// Returns false for keys Deck handles itself, so the terminal never sees them.
function terminalKey(e, term) {
  if (e.type !== 'keydown') return true;
  if (e.ctrlKey && !e.shiftKey && e.key === 'c' && term.hasSelection()) {
    window.deck.writeClipboard(term.getSelection()); term.clearSelection(); return false;
  }
  if (e.ctrlKey && !e.shiftKey && e.key === 'v') {
    window.deck.readClipboard().then(text => text && term.paste(text)); return false;
  }
  return !appKey(e);
}

function appKey(e) {
  const k = e.key.toLowerCase();
  const t = activeTab();
  if (e.ctrlKey && e.shiftKey && k === 't') { if (t) newTab(t.project, 'claude'); else $('#search').focus(); return true; }
  if (e.ctrlKey && e.shiftKey && (e.code === 'Backquote')) { if (t) newTab(t.project, 'shell'); return true; }
  if (e.ctrlKey && e.shiftKey && k === 'w') { if (t) closeTab(t.id); return true; }
  if (e.ctrlKey && k === 'tab') { cycle(e.shiftKey ? -1 : 1); return true; }
  if (e.ctrlKey && !e.shiftKey && /^[1-9]$/.test(e.key)) { const x = tabs[+e.key - 1]; if (x) activate(x.id); return true; }
  if (e.ctrlKey && e.shiftKey && k === 'b') { setSidebar(!document.body.classList.contains('side-hidden')); return true; }
  if (e.ctrlKey && e.shiftKey && k === 'o') { openFolder(); return true; }
  if (e.ctrlKey && e.shiftKey && k === 'p') { setSidebar(false); $('#search').focus(); $('#search').select(); return true; }
  if (e.ctrlKey && (k === '=' || k === '+')) { setFontSize(fontSize + 1); return true; }
  if (e.ctrlKey && k === '-') { setFontSize(fontSize - 1); return true; }
  if (e.ctrlKey && k === '0') { setFontSize(14); return true; }
  return false;
}

document.addEventListener('keydown', e => { if (appKey(e)) { e.preventDefault(); e.stopPropagation(); } }, true);
function setSidebar(hidden) {
  document.body.classList.toggle('side-hidden', hidden);
  store.set('sideHidden', hidden);
  requestAnimationFrame(() => { const t = activeTab(); if (t) safeFit(t); });
}
$('#toggle-side').onclick = () => setSidebar(!document.body.classList.contains('side-hidden'));
$('#new-tab').onclick = () => { const t = activeTab(); if (t) newTab(t.project, 'claude'); else $('#search').focus(); };
$('#new-shell').onclick = () => { const t = activeTab(); if (t) newTab(t.project, 'shell'); };
window.addEventListener('focus', loadProjects);

// ---------- start ----------

(async () => {
  await loadProjects();
  setSidebar(store.get('sideHidden', false));
  const session = store.get('session', []);
  let first = true;
  for (const s of session) {
    const p = projects.find(x => x.path === s.path);
    if (p) { await newTab(p, s.kind, first); first = false; }
  }
  if (!tabs.length) $('#search').focus();
})();
