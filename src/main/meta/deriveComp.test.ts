import { describe, it, expect } from 'vitest'
import { deriveCompFromRepos, type CompClientLike } from './deriveComp'

const mkReport = (profs: string[]) => ({
  stats: {
    squadClassData: profs.map((p) => ({ name: p, value: 1 })),
    roleClassifications: profs.map((p) => ({ profession: p, role: p === 'Reaper' ? 'damage' : 'support' })),
    squadCompByFight: [{ parties: [{ players: profs.map((p) => ({ profession: p })) }] }]
  }
})

const client: CompClientLike = {
  async fetchIndex(repo) {
    return [
      { id: 'recent', dateStart: '2026-06-10T00:00:00.000Z' },
      { id: 'old', dateStart: '2026-01-01T00:00:00.000Z' }
    ] as never
  },
  async fetchReport(_repo, id) {
    return id === 'recent' ? mkReport(['Firebrand', 'Reaper']) : mkReport(['Guardian'])
  }
}

describe('deriveCompFromRepos', () => {
  it('aggregates only reports inside the window and skips old ones', async () => {
    const d = await deriveCompFromRepos(client, [{ owner: 'a', repo: 'b' }], { now: Date.parse('2026-06-15'), days: 30 })
    expect(d).not.toBeNull()
    expect(d!.sampleSize).toBe(1) // only "recent"
    expect(d!.sourceRepos).toEqual(['a/b'])
    expect(d!.professions.map((p) => p.name)).toEqual(expect.arrayContaining(['Firebrand', 'Reaper']))
  })

  it('returns null when no reports fall in the window', async () => {
    const d = await deriveCompFromRepos(client, [{ owner: 'a', repo: 'b' }], { now: Date.parse('2020-01-01'), days: 30 })
    expect(d).toBeNull()
  })

  it('isolates a failing report (aggregates the rest)', async () => {
    const c: CompClientLike = {
      fetchIndex: async () => [
        { id: 'good', dateStart: '2026-06-10T00:00:00.000Z' },
        { id: 'bad', dateStart: '2026-06-11T00:00:00.000Z' }
      ],
      fetchReport: async (_repo, id) => {
        if (id === 'bad') throw new Error('boom')
        return { stats: { squadClassData: [{ name: 'Reaper', value: 1 }], roleClassifications: [{ profession: 'Reaper', role: 'damage' }], squadCompByFight: [] } }
      }
    }
    const d = await deriveCompFromRepos(c, [{ owner: 'a', repo: 'b' }], { now: Date.parse('2026-06-15'), days: 30 })
    expect(d).not.toBeNull()
    expect(d!.sampleSize).toBe(1)
    expect(d!.sourceRepos).toEqual(['a/b'])
  })

  it('isolates a failing repo (continues with the rest)', async () => {
    const flaky: CompClientLike = {
      fetchIndex: async (repo) => {
        if (repo.repo === 'bad') throw new Error('boom')
        return client.fetchIndex(repo)
      },
      fetchReport: client.fetchReport
    }
    const d = await deriveCompFromRepos(flaky, [{ owner: 'a', repo: 'bad' }, { owner: 'a', repo: 'b' }], { now: Date.parse('2026-06-15'), days: 30 })
    expect(d!.sampleSize).toBe(1)
  })
})
