const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('deck', {
  listProjects: () => ipcRenderer.invoke('projects:list'),
  createProject: name => ipcRenderer.invoke('projects:create', name),
  pickFolder: () => ipcRenderer.invoke('projects:pick'),
  reveal: dir => ipcRenderer.invoke('projects:reveal', dir),
  spawn: opts => ipcRenderer.invoke('pty:spawn', opts),
  write: (id, data) => ipcRenderer.send('pty:write', id, data),
  resize: (id, cols, rows) => ipcRenderer.send('pty:resize', id, cols, rows),
  kill: id => ipcRenderer.send('pty:kill', id),
  onData: fn => ipcRenderer.on('pty:data', (_e, id, data) => fn(id, data)),
  onClaudeEvent: fn => ipcRenderer.on('claude:event', (_e, id, event) => fn(id, event)),
  onExit: fn => ipcRenderer.on('pty:exit', (_e, id, code) => fn(id, code)),
  readClipboard: () => ipcRenderer.invoke('clip:read'),
  writeClipboard: text => ipcRenderer.send('clip:write', text),
});
