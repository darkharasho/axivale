import { describe, it, expect } from 'vitest'
import { distill } from './distill'
import { sourceCases } from './__evals__/source-labeling/cases'
import { fixtureModel, evalMode } from './__evals__/harness'
import { liveModel } from './__evals__/liveModel'
import { gradeSource } from './__evals__/grade'

describe('source-labeling eval', () => {
  // Only construct the live model outside replay (it reads app config / requires a token).
  const live = evalMode() === 'replay' ? undefined : liveModel()

  for (const c of sourceCases) {
    // Timeout, not the 5s default: replay is instant, but EVAL_LIVE=1 bypasses
    // the fixture and makes a real model call, which cannot finish in 5s. The
    // whole live suite failed here on a default-timeout timeout, not on grading.
    it(
      c.id,
      async () => {
        const model = fixtureModel('source-labeling', c.id, live)
        const out = await distill(c.mode, c.excerpts, model, c.specMap ?? {}, c.today ?? '')
        expect(out, 'distill returned null').toBeTruthy()
        gradeSource(out as string, c.expect)
      },
      120_000
    )
  }
})
