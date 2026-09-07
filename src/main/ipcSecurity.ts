/**
 * Keep IPC origin validation pure so it can be exercised without starting
 * Electron. A trusted sender must be the top-level app renderer (packaged
 * file URL or the exact configured dev-server origin).
 */
export function isTrustedRendererUrl(
  rawUrl: unknown,
  options: { packaged: boolean; devOrigin?: string }
): boolean {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) return false
  try {
    const url = new URL(rawUrl)
    if (options.packaged) return url.protocol === 'file:'
    if (!options.devOrigin) return false
    const expected = new URL(options.devOrigin)
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.origin === expected.origin
  } catch {
    return false
  }
}

export function isTrustedIpcSender(
  input: {
    senderFrame?: { url?: string | null; parent?: unknown | null; isMainFrame?: boolean } | null
    sender?: { getURL?: () => string }
  },
  options: { packaged: boolean; devOrigin?: string }
): boolean {
  const frame = input.senderFrame
  if (frame) {
    // IPC from an embedded frame is not equivalent to IPC from the app's
    // top-level renderer, even when it happens to share the same origin.
    if (frame.isMainFrame === false || frame.parent != null) return false
    if (typeof frame.url === 'string' && frame.url.trim()) {
      return isTrustedRendererUrl(frame.url, options)
    }
  }
  const frameUrl = input.sender?.getURL?.()
  return isTrustedRendererUrl(frameUrl, options)
}
