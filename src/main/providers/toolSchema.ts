import { z } from 'zod'
import type { SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk'
import { MCP_PREFIX, type DisplayPayload } from './types'
import { evaluateToolPermission } from './permission'

/* eslint-disable @typescript-eslint/no-explicit-any */
type Tools = Array<SdkMcpToolDefinition<any>>

export interface ToolSpec {
  name: string
  description: string
  /** JSON Schema for the tool's parameters. */
  parameters: Record<string, unknown>
}

export interface ToolOutcome {
  text: string
  isError: boolean
  display?: DisplayPayload
}

/** The SDK's tool() stores the raw Zod shape it was given; normalize to a ZodObject. */
function zodObjectOf(t: SdkMcpToolDefinition<any>): z.ZodObject<z.ZodRawShape> {
  const schema = t.inputSchema
  if (schema instanceof z.ZodObject) return schema
  return z.object((schema ?? {}) as z.ZodRawShape)
}

/** Provider-neutral tool descriptions for OpenAI/Gemini function calling. */
export function toToolSpecs(tools: Tools): ToolSpec[] {
  return tools.map((t) => {
    const { $schema: _discard, ...parameters } = z.toJSONSchema(zodObjectOf(t), { io: 'input' }) as Record<string, unknown>
    return { name: t.name, description: t.description ?? '', parameters }
  })
}

/** Drop top-level keys whose value is null. Weak models emit `null` for
 *  optional params instead of omitting them, which Zod's `.optional()` (accepts
 *  undefined, not null) then rejects. Treating null as "not provided" lets the
 *  call validate. */
function dropNullArgs(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(input)) {
    if (v !== null) out[k] = v
  }
  return out
}

/**
 * Validates input against the tool's Zod schema and runs its handler.
 * The Claude SDK does this validation internally; non-Claude adapters call
 * handlers directly, so it must happen here — weak models send bad JSON.
 */
export async function executeTool(
  tools: Tools,
  name: string,
  input: Record<string, unknown>
): Promise<ToolOutcome> {
  const t = tools.find((candidate) => candidate.name === name)
  if (!t) return { text: `Unknown tool: ${name}`, isError: true }
  const parsed = zodObjectOf(t).safeParse(dropNullArgs(input))
  if (!parsed.success) {
    return { text: `Invalid arguments for ${name}: ${parsed.error.message}`, isError: true }
  }
  // Handlers are wrapped in tools.ts safe(): they never throw, errors come back as isError results.
  const result = await t.handler(parsed.data, {})
  // safe()-wrapped handlers always produce at least one text block; empty text means a genuinely empty result.
  const text = (result.content ?? [])
    .map((part: { type: string; text?: string }) => (part.type === 'text' ? (part.text ?? '') : ''))
    .join('')
  const display = (result as { display?: DisplayPayload }).display
  const isError = result.isError === true
  return isError || !display ? { text, isError } : { text, isError, display }
}

/** Permission gate (destructive-tool confirm) + execution, for non-Claude adapters. */
export async function gateAndRunTool(
  tools: Tools,
  name: string,
  input: Record<string, unknown>,
  confirm: (toolName: string, input: Record<string, unknown>) => Promise<boolean>
): Promise<ToolOutcome> {
  const permission = await evaluateToolPermission(`${MCP_PREFIX}${name}`, input, { confirm })
  if (permission.behavior === 'deny') return { text: permission.message, isError: true }
  return executeTool(tools, name, permission.updatedInput ?? input)
}
