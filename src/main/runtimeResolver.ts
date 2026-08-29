import { app } from 'electron'
import { spawn } from 'node:child_process'
import { access, mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join } from 'node:path'

export type RuntimeEngineKind = 'ffmpeg' | 'whisper-cpp' | 'ocr' | 'video2x' | 'douyin'

export interface InstalledRuntimeReceipt {
  engine: string
  version: string
  sha256?: string
  protocol?: string
  installedAt: string
  activePath: string
}

export type InstalledRuntimeState = Record<string, InstalledRuntimeReceipt>

const isWin = process.platform === 'win32'
const isMac = process.platform === 'darwin'

function exe(name: string): string {
  return isWin ? `${name}.exe` : name
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}

function unique(paths: string[]): string[] {
  const seen = new Set<string>()
  return paths.filter((path) => {
    const key = path.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** Root canonical directory for persistent managed engines outside the installer. */
export function runtimeRoot(): string {
  return join(app.getPath('userData'), 'runtime')
}

/** Root canonical directory for a specific engine kind. */
export function runtimeKindDir(kind: RuntimeEngineKind): string {
  return join(runtimeRoot(), kind)
}

/** Root canonical directory for persistent models outside the installer. */
export function modelRoot(kind: 'whisper-cpp' = 'whisper-cpp'): string {
  return join(app.getPath('userData'), 'models', kind)
}

/** Root directory for runtime state metadata and receipts. */
export function runtimeStateRoot(): string {
  return join(app.getPath('userData'), 'runtime-state')
}

export function installedRuntimeReceiptPath(): string {
  return join(runtimeStateRoot(), 'installed-runtime.json')
}

/**
 * Return candidate search directories for a given runtime engine.
 * Priority:
 * 1. Explicit dev override (TEDIAPROS_RUNTIME_DIR) if configured.
 * 2. Canonical managed path in userData/runtime/<kind>.
 * 3. Legacy backward-compatible directories (userData/bin/<kind>, userData/bin, appData/tediapros/bin).
 *
 * Invariant: Production NEVER contains hidden fallbacks to process.resourcesPath/local-assets.
 */
export function runtimeSearchRoots(kind: RuntimeEngineKind): string[] {
  const roots: string[] = []

  const devOverride = process.env.TEDIAPROS_RUNTIME_DIR?.trim()
  if (devOverride) {
    roots.push(join(devOverride, kind))
    roots.push(devOverride)
  }

  // Canonical managed root
  roots.push(join(app.getPath('userData'), 'runtime', kind))

  // Legacy managed roots for migration / backward-compatibility
  roots.push(join(app.getPath('userData'), 'bin', kind))
  roots.push(join(app.getPath('userData'), 'bin'))
  roots.push(join(app.getPath('appData'), 'tediapros', 'bin', kind))
  roots.push(join(app.getPath('appData'), 'tediapros', 'bin'))

  return unique(roots)
}

/**
 * Find an executable file for a given engine kind across canonical and legacy search roots.
 */
export async function resolveRuntimeExecutable(
  kind: RuntimeEngineKind,
  filenames: string[]
): Promise<string | null> {
  const candidates = runtimeSearchRoots(kind)
  for (const root of candidates) {
    for (const name of filenames) {
      const target = join(root, name)
      if (await fileExists(target)) {
        return target
      }
    }
  }
  return null
}

function runCapture(
  cmd: string,
  args: string[],
  timeoutMs = 15_000
): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    let out = ''
    let settled = false
    try {
      const child = spawn(cmd, args, { windowsHide: true })
      const finish = (code: number): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve({ code, out })
      }
      const timer = setTimeout(() => {
        try {
          child.kill()
        } catch {
          /* ignore */
        }
        finish(-1)
      }, timeoutMs)
      child.stdout?.on('data', (d) => (out += d.toString()))
      child.stderr?.on('data', (d) => (out += d.toString()))
      child.on('error', () => finish(-1))
      child.on('close', (code) => finish(code ?? -1))
    } catch {
      resolve({ code: -1, out })
    }
  })
}

async function canRun(cmd: string, args: string[] = ['--version']): Promise<boolean> {
  return (await runCapture(cmd, args)).code === 0
}

/**
 * Canonical resolver for FFmpeg.
 * Priority: managed runtime (runtime/ffmpeg, userData/bin) -> PATH.
 */
export async function resolveFfmpeg(): Promise<string | null> {
  const exeName = exe('ffmpeg')
  const managed = await resolveRuntimeExecutable('ffmpeg', [exeName])

  if (managed && (await canRun(managed, ['-version']))) {
    if (isMac && process.arch === 'arm64') {
      const inspected = await runCapture('/usr/bin/file', ['-b', managed])
      const description = inspected.out.toLowerCase()
      if (
        inspected.code === 0 &&
        (description.includes('arm64') || description.includes('universal binary'))
      ) {
        return managed
      }
    } else {
      return managed
    }
  }

  // Fallback to system PATH
  if (await canRun('ffmpeg', ['-version'])) {
    if (isMac && process.arch === 'arm64') {
      const which = await runCapture('/usr/bin/which', ['ffmpeg'])
      const resolved = which.out.trim().split(/\r?\n/)[0]
      if (!resolved) return null
      const inspected = await runCapture('/usr/bin/file', ['-b', resolved])
      const description = inspected.out.toLowerCase()
      if (!description.includes('arm64') && !description.includes('universal binary')) {
        return null
      }
    }
    return 'ffmpeg'
  }

  return null
}

/**
 * Canonical resolver for ffprobe.
 */
export async function resolveFfprobe(): Promise<string | null> {
  const exeName = exe('ffprobe')
  const managed = await resolveRuntimeExecutable('ffmpeg', [exeName])

  if (managed && (await canRun(managed, ['-version']))) {
    return managed
  }

  if (await canRun('ffprobe', ['-version'])) {
    return 'ffprobe'
  }

  return null
}

/**
 * Read installed runtime state receipt.
 */
export async function readInstalledRuntimeState(): Promise<InstalledRuntimeState> {
  try {
    const raw = await readFile(installedRuntimeReceiptPath(), 'utf8')
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as InstalledRuntimeState
    }
    return {}
  } catch {
    return {}
  }
}

/**
 * Write/update an installed runtime state receipt.
 */
export async function recordInstalledRuntimeReceipt(
  kind: string,
  receipt: Omit<InstalledRuntimeReceipt, 'engine'>
): Promise<void> {
  const current = await readInstalledRuntimeState()
  current[kind] = {
    engine: kind,
    ...receipt
  }
  const stateDir = runtimeStateRoot()
  await mkdir(stateDir, { recursive: true })
  const target = installedRuntimeReceiptPath()
  const partial = `${target}.partial`
  await writeFile(partial, `${JSON.stringify(current, null, 2)}\n`, 'utf8')
  await rm(target, { force: true }).catch(() => {})
  await rename(partial, target)
}
