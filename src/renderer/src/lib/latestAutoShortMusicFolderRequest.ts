export interface AutoShortMusicFolderRequestTokenRef {
  current: number
}

/**
 * Only the newest folder chooser may update renderer state. A stale rejection
 * is deliberately consumed so it cannot overwrite a newer success/cancel.
 */
export async function runLatestAutoShortMusicFolderRequest<T>(
  tokenRef: AutoShortMusicFolderRequestTokenRef,
  request: () => Promise<T>
): Promise<T | undefined> {
  const requestToken = ++tokenRef.current
  try {
    const result = await request()
    return tokenRef.current === requestToken ? result : undefined
  } catch (error) {
    if (tokenRef.current !== requestToken) return undefined
    throw error
  }
}
