/** Requests (listings and claims) a maintainer may have awaiting review at once. */
export const MAX_PENDING_PER_MAINTAINER = 10

/** An own pending claim is re-verified against GitHub at most once per this window (counted from its last check). */
export const CLAIM_RECHECK_COOLDOWN_MS = 10 * 60 * 1000
