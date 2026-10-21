import { Vector3 } from 'three'
import type { AddSound } from '../audio/sound'
import type { Stage } from '../stage'
import { easeInOut, easeOut, seg, smoother } from '../util'
import { LAYOUT } from '../world/layout'

// 压板、压石：平时在案子右边的地上；搬上来、搬回去都先直着抬过台面再平移，不从桌子里穿过去。
// 七爪"润折压"、压果片"压果""复压"共用。

export interface PressCue {
  /** 顶板：开始搬、悬在底板上方、落下压住、开始抬起、抬到上方、放回地上 */
  board: [number, number, number, number, number, number]
  /** 压石：开始搬、压在板上、开始搬走、放回地上 */
  stone: [number, number, number, number]
  /** 压住时顶板底面离底板面多高（底下压着的东西的厚度；压果越压越薄，可以随时间变） */
  gap: number | ((t: number) => number)
}

const v = (x: number, y: number, z: number) => new Vector3(x, y, z)

function over(out: Vector3, a: Vector3, b: Vector3, t: number) {
  const clearY = LAYOUT.tableTop + 22
  const up = v(a.x, Math.max(clearY, a.y), a.z)
  const across = v(b.x, Math.max(clearY, b.y), b.z)
  if (t < 0.4) out.lerpVectors(a, up, smoother(t / 0.4))
  else if (t < 0.8) out.lerpVectors(up, across, smoother((t - 0.4) / 0.4))
  else out.lerpVectors(across, b, smoother((t - 0.8) / 0.2))
  return out
}

/** 压板、压石的声音：顶板压下去、压石搁上去、压石放回地上、顶板放回地上 */
export function pressSounds(add: AddSound, cue: PressCue) {
  const L = LAYOUT
  const at = v(L.press.x, L.press.y + 4, L.press.z)
  const [b0, , b2, , , b5] = cue.board
  const [, s1, , s3] = cue.stone
  add(b0 + 0.05, 'slide', { dur: 0.35, gain: 0.2, pitch: 0.45, at: L.boardRest })
  add(b2 - 0.02, 'knock', { gain: 0.75, at })
  add(s1 - 0.02, 'stone', { gain: 0.75, at })
  add(s3 - 0.02, 'stone', { gain: 0.5, pitch: 0.9, at: L.stoneRest })
  add(b5 - 0.02, 'knock', { gain: 0.5, pitch: 0.85, at: L.boardRest })
}

/** 顶板压住时它的中心高度（板厚 2.4，中心在板厚一半） */
export function pressedY(gap: number) {
  return LAYOUT.press.y + gap + 1.2
}

export function placePress(s: Stage, t: number, cue: PressCue) {
  const L = LAYOUT
  const tb = s.w.table
  const [b0, b1, b2, b3, b4, b5] = cue.board
  const boardRest = tb.boardRest
  const boardAbove = v(L.press.x, L.press.y + 13, L.press.z)
  const gap = typeof cue.gap === 'number' ? cue.gap : cue.gap(t)
  const pressed = v(L.press.x, pressedY(gap), L.press.z)
  const top = tb.topBoard
  if (t < b0) top.position.copy(boardRest)
  else if (t < b1) over(top.position, boardRest, boardAbove, seg(t, b0, b1))
  else if (t < b2) top.position.lerpVectors(boardAbove, pressed, easeInOut(seg(t, b1, b2)))
  else if (t < b3) top.position.copy(pressed)
  else if (t < b4) top.position.lerpVectors(pressed, boardAbove, easeOut(seg(t, b3, b4)))
  else over(top.position, boardAbove, boardRest, seg(t, b4, b5))
  const by = top.position.y
  const [s0, s1, s2, s3] = cue.stone
  const stoneRest = tb.stoneRest
  const onBoard = v(L.press.x + 1, by + 1.2, L.press.z)
  const st = tb.stone
  if (t < s0) st.position.copy(stoneRest)
  else if (t < s1) over(st.position, stoneRest, onBoard, seg(t, s0, s1))
  else if (t < s2) st.position.copy(onBoard)
  else if (t < s3) over(st.position, onBoard, stoneRest, seg(t, s2, s3))
  else st.position.copy(stoneRest)
}
