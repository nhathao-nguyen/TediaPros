import { app } from 'electron'
import { isAbsolute, join, resolve } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'

/** Explicit local runtime update through the normal checksum/probe/atomic installer. */
async function main(): Promise<void> {
  const pairs = process.argv.slice(2)
  const args = Object.fromEntries(pairs.flatMap((arg, index) => arg.startsWith('--') ? [[arg.slice(2), pairs[index + 1]]] : []))
  for (const name of ['user-data', 'runtime-dir', 'evidence-dir']) {
    if (!args[name] || !isAbsolute(args[name])) throw new Error(`--${name} must be absolute`)
  }
  app.setPath('userData', resolve(args['user-data']))
  process.env.TEDIAPROS_LOCAL_RUNTIME_DIR = resolve(args['runtime-dir'])
  const evidence = resolve(args['evidence-dir'])
  await mkdir(evidence, { recursive: true })
  const { readInstalledRuntimeState } = await import('../src/main/runtimeResolver')
  const before = await readInstalledRuntimeState()
  await writeFile(join(evidence, 'receipt-before.json'), JSON.stringify(before['sttn-engine'], null, 2))
  const { downloadRuntimeEngineFromManifest } = await import('../src/main/runtimeInstaller')
  const { runSttnCommand, probeSttnEngine } = await import('../src/main/inpainting/runner')
  const { sttnModelPath, getSttnReadiness } = await import('../src/main/inpainting/assets')
  const installed = await downloadRuntimeEngineFromManifest('sttn-engine', (percent, message) => {
    console.log(JSON.stringify({ percent, message }))
  }, { probe: async (_kind, root, spec) => {
    const executable = join(root, spec.entrypoint)
    const version = await runSttnCommand({ executablePath: executable, args: ['--version'], expectedEvent: 'version' })
    if (version.version !== '1.1.1' || spec.version !== version.version) throw new Error('Unexpected STTN update version')
    const provider = await probeSttnEngine(executable, sttnModelPath())
    return { healthy: true, version: '1.1.1', protocol: 'sttn-engine/1', message: provider }
  } })
  if (!installed) throw new Error('Local STTN manifest was not installed')
  const ready = await getSttnReadiness()
  if (ready.some(item => !item.ready)) throw new Error(JSON.stringify(ready))
  const after = await readInstalledRuntimeState()
  await writeFile(join(evidence, 'installation.json'), JSON.stringify({ receipt: after['sttn-engine'], ready }, null, 2))
  console.log(JSON.stringify({ installed: true, receipt: after['sttn-engine'], ready }))
  if (args['verify-video']) {
    if (!isAbsolute(args['verify-video'])) throw new Error('--verify-video must be absolute')
    const { runAutoShortSttnPreview, startAutoShortSttnPreview, cancelAutoShortSttnPreview, disposeAutoShortSttnPreview } = await import('../src/main/autoshort')
    const request = { videoPath: args['verify-video'], previewSeconds: 5, config: {
      subtitleMethod: 'ocr', whisperModel: 'base', whisperDevice: 'cpu',
      lamMo: true, blurMode: 'sttn', ocrBlurProfile: 'accurate', blurRegions: [],
      ocrRegion: { x0: 0, y0: .75, x1: 1, y1: 1 },
      translateTarget: 'none', translateProvider: 'local', ttsEnabled: false,
      voiceOverMode: false, audioMode: 'replace', originalAudioVolume: 1, outputDir: evidence
    } }
    const preview = await runAutoShortSttnPreview(request, join(evidence, 'preview'), new AbortController().signal,
      p => console.log(JSON.stringify(p)))
    await writeFile(join(evidence, 'preview.json'), JSON.stringify(preview, null, 2))
    let cancellation: Promise<void> | undefined
    const cancelled = await startAutoShortSttnPreview(900002, request, p => {
      if (p.percent > 45 && !cancellation) cancellation = cancelAutoShortSttnPreview(900002)
    })
    await cancellation
    await disposeAutoShortSttnPreview(900002)
    if (!cancellation || cancelled.ok) throw new Error('Native STTN cancellation did not finish')
    await writeFile(join(evidence, 'cancellation.json'), JSON.stringify(cancelled, null, 2))
    console.log(JSON.stringify({ preview, cancelled }))
  }
}

app.whenReady().then(main).then(() => app.exit(0), error => { console.error(error); app.exit(1) })
