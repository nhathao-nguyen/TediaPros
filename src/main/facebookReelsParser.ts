import { facebookReelEntry, mergeFacebookReel, type FacebookReelsSource } from '../shared/facebookReels'
import type { PlaylistEntry } from '../shared/types'
import { articleLinksFromMessage } from '../shared/facebookArticleLinks'

type RecordValue = Record<string, unknown>
const record = (v: unknown): RecordValue | null => v && typeof v === 'object' && !Array.isArray(v) ? v as RecordValue : null
const text = (v: unknown): string | null => typeof v === 'string' && v.trim() ? v.trim() : null
const numericId = (v: unknown): string | null => typeof v === 'string' && /^\d{5,30}$/.test(v) ? v : null

export interface FacebookReelsParseContext {
  source: FacebookReelsSource
  knownIds?: ReadonlySet<string>
  /** Collection IDs already linked to this source by owner-checked edges. */
  collectionIds?: ReadonlySet<string>
  knownOwners?: ReadonlyMap<string,string>
}
export interface FacebookReelsConnection {
  id: string
  hasNextPage: boolean
  cursor: string | null
}
export interface FacebookReelsPayload {
  entries: PlaylistEntry[]
  excludedIds: string[]
  collectionIds: string[]
  connections: FacebookReelsConnection[]
  malformed: boolean
}

function storyVideo(story: RecordValue): RecordValue | null {
  const direct = record(story.video)
  if (numericId(direct?.id)) return direct
  const attachments = Array.isArray(story.attachments) ? story.attachments : []
  for (const attachment of attachments) {
    const media = record(record(attachment)?.media)
    if (numericId(media?.id) && (media?.__typename === 'Video' || media?.owner)) return media
  }
  return null
}

function entryFromStory(story: RecordValue, video: RecordValue, sourceVerified = false): PlaylistEntry | null {
  const id = numericId(video.id)
  if (!id) return null
  const caption = text(record(story.message)?.text) ??
    text(record(record(video.creation_story)?.message)?.text)
  const attachments = Array.isArray(story.attachments) ? story.attachments : []
  const media = attachments.map(a => record(record(a)?.media)).find(m => m?.id === id)
  const uploader = text(record(media?.owner)?.name) ?? text(record(video.owner)?.name)
  const result = facebookReelEntry(id, caption, 'graphql', uploader)
  result.facebook!.sourceVerified = sourceVerified
  const ownerId=numericId(record(video.owner)?.id)??numericId(record(media?.owner)?.id)
  if(ownerId)result.facebook!.ownerId=ownerId
  const links=articleLinksFromMessage(story.message??record(video.creation_story)?.message)
  if(links.length) result.facebook!.links=links.map(url=>({url,foundIn:'caption'}))
  const duration = media?.length_in_second
  if (typeof duration === 'number' && Number.isFinite(duration) && duration >= 0) result.duration = duration
  return result
}

