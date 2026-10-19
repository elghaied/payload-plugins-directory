import { normalizeGitHubUrl } from '@/sync/packages'
import { canonicalFullName } from '@/lib/submissions/url'

/**
 * `owner/repo` (lower-case) from a package.json `repository` field, if it points at GitHub. Parsing is shared
 * with discover (`normalizeGitHubUrl`); the result is then re-validated with the strict submission rules.
 */
export function githubFullNameFromRepositoryField(field: unknown): string | null {
  const raw =
    typeof field === 'string'
      ? field
      : typeof field === 'object' && field !== null && typeof (field as { url?: unknown }).url === 'string'
        ? (field as { url: string }).url
        : null
  if (!raw || raw.length > 500) return null
  const normalized = normalizeGitHubUrl(raw)
  if (!normalized) return null
  const [owner, repo, ...rest] = normalized.split('/')
  return rest.length === 0 && owner && repo ? canonicalFullName(owner, repo) : null
}
