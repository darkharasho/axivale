export interface ServerEntry {
  label: string
  name: string | null
  guildId: string | null
}

const norm = (s: string): string => s.trim().toLowerCase()

/** Pick the server entry matching `server` (by label or cached name), or throw a
 *  message the agent can act on (ask the user / fix the name). With no `server`:
 *  exactly one configured ⇒ that one; otherwise throw. */
export function resolveServerEntry(servers: ServerEntry[], server?: string): ServerEntry {
  const labels = servers.map((s) => s.label).join(', ')
  if (server && server.trim()) {
    const want = norm(server)
    const matches = servers.filter(
      (s) => norm(s.label) === want || (s.name != null && norm(s.name) === want)
    )
    if (matches.length === 1) return matches[0]
    if (matches.length === 0) {
      if (!servers.length) throw new Error('No Discord server is configured — add an AxiVale key in Settings (03).')
      throw new Error(`Unknown Discord server "${server}". Connected servers: ${labels}.`)
    }
    throw new Error(`"${server}" matches multiple servers: ${matches.map((s) => s.label).join(', ')}.`)
  }
  if (servers.length === 1) return servers[0]
  if (servers.length === 0) throw new Error('No Discord server is configured — add an AxiVale key in Settings (03).')
  throw new Error(`Multiple Discord servers connected (${labels}). Pass the \`server\` argument to choose one.`)
}
