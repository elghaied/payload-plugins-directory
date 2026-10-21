import type { Payload } from 'payload'
import { ValidationError } from 'payload'
import type { CurrentMaintainer } from '@/lib/auth/current'
import { findListingConflict, type ListingConflict, type ListingKind } from './duplicates'
import { MESSAGES } from './messages'
import { parseSubmissionUrl, parseTemplateSubmissionUrl } from './url'

/** Template results carry `kind: 'template'` so the form links and words them for templates; plugin results are unchanged. */
export type SubmitResult =
  | { status: 'created' }
  | { status: 'listed'; slug: string; name: string; kind?: 'template' }
  | { status: 'pending'; kind?: 'template' }
  | { status: 'unavailable' }
  | { status: 'otherType'; existingType: ListingKind; slug: string; name: string }
  | { status: 'invalid'; message: string }

export function normalizeNote(note: string): string | undefined {
  const value = note.trim().slice(0, 1000)
  return value || undefined
}

export function validationMessage(err: ValidationError): string {
  const errors = (err.data as { errors?: { message?: string }[] } | undefined)?.errors
  return errors?.[0]?.message ?? err.message
}

export async function submitListing({
  payload,
  maintainer,
  url,
  note,
  kind = 'plugin',
}: {
  payload: Payload
  maintainer: CurrentMaintainer
  url: string
  note: string
  kind?: ListingKind
}): Promise<SubmitResult> {
  let canonicalUrl: string
  let conflict: ListingConflict | null
  // Friendly pre-check (links to the existing listing). The collection hook re-checks on create,
  // so the REST API cannot bypass it.
  if (kind === 'template') {
    const target = parseTemplateSubmissionUrl(url)
    if (!target) return { status: 'invalid', message: MESSAGES.templateNeedsGitHub }
    canonicalUrl = target.canonicalUrl
    conflict = await findListingConflict(payload, target, undefined, 'template')
  } else {
    const target = parseSubmissionUrl(url)
    if (!target) return { status: 'invalid', message: MESSAGES.invalidUrl }
    canonicalUrl = target.canonicalUrl
    conflict = await findListingConflict(payload, target)
  }
  if (conflict) return toResult(conflict, kind)

  try {
    // Acts for the maintainer: collection access and field access apply (status/submittedBy are admin-only fields,
    // the beforeChange hook stamps the real owner).
    await payload.create({
      collection: 'submissions',
      overrideAccess: false,
      user: maintainer,
      depth: 0,
      // `path` is derived from the URL by the collection hook; kind is the only extra a maintainer sends.
      data: { type: 'listing', kind, url: canonicalUrl, note: normalizeNote(note), submittedBy: maintainer.id, status: 'pending' },
    })
    return { status: 'created' }
  } catch (err) {
    if (err instanceof ValidationError) return { status: 'invalid', message: validationMessage(err) }
    throw err
  }
}

function toResult(conflict: ListingConflict, kind: ListingKind): SubmitResult {
  const flavour = kind === 'template' ? ({ kind: 'template' } as const) : {}
  switch (conflict.kind) {
    case 'listed':
      return { status: 'listed', slug: conflict.slug, name: conflict.name, ...flavour }
    case 'pending':
      return { status: 'pending', ...flavour }
    case 'otherType':
      return { status: 'otherType', existingType: conflict.existingType, slug: conflict.slug, name: conflict.name }
    default:
      return { status: conflict.kind }
  }
}
