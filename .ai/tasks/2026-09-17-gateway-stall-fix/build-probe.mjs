import { build } from 'esbuild'
import { resolve } from 'node:path'
await build({
  entryPoints: ['.ai/tasks/2026-09-17-gateway-stall-fix/verify-live.ts'],
  outfile: '.ai/tasks/2026-09-17-gateway-stall-fix/verify-live.cjs', bundle: true, platform: 'node', format: 'cjs', target: 'node20',
  plugins: [{ name: 'electron-readonly-probe', setup(b) {
    b.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'probe' }))
    b.onLoad({ filter: /.*/, namespace: 'probe' }, () => ({ contents: `module.exports = { app: {
      getPath: () => ${JSON.stringify(resolve('.ai/tasks/2026-09-17-gateway-stall-fix'))},
      getVersion: () => '0.1.26', getName: () => 'restoration-probe', isPackaged: false
    }, safeStorage: { isEncryptionAvailable: () => false } };`, loader: 'js' }))
  } }]
})
