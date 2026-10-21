import { App } from './app'
import { startLab } from './lab'
import { findLine } from './lines'
import { QIZHUA } from './lines/qizhua'
import { startWorldLab } from './worldlab'

const q = new URLSearchParams(location.search)
const canvas = document.getElementById('gl') as HTMLCanvasElement

if (q.get('lab') === 'world') startWorldLab(canvas)
else if (q.has('lab')) startLab(canvas, q.get('lab') || 'whole')
else {
  // 选了哪一段就演哪一段；没选（或者选了还没做好的）就是入口页，背后放七爪的院子
  const line = findLine(q.get('line'))
  if (line) document.title = `${line.name} · 古法`
  new App(line ?? QIZHUA, !line && !q.has('t') && !q.has('autoplay'))
}
