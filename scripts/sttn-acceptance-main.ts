import { app } from 'electron'
import { isAbsolute, resolve, join } from 'node:path'
import { mkdir, readdir, writeFile } from 'node:fs/promises'

/** Run with Electron after bundling (external:electron); no renderer or AI server mocks. */
async function main(): Promise<void> {
  const args = Object.fromEntries(process.argv.slice(2).reduce<string[][]>((pairs, arg, index, all) => {
    if (arg.startsWith('--')) pairs.push([arg.slice(2), all[index + 1]])
    return pairs
  }, []))
  for (const key of ['user-data', 'output-dir', 'video']) {
    if (!args[key] || !isAbsolute(args[key])) throw new Error(`--${key} must be absolute`)
  }
  app.setPath('userData', resolve(args['user-data']))
  const outputDir = resolve(args['output-dir'])
  await mkdir(outputDir, { recursive: true })
  const { installSttnDependencies, getSttnReadiness } = await import('../src/main/inpainting/assets')
  if (args.install === 'true') await installSttnDependencies(p => console.log(JSON.stringify(p)))
  const ready = await getSttnReadiness()
  console.log(JSON.stringify({ type: 'readiness', dependencies: ready }))
  if (ready.some(d => !d.ready)) throw new Error('STTN is not ready')
  const { runAutoShortSttnPreview, startAutoShortSttnPreview, cancelAutoShortSttnPreview, disposeAutoShortSttnPreview } = await import('../src/main/autoshort')
  const started = Date.now()
  const request = {
    videoPath: args.video, previewSeconds: 5,
    config: {
      subtitleMethod: 'ocr', whisperModel: 'base', whisperDevice: 'cpu',
      lamMo: true, blurMode: 'sttn', ocrBlurProfile: 'accurate', blurRegions: [],
      ocrRegion: { x0: 0, y0: 1450 / 1920, x1: 1, y1: 1 },
      translateTarget: 'none', translateProvider: 'local', ttsEnabled: false,
      voiceOverMode: false, audioMode: 'replace', originalAudioVolume: 1, outputDir
    }
  }
  if (args.cancel === 'true') {
    const root = join(app.getPath('userData'), 'autoshort', 'sttn-previews')
    const before = await readdir(root).catch(() => [])
    let cancellation: Promise<void> | undefined
    const result = await startAutoShortSttnPreview(900001, request, p => {
      console.log(JSON.stringify(p))
      if (p.percent >= 45 && !cancellation) cancellation = cancelAutoShortSttnPreview(900001)
    })
    await cancellation
    await disposeAutoShortSttnPreview(900001)
    const after = await readdir(root).catch(() => [])
    if (!cancellation || result.ok || after.some(name => !before.includes(name))) throw new Error('Cancellation did not finish with clean work directory')
    await writeFile(join(outputDir, 'cancellation.json'), JSON.stringify({ result, clean: true, elapsedMs: Date.now() - started }, null, 2))
    console.log(JSON.stringify({ type: 'cancel-accepted', result, clean: true }))
    return
  }
  const result = await runAutoShortSttnPreview(request, join(outputDir, 'preview'), new AbortController().signal, p => console.log(JSON.stringify(p)))
  const evidence = { ...result, totalElapsedMs: Date.now() - started, dependencies: ready }
  await writeFile(join(outputDir, 'result.json'), JSON.stringify(evidence, null, 2), 'utf8')
  console.log(JSON.stringify({ type: 'accepted', ...evidence }))
}

app.whenReady().then(main).then(() => app.exit(0), error => { console.error(error); app.exit(1) })
