// Deck: a project list and terminal tabs, each tab running Claude Code.
const { app, BrowserWindow, ipcMain, clipboard, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');
const pty = require('@lydell/node-pty');
const http = require('http');
const crypto = require('crypto');

const PROJECTS = path.join(os.homedir(), 'projects');
const CLAUDE = [path.join(os.homedir(), '.local', 'bin', 'claude.exe')].find(fs.existsSync) || 'claude';
const SHELL = 'powershell.exe';

if (!process.env.DECK_SHOT && !app.requestSingleInstanceLock()) app.quit();

let win;
const terms = new Map(); // id -> pty

function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    backgroundColor: '#1e1e1e',
    icon: path.join(__dirname, 'build', 'icon.ico'),
    title: 'Deck',
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#1f1f1f', symbolColor: '#cccccc', height: 35 },
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  win.loadFile(path.join(__dirname, 'ui', 'index.html'));
  if (process.env.DECK_SHOT) win.webContents.on('console-message', e => console.log('RENDERER', e.message));
  win.on('closed', () => {
    for (const p of terms.values()) try { p.kill(); } catch {}
    terms.clear();
    win = null;
  });
}

// DECK_SHOT=out.png: open a project (DECK_PROJECT, default the first) in a throwaway
// profile, optionally type DECK_TYPE into it, screenshot, quit.
if (process.env.DECK_SHOT) {
  app.setPath('userData', path.join(os.tmpdir(), 'deck-shot'));
  const wait = ms => new Promise(r => setTimeout(r, ms));
  app.whenReady().then(async () => {
    await wait(1500);
    const name = JSON.stringify(process.env.DECK_PROJECT || '');
    await win.webContents.executeJavaScript(`(projects.find(p => p.name === ${name}) ? openProject(projects.find(p => p.name === ${name})) : document.querySelector('#projects li').click())`);
    await wait(Number(process.env.DECK_PRE || 9000));
    await win.webContents.executeJavaScript(`window.__ev = []; window.deck.onClaudeEvent((id, e) => window.__ev.push(e + '@' + Math.round(performance.now()))); 0`);
    if (process.env.DECK_TYPE) {
      await win.webContents.executeJavaScript(`window.deck.write(activeId, ${JSON.stringify(process.env.DECK_TYPE)})`);
      await wait(400);
      await win.webContents.executeJavaScript(`window.deck.write(activeId, String.fromCharCode(13))`);
      await wait(Number(process.env.DECK_WAIT || 15000));
      console.log('DECK_EVENTS', await win.webContents.executeJavaScript(`JSON.stringify({ events: window.__ev, tab: document.querySelector('.tab').className })`));
    }
    fs.writeFileSync(process.env.DECK_SHOT, (await win.webContents.capturePage()).toPNG());
    app.quit();
  });
}

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());

ipcMain.handle('projects:list', () => {
  fs.mkdirSync(PROJECTS, { recursive: true });
  return fs.readdirSync(PROJECTS, { withFileTypes: true })
    .filter(d => d.isDirectory() && !d.name.startsWith('.'))
    .map(d => {
      const full = path.join(PROJECTS, d.name);
      let mtime = 0;
      try { mtime = fs.statSync(full).mtimeMs; } catch {}
      return { name: d.name, path: full, mtime };
    });
});

