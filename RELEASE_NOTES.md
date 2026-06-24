# Release Notes

## Version v1.3.2 — June 23, 2026

### Just start typing
You no longer have to click the message box first. Start typing anywhere in the AxiVale window and your keystrokes land in the composer automatically — the first character isn't lost. Plain printable keys pull focus in; keyboard shortcuts and typing inside another field are left untouched.

## Version v1.3.1 — June 21, 2026

### New app icon
AxiVale's mark is now a duotone **quill**, refreshed alongside the rest of the Axi suite. New icon across the installer, app window, and share-viewer favicons. No functional changes in this release.

## Version v1.3.0 — June 21, 2026

### Condition stats actually work now
Asking about condition damage used to come back empty — every player showed zero outgoing conditions, which quietly understated your condi specs (Scourge, Reaper, and friends) in every analysis. The numbers were in your reports the whole time; AxiVale was reading the wrong field. Now "who's putting out the most condi pressure?" returns real per-player applications and condition damage, and you can drill into a single condition: "who applied the most Poison last run?" or "Torment by player." Both outgoing and incoming conditions are covered.

### See who's actually landing the crowd control
Crowd control had only ever shown CC *received*. There's now a separate view for CC *applied* — disables landed on the enemy, total disable duration, interrupts, and the down-contribution from your CC. Ask "who's doing the most CC?" and you get the players setting up your bombs, not the ones eating them. (One honest limit: AxiBridge reports a single aggregate disable count, so stuns vs dazes vs knockbacks can't be split apart — AxiVale will tell you that instead of inventing a breakdown.)

### Healing on downed allies
Healers who specialize in picking people up off the floor were invisible in the healing numbers. Downed-ally healing is now surfaced alongside total / squad / group / self healing, plus resurrect contribution — so "who kept us off the floor last fight?" is answerable, separate from raw healing throughput.

### AxiVale speaks GW2 shorthand
You can talk to AxiVale the way you talk in squad chat. It now understands the common abbreviations — condi, HFB, QB, alac, stab, boon strip, vuln, the profession and elite-spec short names, WvW/EBG/BL, and the rest — and expands them in context (it knows "BS" means boon strip in one breath and Spellbreaker in another). For the long tail of community slang it can look the rest up on the wiki.

## Version v1.2.0 — June 21, 2026

### Boon, mitigation & sustain analysis — straight from your reports
AxiVale now reads *every* section AxiBridge publishes — boon generation and uptime (split self / group / squad), damage mitigation (blocks, evades, dodges, invulns, interrupts), damage taken, cleanses, boon strips, healing, barrier, crowd control, outgoing conditions, and the per-metric leaderboards. Ask things like "who wasted the most Protection?" or "was our boon coverage good last fight?" and it pulls the real per-player numbers instead of inferring from each player's role. Under the hood: a quick search to find the right section, then a pull for the exact figures — so boon and sustain questions are grounded in data, not assumptions. This fixes boon analysis that previously read as guesswork.

### Save a build guide onto the build itself
You can now write a build guide and save it straight onto the build's notes in AxiForge — and a fresh chat reads and *edits* the existing guide instead of starting over. Reference skills, traits, runes and relics by name (`[[skill:Shelter]]`) and AxiVale resolves each to the real game entity so it renders as a proper skill chip in AxiForge. Say "write a short guide for my Reaper and save it," tweak later with "update the rotation section," and the finished guide lives on the build — not buried in a chat transcript.

### Under the hood
A new live-turn eval harness lets us catch agent regressions automatically: it runs real questions against real data and grades the answers with a second model, so behavior changes like the boon fix above are verified before they ship.

## Version v1.1.2 — June 20, 2026

### Right-click clipboard fixes
Paste from the right-click menu now works — it was silently doing nothing because of a clipboard permission quirk, and clipboard actions now run through a path that behaves the same on Windows, Mac, and Linux. You can also right-click your own messages to copy them, not just AxiVale's replies.

## Version v1.1.1 — June 20, 2026

### ChatGPT tools now work in the Windows app
On Windows, the packaged build couldn't start the ChatGPT (Codex) provider's officer tools — so player reviews and other tool-backed answers came back empty, even with AxiBridge reports loaded. The bundled tool proxy now launches correctly inside the installed app, and AxiVale writes `officer-bridge.log` / `officer-proxy.log` so any future spawn issue is obvious at a glance. Claude and Gemini were unaffected.

