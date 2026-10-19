/** Every auth response (they set, clear or depend on cookies) must never be stored by any cache. */
export const NO_STORE = { 'Cache-Control': 'private, no-store' } as const
