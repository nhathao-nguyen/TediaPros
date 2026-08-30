import { readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const FORBIDDEN_PATTERNS = [
  /local-assets/i,
  /whisper-models/i,
  /whisper-engine(\.exe)?$/i,
  /ocr-engine(\.exe)?$/i,
  /video2x(\.exe)?$/i,
  /dy-engine(\.exe)?$/i,
  /ffmpeg(\.exe)?$/i,
  /ffprobe(\.exe)?$/i,
  /cublas.*\.dll$/i,
  /cudart.*\.dll$/i,
  /nvrtc.*\.dll$/i,
  /nvblas.*\.dll$/i,
  /\.zip$/i
]

export async function findForbiddenFiles(dir) {
  const violations = []

  async function scan(current) {
    let entries
    try {
      entries = await readdir(current, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      const fullPath = join(current, entry.name)
      for (const pattern of FORBIDDEN_PATTERNS) {
        if (pattern.test(entry.name) || pattern.test(fullPath)) {
          violations.push(fullPath)
          break
        }
      }
      if (entry.isDirectory()) {
        await scan(fullPath)
      }
    }
  }

  await scan(dir)
  return violations
}

export async function verifyPackagedDirectory(appResourcesDir) {
  const violations = await findForbiddenFiles(appResourcesDir)
  return {
    ok: violations.length === 0,
    violations
  }
}

async function main() {
  const targetDir = resolve(process.argv[2] || 'dist')
  console.log(`Verifying package output in: ${targetDir}`)

  const violations = await findForbiddenFiles(targetDir)
  const innerViolations = violations.filter((filePath) => {
    const norm = filePath.replace(/\\/g, '/')
    return (
      norm.includes('/win-unpacked/') ||
      norm.includes('/mac-arm64/') ||
      norm.includes('.app/Contents/') ||
      norm.includes('/resources/')
    )
  })

  if (innerViolations.length > 0) {
    console.error('PACKAGE VERIFICATION FAILED: Prohibited core runtime or model files found in packaged app:')
    for (const v of innerViolations) {
      console.error(`  - ${v}`)
    }
    process.exit(1)
  }

  console.log('PASS: No prohibited core runtime binaries, CUDA DLLs, or model assets in packaged output.')
}

let isDirectRun = false
try {
  if (typeof import.meta !== 'undefined' && import.meta?.url && process.argv[1]) {
    isDirectRun = resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
  }
} catch {
  isDirectRun = false
}

if (isDirectRun) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  })
}
