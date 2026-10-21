import { QIZHUA } from './qizhua'
import { TAI } from './tai'
import type { LineDef } from './types'
import { WUZHUA } from './wuzhua'
import { YAGUO } from './yaguo'

// 四条线（入口页按这个顺序排）。ready = false 的在入口页上标"制作中"。

export const LINES: LineDef[] = [QIZHUA, WUZHUA, YAGUO, TAI]

export function findLine(id: string | null): LineDef | null {
  return LINES.find((l) => l.id === id && l.ready) ?? null
}
