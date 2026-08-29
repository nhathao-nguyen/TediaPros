import { app, BrowserWindow } from 'electron'
import { logInfo } from './logger'
import { UpdateStatus } from '../shared/types'

let started = false
let getWindowRef: (() => BrowserWindow | null) | null = null

function sendStatus(status: UpdateStatus): void {
  getWindowRef?.()?.webContents.send('update:status', status)
}

/**
 * App updates are intentionally disabled until a project-owned update channel
 * is configured. This prevents the old repository from remaining a runtime
 * dependency and keeps offline installs deterministic.
 */
export function initAutoUpdate(getWindow: () => BrowserWindow | null): void {
  if (started) return
  started = true
  getWindowRef = getWindow
  logInfo(`Tự cập nhật app: tắt trong bản local ${app.getVersion()}; chưa cấu hình kênh cập nhật của dự án.`)
  sendStatus({ state: 'none' })
}

export async function checkForUpdates(): Promise<void> {
  if (!started) logInfo('Kiểm tra cập nhật: bỏ qua vì chưa có kênh cập nhật local.')
}

export async function quitAndInstall(): Promise<void> {
  logInfo('Cài cập nhật: không có bản cập nhật được tải trong chế độ local.')
}
