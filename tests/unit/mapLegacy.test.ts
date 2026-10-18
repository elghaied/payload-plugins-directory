import { describe, expect, it } from 'vitest'
import fixture from '../fixtures/legacy-plugins.json'
import { mapLegacy, repoFullNameFromUrl, type LegacyPluginsData } from '@/lib/seed/mapLegacy'

const data = fixture as LegacyPluginsData

describe('repoFullNameFromUrl', () => {
  it('handles plain repo URLs', () => {
    expect(repoFullNameFromUrl('https://github.com/ashbuilds/payload-ai')).toBe('ashbuilds/payload-ai')
  })
  it('strips /tree/... monorepo paths', () => {
    expect(repoFullNameFromUrl('https://github.com/r1tsuu/payload-enchants/tree/master/packages/translator')).toBe('r1tsuu/payload-enchants')
  })
})

describe('mapLegacy', () => {
  const out = mapLegacy(data, ['684372049-translator'])

  it('creates one repository per GitHub repo', () => {
    expect(out.repositories.map((r) => r.fullName).sort()).toEqual(['ashbuilds/payload-ai', 'payloadcms/payload', 'r1tsuu/payload-enchants'])
  })
  it('marks multi-plugin repos as monorepos', () => {
    expect(out.repositories.find((r) => r.fullName === 'r1tsuu/payload-enchants')?.isMonorepo).toBe(true)
    expect(out.repositories.find((r) => r.fullName === 'ashbuilds/payload-ai')?.isMonorepo).toBe(false)
  })
  it('takes githubId from the numeric slug prefix', () => {
    expect(out.repositories.find((r) => r.fullName === 'ashbuilds/payload-ai')?.githubId).toBe(829724738)
    expect(out.repositories.find((r) => r.fullName === 'payloadcms/payload')?.githubId).toBeUndefined()
  })
  it('keeps slugs identical to legacy ids', () => {
    expect(out.plugins.map((p) => p.slug).sort()).toEqual(
      ['684372049-better-localized-fields', '684372049-translator', '829724738-root', 'official-plugin-form-builder'],
    )
  })
  it('hides blocklisted plugins instead of dropping them', () => {
    expect(out.plugins.find((p) => p.slug === '684372049-translator')?.visibility).toBe('hidden')
    expect(out.plugins.find((p) => p.slug === '829724738-root')?.visibility).toBe('listed')
  })
  it('maps versions including workspace fallback and unknown', () => {
    const by = (s: string) => out.plugins.find((p) => p.slug === s)!
    expect(by('829724738-root').payloadMajors).toEqual(['3'])
    expect(by('684372049-better-localized-fields').payloadMajors).toEqual(['unknown'])
    expect(by('684372049-translator').payloadMajors).toEqual(['2', '3'])
    expect(by('official-plugin-form-builder').payloadMajors).toEqual(['3'])
  })
  it('sets source and monorepo path', () => {
    const official = out.plugins.find((p) => p.slug === 'official-plugin-form-builder')!
    expect(official.source).toBe('official')
    expect(official.path).toBe('packages/plugin-form-builder')
    expect(out.plugins.find((p) => p.slug === '829724738-root')!.path).toBeUndefined()
  })
})