/** Parse only ID-associated content and observed profile collection shapes, never longest page text. */
export function parseFacebookReelsPayload(raw: string, context: FacebookReelsParseContext): FacebookReelsPayload {
  const result: FacebookReelsPayload = { entries: [], excludedIds: [], collectionIds: [], connections: [], malformed: false }
  if (typeof raw !== 'string' || raw.length > 4 * 1024 * 1024) return { ...result, malformed: true }
  const cleaned = raw.replace(/^\s*for\s*\(\s*;;\s*\)\s*;\s*/, '')
  const chunks: unknown[] = []
  try { chunks.push(JSON.parse(cleaned)) } catch {
    for (const line of cleaned.split(/\r?\n/)) {
      if (!line.trim()) continue
      try { chunks.push(JSON.parse(line)) } catch { result.malformed = true }
    }
  }
  if (!chunks.length) return { ...result, malformed: true }
  const entries = new Map<string, PlaylistEntry>()
  const excludedIds=new Set<string>()
  const collectionIds = new Set(context.collectionIds ?? [])
  const add = (entry: PlaylistEntry | null): void => {
    if (!entry) return
    const old = entries.get(entry.id)
    entries.set(entry.id, old ? mergeFacebookReel(old, entry) : entry)
  }
  let visited = 0
  const walk = (value: unknown, depth: number): void => {
    if (depth > 40 || ++visited > 50000) { result.malformed = true; return }
    if (Array.isArray(value)) { for (const v of value) walk(v, depth + 1); return }
    const obj = record(value)
    if (!obj) return
    // Facebook's comment renderer carries an explicit associated_video ID.
    // Do not inspect comments under a recommendation or unrelated feedback object.
    const associatedId=numericId(record(obj.associated_video)?.id)
    if(associatedId && context.knownIds?.has(associatedId) && obj.comment_list_renderer) {
      const creator=entries.get(associatedId)?.facebook?.ownerId??context.knownOwners?.get(associatedId)??
        numericId(record(obj.owning_profile)?.id)??context.source.profileId
      const comments: {owner:boolean;urls:string[]}[]=[];let examined=0
      const readComments=(v:unknown,d:number):void=>{
        if(d>20||++examined>15000)return
        if(Array.isArray(v)){for(const x of v)readComments(x,d+1);return}
        const c=record(v);if(!c)return
        if(c.author && (c.body||c.preferred_body||c.body_renderer)) {
          const urls=[...new Set([c.body,c.preferred_body,c.body_renderer].flatMap(articleLinksFromMessage))]
          if(urls.length && creator && record(c.author)?.id===creator)comments.push({owner:true,urls})
        }
        for(const [k,x]of Object.entries(c))if(!['tracking','extensions','feedback','comment_action_links','attachments'].includes(k))readComments(x,d+1)
        // The renderer's root feedback contains the comment connection.
        if(c===record(obj.comment_list_renderer)&&c.feedback)readComments(c.feedback,d+1)
      }
      readComments(obj.comment_list_renderer,0)
      const entry=facebookReelEntry(associatedId)
      entry.facebook!.links=comments.sort((a,b)=>Number(b.owner)-Number(a.owner)).flatMap(c=>c.urls.map(url=>({url,foundIn:'comment' as const})))
      if(entry.facebook!.links.length)add(entry)
    }
    const connection = record(obj.aggregated_fb_shorts)
    if (connection && Array.isArray(connection.edges)) {
      const collectionId = text(obj.id)
      const stories = connection.edges.map(edge =>
        record(record(record(edge)?.profile_reel_node)?.node)).filter((s): s is RecordValue => s !== null)
      const sourceOwner = context.source.profileId
      const ownersMatch = !!sourceOwner && stories.length === connection.edges.length && stories.length > 0 &&
        stories.every(story => record(storyVideo(story)?.owner)?.id === sourceOwner)
      const scoped = collectionId && (collectionIds.has(collectionId) || collectionId === sourceOwner || ownersMatch)
      if (scoped && context.source.kind === 'profile') {
        collectionIds.add(collectionId)
        if (!result.collectionIds.includes(collectionId)) result.collectionIds.push(collectionId)
        for (const story of stories) {
          const video = storyVideo(story)
          if (video) add(entryFromStory(story, video, true))
        }
        const pageInfo = record(connection.page_info)
        if (typeof pageInfo?.has_next_page === 'boolean') {
          result.connections.push({ id: collectionId, hasNextPage: pageInfo.has_next_page, cursor: text(pageInfo.end_cursor) })
        }
      }
    }
    const ownId = numericId(obj.id)
    const ownerId = text(record(obj.owner)?.id)
    if(ownId&&ownerId&&context.source.profileId&&ownerId!==context.source.profileId) {
      if(excludedIds.size<10000)excludedIds.add(ownId);else result.malformed=true
    }
    const ownerAllowed = !context.source.profileId || !ownerId || ownerId === context.source.profileId
    if (ownId && ownerAllowed && context.knownIds?.has(ownId) && record(obj.creation_story)) {
      add(entryFromStory(record(obj.creation_story)!, obj, !!ownerId && ownerId === context.source.profileId))
    }
    const video = storyVideo(obj)
    const videoOwner = text(record(video?.owner)?.id)
    if (video && (!context.source.profileId || !videoOwner || videoOwner === context.source.profileId) &&
      context.knownIds?.has(String(video.id)) && record(obj.message)) add(entryFromStory(obj, video, !!videoOwner && videoOwner === context.source.profileId))
    // Delivery/tracking/extensions are unrelated and can be very large.
    for (const [key, v] of Object.entries(obj)) {
      if (!['extensions', 'tracking', 'encrypted_tracking', 'videoDeliveryLegacyFields',
        'videoDeliveryResponseFragment', 'video_delivery_response'].includes(key)) walk(v, depth + 1)
    }
  }
  for (const chunk of chunks) walk(chunk, 0)
  result.entries = [...entries.values()]
  result.excludedIds=[...excludedIds]
  result.entries = result.entries.filter(e=>!excludedIds.has(e.id))
  return result
}
