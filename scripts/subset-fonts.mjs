// 把字体裁成只含用到的字：从 src 里的 .ts 收集字（去掉注释），再加常用标点和英文数字。
// 原字体在 ../assets/fonts/（不进仓库），裁好的放进 public/fonts/。改了界面文字后重跑：npm run fonts
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import subsetFont from 'subset-font'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const assets = join(root, '..', 'assets', 'fonts')
const out = join(root, 'public', 'fonts')

const FONTS = [
  ['source-han-serif/SourceHanSerifCN-Regular.otf', 'serif-400.woff2'],
  ['source-han-serif/SourceHanSerifCN-SemiBold.otf', 'serif-600.woff2'],
  ['lxgw-wenkai/LXGWWenKai-Regular.ttf', 'wenkai.woff2'],
]

function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, files)
    else if (['.ts'].includes(extname(p))) files.push(p)
  }
  return files
}

let text = ''
for (const f of walk(join(root, 'src'))) {
  let src = readFileSync(f, 'utf8')
  src = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/.*$/gm, '')
  text += src
}
text += ' 0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~'
text += '，。、；：？！…—～·（）《》〈〉「」『』“”‘’【】'
const chars = [...new Set(text)].filter((c) => c.codePointAt(0) >= 32).join('')

mkdirSync(out, { recursive: true })
for (const [src, name] of FONTS) {
  const buf = await subsetFont(readFileSync(join(assets, src)), chars, { targetFormat: 'woff2' })
  writeFileSync(join(out, name), buf)
  console.log(`${name.padEnd(16)} ${(buf.length / 1024).toFixed(0)} KB`)
}
console.log(`${[...chars].length} chars`)
