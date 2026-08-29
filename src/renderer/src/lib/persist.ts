import { Dispatch, SetStateAction, useCallback, useEffect, useState } from 'react'

const STORAGE_SYNC_EVENT = 'tblao:storage-sync'

function migrateLegacyStorage(): void {
  try {
    const aiKey = 'tblao.ai.serverUrl'
    const currentAiUrl = localStorage.getItem(aiKey)
    if (!currentAiUrl) {
      const legacyKeys = ['tblao.tts.serverUrl', 'tblao.autoshort.ttsUrl']
      for (const oldKey of legacyKeys) {
        const raw = localStorage.getItem(oldKey)
        if (raw) {
          const parsed = JSON.parse(raw)
          if (typeof parsed === 'string' && parsed.trim()) {
            localStorage.setItem(aiKey, JSON.stringify(parsed.trim()))
            break
          }
        }
      }
    }
  } catch {
    /* ignore migration errors */
  }
}

if (typeof window !== 'undefined') {
  migrateLegacyStorage()
}

export function usePersistedState<T>(
  key: string,
  initial: T
): [T, Dispatch<SetStateAction<T>>] {
  const [val, setValInternal] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key)
      return raw != null ? (JSON.parse(raw) as T) : initial
    } catch {
      return initial
    }
  })

  useEffect(() => {
    const handleSync = (e: CustomEvent<{ key: string; value: unknown }>): void => {
      if (e.detail && e.detail.key === key) {
        setValInternal(e.detail.value as T)
      }
    }
    window.addEventListener(STORAGE_SYNC_EVENT as any, handleSync as any)
    return () => {
      window.removeEventListener(STORAGE_SYNC_EVENT as any, handleSync as any)
    }
  }, [key])

  const setVal: Dispatch<SetStateAction<T>> = useCallback((action: SetStateAction<T>) => {
    setValInternal((prev) => {
      const next = typeof action === 'function' ? (action as (prevState: T) => T)(prev) : action
      try {
        localStorage.setItem(key, JSON.stringify(next))
        window.dispatchEvent(new CustomEvent(STORAGE_SYNC_EVENT, { detail: { key, value: next } }))
      } catch {
        /* ignore */
      }
      return next
    })
  }, [key])

  return [val, setVal]
}

