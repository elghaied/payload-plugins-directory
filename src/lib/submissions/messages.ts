import { MAX_PENDING_PER_MAINTAINER } from './limits'

export const MESSAGES = {
  invalidUrl: 'Enter a GitHub repository (https://github.com/owner/repo) or npm package (https://www.npmjs.com/package/name) URL.',
  listed: (name: string) => `Already listed as "${name}".`,
  unavailable: 'This repository is already known to the directory and cannot be submitted again.',
  pending: 'This plugin has already been submitted and is awaiting review.',
  tooMany: `You have ${MAX_PENDING_PER_MAINTAINER} requests awaiting review. Please wait until some are reviewed.`,
  claimNotListed: 'A claim must reference a listed plugin.',
  alreadyMaintainer: 'You already maintain this plugin.',
  claimPending: 'You already have a pending claim for this plugin.',
  unresolvedRepository: 'Could not find the GitHub repository for this submission. Enter owner/repo by hand, then approve.',
} as const
