// 声音时刻检查：sounds() 里不许直接写裸数字时刻。
//
// 为什么：动作声的时间点如果写成 add(16.76, 'tap')，以后改动画节奏时没人会记得回来改它，
// 于是声音和画面对不上。每个段文件顶部有一个 AT 表，把该段所有"声音该响的时刻"集中写上，
// 声音和视觉都只引用名字。这个脚本负责拦住新写的裸数字。
//
// 跑法：npm run check:audio（也接在 npm run build 里）

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = fileURLToPath(new URL('../src/acts/', import.meta.url))
const files = readdirSync(dir).filter((f) => f.endsWith('.ts'))
const bad = []

for (const f of files) {
  const src = readFileSync(join(dir, f), 'utf8')
  const lines = src.split('\n')
  lines.forEach((line, i) => {
    // add(12.3, 'name'  —— 第一个参数是纯数字字面量、第二个参数是音效名
    const m = /add\(\s*([0-9]+(?:\.[0-9]+)?)\s*,\s*'([a-z]+)'/.exec(line)
    if (!m) return
    bad.push({ file: f, line: i + 1, t: m[1], name: m[2], text: line.trim() })
  })
}

if (bad.length === 0) {
  console.log('声音时刻检查：通过（没有裸数字时刻）')
} else {
  console.error(`声音时刻检查：发现 ${bad.length} 处裸数字时刻，请收进该段的 AT 表：\n`)
  for (const b of bad) console.error(`  src/acts/${b.file}:${b.line}  add(${b.t}, '${b.name}')`)
  console.error('\n写法：文件顶部 const AT = { 名字: 12.3 }，调用处 add(AT.名字, ...)')
  process.exit(1)
}
