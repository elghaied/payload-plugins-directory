/** Output limits (spec §5.2). Enforced by validateEnrichment(); the schema can only describe them. */
export const LIMITS = {
  tagline: 120,
  summary: 600,
  featureLength: 120,
  featuresMin: 3,
  featuresMax: 6,
  useCaseLength: 140,
  useCasesMin: 1,
  useCasesMax: 3,
  tagsMax: 6,
  tagTitle: 40,
  tagTitleWords: 4,
} as const

/** Above this many tags the schema stops enumerating them (keeps the schema small); the validator still maps strings. */
export const TAG_ENUM_MAX = 300

/**
 * JSON schema for `output_config.format`. Structured outputs reject string/array/number constraints
 * (maxLength, minItems, minimum…), so limits live in descriptions and in the system prompt.
 */
export function buildOutputSchema(leafSlugs: readonly string[], tagSlugs: readonly string[]): Record<string, unknown> {
  const newTag = {
    type: 'object',
    additionalProperties: false,
    required: ['new'],
    properties: {
      new: { type: 'string', description: `Title of a new tag: 1-${LIMITS.tagTitleWords} words, at most ${LIMITS.tagTitle} characters.` },
    },
  }
  const existingTag = tagSlugs.length > TAG_ENUM_MAX ? { type: 'string' } : { type: 'string', enum: [...tagSlugs] }
  const tagItem = tagSlugs.length ? { anyOf: [existingTag, newTag] } : newTag
  return {
    type: 'object',
    additionalProperties: false,
    required: ['category', 'tags', 'tagline', 'summary', 'features', 'useCases', 'confidence'],
    properties: {
      category: { type: 'string', enum: [...leafSlugs], description: 'Exactly one category slug from the list.' },
      tags: { type: 'array', items: tagItem, description: `At most ${LIMITS.tagsMax} tags; prefer existing slugs.` },
      tagline: { type: 'string', description: `At most ${LIMITS.tagline} characters.` },
      summary: { type: 'string', description: `At most ${LIMITS.summary} characters.` },
      features: {
        type: 'array',
        items: { type: 'string' },
        description: `${LIMITS.featuresMin}-${LIMITS.featuresMax} items, each at most ${LIMITS.featureLength} characters.`,
      },
      useCases: {
        type: 'array',
        items: { type: 'string' },
        description: `${LIMITS.useCasesMin}-${LIMITS.useCasesMax} items, each at most ${LIMITS.useCaseLength} characters.`,
      },
      confidence: { type: 'number', description: 'From 0 to 1.' },
    },
  }
}
