import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { defineConfig, type Plugin } from 'vite'

// 开发时的截图通道：页面 POST 到 /__shot?name=xxx，存成 .shots/xxx.jpg（只在 dev 下有，打包不带）
function shots(): Plugin {
  const dir = process.env.SHOT_DIR ?? join(process.cwd(), '.shots')
  return {
    name: 'dev-shots',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__shot', (req, res) => {
        const name = (new URL(req.url ?? '', 'http://x').searchParams.get('name') ?? 'shot').replace(/[^\w.-]/g, '_')
        const chunks: Buffer[] = []
        req.on('data', (c: Buffer) => chunks.push(c))
        req.on('end', () => {
          mkdirSync(dir, { recursive: true })
          writeFileSync(join(dir, name + '.jpg'), Buffer.concat(chunks))
          res.end('ok')
        })
      })
    },
  }
}

// 独立的小工程：和 site/ 分开跑，端口也错开
export default defineConfig({
  base: './',
  plugins: [shots()],
  server: { host: '127.0.0.1', port: 5180, strictPort: true },
  preview: { host: '127.0.0.1', port: 4180, strictPort: true },
  build: { chunkSizeWarningLimit: 1200 },
})
