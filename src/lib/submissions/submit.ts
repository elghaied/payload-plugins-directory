import type { Payload } from 'payload'
import { ValidationError } from 'payload'
import type { CurrentMaintainer } from '@/lib/auth/current'
import { findListingConflict } from './duplicates'
import { MESSAGES } from './messages'
import { parseSubmissionUrl } from './url'

export type SubmitResult =
  | { status: 'created' }
  | { status: 'listed'; slug: string; name: string }
  | { status: 'pending' }
  | { status: 'unavailable' }
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
}: {
  payload: Payload
  maintainer: CurrentMaintainer
  url: string
  note: string
}): Promise<SubmitResult> {
  const target = parseSubmissionUrl(url)
  if (!target) return { status: 'invalid', message: MESSAGES.invalidUrl }

  // Friendly pre-check (links to the existing listing). The collection hook re-checks on create,
  // so the REST API cannot bypass it.
  const conflict = await findListingConflict(payload, target)
  if (conflict) return conflict.kind === 'listed' ? { status: 'listed', slug: conflict.slug, name: conflict.name } : { status: conflict.kind }

  try {
    // Acts for the maintainer: collection access and field access apply (status/submittedBy are admin-only fields,
    // the beforeChange hook stamps the real owner).
    await payload.create({
      collection: 'submissions',
      overrideAccess: false,
      user: maintainer,
      depth: 0,
      data: { type: 'listing', url: target.canonicalUrl, note: normalizeNote(note), submittedBy: maintainer.id, status: 'pending' },
    })
    return { status: 'created' }
  } catch (err) {
    if (err instanceof ValidationError) return { status: 'invalid', message: validationMessage(err) }
    throw err
  }
}
