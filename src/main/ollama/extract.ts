import { spawn } from 'child_process'
import type { ArchiveType } from './assets'

export function tarArgs(archive: ArchiveType, src: string, destDir: string): string[] {
  // zstd needs an explicit decompression filter; gzip (-z) is auto via -xzf;
  // zip is read directly by libarchive/bsdtar with -xf.
  if (archive === 'zst') return ['--zstd', '-xf', src, '-C', destDir]
  const flag = archive === 'tgz' ? '-xzf' : '-xf'
  return [flag, src, '-C', destDir]
}

export function extractArchive(archive: ArchiveType, src: string, destDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('tar', tarArgs(archive, src, destDir), { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    proc.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString()
    })
    proc.on('error', reject)
    proc.on('close', (code: number) => {
      if (code === 0) resolve()
      else reject(new Error(`tar exited with code ${code}: ${stderr.trim()}`))
    })
  })
}
