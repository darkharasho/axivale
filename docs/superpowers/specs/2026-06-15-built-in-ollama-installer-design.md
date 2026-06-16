# Built-in Ollama Installer — Design

**Date:** 2026-06-15
**Status:** Design approved, pending spec review

## Problem

The free/local tier runs against Ollama at `localhost:11434`, but today setup is a wall of
manual instructions ("Install Ollama from ollama.com, then run `ollama pull qwen3:8b`" —
see `src/main/index.ts:636`, `src/renderer/src/components/Settings.tsx:422,679`). Non-technical
guild members can't get past it. We want a one-click, in-app flow that installs Ollama, picks a
model that fits the machine, downloads it with visible progress, and switches the app to the
local provider — on Windows, macOS, and Linux.

## Key decision: manage a standalone binary in `userData` (no system install)

We do **not** run the official OS installers (`OllamaSetup.exe`, the `.dmg`, or `curl | sh`).
Those drag in UAC / Gatekeeper / `sudo` and a systemd service. Instead we mirror the proven
pattern already shipped on `axibridge` `feature/local-ei-integration` (`EiManager` in
`src/main/eiParser.ts`), which installs Elite Insights **and** the .NET runtime entirely inside
`userData` with **no sudo** by downloading standalone assets and pointing the install dir at a
user directory.

Ollama, like .NET, publishes standalone builds (`ollama-linux-amd64.tgz`,
`ollama-windows-amd64.zip`, and the macOS app zip). So the same move works: download the
standalone build into `userData/ollama/`, extract it, mark it executable, and spawn
`ollama serve` ourselves on a port we own. This is true one-click on all three platforms and
touches nothing else on the system.

## Architecture

Only the **install/extract** step is OS-specific. Everything after the server is up is identical
across platforms because it all goes through HTTP at the local endpoint.

```
detect hardware → check existing install → install Ollama (per-OS asset) →
ensure server running → recommend + pull model (progress) → verify → switch provider → done
```

### Components

1. **`OllamaManager`** (`src/main/ollama/ollamaManager.ts`) — modeled directly on `EiManager`.
   - Base dir: `path.join(app.getPath('userData'), 'ollama')`.
   - `getStatus()` → `{ installed, serverRunning, version, model | null }`.
   - `install(onProgress)` → download per-OS standalone asset, extract into base dir,
     `chmod +x` the binary (non-Windows). Reuses an `EiManager`-style `downloadFile` with
     redirect handling + percent progress.
   - `ensureServerRunning()` → if our managed `ollama serve` is not responding, spawn it as a
     child process bound to the managed endpoint; health-check `GET /api/tags` with a timeout.
   - `pullModel(name, onProgress)` → stream `POST /api/pull`, parse NDJSON progress
     (`completed`/`total` bytes) into percent.
   - `listModels()` → `GET /api/tags`.
   - `uninstall()` → stop server child, `fs.rm` the base dir.
   - Holds the `ChildProcess` for the spawned server; stops it on app quit.

2. **`ollamaHandlers`** (`src/main/handlers/ollamaHandlers.ts`) — IPC surface mirroring
   `eiHandlers` and the existing `ipcMain.handle` pattern in `src/main/index.ts`:
   `ollama:get-status`, `ollama:install`, `ollama:pull-model`, `ollama:list-models`,
   `ollama:uninstall`, `ollama:detect-hardware`. Progress is pushed via
   `win.webContents.send('ollama:progress', …)`.

3. **Hardware detection** (`src/main/ollama/hardware.ts`)
   - Primary signal: `os.totalmem()` (cross-platform, no native deps).
   - A detected discrete GPU is a *bonus hint only*, never a requirement (GPU probing is
     unreliable across 3 OSes).
   - Recommendation tiers (override always allowed):
     - **< 8 GB** → `llama3.2:3b` (~2 GB)
     - **8–16 GB** → `qwen3:8b` (~5 GB, current default)
     - **16 GB+** → `qwen3:8b` default, `qwen3:14b` offered as an option

4. **Setup wizard UI** (`src/renderer/src/components/` — replaces the static nudge near
   `Settings.tsx:679`). State machine: `detect → check → install → start-server → recommend →
   pull → verify → done`, each stage with explicit error + **retry** and an
   "I'll do it manually" escape hatch that shows the old instructions.

### Asset resolution (per-OS)

`install()` picks the asset by `process.platform` + `process.arch`:

| Platform | Asset (standalone) | Run command |
|----------|--------------------|-------------|
| Linux    | `ollama-linux-<arch>.tgz` | `<base>/bin/ollama serve` |
| Windows  | `ollama-windows-<arch>.zip` | `<base>\ollama.exe serve` |
| macOS    | macOS app zip | embedded `ollama` binary `serve` |

Exact current asset URLs/filenames are **verified during implementation** against Ollama's
releases, not hardcoded from memory.

## Data flow

1. Wizard calls `ollama:detect-hardware` → shows "Detected N GB RAM → recommended `<model>`"
   with a dropdown override.
2. On confirm: `ollama:install` (skipped if `getStatus().installed`) → `ensureServerRunning` →
   `ollama:pull-model` streaming progress to the bar.
3. On success: set provider settings via the existing store —
   `provider='local'`, `localModel=<pulled>`, `localEndpoint=<managed endpoint>` — so the
   existing `openaiCompat` adapter (`src/main/providers/openaiCompat.ts`) works unchanged.

## Error handling

- Every wizard stage surfaces a specific error and a retry action.
- Download/extract failures clean up partial files before retry.
- Server-start failure: show captured stderr, offer retry, and the manual fallback.
- Model pull is resumable (Ollama dedupes already-downloaded layers on re-pull).
- "I'll do it manually" at any stage falls back to the current instructions.

## Testing

- **`OllamaManager`** unit tests with `downloadFile`, `spawn`, and `fetch` mocked: asset
  selection per platform/arch, extract path, progress parsing for `/api/pull` NDJSON,
  `getStatus` permutations (not installed / installed-not-running / running). Follow the
  existing vitest setup; respect the repo/global `--maxWorkers=2` limit.
- **`hardware.ts`** unit tests: each RAM tier maps to the expected recommended model.
- **`ollamaHandlers`** tests: IPC handlers call the manager and forward progress events
  (mirroring how `eiHandlers` is structured).
- Real network download / cross-OS extract / Gatekeeper behavior are validated by manual
  smoke test per platform, not in CI.

## Open items to verify during implementation (not assumed)

1. Exact current standalone asset URLs/filenames per platform + arch from Ollama releases.
2. **macOS Gatekeeper quarantine** on a downloaded-and-extracted binary — may require clearing
   `com.apple.quarantine` via `xattr` or relying on the embedded signature. (Same class of
   issue `EiManager` dealt with.)
3. Whether to pin a known-good Ollama version or always fetch latest.

## Out of scope (YAGNI)

- Training/fine-tuning any model (explicitly rejected earlier — RAG already supplies GW2 facts
  and stays current across balance patches).
- Bundling the Ollama binary inside the app installer (we download on first setup instead, to
  keep the app bundle small).
- Managing multiple concurrent local models or a model-library browser — single recommended
  model with override is enough.
