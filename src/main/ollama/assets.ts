export type ArchiveType = 'tgz' | 'zip' | 'zst'

export interface OllamaAsset {
  url: string
  archive: ArchiveType
  /** Path of the ollama executable relative to the extraction root. */
  binRelPath: string
}

// Ollama's own ollama.com/download/*.tgz alias is stale for current releases
// (the .tgz assets no longer exist — Linux ships .tar.zst now). Use GitHub's
// version-agnostic "releases/latest/download" URLs, which resolve to the
// current release's assets without an API lookup.
const BASE = 'https://github.com/ollama/ollama/releases/latest/download'

function linuxArch(arch: string): string {
  if (arch === 'arm64') return 'arm64'
  return 'amd64' // x64
}

export function resolveAsset(platform: string, arch: string): OllamaAsset {
  switch (platform) {
    case 'linux':
      // zstd-compressed tarball; extracts to bin/ollama (+ lib/ollama/).
      return {
        url: `${BASE}/ollama-linux-${linuxArch(arch)}.tar.zst`,
        archive: 'zst',
        binRelPath: 'bin/ollama'
      }
    case 'win32':
      return {
        url: `${BASE}/ollama-windows-amd64.zip`,
        archive: 'zip',
        binRelPath: 'ollama.exe'
      }
    case 'darwin':
      // Standalone CLI tarball (gzip); the `ollama` binary sits at the root,
      // so no Gatekeeper-quarantined .app to unpack.
      return {
        url: `${BASE}/ollama-darwin.tgz`,
        archive: 'tgz',
        binRelPath: 'ollama'
      }
    default:
      throw new Error(`Unsupported platform for Ollama install: ${platform}`)
  }
}
