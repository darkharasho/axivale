# Custom Titlebar — Design

Date: 2026-06-11 · Status: approved (chat)

## Goal

Remove the OS window frame so the gazette masthead is the top of the window,
with the masthead itself acting as the titlebar: draggable, with themed
window controls.

## Design

- **Window**: `BrowserWindow({ frame: false, ... })` in `src/main/index.ts`.
  Frameless windows keep edge-resize behavior; no extra handling.
- **Drag region**: `.mtop` and `.mmain` get `-webkit-app-region: drag`
  (double-click-to-maximize comes with it). Interactive children (window
  controls, nav buttons) get `no-drag`. `.mnav` stays non-drag.
- **Window controls**: three text-glyph buttons (`—`, `□`, `✕`) at the right
  end of `.mtop`, after "Final Edition · Free to Members". IBM Plex Mono,
  faint color, hover brightens, close hover is accent red. Rendered by
  `Masthead.tsx`.
- **IPC**: one fire-and-forget channel `window:control` carrying
  `'minimize' | 'maximize-toggle' | 'close'`. Main resolves the window via
  `BrowserWindow.fromWebContents(event.sender)`. Preload exposes
  `window.officer.windowControl(action)`.

## Trade-offs

- On Linux, frameless windows lose the native window menu and, under some
  compositors, server-side shadows. Accepted for the immersive look.
- Main-process glue is untested (consistent with the rest of
  `src/main/index.ts`); verification is typecheck + vitest suite + a
  Playwright run that clicks the controls and checks window state.
