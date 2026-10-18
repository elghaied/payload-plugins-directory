import { describe, expect, it } from 'vitest'
import { assertTestDatabaseUrl } from '../int/helpers/assertTestDatabaseUrl'

const DEV = 'postgres://directory:directory@localhost:5433/directory'
const TEST = 'postgres://directory:directory@localhost:5433/directory_test'

describe('assertTestDatabaseUrl', () => {
  it('throws when the test URL is missing', () => {
    expect(() => assertTestDatabaseUrl(undefined, DEV)).toThrow(/DATABASE_URL_TEST is not set/)
    expect(() => assertTestDatabaseUrl('', DEV)).toThrow(/DATABASE_URL_TEST is not set/)
  })

  it('throws when the test URL equals the dev URL', () => {
    expect(() => assertTestDatabaseUrl(DEV, DEV)).toThrow(/must differ from DATABASE_URL/)
  })

  it('throws when the database name does not end in _test', () => {
    expect(() =>
      assertTestDatabaseUrl('postgres://u:p@localhost:5433/directory_staging', DEV),
    ).toThrow(/must end in "_test"/)
    expect(() => assertTestDatabaseUrl('postgres://u:p@localhost:5433/', DEV)).toThrow(/must end in "_test"/)
  })

  it('returns the URL when it targets a _test database', () => {
    expect(assertTestDatabaseUrl(TEST, DEV)).toBe(TEST)
    expect(assertTestDatabaseUrl(`${TEST}?sslmode=disable`, undefined)).toBe(`${TEST}?sslmode=disable`)
  })
})
