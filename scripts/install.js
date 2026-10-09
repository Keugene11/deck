// Builds nothing: copies dist/Deck-win32-x64 to %LOCALAPPDATA%\Programs\Deck and points the
// Desktop and Start menu shortcuts at Deck.exe. Run after `npm run pack` (Deck must be closed).
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');

const src = path.join(__dirname, '..', 'dist', 'Deck-win32-x64');
const dest = path.join(process.env.LOCALAPPDATA, 'Programs', 'Deck');
const exe = path.join(dest, 'Deck.exe');

const running = execFileSync('tasklist', ['/FI', 'IMAGENAME eq Deck.exe', '/NH'], { encoding: 'utf8' });
if (running.includes('Deck.exe')) { console.error('Deck is running. Close it, then run this again.'); process.exit(1); }

fs.rmSync(dest, { recursive: true, force: true });
fs.cpSync(src, dest, { recursive: true });

const desktop = execFileSync('powershell.exe', ['-NoProfile', '-Command', "[Environment]::GetFolderPath('Desktop')"], { encoding: 'utf8' }).trim();
const startMenu = path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs');
const ps = [desktop, startMenu].map(dir => `
$s = (New-Object -ComObject WScript.Shell).CreateShortcut('${path.join(dir, 'Deck.lnk')}')
$s.TargetPath = '${exe}'
$s.WorkingDirectory = '${dest}'
$s.IconLocation = '${exe},0'
$s.Description = 'Claude tabs per project'
$s.Save()`).join('\n');
execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], { stdio: 'inherit' });
console.log(`Installed ${exe}\nShortcuts: ${path.join(desktop, 'Deck.lnk')}, ${path.join(startMenu, 'Deck.lnk')}`);
