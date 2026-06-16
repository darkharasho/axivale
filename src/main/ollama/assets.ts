export interface OllamaAsset {
  url: string
  archive: 'tgz' | 'zip'
  /** Path of the ollama executable relative to the extraction root. */
  binRelPath: string
}

const BASE = 'https://ollama.com/download'

function linuxArch(arch: string): string {
  if (arch === 'arm64') return 'arm64'
  return 'amd64' // x64
}

export function resolveAsset(platform: string, arch: string): OllamaAsset {
  switch (platform) {
    case 'linux':
      return {
        url: `${BASE}/ollama-linux-${linuxArch(arch)}.tgz`,
        archive: 'tgz',
        binRelPath: 'bin/ollama'
      }
    case 'win32':
      return {
        url: `${BASE}/ollama-windows-amd64.zip`,
        archive: 'zip',
        binRelPath: 'ollama.exe'
      }
    case 'darwin':
      return {
        url: `${BASE}/Ollama-darwin.zip`,
        archive: 'zip',
        // The app zip contains Ollama.app; the CLI server binary lives inside it.
        binRelPath: 'Ollama.app/Contents/Resources/ollama'
      }
    default:
      throw new Error(`Unsupported platform for Ollama install: ${platform}`)
  }
}
