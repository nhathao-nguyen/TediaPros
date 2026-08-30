import { spawnSync, type ChildProcess } from 'node:child_process'

const trackedChildren = new Set<ChildProcess>()

/** Keep every native helper visible to the coordinated Electron shutdown barrier. */
export function trackChildProcess<T extends ChildProcess>(child: T): T {
  trackedChildren.add(child)
  const forget = (): void => { trackedChildren.delete(child) }
  child.once('close', forget)
  child.once('error', forget)
  return child
}

/** Kill a native process and its descendants; Windows needs taskkill /T. */
export function terminateProcessTree(child: ChildProcess | null | undefined): void {
  if (!child || child.killed) return
  try {
    if (process.platform === 'win32' && child.pid) {
      const result = spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore'
      })
      if (result.status === 0) return
    }
    child.kill()
  } catch {
    /* best effort during shutdown */
  }
}

/** Stop all helpers tracked by the media/runtime pipeline. */
export function terminateTrackedProcessTrees(): void {
  for (const child of [...trackedChildren]) terminateProcessTree(child)
}
