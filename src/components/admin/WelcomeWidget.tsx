import Link from 'next/link'
import type { WidgetServerProps } from 'payload'
import { isAdminUser } from '@/access'
import { listedPluginsWhere } from '@/collections/Plugins'
import { listedTemplatesWhere } from '@/collections/Templates'
import { getServerURL } from '@/lib/serverUrl'
import { Greeting } from './Greeting'
import './dashboard.css'

/** First word of the email's local part, capitalised ("sam.e@…" → "Sam"); null when it does not look like a name. */
export function nameFromEmail(email: unknown): string | null {
  if (typeof email !== 'string') return null
  const word = email.split('@')[0]?.split(/[._+-]/)[0] ?? ''
  return /^[a-z]{2,20}$/i.test(word) ? word[0].toUpperCase() + word.slice(1).toLowerCase() : null
}

/** Dashboard banner: greeting, the directory at a glance, and the admin's most used destinations. */
export async function WelcomeWidget({ req }: WidgetServerProps) {
  if (!isAdminUser(req.user)) return null
  const { payload } = req
  const count = async (collection: 'plugins' | 'templates' | 'submissions', where: object) => {
    try {
      return (await payload.count({ collection, overrideAccess: true, where: where as never })).totalDocs
    } catch (err) {
      payload.logger.error({ err, msg: `Welcome widget: could not count ${collection}` })
      return null
    }
  }
  const [plugins, templates, pending, enriched] = await Promise.all([
    count('plugins', listedPluginsWhere),
    count('templates', listedTemplatesWhere),
    count('submissions', { status: { equals: 'pending' } }),
    count('plugins', { and: [listedPluginsWhere, { 'ai.enrichedAt': { exists: true } }] }),
  ])
  const coverage = plugins && enriched !== null ? Math.round((enriched / plugins) * 100) : null
  const show = (n: number | null) => (n === null ? '–' : n.toLocaleString('en'))
  const site = getServerURL() || '/'
  return (
    <header className="pd-hero">
      <div className="pd-hero__copy">
        <span className="pd-eyebrow">Payload Directory · admin</span>
        <Greeting name={nameFromEmail((req.user as { email?: unknown } | null)?.email)} />
        <p>
          {pending ? `${pending} ${pending === 1 ? 'submission is' : 'submissions are'} waiting for review.` : 'No submissions waiting.'} Jobs, AI
          coverage and the review queue are below.
        </p>
        <div className="pd-hero__actions">
          <a className="pd-hero__action pd-hero__action--primary" href={site} target="_blank" rel="noopener noreferrer">
            Open the site ↗
          </a>
          <Link className="pd-hero__action" href="/admin/collections/plugins">
            Plugins
          </Link>
          <Link className="pd-hero__action" href="/admin/collections/templates">
            Templates
          </Link>
          <Link className="pd-hero__action" href="/admin/globals/directory-settings">
            Settings
          </Link>
        </div>
      </div>
      <div className="pd-hero__stats">
        <Link className="pd-hero__stat" href="/admin/collections/plugins">
          <strong>{show(plugins)}</strong>
          <span>plugins listed</span>
        </Link>
        <Link className="pd-hero__stat" href="/admin/collections/templates">
          <strong>{show(templates)}</strong>
          <span>templates listed</span>
        </Link>
        <Link className={`pd-hero__stat ${pending ? 'pd-hero__stat--alert' : ''}`} href="/admin/collections/submissions?where[status][equals]=pending">
          <strong>{show(pending)}</strong>
          <span>waiting review</span>
        </Link>
        <div className="pd-hero__stat">
          <strong>{coverage === null ? '–' : `${coverage}%`}</strong>
          <span>AI summaries</span>
        </div>
      </div>
    </header>
  )
}
