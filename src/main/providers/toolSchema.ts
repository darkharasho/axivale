import { z } from 'zod'
import type { SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk'
import { MCP_PREFIX } from './types'
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
    const parameters = z.toJSONSchema(zodObjectOf(t), { io: 'input' }) as Record<string, unknown>
    delete parameters.$schema
    return { name: t.name, description: t.description ?? '', parameters }
  })
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
  const parsed = zodObjectOf(t).safeParse(input)
  if (!parsed.success) {
    return { text: `Invalid arguments for ${name}: ${parsed.error.message}`, isError: true }
  }
  // Handlers are wrapped in tools.ts safe(): they never throw, errors come back as isError results.
  const result = await t.handler(parsed.data, {})
  const text = (result.content ?? [])
    .map((part: { type: string; text?: string }) => (part.type === 'text' ? (part.text ?? '') : ''))
    .join('')
  return { text, isError: result.isError === true }
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
