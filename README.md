# Deck

A desktop app for running many Claude Code sessions at once. Your projects are listed on the left, and each project's terminal tabs run across the top, like an editor whose every tab is Claude.

- **Projects on the left**: every folder in `~/projects`, most recently used first. Type in the search box to filter, or type a new name and press Enter to create the folder (`git init` included). Folders opened from anywhere else with Open Folder stay on the list too.
- **Claude tabs on top**: clicking a project opens a tab running `claude --dangerously-skip-permissions` in that folder. Open as many as you want per project; the sidebar shows how many are open in each one.
- **PowerShell tabs** sit beside them, for when you want a shell in the same folder.
- Real terminals (xterm.js on node-pty), with truecolor, copy/paste, and adjustable font size.

## Shortcuts

| Keys | Action |
| --- | --- |
| Ctrl+Shift+T | New Claude tab in the same project |
| Ctrl+Shift+` | New PowerShell tab in the same project |
| Ctrl+Shift+W | Close tab |
| Ctrl+Tab / Ctrl+Shift+Tab | Next / previous tab |
| Ctrl+1…9 | Go to tab |
| Ctrl+Shift+O | Open Folder (Windows picker) |
| Ctrl+Shift+P | Search projects |
| Ctrl+Shift+B | Show/hide the project list |
| Ctrl+= / Ctrl+- / Ctrl+0 | Font size up / down / reset |

## Run it

Windows only for now. Needs Node and [Claude Code](https://docs.anthropic.com/en/docs/claude-code) (it looks for `~/.local/bin/claude.exe`, then `claude` on your PATH).

```bash
npm install
npm start
```

To install it as an app with Desktop and Start menu shortcuts:

```bash
npm run release   # packs dist/Deck-win32-x64, copies it to %LOCALAPPDATA%\Programs\Deck
```

> Every Claude tab starts with permission prompts skipped. Only open folders you trust.

## Stack

Electron, xterm.js, node-pty, plain HTML/CSS/JS (no framework, no bundler).
