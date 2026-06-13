import { describe, it, expect } from 'vitest'
import { parseRepoRef, listLinkedRepos, serializeLinkedRepos } from './axibridgeRepos'

describe('parseRepoRef', () => {
  it('parses owner/repo', () => {
    expect(parseRepoRef('darkharasho/eww-reports')).toEqual({ owner: 'darkharasho', repo: 'eww-reports' })
  })
  it('parses a GitHub Pages URL', () => {
    expect(parseRepoRef('https://darkharasho.github.io/eww-reports/?report=x')).toEqual({
      owner: 'darkharasho',
      repo: 'eww-reports'
    })
  })
  it('parses a github.com URL and strips .git', () => {
    expect(parseRepoRef('https://github.com/darkharasho/eww-reports.git')).toEqual({
      owner: 'darkharasho',
      repo: 'eww-reports'
    })
  })
  it('rejects garbage', () => {
    expect(parseRepoRef('not a repo')).toBeNull()
    expect(parseRepoRef('')).toBeNull()
    expect(parseRepoRef('a/b/c')).toBeNull()
  })
})

describe('linked repo list round-trip', () => {
  it('serializes and parses, dropping malformed entries', () => {
    const repos = [{ owner: 'darkharasho', repo: 'eww-reports' }]
    expect(listLinkedRepos(serializeLinkedRepos(repos))).toEqual(repos)
    expect(listLinkedRepos(null)).toEqual([])
    expect(listLinkedRepos('not json')).toEqual([])
    expect(listLinkedRepos('[{"owner":"x"}]')).toEqual([])
  })
})