ipcMain.handle('projects:create', async (_e, name) => {
  name = String(name || '').trim().replace(/[<>:"/\\|?*]/g, '-');
  if (!name) throw new Error('Name is empty');
  const full = path.join(PROJECTS, name);
  if (fs.existsSync(full)) return { name, path: full };
  fs.mkdirSync(full, { recursive: true });
  await new Promise(res => execFile('git', ['init', '-q'], { cwd: full }, () => res()));
  return { name, path: full };
});

// The Windows folder picker (it has its own "New folder" button).
ipcMain.handle('projects:pick', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Open Folder',
    defaultPath: PROJECTS,
    properties: ['openDirectory', 'createDirectory'],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  const full = r.filePaths[0];
  return { name: path.basename(full) || full, path: full, mtime: Date.now() };
});

ipcMain.handle('projects:reveal', (_e, dir) => shell.openPath(dir));

// Deck may itself be launched from inside a Claude session; a tab must not inherit
// that session's markers or NO_COLOR, or Claude starts as a colorless child.
function cleanEnv() {
  const env = { ...process.env };
  for (const k of Object.keys(env)) {
    if (/^(CLAUDE|NO_COLOR$|FORCE_COLOR$|ELECTRON_)/i.test(k)) delete env[k];
  }
  return { ...env, TERM: 'xterm-256color', COLORTERM: 'truecolor', DISABLE_TELEMETRY: '1' };
}

// Each Claude tab gets hooks (through --settings) that tell Deck when a prompt is
// sent and when Claude stops or wants attention, so the tab can show working/done.
const HOOK_TOKEN = crypto.randomBytes(12).toString('hex');
const HOOK_DIR = path.join(os.tmpdir(), 'deck-hooks');
const CURL = 'C:/Windows/System32/curl.exe';
const hookServer = http.createServer((req, res) => {
  const [, token, id, event] = (req.url || '').split('/');
  if (token === HOOK_TOKEN && win && ['prompt', 'stop', 'notify'].includes(event)) {
    win.webContents.send('claude:event', id, event);
  }
  res.writeHead(204).end();
});
const hookPort = new Promise(res => hookServer.listen(0, '127.0.0.1', () => res(hookServer.address().port)));

async function hookSettings(id) {
  const port = await hookPort;
  const hook = event => [{ hooks: [{ type: 'command', command: `${CURL} -s -m 2 http://127.0.0.1:${port}/${HOOK_TOKEN}/${id}/${event}` }] }];
  const file = path.join(HOOK_DIR, `${process.pid}-${id}.json`);
  fs.mkdirSync(HOOK_DIR, { recursive: true });
  fs.writeFileSync(file, JSON.stringify({
    hooks: { UserPromptSubmit: hook('prompt'), Stop: hook('stop'), StopFailure: hook('stop'), Notification: hook('notify') },
  }));
  return file;
}
app.on('quit', () => {
  for (const f of fs.readdirSync(HOOK_DIR, { withFileTypes: true }).filter(f => f.name.startsWith(`${process.pid}-`))) {
    try { fs.rmSync(path.join(HOOK_DIR, f.name)); } catch {}
  }
});

// Terminals started at the same instant fail on Windows (all but the first exit -1
// with no output), so restoring several tabs at once queues them a little apart.
const SPAWN_GAP = 400;
let spawnQueue = Promise.resolve();
const nextSpawnSlot = () => {
  const slot = spawnQueue;
  spawnQueue = slot.then(() => new Promise(r => setTimeout(r, SPAWN_GAP)));
  return slot;
};

ipcMain.handle('pty:spawn', async (_e, { id, cwd, cols, rows, kind }) => {
  await nextSpawnSlot();
  const [file, args] = kind === 'shell'
    ? [SHELL, ['-NoLogo']]
    : [CLAUDE, ['--dangerously-skip-permissions', '--settings', await hookSettings(id)]];
  const p = pty.spawn(file, args, {
    name: 'xterm-256color',
    cwd,
    cols: cols || 120,
    rows: rows || 30,
    env: cleanEnv(),
  });
  terms.set(id, p);
  p.onData(data => win && win.webContents.send('pty:data', id, data));
  p.onExit(({ exitCode }) => {
    terms.delete(id);
    if (win) win.webContents.send('pty:exit', id, exitCode);
  });
  return true;
});

ipcMain.on('pty:write', (_e, id, data) => terms.get(id)?.write(data));
ipcMain.on('pty:resize', (_e, id, cols, rows) => { try { terms.get(id)?.resize(cols, rows); } catch {} });
ipcMain.on('pty:kill', (_e, id) => { try { terms.get(id)?.kill(); } catch {} terms.delete(id); });

ipcMain.handle('clip:read', () => clipboard.readText());
ipcMain.on('clip:write', (_e, text) => clipboard.writeText(text));
