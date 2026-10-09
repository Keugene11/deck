// Renders build/icon.svg at several sizes and writes build/icon.ico (PNG-in-ICO) and icon.png.
// Run: electron build/make-icon.js
const { app, BrowserWindow } = require('electron');
const fs = require('fs'), path = require('path');
const SIZES = [256, 128, 64, 48, 32, 24, 16];
app.whenReady().then(async () => {
  const svg = fs.readFileSync(path.join(__dirname, 'icon.svg'), 'utf8');
  const w = new BrowserWindow({ width: 256, height: 256, show: false, frame: false, transparent: true,
    useContentSize: true, webPreferences: { offscreen: true } });
  const file = path.join(app.getPath('temp'), 'deck-icon.html');
  fs.writeFileSync(file, `<html><body style="margin:0;background:transparent">${svg.replace('<svg ', '<svg width="256" height="256" ')}</body></html>`);
  await w.loadFile(file);
  await new Promise(r => setTimeout(r, 500));
  const big = await w.webContents.capturePage({ x: 0, y: 0, width: 256, height: 256 });
  w.destroy();
  const pngs = SIZES.map(s => ({ s, buf: (s === 256 ? big : big.resize({ width: s, height: s, quality: 'best' })).toPNG() }));
  const head = Buffer.alloc(6 + 16 * pngs.length);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(pngs.length, 4);
  let offset = head.length;
  pngs.forEach(({ s, buf }, i) => {
    const o = 6 + 16 * i;
    head.writeUInt8(s >= 256 ? 0 : s, o); head.writeUInt8(s >= 256 ? 0 : s, o + 1);
    head.writeUInt16LE(1, o + 4); head.writeUInt16LE(32, o + 6);
    head.writeUInt32LE(buf.length, o + 8); head.writeUInt32LE(offset, o + 12);
    offset += buf.length;
  });
  fs.writeFileSync(path.join(__dirname, 'icon.ico'), Buffer.concat([head, ...pngs.map(p => p.buf)]));
  fs.writeFileSync(path.join(__dirname, 'icon.png'), pngs[0].buf);
  console.log('wrote icon.ico with', pngs.map(p => p.s).join(','));
  app.quit();
});
