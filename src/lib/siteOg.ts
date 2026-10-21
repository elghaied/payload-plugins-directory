/**
 * The default social image. Next merges file-based images (src/app/opengraph-image.tsx) only into the segment that
 * owns the file, and any page exporting its own `openGraph`/`twitter` replaces the parent object wholesale. So every
 * such export lists the image explicitly; relative URLs resolve against `metadataBase` (SERVER_URL).
 */
export const OG_IMAGES = [{ url: '/opengraph-image', width: 1200, height: 630, alt: 'Payload Plugin Directory' }]
export const TWITTER_IMAGES = ['/opengraph-image']
