import { describe, expect, it } from 'vitest'
import { extractMajorVersions, payloadMajorsFromRange } from '@/lib/versions'

describe('extractMajorVersions', () => {
  it.each([
    ['^3.0.0', [3]],
    ['^2.0.0 || ^3.0.0', [2, 3]],
    ['>=3.0.0-beta.1', [3]],
    ['3.0.0-beta.120', [3]],
    ['^4.0.0-beta.2', [4]],
    ['~1.15.0', [1]],
  ])('%s -> %j', (range, expected) => {
    expect(extractMajorVersions(range)).toEqual(expected)
  })
})

describe('payloadMajorsFromRange', () => {
  it('maps a normal range', () => {
    expect(payloadMajorsFromRange('^3.0.0 || ^4.0.0')).toEqual(['3', '4'])
  })
  it('returns unknown for null', () => {
    expect(payloadMajorsFromRange(null)).toEqual(['unknown'])
  })
  it('returns unknown for garbage', () => {
    expect(payloadMajorsFromRange('latest')).toEqual(['unknown'])
  })
  it('falls back to the npm major for workspace ranges', () => {
    expect(payloadMajorsFromRange('workspace:*', '4.0.0-beta.2')).toEqual(['4'])
  })
  it('counts both the npm latest and the monorepo version majors for workspace:<version>', () => {
    expect(payloadMajorsFromRange('workspace:4.0.0-beta.4', '3.92.0')).toEqual(['3', '4'])
    expect(payloadMajorsFromRange('workspace:4.1.0', '4.0.0')).toEqual(['4'])
    expect(payloadMajorsFromRange('workspace:4.0.0-beta.4', null)).toEqual(['4'])
  })
  it('ignores a workspace suffix that is not an exact version', () => {
    expect(payloadMajorsFromRange('workspace:^4.0.0', '3.92.0')).toEqual(['3'])
  })
  it('returns unknown for workspace ranges without npm data', () => {
    expect(payloadMajorsFromRange('workspace:*', null)).toEqual(['unknown'])
  })
  it('ignores majors outside 1-4', () => {
    expect(payloadMajorsFromRange('^0.9.0')).toEqual(['unknown'])
  })
})
