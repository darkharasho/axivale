import { MCP_PREFIX } from './types'
import { DESTRUCTIVE_TOOLS, ACTION_GATED_TOOLS } from '../tools'

/** The result type returned by canUseTool callbacks. */
export type PermissionResult =
  | { behavior: 'allow'; updatedInput?: Record<string, unknown> }
  | { behavior: 'deny'; message: string }

/**
 * Pure function that decides whether a tool call is allowed.
 * Extracted so it can be unit-tested without running a full agent turn.
 *
 * Built-in SDK tools (e.g. Bash) are not in allowedTools and would otherwise
 * fall through to allow — the non-officer prefix check blocks them explicitly.
 */
export async function evaluateToolPermission(
  toolName: string,
  input: Record<string, unknown>,
  deps: { confirm: (toolName: string, input: Record<string, unknown>) => Promise<boolean> }
): Promise<PermissionResult> {
  // Only officer MCP tools are permitted in this app.
  if (!toolName.startsWith(MCP_PREFIX)) {
    return { behavior: 'deny', message: 'Only officer tools are available in this app.' }
  }

  const bare = toolName.slice(MCP_PREFIX.length)
  // Action-gated tools' risk depends on the verb, not the tool name.
  const gatedVerbs = ACTION_GATED_TOOLS[bare]
  const destructive = gatedVerbs
    ? gatedVerbs.includes(String(input.action ?? ''))
    : DESTRUCTIVE_TOOLS.includes(bare)
  if (destructive) {
    const allowed = await deps.confirm(bare, input)
    if (!allowed) {
      return { behavior: 'deny', message: 'The user declined this action.' }
    }
  }

  return { behavior: 'allow', updatedInput: input }
}
