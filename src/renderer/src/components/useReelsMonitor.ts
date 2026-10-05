import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReelsMonitorResult, ReelsMonitorState } from '../../../shared/facebookReelsMonitor'

export function useReelsMonitor(): {
  state: ReelsMonitorState | null; error: string
  act: (operation: Promise<ReelsMonitorResult>) => Promise<void>
} {
  const [state, setState] = useState<ReelsMonitorState | null>(null), [error, setError] = useState('')
  const mounted = useRef(false), revision = useRef(0)
  const act = useCallback(async (operation: Promise<ReelsMonitorResult>): Promise<void> => {
    const request = ++revision.current
    try {
      const result = await operation
      if (!mounted.current || request !== revision.current) return
      if (!result.ok || !result.state) { setError(result.error ?? 'Không đọc được theo dõi Reels.'); return }
      setState(result.state); setError('')
    } catch (error) { if (mounted.current && request === revision.current) setError(error instanceof Error ? error.message : 'Không đọc được theo dõi Reels.') }
  }, [])
  useEffect(() => {
    mounted.current = true
    if (typeof window.api.facebookReelsMonitorState !== 'function') {
      setError('Hãy mở lại ứng dụng để nạp chức năng theo dõi Reels.'); return () => { mounted.current = false }
    }
    const refresh = (): void => { void act(window.api.facebookReelsMonitorState()) }
    const off = window.api.onFacebookReelsMonitorChanged(refresh); refresh()
    return () => { mounted.current = false; off() }
  }, [act])
  return { state, error, act }
}
