// Placeholder — replaced wholesale in Task 4, which implements the real section
// registry. It exists now only so the worker and service have the `SectionQuery`
// / `SectionResult` types to compile against and a `runSection` to call.

export interface SectionQuery {
  granularity?: string
  entity?: string
  role?: string
  subgroup?: number
  sort?: string
  limit?: number
}

export interface SectionResult {
  rows: Array<Record<string, string | number>>
  columns: Array<{ key: string; label: string }>
  note?: string
  warnings?: string[]
}

export function runSection(_report: unknown, section: string, _opts: SectionQuery): SectionResult {
  throw new Error(`Unknown section "${section}" — no sections registered yet`)
}
