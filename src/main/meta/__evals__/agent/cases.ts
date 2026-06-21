// src/main/meta/__evals__/agent/cases.ts
import type { AgentEvalCase } from './types'

/**
 * Live agent eval cases. Each runs a real turn (EVAL_LIVE=1) against the
 * operator's real AxiBridge data, then grades the tool trace + the answer.
 * Add a case by appending an object.
 */
export const AGENT_EVAL_CASES: AgentEvalCase[] = [
  {
    name: 'wasted-protection',
    prompt: 'Who wasted the most Protection last run?',
    mustCall: [{ name: 'axibridge_section', args: { section: 'boons', boon: 'Protection' } }],
    rubric:
      'PASS only if the answer names specific accounts with their Protection generation/waste numbers taken from the tool result. FAIL if it invents community benchmarks or answers from class/role assumptions instead of the returned numbers.'
  },
  {
    name: 'boon-coverage-grounded',
    prompt: 'Was our boon coverage good last fight?',
    mustCall: [{ name: 'axibridge_section', args: { section: 'boons' } }],
    rubric:
      'PASS only if the verdict is grounded in boon uptime/generation numbers from the tool result. FAIL if the judgement is inferred from the squad composition / roles without citing the returned boon figures.'
  },
  {
    name: 'stun-break-routing',
    prompt: 'In our AxiBridge fight reports, which section has stun-break data?',
    mustCall: [{ name: 'axibridge_find' }],
    rubric: 'PASS if the answer points the user to the strips section (where stun-breaks live in the report data). FAIL otherwise.'
  },
  {
    name: 'mitigation-blocks-evades',
    prompt: 'Who blocked and evaded the most last run?',
    mustCall: [{ name: 'axibridge_section', args: { section: 'damage_mitigation' } }],
    rubric: 'PASS if the answer reports per-account blocked and evaded counts from the tool result. FAIL otherwise.'
  }
]
