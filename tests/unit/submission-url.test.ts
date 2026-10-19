import { describe, expect, it } from 'vitest'
import { canonicalFullName, parseSubmissionUrl } from '@/lib/submissions/url'

describe('parseSubmissionUrl — GitHub', () => {
  it.each([
    ['https://github.com/Acme/Payload-Plugin', 'acme/payload-plugin'],
    ['https://www.github.com/acme/payload-plugin/', 'acme/payload-plugin'],
    ['github.com/acme/payload-plugin', 'acme/payload-plugin'],
    ['https://github.com/acme/payload-plugin.git', 'acme/payload-plugin'],
    ['https://github.com/acme/payload-plugin/tree/main/packages/x', 'acme/payload-plugin'],
    ['https://github.com/acme/payload-plugin?tab=readme#install', 'acme/payload-plugin'],
    ['  https://github.com/acme/p.l_u-g  ', 'acme/p.l_u-g'],
  ])('%s → %s', (input, fullName) => {
    expect(parseSubmissionUrl(input)).toEqual({ kind: 'github', fullName, canonicalUrl: `https://github.com/${fullName}` })
  })
})

describe('parseSubmissionUrl — npm', () => {
  it.each([
    ['https://www.npmjs.com/package/payload-plugin-x', 'payload-plugin-x'],
    ['https://npmjs.com/package/@acme/payload-plugin', '@acme/payload-plugin'],
    ['https://www.npmjs.com/package/%40acme%2Fpayload-plugin', '@acme/payload-plugin'],
    ['www.npmjs.com/package/@acme/payload-plugin/v/1.2.3', '@acme/payload-plugin'],
  ])('%s → %s', (input, packageName) => {
    expect(parseSubmissionUrl(input)).toEqual({ kind: 'npm', packageName, canonicalUrl: `https://www.npmjs.com/package/${packageName}` })
  })
})

describe('parseSubmissionUrl — rejected input', () => {
  it.each([
    '',
    'acme/payload-plugin',
    'http://github.com/acme/repo',
    'https://github.com.evil.com/acme/repo',
    'https://evil.com/github.com/acme/repo',
    'https://github.com@evil.com/acme/repo',
    'https://user:pass@github.com/acme/repo',
    'https://github.com:8443/acme/repo',
    'https://gist.github.com/acme/abc',
    'https://raw.githubusercontent.com/acme/repo/main/package.json',
    'https://api.github.com/repos/acme/repo',
    'https://github.com/acme',
    'https://github.com/orgs/acme',
    'https://github.com/-acme/repo',
    'https://github.com/acme/..',
    'https://github.com/ac me/repo',
    'https://github.com/acme\\repo/x',
    'javascript:alert(1)//github.com/a/b',
    'file:///etc/passwd',
    'ftp://github.com/acme/repo',
    'https://www.npmjs.com/search?q=payload',
    'https://www.npmjs.com/package/',
    'https://www.npmjs.com/package/Upper-Case',
    'https://www.npmjs.com/package/@scope',
    'https://registry.npmjs.org/payload',
    'https://xn--github-xyz.com/acme/repo',
    `https://github.com/acme/${'r'.repeat(400)}`,
    'https://github.com/acme/repo\n.evil.com',
    'https://github.com/acme%2Frepo/x',
    'https://github.com/acme/repo/../../evil/x',
    'https://github.com/x/%2e%2e/acme/repo',
    'https://github.com/./acme/repo',
    'https://github.com/acme/repo/..',
    'https://ｇｉｔｈｕｂ.com/acme/repo',
    'https://git\u00adhub.com/acme/repo',
    'https://git\u200bhub.com/acme/repo',
    'https://github\u3002com/acme/repo',
    'https://github.com/acme/r\u00e9po',
    'https://github.com/%2e%2e/repo',
    'https://github.com/acme/%2e%2e',
    'https://140.82.112.3/acme/repo',
    'https://[::1]/acme/repo',
    'https://www.npmjs.com/package/%2e%2e%2f%2e%2e',
    'https://www.npmjs.com:444/package/x',
  ])('rejects %j', (input) => {
    expect(parseSubmissionUrl(input)).toBeNull()
  })
})

describe('canonicalFullName', () => {
  it('lower-cases and strips .git', () => {
    expect(canonicalFullName('Acme', 'Repo.git')).toBe('acme/repo')
  })
  it('refuses invalid names', () => {
    expect(canonicalFullName('a_b', 'repo')).toBeNull()
    expect(canonicalFullName('acme', '.')).toBeNull()
  })
})