## Version v1.1.0 — June 20, 2026

### Positioning — see *where* a WvW fight was won or lost
AxiVale now reads your AxiBridge replay data and analyzes fights by position: squad cohesion (how tight the ball stayed), overextension and out-of-position deaths, where on the map people fell, and the commander's pathing. Ask for a review and — when your reports carry replay data — it weaves this into the verdict with an inline map of the death/down hotspots, the commander's route, and a squad-spread-over-time strip. Shows up automatically in the WvW night report and commander review, and you can ask directly ("did we overextend?", "where did we die?"). Degrades gracefully when a report has only partial positional data.

### Fairer commander reviews
A commander's personal damage/cleave/strips are *expected* to run below the squad average — they tag, position, and call rather than pad personal numbers. Reviews no longer read that as underperformance; leadership is judged on squad outcomes and positioning instead.

## Version v1.0.3 — June 19, 2026

### ChatGPT tool access on Windows
Chasing a Windows-only issue where the ChatGPT provider couldn't reach AxiVale's
tools — player reviews and other tool-backed answers came back empty ("0 actions
taken"). This build hardens how those tools are launched on Windows and writes a
diagnostic log to `logs/codex.log` so any remaining cases can be pinned down
exactly. Claude and Gemini are unaffected.

## Version v1.0.2 — June 19, 2026

### ChatGPT now uses your analytics tools instead of refusing
On the ChatGPT provider, AxiVale could wrongly claim its AxiBridge/identity tools
were "not available" and ask you to paste data — because the model didn't match
the tool names. It now finds and uses them, so player reviews and WvW analytics
work on ChatGPT the same as on Claude and Gemini. (Start a new conversation to
pick up the fix.)

## Version v1.0.1 — June 19, 2026

### AxiBridge & AxiForge work on their own
Reviewing a player or working with builds no longer pushes you to connect the
AxiTools Discord bot. If you only use AxiBridge (WvW reports) or AxiForge
(builds & comps), AxiVale now handles those fully on their own — it resolves
players straight from your combat logs instead of asking you to hook up Discord.

### A picture of where the meta comes from
The **Sources** page now opens with a diagram showing how AxiVale's GW2 knowledge
flows — community sources (Snowcrows, MetaBattle, Discretize, and friends) crawled,
dated, indexed, and cited back to you when you ask.

### Fixes
- The "What's New" notice now closes properly — the ✕ sits where it should and
  clicks cleanly.

## Version v1.0.0 — June 19, 2026

**AxiVale is generally available.** A virtual officer for your Guild Wars 2 guild
and Discord — you file orders in plain English and a Claude agent with real tools
does the work, all styled as a dark-newsprint broadsheet.

### A virtual officer that actually runs the guild
File orders the way you'd talk to a person — *"who joined this week?"*, *"add the
MetaBattle feed to #news"*, *"DM everyone without an API key and remind them to
link one"* — and AxiVale carries them out. Replies come back as filed articles
with full markdown, and every tool call leaves a receipt in the Notices rail so
you can see exactly what was done.

### Guild intelligence
Roster, join history, and activity straight from the official GW2 API — plus any
`/v2` endpoint on demand (items, prices, WvW matches). The Roster desk is
searchable when you'd rather click than ask.

### Builds & compositions
Full CRUD on your [AxiTools](https://github.com/darkharasho/axitools) bot's
builds and squad-comp presets and schedules — the app and the bot's Discord slash
commands share one source of truth. Class icons, profession grouping, and
clip-to-clipboard chat codes throughout. Share a comp or build straight to Discord
through AxiForge's webhook.

### Discord management, with a brake pedal
Channels, roles, members, messages, threads, events, and DMs through a
guild-scoped action registry. Anything destructive — deletes, kicks, bans, mass
DMs — stops at a **Notice of Destruction** you approve before it runs. Manage
several servers from one app: pick the active server from the masthead and the
agent routes actions and webhook shares to the right place.

### The Bureau
Audit-log queries, RSS feeds, Twitch/YouTube stream announcements, WvW alliance
settings, and GW2-guild→role mappings — the back-office desks, on call.

### Built to stay out of your way
Three credentials, all stored encrypted in the OS keychain. Signed and notarized
builds for Linux, Windows, and macOS, and the app updates itself from the release
feed — a "Late Edition" banner appears when a new edition is ready to install.
