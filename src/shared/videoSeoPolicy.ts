import type { VideoSeoMetadata, VideoSeoOptions } from './types'

export const SHORT_VIDEO_SEO_POLICY_VERSION = 'short-video-seo-v1'

const DESCRIPTION_LIMITS: Record<VideoSeoOptions['descriptionLength'], number> = {
  short: 300,
  medium: 500,
  long: 800
}

const INLINE_HASHTAG = /#[\p{L}\p{N}_]/u

export type ShortVideoSeoErrorCode =
  | 'description-too-long'
  | 'too-many-tags'
  | 'too-many-hashtags'
  | 'inline-hashtag'

export class ShortVideoSeoValidationError extends Error {
  constructor(public readonly code: ShortVideoSeoErrorCode, message: string) {
    super(message)
    this.name = 'ShortVideoSeoValidationError'
  }
}

export function shortVideoSeoErrorCode(error: unknown): string {
  return error instanceof ShortVideoSeoValidationError ? error.code : 'invalid-structured-output'
}

export function validateShortVideoSeoMetadata(
  metadata: VideoSeoMetadata,
  options: VideoSeoOptions
): void {
  const descriptionLimit = DESCRIPTION_LIMITS[options.descriptionLength]
  if (Array.from(metadata.description).length > descriptionLimit) {
    throw new ShortVideoSeoValidationError('description-too-long', `Description video ngắn dài quá ${descriptionLimit} ký tự.`)
  }
  if (metadata.tags.length > 8) throw new ShortVideoSeoValidationError('too-many-tags', 'Metadata video ngắn có quá 8 tags.')
  if (metadata.hashtags.length > 3) throw new ShortVideoSeoValidationError('too-many-hashtags', 'Metadata video ngắn có quá 3 hashtags.')
  if (INLINE_HASHTAG.test(metadata.title) || INLINE_HASHTAG.test(metadata.description)) {
    throw new ShortVideoSeoValidationError('inline-hashtag', 'Title và description không được chứa hashtag.')
  }
}
