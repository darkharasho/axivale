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
    `FORMAT (axilog_query only): axilog_query filters over the raw document, which is NOT ` +
    `the AxiBridge shape and NOT what axilog_fight_overview/axilog_section return. Its ` +
    `roster is entities[] (roles: squad, friendly_player, enemy_player, npc) — there is no ` +
    `players[]. Per-entity statistics live at blocks.<name>.by_entity keyed by entities[].id ` +
    `AS STRINGS. Names for skills, buffs, and minions live in catalogs.<kind>[<id>].name; no ` +
    `block inlines a name.\n` +
    `COVERAGE IS AUTHORITATIVE: axilog_fight_overview returns a coverage map with four ` +
    `states — present, empty (computed, genuinely no data — reporting 0 here IS honest), ` +
    `not_computed, and unsupported. A block marked not_computed or unsupported means this ` +
    `log does not carry that data — say so plainly, and never infer a player's or enemy's ` +
    `build from it. Never present a not_computed/unsupported metric as zero.\n` +
    `Coverage is also the ONLY licence to say WHY something is missing. If coverage does ` +
    `not mark a block absent, never tell the user the log "did not record" or "did not ` +
    `capture" it — an empty, flat, or all-identical result is your own filter until ` +
    `coverage says otherwise. Re-read the tool's schema and query it another way instead.\n` +
    `SCOPE: one .zevtc is ONE FIGHT, not a night. Never generalize a single skirmish into ` +
    `a trend — night-level and multi-run questions belong to the axibridge_* tools.`
  )
}
