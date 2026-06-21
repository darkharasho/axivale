// src/main/glossaryPrompt.ts
//
// Builds the always-on "GW2 abbreviations" block appended to the system prompt.
// Players type abbreviations constantly ("condi on the scourges", "HFB stab
// uptime", "QB alac"), so the model must expand them while READING a message —
// RAG retrieval can't help there since nobody asks "what does condi mean". This
// is a curated, domain-relevant subset (this app is WvW squad analytics +
// builds); the full GW2-wiki abbreviation list is reachable on demand via
// gw2_wiki_search for the long tail (raid/fractal/open-world/event slang).
//
// Source: https://wiki.guildwars2.com/wiki/Abbreviations

const GLOSSARY = `# GW2 abbreviations
Expand these in-place when a user uses them; never ask what a common one means. An abbreviation can be context-dependent (e.g. "BS" = boon strip OR Spellbreaker OR Soulbeast) — disambiguate from context. For anything not listed, call gw2_wiki_search before guessing.

Game modes: WvW = World vs World; EBG/EB = Eternal Battlegrounds; BL = Borderlands; SM = Stonemist Castle; sPvP = structured PvP; PvE / PvP / PvX; OW = open world; EotM = Edge of the Mists; roam = small-scale WvW.

Roles / archetypes: condi = condition damage; power = direct/strike damage; hybrid = both; DPS = damage per second; PDPS/CDPS/BDPS/ADPS/QDPS = power/condition/boon/alacrity/quickness DPS; support; boon DPS; pug = pick-up group; comp = composition; squad; party/subgroup; zerg = large blob; GvG; tag/commander/pin = the commander; bomb = burst AoE; pull/CC; cleave.

Healer / boon-support shorthand: HB / healbrand = heal Firebrand; HFB = heal Firebrand; QB / quickbrand = quickness Firebrand; HS = heal Scourge; HAD/HAM/HAT = heal-alac Druid/Mechanist/Tempest; Bheal = boon healer; Qheal/Aheal = quickness/alacrity heal.

Boons: might, fury, quick(ness), alac(rity), prot(ection), regen, resist(ance), aegis, stab(ility), vigor, swift(ness), resolution.

Conditions: condi = condition; bleed(ing), burn(ing), torment, confusion, poison, vuln = vulnerability, chill(ed), cripple(d), immob = immobilize, weakness, blind(ed), fear, taunt, slow.

Combat / stats: AoE = area of effect; CC = crowd control; CD/ICD = cooldown / internal cooldown; LF = life force (necro); strip/rip = boon strip; cleanse = condition removal; stunbreak; defiance/break bar; KP = kill proof; rota = rotation; uptime; AR = agony resistance.

Professions: ele = Elementalist; war = Warrior; guard = Guardian; rev = Revenant; engi = Engineer; ranger; thief; mes/mesmer; necro = Necromancer.

Elite specs — Elementalist: Tempest, Weaver, Cata(lyst). Warrior: Berserker (zerk), Spellbreaker (SpB), Bladesworn (BsW). Guardian: Dragonhunter (DH), Firebrand (FB), Willbender (WB). Revenant: Herald, Renegade (Ren), Vindicator (Vindi). Engineer: Scrapper, Holo(smith), Mech(anist). Ranger: Druid (dudu), Soulbeast (SB), Untamed. Thief: Daredevil (DD), Deadeye (DE), Specter. Mesmer: Chrono(mancer), Mirage, Virtuoso (Virt). Necromancer: Reaper, Scourge, Harbinger. Note "zerk" = Berserker's gear stats too; disambiguate by context.`

/** The always-on GW2 abbreviation glossary. Static — no per-turn data. */
export function buildGlossaryReference(): string {
  return `\n\n${GLOSSARY}`
}
