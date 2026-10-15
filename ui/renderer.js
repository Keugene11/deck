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
const START_TABS = 3;

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
    const mine = tabs.filter(t => t.project.path === p.path && t.kind !== 'file');
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
  const existing = tabs.filter(t => t.project.path === p.path && t.kind !== 'file').pop();
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
  term.registerLinkProvider(fileLinkProvider(term, project));
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
  if (focus || !activeId) activate(id); else renderProjects();
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
    requestAnimationFrame(() => { if (t.kind === 'file') { t.focus?.(); checkDisk(t); } else { safeFit(t); t.term.focus(); } });
    t.tabEl.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  $('#title-path').textContent = t ? t.project.path : '';
  renderProjects();
  renderFileTree();
}

function closeTab(id) {
  const i = tabs.findIndex(t => t.id === id);
  if (i < 0) return;
  if (tabs[i].dirty && !confirm(`Close ${tabs[i].tabEl.title || 'this file'} without saving?`)) return;
  const [t] = tabs.splice(i, 1);
  if (t.kind === 'file') clearInterval(t.timer); else { window.deck.kill(id); t.term.dispose(); }
  t.el.remove(); t.tabEl.remove();
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
  for (const t of tabs) { if (t.kind === 'file') t.applyFont(); else { t.term.options.fontSize = fontSize; safeFit(t); } }
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
function saveSession() { store.set('session', tabs.filter(t => t.kind !== 'file').map(t => ({ path: t.project.path, kind: t.kind }))); }

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
  if (e.ctrlKey && !e.shiftKey && k === 'p') { openQuickOpen(); return true; }
  if (e.ctrlKey && !e.shiftKey && k === 's' && t?.kind === 'file') { saveFile(t); return true; }
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
window.addEventListener('focus', () => { loadProjects(); renderFileTree(true); const t = activeTab(); if (t?.kind === 'file') checkDisk(t); });
$('#quick-open-btn').onclick = () => openQuickOpen();

// ---------- files: viewer/editor tabs, tree, quick open, clickable paths ----------

const baseName = p => p.split(/[\\/]/).pop();
const joinPath = (root, rel) => root.replace(/[\\/]+$/, '') + '\\' + rel.replace(/\//g, '\\');
const relPath = (root, file) => file.toLowerCase().startsWith(root.toLowerCase()) ? file.slice(root.length).replace(/^[\\/]+/, '').replace(/\\/g, '/') : file;
const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const recent = store.get('recentFiles', {});   // project path -> [relative files, newest first]

// Opens a file in its own tab (or jumps to the tab it is already in), optionally at a line.
async function openFile(project, file, line, col) {
  let t = tabs.find(x => x.kind === 'file' && x.filePath.toLowerCase() === file.toLowerCase());
  if (!t) t = await newFileTab(project, file);
  activate(t.id);
  if (line) requestAnimationFrame(() => gotoLine(t, line, col));
  const rel = relPath(project.path, file);
  recent[project.path] = [rel, ...(recent[project.path] || []).filter(x => x !== rel)].slice(0, 30);
  store.set('recentFiles', recent);
  return t;
}

async function newFileTab(project, file) {
  const id = `f${nextId++}`;
  const el = document.createElement('div');
  el.className = 'fileview';
  el.innerHTML = `<div class="fv-bar"><span class="fv-path"></span><button class="fv-reload" title="Reload from disk">Reload</button><button class="fv-save" title="Save (Ctrl+S)" disabled>Save</button></div>
    <div class="fv-note"><span></span><button>Reload</button></div><div class="fv-body"></div>`;
  $('#terminals').appendChild(el);
  el.querySelector('.fv-path').textContent = relPath(project.path, file);
  el.querySelector('.fv-path').title = file;

  const tabEl = document.createElement('div');
  tabEl.className = 'tab file';
  tabEl.innerHTML = `<span class="dot"></span><span class="label"></span><span class="kind"></span><button class="close" title="Close (Ctrl+Shift+W)">×</button>`;
  tabEl.querySelector('.label').textContent = baseName(file);
  tabEl.title = file;
  tabEl.onclick = () => activate(id);
  tabEl.onauxclick = e => { if (e.button === 1) closeTab(id); };
  tabEl.querySelector('.close').onclick = e => { e.stopPropagation(); closeTab(id); };
  $('#tabs').appendChild(tabEl);

  const t = { id, project, kind: 'file', filePath: file, el, tabEl, state: 'idle', dirty: false, saved: '', mtime: 0, ta: null };
  const note = el.querySelector('.fv-note');
  const saveBtn = el.querySelector('.fv-save');
  const setNote = text => { note.classList.toggle('show', !!text); note.querySelector('span').textContent = text || ''; };
  t.setDirty = d => { t.dirty = d; tabEl.classList.toggle('dirty', d); saveBtn.disabled = !d; };
  t.setNote = setNote;
  t.applyFont = () => {
    if (!t.ta) return;
    const lh = Math.round(fontSize * 1.5) + 'px';
    for (const n of [t.ta, t.gutter]) { n.style.fontSize = fontSize + 'px'; n.style.lineHeight = lh; }
  };
  t.focus = () => t.ta?.focus();
  saveBtn.onclick = () => saveFile(t);
  el.querySelector('.fv-reload').onclick = () => reloadFile(t, true);
  note.querySelector('button').onclick = () => reloadFile(t, true);
  tabs.push(t);
  await loadInto(t, await window.deck.readFile(file));
  // Claude edits files constantly: a clean tab quietly follows the disk, a modified one asks first.
  t.timer = setInterval(() => { if (t.id === activeId && document.hasFocus()) checkDisk(t); }, 1500);
  return t;
}

// Fills the body of a file tab from what main.js read.
async function loadInto(t, data, keepView) {
  const body = t.el.querySelector('.fv-body');
  const view = keepView && t.ta ? { top: t.ta.scrollTop, left: t.ta.scrollLeft, a: t.ta.selectionStart, b: t.ta.selectionEnd } : null;
  body.innerHTML = '';
  t.ta = null;
  t.mtime = data.mtime || 0;
  const msg = text => { const d = document.createElement('div'); d.className = 'fv-msg'; d.textContent = text; body.appendChild(d); };
  if (data.error) return msg(`Can't open this file: ${data.error}`);
  if (data.image) { const img = document.createElement('img'); img.className = 'fv-image'; img.src = data.image; body.appendChild(img); return; }
  if (data.tooBig) return msg(`This file is ${(data.size / 1048576).toFixed(1)} MB, too big to open here.`);
  if (data.binary) return msg(`Binary file (${(data.size / 1024).toFixed(0)} KB). Nothing to show.`);

  const gutter = document.createElement('div');
  gutter.className = 'fv-gutter';
  const ta = document.createElement('textarea');
  ta.className = 'fv-text';
  ta.spellcheck = false;
  ta.wrap = 'off';
  ta.value = data.text;
  body.append(gutter, ta);
  t.ta = ta; t.gutter = gutter; t.saved = data.text;
  const numbers = () => {
    const n = ta.value.split('\n').length;
    if (t.lines === n) return;
    t.lines = n;
    gutter.textContent = Array.from({ length: n }, (_, i) => i + 1).join('\n');
    gutter.style.minWidth = `${String(n).length * 0.62 + 2.2}em`;
  };
  t.lines = 0; numbers();
  ta.addEventListener('input', () => { numbers(); t.setDirty(ta.value !== t.saved); });
  ta.addEventListener('scroll', () => { gutter.scrollTop = ta.scrollTop; });
  ta.addEventListener('keydown', e => {
    if (e.key === 'Tab' && !e.ctrlKey && !e.altKey) { e.preventDefault(); document.execCommand('insertText', false, '  '); }
  });
  t.applyFont();
  t.setDirty(false);
  t.setNote('');
  if (view) { ta.scrollTop = view.top; ta.scrollLeft = view.left; ta.setSelectionRange(Math.min(view.a, ta.value.length), Math.min(view.b, ta.value.length)); gutter.scrollTop = view.top; }
}

async function reloadFile(t, force) {
  const data = await window.deck.readFile(t.filePath);
  if (!force && !data.error && data.text === t.saved) { t.mtime = data.mtime; return; }
  await loadInto(t, data, true);
}

// Called while a file tab is on screen: follows changes on disk.
async function checkDisk(t) {
  if (t.kind !== 'file' || t.checking) return;
  t.checking = true;
  try {
    const m = await window.deck.statFile(t.filePath);
    if (m == null) { t.setNote('This file was deleted or moved on disk.'); return; }
    if (m === t.mtime) return;
    if (!t.dirty) await reloadFile(t, false);
    else t.setNote('This file changed on disk while you were editing it.');
  } finally { t.checking = false; }
}

async function saveFile(t) {
  if (!t.ta || !t.dirty) return;
  const m = await window.deck.statFile(t.filePath);
  if (m != null && m !== t.mtime && !confirm('This file changed on disk since you opened it. Overwrite it with your version?')) return;
  const text = t.ta.value;
  const res = await window.deck.writeFile(t.filePath, text);
  if (res.error) { t.setNote(`Couldn't save: ${res.error}`); return; }
  t.saved = text; t.mtime = res.mtime;
  t.setDirty(t.ta.value !== text);
  t.setNote('');
}

function gotoLine(t, line, col) {
  const ta = t.ta;
  if (!ta) return;
  const lines = ta.value.split('\n');
  const n = Math.max(1, Math.min(line, lines.length));
  let off = 0;
  for (let i = 0; i < n - 1; i++) off += lines[i].length + 1;
  const start = off + Math.max(0, Math.min((col || 1) - 1, lines[n - 1].length));
  ta.focus();
  ta.setSelectionRange(start, col ? start : off + lines[n - 1].length);
  const lh = Math.round(fontSize * 1.5);
  ta.scrollTop = Math.max(0, (n - 1) * lh - ta.clientHeight / 3);
  t.gutter.scrollTop = ta.scrollTop;
}

// ----- clickable paths in terminal output -----

const FILE_RE = /(?:[A-Za-z]:[\\/][^\s"'`<>|*?:()]+|(?:\.{1,2}[\\/])?[\w@.\-[\]()]+(?:[\\/][\w@.\-[\]()]+)+|\b[\w-]+\.(?:md|mdx|txt|json|jsonc|ts|tsx|mts|js|jsx|mjs|cjs|css|html|py|sql|ya?ml|toml|sh|ps1|csv|lock|env))(?::(\d+)(?::(\d+))?)?/g;
const resolved = new Map();   // "cwd|text" -> { at, file }
async function resolveLink(cwd, text) {
  const key = `${cwd}|${text}`;
  const hit = resolved.get(key);
  if (hit && Date.now() - hit.at < (hit.file ? 600000 : 5000)) return hit.file;
  const file = await window.deck.resolveFile(cwd, text);
  resolved.set(key, { at: Date.now(), file });
  return file;
}

function fileLinkProvider(term, project) {
  return {
    async provideLinks(y, cb) {
      const line = term.buffer.active.getLine(y - 1)?.translateToString(true);
      if (!line) return cb(undefined);
      const found = [];
      for (const m of line.matchAll(FILE_RE)) {
        const suffix = m[1] ? `:${m[1]}${m[2] ? ':' + m[2] : ''}` : '';
        let text = m[0].slice(0, m[0].length - suffix.length);
        if (!suffix) text = text.replace(/[.,;:)\]]+$/, '');
        if (!text || /^\d+(\.\d+)*$/.test(text)) continue;
        found.push({ text, at: m.index, len: text.length + suffix.length, line: m[1] && +m[1], col: m[2] && +m[2] });
      }
      const files = await Promise.all(found.map(f => resolveLink(project.path, f.text)));
      const links = [];
      found.forEach((f, i) => {
        if (!files[i]) return;
        links.push({
          range: { start: { x: f.at + 1, y }, end: { x: f.at + f.len, y } },
          text: line.slice(f.at, f.at + f.len),
          activate: () => openFile(project, files[i], f.line, f.col),
        });
      });
      cb(links.length ? links : undefined);
    },
  };
}

// ----- file tree (sidebar) -----

const treeOpen = new Set(store.get('treeOpen', []));
let treeRoot = null;
let treeBusy = false;

async function buildDir(dir, depth) {
  const frag = document.createDocumentFragment();
  const entries = await window.deck.listDir(dir);
  for (const e of entries) {
    const node = document.createElement('div');
    node.className = 'node' + (e.dir ? ' dir' : '');
    node.dataset.path = e.path;
    node.style.paddingLeft = `${14 + depth * 12}px`;
    node.innerHTML = `<span class="twist">${e.dir ? (treeOpen.has(e.path) ? '▾' : '▸') : ''}</span><span class="nm"></span>`;
    node.querySelector('.nm').textContent = e.name;
    node.title = e.path;
    frag.appendChild(node);
    if (e.dir) {
      const kids = document.createElement('div');
      frag.appendChild(kids);
      if (treeOpen.has(e.path)) kids.appendChild(await buildDir(e.path, depth + 1));
      node.onclick = async () => {
        if (treeOpen.has(e.path)) { treeOpen.delete(e.path); kids.innerHTML = ''; node.querySelector('.twist').textContent = '▸'; }
        else { treeOpen.add(e.path); node.querySelector('.twist').textContent = '▾'; kids.appendChild(await buildDir(e.path, depth + 1)); markTree(); }
        store.set('treeOpen', [...treeOpen]);
      };
    } else {
      node.onclick = () => { const t = activeTab(); if (t) openFile(t.project, e.path); };
    }
  }
  return frag;
}

function markTree() {
  const t = activeTab();
  for (const n of document.querySelectorAll('#filetree .node')) n.classList.toggle('open-file', !!t && t.kind === 'file' && n.dataset.path.toLowerCase() === t.filePath.toLowerCase());
}

async function renderFileTree(force) {
  const t = activeTab();
  const root = t?.project.path || null;
  $('#files-title').textContent = t ? `FILES · ${t.project.name.toUpperCase()}` : 'FILES';
  if (!root) { treeRoot = null; $('#filetree').innerHTML = ''; return; }
  if (root === treeRoot && !force) return markTree();
  if (treeBusy) return;
  treeBusy = true;
  try {
    const frag = await buildDir(root, 0);
    const box = $('#filetree');
    const top = root === treeRoot ? box.scrollTop : 0;
    box.innerHTML = '';
    box.appendChild(frag);
    box.scrollTop = top;
    treeRoot = root;
    markTree();
  } finally { treeBusy = false; }
  if (activeTab()?.project.path !== treeRoot) renderFileTree();
}

// ----- quick open (Ctrl+P) -----

const qo = { root: null, files: [], list: [], sel: 0, cache: {} };

// Subsequence match: every typed letter in order. Higher is better: a hit in the file name, at word starts, in a row.
function fuzzy(query, file) {
  const q = query.toLowerCase(), f = file.toLowerCase();
  const slash = f.lastIndexOf('/');
  let best = null;
  for (const from of [slash + 1, 0]) {
    let qi = 0, score = 0, run = 0, last = -2;
    const hits = [];
    for (let i = from; i < f.length && qi < q.length; i++) {
      if (f[i] !== q[qi]) { run = 0; continue; }
      const start = i === 0 || /[\/._\-\s]/.test(f[i - 1]);
      run = last === i - 1 ? run + 1 : 0;
      score += 1 + run * 2 + (start ? 3 : 0) + (i >= slash + 1 ? 2 : 0);
      hits.push(i); last = i; qi++;
    }
    if (qi === q.length) { score -= file.length * 0.02; if (!best || score > best.score) best = { score, hits }; }
  }
  return best;
}

function highlight(text, hits, offset) {
  let out = '';
  for (let i = 0; i < text.length; i++) out += hits.has(i + offset) ? `<mark>${esc(text[i])}</mark>` : esc(text[i]);
  return out;
}

function renderQuickOpen() {
  const raw = $('#qo-input').value.trim();
  const m = /^(.*?)(?::(\d+))?$/.exec(raw);
  const q = (m[1] || '').trim();
  let list;
  if (!q) {
    const rec = (recent[qo.root] || []).filter(f => qo.files.includes(f));
    list = [...rec, ...qo.files.filter(f => !rec.includes(f))].slice(0, 40).map(file => ({ file, hits: new Set() }));
  } else {
    list = [];
    for (const file of qo.files) { const r = fuzzy(q, file); if (r) list.push({ file, score: r.score, hits: new Set(r.hits) }); }
    list.sort((a, b) => b.score - a.score);
    list = list.slice(0, 40);
  }
  qo.list = list;
  qo.line = m[2] ? +m[2] : null;
  qo.sel = Math.min(qo.sel, Math.max(0, list.length - 1));
  const ul = $('#qo-list');
  ul.innerHTML = '';
  if (!list.length) { ul.innerHTML = `<li class="none">${qo.files.length ? 'No matching files' : 'Loading files…'}</li>`; return; }
  list.forEach((it, i) => {
    const li = document.createElement('li');
    if (i === qo.sel) li.className = 'sel';
    const slash = it.file.lastIndexOf('/');
    li.innerHTML = `<span class="base">${highlight(it.file.slice(slash + 1), it.hits, slash + 1)}</span><span class="dir">${highlight(it.file.slice(0, slash + 1), it.hits, 0)}</span>`;
    li.onclick = () => chooseQuickOpen(i);
    ul.appendChild(li);
  });
  ul.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
}

async function openQuickOpen() {
  const t = activeTab();
  if (!t) return;
  qo.root = t.project.path; qo.project = t.project;
  qo.files = qo.cache[qo.root] || [];
  qo.sel = 0;
  $('#quickopen').hidden = false;
  $('#qo-input').value = '';
  $('#qo-input').focus();
  renderQuickOpen();
  const root = qo.root;
  const files = await window.deck.listFiles(root);   // fresh every time: Claude adds files all day
  qo.cache[root] = files;
  if (root === qo.root && !$('#quickopen').hidden) { qo.files = files; renderQuickOpen(); }
}

function closeQuickOpen() {
  $('#quickopen').hidden = true;
  const t = activeTab();
  if (t?.kind === 'file') t.focus?.(); else t?.term.focus();
}

function chooseQuickOpen(i) {
  const it = qo.list[i];
  if (!it) return;
  const line = qo.line;
  const project = qo.project;
  $('#quickopen').hidden = true;
  openFile(project, joinPath(qo.root, it.file), line);
}

$('#qo-input').addEventListener('input', () => { qo.sel = 0; renderQuickOpen(); });
$('#qo-input').addEventListener('keydown', e => {
  if (e.key === 'ArrowDown') { qo.sel = Math.min(qo.sel + 1, qo.list.length - 1); renderQuickOpen(); e.preventDefault(); }
  else if (e.key === 'ArrowUp') { qo.sel = Math.max(qo.sel - 1, 0); renderQuickOpen(); e.preventDefault(); }
  else if (e.key === 'Enter') { chooseQuickOpen(qo.sel); e.preventDefault(); }
  else if (e.key === 'Escape') { closeQuickOpen(); e.preventDefault(); }
});
$('#quickopen').addEventListener('mousedown', e => { if (e.target.id === 'quickopen') closeQuickOpen(); });

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
  // Nothing to restore: open the project used last with a few Claude tabs.
  const last = sortedProjects()[0];
  if (!tabs.length && last) for (let i = 0; i < START_TABS; i++) await newTab(last, 'claude', i === 0);
  if (!tabs.length) $('#search').focus();
})();
