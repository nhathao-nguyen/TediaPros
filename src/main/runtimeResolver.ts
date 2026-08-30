import { app } from 'electron'
import { spawn } from 'node:child_process'
import { access, mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join } from 'node:path'

/** Runtime packages that may be installed by the production application. */
export type RuntimeEngineKind =
  | 'ffmpeg'
  | 'whisper-engine'
  | 'whisper-cuda'
  | 'ocr-engine'
  | 'video2x'
  | 'douyin'

export interface InstalledRuntimeReceipt {
  engine: RuntimeEngineKind
  version: string
  sha256?: string
  protocol?: string
  installedAt: string
  activePath: string
}

export type InstalledRuntimeState = Partial<Record<RuntimeEngineKind, InstalledRuntimeReceipt>>

const isMac = process.platform === 'darwin'

function exe(name: string): string {
  return process.platform === 'win32' ? `${name}.exe` : name
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}

/** Persistent managed runtime root. It is independent of the installed app version. */
export function runtimeRoot(): string {
  return join(app.getPath('userData'), 'bin')
}

/** Persistent directory for one runtime package. */
export function runtimeKindDir(kind: RuntimeEngineKind): string {
  return join(runtimeRoot(), kind)
}

/** Persistent model root. Models are not runtime packages. */
export function modelRoot(): string {
  return join(app.getPath('userData'), 'whisper-models')
}

export function runtimeStateRoot(): string {
  return join(app.getPath('userData'), 'runtime-state')
}

export function installedRuntimeReceiptPath(): string {
  return join(runtimeStateRoot(), 'installed-runtime.json')
}

/**
 * Production resolution is deliberately boring: one canonical directory only.
 * Development source overrides belong in an explicit dev-only adapter and must
 * never be silently considered by packaged code.
 */
export function runtimeSearchRoots(kind: RuntimeEngineKind): string[] {
  return [runtimeKindDir(kind)]
}

export async function resolveRuntimeExecutable(
  kind: RuntimeEngineKind,
  filenames: string[]
): Promise<string | null> {
  const root = runtimeKindDir(kind)
  for (const name of filenames) {
    const candidate = join(root, name)
    if (await fileExists(candidate)) return candidate
  }
  return null
}

function runCapture(cmd: string, args: string[], timeoutMs = 15_000): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    let out = ''
    let settled = false
    let timer: NodeJS.Timeout | undefined
    const finish = (code: number): void => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      resolve({ code, out })
    }
    try {
      const child = spawn(cmd, args, { windowsHide: true })
      timer = setTimeout(() => {
        try { child.kill() } catch { /* best effort */ }
        finish(-1)
      }, timeoutMs)
      child.stdout?.on('data', (data) => { out += data.toString() })
      child.stderr?.on('data', (data) => { out += data.toString() })
      child.on('error', () => finish(-1))
      child.on('close', (code) => finish(code ?? -1))
    } catch {
      finish(-1)
    }
  })
}

async function canRun(cmd: string, args: string[]): Promise<boolean> {
  return (await runCapture(cmd, args)).code === 0
}

async function isMacBinaryCompatible(path: string): Promise<boolean> {
  if (!isMac || process.arch !== 'arm64') return true
  const inspected = await runCapture('/usr/bin/file', ['-b', path])
  const description = inspected.out.toLowerCase()
  return inspected.code === 0 && (description.includes('arm64') || description.includes('universal binary'))
}

/** A working FFmpeg install is an FFmpeg/FFprobe pair from the managed runtime. */
export async function resolveFfmpeg(): Promise<string | null> {
  const ffmpeg = join(runtimeKindDir('ffmpeg'), exe('ffmpeg'))
  const ffprobe = join(runtimeKindDir('ffmpeg'), exe('ffprobe'))
  if (!(await fileExists(ffmpeg)) || !(await fileExists(ffprobe))) return null
  if (!(await canRun(ffmpeg, ['-version'])) || !(await canRun(ffprobe, ['-version']))) return null
  if (!(await isMacBinaryCompatible(ffmpeg)) || !(await isMacBinaryCompatible(ffprobe))) return null
  return ffmpeg
}

export async function resolveFfprobe(): Promise<string | null> {
  const ffmpeg = await resolveFfmpeg()
  return ffmpeg ? join(runtimeKindDir('ffmpeg'), exe('ffprobe')) : null
}

export async function readInstalledRuntimeState(): Promise<InstalledRuntimeState> {
  try {
    const raw = await readFile(installedRuntimeReceiptPath(), 'utf8')
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as InstalledRuntimeState
  } catch {
    // Missing or corrupt receipt is equivalent to no receipt.
  }
  return {}
}

export async function recordInstalledRuntimeReceipt(
  kind: RuntimeEngineKind,
  receipt: Omit<InstalledRuntimeReceipt, 'engine'>
): Promise<void> {
  const current = await readInstalledRuntimeState()
  current[kind] = { engine: kind, ...receipt }
  await mkdir(runtimeStateRoot(), { recursive: true })
  const target = installedRuntimeReceiptPath()
  const partial = `${target}.partial`
  await writeFile(partial, `${JSON.stringify(current, null, 2)}\n`, 'utf8')
  await rm(target, { force: true }).catch(() => {})
  await rename(partial, target)
}
