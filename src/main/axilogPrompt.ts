// src/main/axilogPrompt.ts
//
// The per-turn "raw combat log" block, appended to the system prompt the way
// buildMetaReference is. Returns '' when there is no log source — zero overhead
// on an install that never opens a .zevtc.

export function buildAxilogReference(available: boolean): string {
  if (!available) return ''
  return (
    `\n\n# Raw combat logs (AxiLog)\n` +
    `You can open a single raw arcdps log and analyze it. Workflow: axilog_logs_list ` +
    `to turn "last fight"/"tonight" into a logId, then axilog_fight_overview (always ` +
    `first for a log), then axilog_sections_list if you are unsure which section fits, ` +
    `then axilog_section. Use axilog_query (jq) only when no section covers the question.\n` +
    `FORMAT: this is NOT the AxiBridge shape. The roster is entities[] (roles: squad, ` +
    `friendly_player, enemy_player, npc) — there is no players[]. Per-entity statistics ` +
    `live at blocks.<name>.by_entity keyed by entities[].id AS STRINGS. Names for skills, ` +
    `buffs, and minions live in catalogs.<kind>[<id>].name; no block inlines a name.\n` +
    `COVERAGE IS AUTHORITATIVE: axilog_fight_overview returns a coverage map. A block ` +
    `marked not_computed or unsupported means this log does not carry that data — say so ` +
    `plainly. Never infer a player's or enemy's build from an absent block, and never ` +
    `present a missing metric as zero.\n` +
    `SCOPE: one .zevtc is ONE FIGHT, not a night. Never generalize a single skirmish into ` +
    `a trend — night-level and multi-run questions belong to the axibridge_* tools.`
  )
}
