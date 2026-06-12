import { describe, it, expect, vi } from 'vitest'
import { z } from 'zod'
import { tool } from '@anthropic-ai/claude-agent-sdk'
import { toToolSpecs, executeTool, gateAndRunTool } from './toolSchema'
import { buildOfficerTools } from '../tools'

const echo = tool(
  'echo_tool',
  'Echoes its input.',
  { message: z.string().describe('What to echo'), times: z.number().optional() },
  async (args: { message: string }) => ({
    content: [{ type: 'text' as const, text: args.message }]
  })
)

describe('toToolSpecs', () => {
  it('produces a JSON schema with required/optional fields and no $schema key', () => {
    const [spec] = toToolSpecs([echo])
    expect(spec.name).toBe('echo_tool')
    expect(spec.description).toBe('Echoes its input.')
    expect(spec.parameters).toMatchObject({
      type: 'object',
      properties: {
        message: expect.objectContaining({ type: 'string', description: 'What to echo' }),
        times: expect.objectContaining({ type: 'number' })
      },
      required: ['message']
    })
    expect(spec.parameters).not.toHaveProperty('$schema')
  })

  it('translates every officer tool without throwing', () => {
    const tools = buildOfficerTools({
      axitools: {} as never,
      gw2: {} as never,
      discordGuildId: () => '1',
      gw2GuildId: () => 'g1'
    })
    const specs = toToolSpecs(tools)
    expect(specs.length).toBe(tools.length)
    for (const spec of specs) {
      expect(spec.name).toBeTruthy()
      expect((spec.parameters as { type: string }).type).toBe('object')
    }
  })
})

describe('executeTool', () => {
  it('runs the handler and returns its text', async () => {
    const outcome = await executeTool([echo], 'echo_tool', { message: 'hi' })
    expect(outcome).toEqual({ text: 'hi', isError: false })
  })

  it('rejects invalid arguments with a corrective error, not a crash', async () => {
    const outcome = await executeTool([echo], 'echo_tool', { message: 42 })
    expect(outcome.isError).toBe(true)
    expect(outcome.text).toContain('Invalid arguments')
  })

  it('reports unknown tools as errors', async () => {
    const outcome = await executeTool([echo], 'nope', {})
    expect(outcome).toEqual({ text: 'Unknown tool: nope', isError: true })
  })
})

describe('gateAndRunTool', () => {
  it('runs safe tools without confirmation', async () => {
    const confirm = vi.fn()
    const outcome = await gateAndRunTool([echo], 'echo_tool', { message: 'ok' }, confirm)
    expect(outcome.text).toBe('ok')
    expect(confirm).not.toHaveBeenCalled()
  })

  it('returns a deny message when the user declines a destructive tool', async () => {
    const del = tool('axitools_builds_delete', 'Deletes.', { build_id: z.string() }, async () => ({
      content: [{ type: 'text' as const, text: 'deleted' }]
    }))
    const confirm = vi.fn().mockResolvedValue(false)
    const outcome = await gateAndRunTool([del], 'axitools_builds_delete', { build_id: 'b1' }, confirm)
    expect(outcome).toEqual({ text: 'The user declined this action.', isError: true })
    expect(confirm).toHaveBeenCalledWith('axitools_builds_delete', { build_id: 'b1' })
  })
})
