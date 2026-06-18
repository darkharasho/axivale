// src/main/meta/__evals__/grade.ts
//
// Assertion-based grading helpers (no LLM judge). Imports vitest's expect so failures
// read as ordinary test failures with the offending output in the message.
import { expect } from 'vitest'

export function domainsIn(text: string): string[] {
  const re = /https?:\/\/([^/\s)]+)/gi
  const out: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) out.push(m[1].replace(/^www\./, ''))
  return out
}

export interface SourceExpect {
  include?: RegExp[]
  exclude?: RegExp[]
  domains?: string[]
}

export function gradeSource(output: string, exp: SourceExpect): void {
  for (const re of exp.include ?? []) expect(output, `expected to match ${re}`).toMatch(re)
  for (const re of exp.exclude ?? []) expect(output, `expected NOT to match ${re}`).not.toMatch(re)
  if (exp.domains) {
    const found = domainsIn(output)
    for (const want of exp.domains) expect(found, `expected domain ${want} in ${found.join(', ')}`).toContain(want)
  }
}
