# Release Notes

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
