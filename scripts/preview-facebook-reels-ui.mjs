// Renderer-only visual QA. No Electron, cookies, Facebook requests, or real downloads.
import { context } from 'esbuild'
import { createServer } from 'node:http'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const directory = await mkdtemp(join(tmpdir(), 'tediapros-reels-ui-'))
const buildContext = await context({ entryPoints: [resolve('tests/fixtures/facebook-reels-ui.tsx')],
  bundle: true, platform: 'browser', format: 'esm', jsx: 'automatic', outfile: join(directory, 'app.js'),
  define: { 'process.env.NODE_ENV': '"development"' } })
await buildContext.rebuild()
await buildContext.watch()
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://127.0.0.1').pathname
  if (pathname === '/') {
    response.setHeader('Content-Type', 'text/html; charset=utf-8')
    response.end('<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>TediaPros · Kiểm tra giao diện Reels</title><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>')
  } else if (pathname === '/app.js' || pathname === '/app.css') {
    response.setHeader('Content-Type', pathname.endsWith('.css') ? 'text/css' : 'text/javascript')
    response.setHeader('Cache-Control', 'no-store')
    response.end(await readFile(join(directory, pathname.slice(1))))
  } else { response.writeHead(404); response.end() }
})
server.listen(4179, '127.0.0.1', () => console.log('Renderer QA preview: http://127.0.0.1:4179 (synthetic data only)'))
process.on('SIGINT', async () => { server.close(); await buildContext.dispose(); process.exit(0) })
