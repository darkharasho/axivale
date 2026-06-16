export interface PullProgress {
  status: string
  percent?: number
  error?: string
}

export function parsePullLine(line: string): PullProgress | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  let obj: { status?: string; completed?: number; total?: number; error?: string }
  try {
    obj = JSON.parse(trimmed)
  } catch {
    return null
  }
  const percent =
    typeof obj.completed === 'number' && typeof obj.total === 'number' && obj.total > 0
      ? Math.round((obj.completed / obj.total) * 100)
      : undefined
  return { status: obj.status ?? '', percent, error: obj.error }
}
