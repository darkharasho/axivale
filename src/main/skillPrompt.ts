// src/main/skillPrompt.ts
//
// Assembles the per-turn system prompt: base constant + a lightweight registry
// of available skills (name + when-to-use only, so matching is cheap), plus the
// full recipe when a skill is explicitly forced for this turn. The full recipe
// of an auto-matched skill is fetched by the agent via the load_skill tool, not
// injected here.

import type { Skill } from './skillStore'

export function buildTurnSystemPrompt(
  base: string,
  skills: Skill[],
  forced?: Skill | null
): string {
  let out = base

  const enabled = skills.filter((s) => s.enabled)
  if (enabled.length > 0) {
    const lines = enabled.map((s) => `- ${s.name}: ${s.whenToUse}`).join('\n')
    out +=
      `\n\n# Available skills\n` +
      `The user has defined the skills below. If the request clearly matches a ` +
      `skill's "when to use", call the load_skill tool with its exact name and ` +
      `follow the returned instructions for this reply. Use at most one skill ` +
      `per reply; if none clearly fits, answer normally.\n` +
      lines
  }

  if (forced) {
    out +=
      `\n\n# Active skill: ${forced.name}\n` +
      `The user explicitly invoked this skill. Follow these instructions for ` +
      `this reply:\n${forced.instructions}`
  }

  return out
}
