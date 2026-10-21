// 逐帧截图：先 npm run dev，再 node scripts/shoot.mjs <输出目录> <秒> <秒> ...
// 接管 requestAnimationFrame 和 performance.now，手动一帧帧渲染（软件渲染下也不会超时，分辨率不会被自适应压低）
// 需要另装 Playwright（不是本工程的依赖）：找不到时用 PLAYWRIGHT=<playwright 的 index.mjs 路径> 指过去
const { chromium } = await import(process.env.PLAYWRIGHT ?? 'playwright')
const [outDir, ...times] = process.argv.slice(2)
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: Number(process.env.W ?? 960), height: Number(process.env.H ?? 540) } })
page.setDefaultTimeout(600000)
await page.addInitScript(() => {
  let fake = 1000
  performance.now = () => fake
  window.__rafQ = []
  window.requestAnimationFrame = (cb) => (window.__rafQ.push(cb), 1)
  window.__step = (n = 1, dt = 1000 / 60) => {
    for (let i = 0; i < n; i++) {
      fake += dt
      const q = window.__rafQ
      window.__rafQ = []
      for (const cb of q) cb(fake)
    }
  }
})
const logs = []
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`))
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`))
const q = process.env.Q ?? '&pause'
const url = process.env.URL ?? `http://127.0.0.1:5180/?t=${times[0]}${q}`
await page.goto(url, { waitUntil: 'load' })
await page.evaluate(() => document.fonts.ready)
for (const t of times) {
  const t0 = Date.now()
  await page.evaluate((t) => {
    if (window.__seek) window.__seek(Number(t))
    window.__step(2)
  }, t)
  await page.screenshot({ path: `${outDir}/t${String(t).padStart(6, '0')}.png` })
  console.log(`t=${t} ${Date.now() - t0}ms`)
}
console.log('--- console (unique) ---\n' + [...new Set(logs)].slice(0, 60).join('\n'))
await browser.close()
