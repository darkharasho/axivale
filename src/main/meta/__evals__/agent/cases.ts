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
  },
  {
    name: 'applied-cc-leaders',
    prompt: 'Who landed the most crowd control on the enemy last run?',
    mustCall: [{ name: 'axibridge_section', args: { section: 'crowd_control_out' } }],
    rubric:
      'PASS only if the answer names specific accounts with their APPLIED CC numbers (disable count / duration / interrupts) from the tool result — outgoing CC, not CC received. FAIL if it uses the received crowd_control section, infers from class/role, or invents numbers.'
  },
  {
    name: 'cc-types-not-split',
    prompt: 'How many stuns vs dazes did each player apply last run?',
    rubric:
      'PASS only if the answer makes clear that individual disable types (stun vs daze vs knockback) are NOT broken out in the AxiBridge report — only an aggregate applied-CC count is available. Reaching that via axibridge_find or the aggregate crowd_control_out section both count. FAIL if it fabricates a per-type stun/daze split.'
  },
  {
    name: 'downed-healing-leaders',
    prompt: 'Who did the most healing on downed allies last run?',
    mustCall: [{ name: 'axibridge_section', args: { section: 'healing' } }],
    rubric:
      'PASS only if the answer names specific accounts with their downed-healing numbers (downedHealing / squad downed healing) from the tool result, not total healing. FAIL if it reports overall healing instead, infers from role, or invents numbers.'
  },
  {
    name: 'individual-condition-poison',
    prompt: 'Who applied the most Poison last run?',
    mustCall: [{ name: 'axibridge_section', args: { section: 'conditions_out' } }],
    rubric:
      'PASS only if the answer focuses on Poison specifically (using the conditions_out condition filter) and names accounts with their Poison applications/damage from the tool result. FAIL if it reports all-condition totals as if they were Poison, or invents numbers.'
  },
  {
    name: 'raw-log-routing-and-honesty',
    prompt: 'How did that last fight go?',
    mustCall: [{ name: 'axilog_logs_list' }],
    rubric:
      'This eval runs with the axilog parse service unavailable (service: null) — every axilog_fight_overview ' +
      'or axilog_section call will error. PASS only if the answer honestly reports that the raw-log parser is ' +
      'unavailable / the fight could not be analyzed, WITHOUT inventing any fight numbers, names, or outcome. ' +
      'If the agent calls axilog_fight_overview or axilog_section at all, it must call axilog_fight_overview ' +
      'before any axilog_section call (check the order of toolCalls) — FAIL if a section call precedes the ' +
      'overview call. A reasonable fallback to axibridge_* tools (e.g. axibridge_runs_list) to try to still ' +
      'answer is acceptable and should not be penalized — grade routing via the axilog_logs_list mustCall ' +
      'above, not by penalizing a defensible axibridge fallback here. FAIL if the answer presents fabricated ' +
      'damage/boon/kill numbers as if they came from a real fight.'
  },
  {
    name: 'night-level-question-does-not-route-to-axilog',
    prompt: 'How did we do last night overall — across all our fights?',
    mustNotCall: [
      { name: 'axilog_logs_list' },
      { name: 'axilog_fight_overview' },
      { name: 'axilog_section' }
    ],
    rubric:
      'This is a night-level, multi-fight question — the kind the AxiBridge tools own, per the raw-log ' +
      'prompt block\'s own SCOPE guidance ("one .zevtc is ONE FIGHT, not a night"). PASS if the agent routes ' +
      'to axibridge_* tools (e.g. axibridge_runs_list / axibridge_run_summary) rather than any axilog_* tool ' +
      '— a single raw log cannot answer a whole-night question. FAIL if the agent calls any axilog_* tool for ' +
      'this prompt, or if it answers as though a single fight represented the whole night.'
  }
]
