export function isSafeExternalUrl(target: unknown): target is string {
  if (typeof target !== 'string' || !target.trim()) return false
  try {
    const parsed = new URL(target.trim())
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'mailto:'
  } catch {
    return false
  }
}
