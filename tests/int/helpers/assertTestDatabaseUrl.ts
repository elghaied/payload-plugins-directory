/** Name of the database in a Postgres connection URL (its path segment). */
export function databaseNameFromUrl(url: string): string {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ''))
}

/**
 * Refuses any test database URL that could point at real data: it must be set,
 * differ from the dev DATABASE_URL, and name a database ending in `_test`.
 */
export function assertTestDatabaseUrl(testUrl: string | undefined, devUrl: string | undefined): string {
  if (!testUrl) {
    throw new Error('DATABASE_URL_TEST is not set; refusing to run integration tests.')
  }
  if (devUrl && testUrl === devUrl) {
    throw new Error('DATABASE_URL_TEST must differ from DATABASE_URL; refusing to run against the dev database.')
  }
  const name = databaseNameFromUrl(testUrl)
  if (!name.endsWith('_test')) {
    throw new Error(`DATABASE_URL_TEST database name must end in "_test" (got "${name}").`)
  }
  return testUrl
}
