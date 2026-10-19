import { describe, expect, it } from 'vitest'
import { githubFullNameFromRepositoryField } from '@/lib/npm/repository'

describe('githubFullNameFromRepositoryField', () => {
  it.each([
    ['git+https://github.com/Acme/Plugin.git', 'acme/plugin'],
    ['https://github.com/acme/plugin', 'acme/plugin'],
    ['git://github.com/acme/plugin.git', 'acme/plugin'],
    ['ssh://git@github.com/acme/plugin.git', 'acme/plugin'],
    ['git@github.com:acme/plugin.git', 'acme/plugin'],
    ['github:acme/plugin', 'acme/plugin'],
    ['acme/plugin', 'acme/plugin'],
    [{ type: 'git', url: 'git+https://github.com/acme/plugin.git', directory: 'packages/x' }, 'acme/plugin'],
    ['https://github.com/acme/plugin/tree/main#readme', 'acme/plugin'],
  ])('%j → %s', (field, expected) => {
    expect(githubFullNameFromRepositoryField(field)).toBe(expected)
  })
  it.each([undefined, null, 42, {}, { url: 7 }, 'gitlab:acme/plugin', 'https://gitlab.com/acme/plugin', 'https://github.com.evil.com/a/b', 'bitbucket:acme/plugin'])(
    'returns null for %j',
    (field) => {
      expect(githubFullNameFromRepositoryField(field)).toBeNull()
    },
  )
})
