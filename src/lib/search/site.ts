import { getPayload } from 'payload'
import config from '@payload-config'
import { toSiteResult } from './present'
import { searchDirectory } from './searchDirectory'

/** Uncached on purpose: /search is dynamic and results must reflect visibility changes immediately. */
export async function searchSite(raw: string) {
  const payload = await getPayload({ config: await config })
  return toSiteResult(await searchDirectory(payload, raw, { pluginLimit: 50, taxonomyLimit: 12, templateLimit: 6 }))
}
