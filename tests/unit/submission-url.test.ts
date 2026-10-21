import { describe, expect, it } from 'vitest'
import { canonicalFullName, parseSubmissionUrl, parseTemplateSubmissionUrl } from '@/lib/submissions/url'

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

describe('parseTemplateSubmissionUrl', () => {
  it('drops the ref and keeps a subfolder path', () => {
    expect(parseTemplateSubmissionUrl('https://github.com/a/b/tree/main/apps/site')).toEqual({
      fullName: 'a/b', canonicalUrl: 'https://github.com/a/b/tree/HEAD/apps/site', path: 'apps/site',
    })
  })
  it.each([
    ['https://github.com/A/B', 'a/b'],
    ['github.com/a/b/', 'a/b'],
    ['https://github.com/a/b.git', 'a/b'],
    ['https://github.com/a/b/tree/main', 'a/b'],
    ['https://github.com/a/b?tab=readme#x', 'a/b'],
  ])('%s is the repository root of %s', (input, fullName) => {
    expect(parseTemplateSubmissionUrl(input)).toEqual({ fullName, canonicalUrl: `https://github.com/${fullName}`, path: null })
  })
  it('keeps the path case and re-parses its canonical URL to the same target', () => {
    const t = parseTemplateSubmissionUrl('https://github.com/Acme/Mono/tree/v1.2/templates/My_Site.v2/')
    expect(t).toEqual({ fullName: 'acme/mono', canonicalUrl: 'https://github.com/acme/mono/tree/HEAD/templates/My_Site.v2', path: 'templates/My_Site.v2' })
    expect(parseTemplateSubmissionUrl(t!.canonicalUrl)).toEqual(t)
  })
  it.each([
    'https://github.com/a/b/tree/main/../x',
    'https://github.com/a/b/tree/main/./x',
    'https://github.com/a/b/tree/main/x/%2e%2e/y',
    'https://github.com/a/b/tree/main/a%20b',
    'https://github.com/a/b/tree/main/a%2Fb',
    'https://github.com/a/b/tree/main/x$y',
    'https://github.com/a/b/blob/main/README.md',
    'https://github.com/a/b/issues',
    'https://github.com/a',
    `https://github.com/a/b/tree/main/${'x'.repeat(301)}`,
    'https://www.npmjs.com/package/payload-template',
    'https://gitlab.com/a/b',
    'http://github.com/a/b',
    '',
  ])('rejects %j', (input) => {
    expect(parseTemplateSubmissionUrl(input)).toBeNull()
  })
})
