import { Color, Vector3, type Mesh, type Object3D } from 'three'

// 数学小工具。整段动画都是"时间 → 画面"的纯函数，所以这里大多是插值和缓动。

export const PI = Math.PI
export const TAU = Math.PI * 2

export const clamp = (x: number, a = 0, b = 1) => (x < a ? a : x > b ? b : x)
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
export const invLerp = (a: number, b: number, x: number) => clamp((x - a) / (b - a))
export const smoothstep = (a: number, b: number, x: number) => {
  const t = invLerp(a, b, x)
  return t * t * (3 - 2 * t)
}
export const smooth = (t: number) => t * t * (3 - 2 * t)
export const smoother = (t: number) => t * t * t * (t * (t * 6 - 15) + 10)
export const easeOut = (t: number) => 1 - (1 - t) ** 3
export const easeIn = (t: number) => t * t * t
export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)
export const easeOutBack = (t: number, s = 1.5) => 1 + (s + 1) * (t - 1) ** 3 + s * (t - 1) ** 2
export const easeOutQuad = (t: number) => 1 - (1 - t) * (1 - t)

/** 时间段进度：T 在 [a, b] 里走到哪了，0～1 */
export const seg = (T: number, a: number, b: number) => invLerp(a, b, T)
/** 进度加缓动 */
export const segE = (T: number, a: number, b: number, e: (t: number) => number = smoother) => e(seg(T, a, b))

/** 可复现的伪随机 */
export function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
export const hash1 = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}

/** 平滑噪声（一维），给手持镜头的轻微晃动、火光闪烁用 */
export function noise1(x: number) {
  const i = Math.floor(x)
  const f = x - i
  const u = f * f * (3 - 2 * f)
  return lerp(hash1(i), hash1(i + 1), u) * 2 - 1
}
export const fbm1 = (x: number) => noise1(x) * 0.6 + noise1(x * 2.3 + 7) * 0.3 + noise1(x * 5.1 + 19) * 0.1

export const v3 = (x = 0, y = 0, z = 0) => new Vector3(x, y, z)
export const col = (hex: string) => new Color(hex)

/** 抛物线式的"拿起—挪过去—放下"：水平匀缓，竖直先抬后落 */
export function hop(out: Vector3, a: Vector3, b: Vector3, t: number, height: number) {
  const e = smoother(t)
  out.lerpVectors(a, b, e)
  out.y += Math.sin(Math.PI * e) * height
  return out
}

/** 一串关键帧上的数值插值：[[时间, 值], ...]，段内用 smoother 缓动 */
export function keys(T: number, ks: [number, number][], ease: (t: number) => number = smoother) {
  if (T <= ks[0][0]) return ks[0][1]
  for (let i = 1; i < ks.length; i++) {
    if (T <= ks[i][0]) {
      const [t0, a] = ks[i - 1]
      const [t1, b] = ks[i]
      return lerp(a, b, ease((T - t0) / (t1 - t0)))
    }
  }
  return ks[ks.length - 1][1]
}

export function lerpColor(out: Color, a: Color, b: Color, t: number) {
  out.r = lerp(a.r, b.r, t)
  out.g = lerp(a.g, b.g, t)
  out.b = lerp(a.b, b.b, t)
  return out
}

/** 一组东西投不投影 */
export function setCast(o: Object3D, on: boolean) {
  o.traverse((c) => {
    if ((c as Mesh).isMesh) c.castShadow = on
  })
}
