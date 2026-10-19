import { MAX_PENDING_PER_MAINTAINER } from './limits'

export const MESSAGES = {
  invalidUrl: 'Enter a GitHub repository (https://github.com/owner/repo) or npm package (https://www.npmjs.com/package/name) URL.',
  listed: (name: string) => `Already listed as "${name}".`,
  unavailable: 'This repository is already known to the directory and cannot be submitted again.',
  pending: 'This plugin has already been submitted and is awaiting review.',
  tooMany: `You have ${MAX_PENDING_PER_MAINTAINER} requests awaiting review. Please wait until some are reviewed.`,
  submitFailed: 'Something went wrong while saving your submission. Please try again in a moment.',
  claimFailed: 'Something went wrong while processing your claim. Please try again in a moment.',
  claimNotListed: 'A claim must reference a listed plugin.',
  alreadyMaintainer: 'You already maintain this plugin.',
  claimPending: 'You already have a pending claim for this plugin.',
  registryUnavailable: 'The npm registry did not answer. The submission stays pending; try again in a moment, or enter owner/repo by hand.',
  approvedIsFinal: {
    claim: 'An approved claim cannot be changed. Remove the maintainer from the plugin instead.',
    listing: 'An approved listing cannot be changed. Hide or trash the plugin instead.',
  },
  claimPluginGone: 'The plugin for this claim is trashed or no longer exists, so the claim cannot be approved.',
  unresolvedRepository: 'Could not find the GitHub repository for this submission. Enter owner/repo by hand, then approve.',
} as const
