import type { SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk'
import type { AgentEvent, DisplayPayload } from './types'

/* eslint-disable @typescript-eslint/no-explicit-any */
type Tools = Array<SdkMcpToolDefinition<any>>

/**
 * Side-channel for display payloads on the Claude path.
 *
 * Claude tools run in-process (createSdkMcpServer), but their results are
 * serialized to the claude subprocess and come back as plain tool_result
 * text — any extra keys on the handler's ToolResult are lost. So we wrap
 * each handler to capture `display` into a FIFO queue per tool name, track
 * tool-start id→name, and re-attach the payload to the matching translated
 * tool-result event. FIFO is safe because a tool's handler always completes
 * before the SDK emits its tool_result message.
 *
 * One instance per turn — do not reuse across turns.
 */
export class DisplayCorrelator {
  private pending = new Map<string, DisplayPayload[]>()
  private idToName = new Map<string, string>()

  wrapTools(tools: Tools): Tools {
    return tools.map((t) => ({
      ...t,
      handler: async (args: Record<string, unknown>, extra: unknown) => {
        const result = await t.handler(args, extra)
        const display = (result as { display?: DisplayPayload }).display
        if (display && result.isError !== true) {
          const queue = this.pending.get(t.name) ?? []
          queue.push(display)
          this.pending.set(t.name, queue)
        }
        return result
      }
    }))
  }

  /** Pass every translated event through; tool-results gain their display. */
  observe(event: AgentEvent): AgentEvent {
    if (event.kind === 'tool-start') {
      this.idToName.set(event.id, event.name)
      return event
    }
    if (event.kind !== 'tool-result' || event.isError) return event
    const name = this.idToName.get(event.id)
    if (!name) return event
    const queue = this.pending.get(name)
    const display = queue?.shift()
    return display ? { ...event, display } : event
  }
}
