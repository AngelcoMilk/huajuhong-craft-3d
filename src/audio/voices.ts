// 音效全是现合成的（Web Audio 的噪声、振荡器、滤波、包络）：没有一个音频文件，也不用第三方库。
// 每个声音是一个函数：在 when 时刻往 out 上接一小串节点，放完自己停。
// 都往"收着"做：音量小、起音不硬、高频收掉一些，像在院子里隔几步听到的。

export interface Voice {
  /** 1 是常规音量 */
  gain: number
  /** 1 是常规音高（乘在基准频率上） */
  pitch: number
  /** 持续类的声音放多久（秒） */
  dur: number
  rnd: () => number
}
export type VoiceFn = (ctx: BaseAudioContext, out: AudioNode, when: number, v: Voice) => void

const NOISE = new WeakMap<BaseAudioContext, AudioBuffer>()

/** 三秒白噪声（固定种子），各处从不同位置起放，听不出是同一段 */
export function noiseBuffer(ctx: BaseAudioContext) {
  let b = NOISE.get(ctx)
  if (b) return b
  const len = Math.floor(ctx.sampleRate * 3)
  b = ctx.createBuffer(1, len, ctx.sampleRate)
  const d = b.getChannelData(0)
  let s = 0x9e3779b9
  for (let i = 0; i < len; i++) {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    d[i] = ((s >>> 0) / 4294967296) * 2 - 1
  }
  NOISE.set(ctx, b)
  return b
}

function noiseSrc(ctx: BaseAudioContext, when: number, len: number, rnd: () => number) {
  const s = ctx.createBufferSource()
  s.buffer = noiseBuffer(ctx)
  s.loop = true
  s.start(when, rnd() * 2.8)
  s.stop(when + len + 0.05)
  return s
}

/** 起音 a 秒升到 peak，再按指数落下去（d 秒后剩 2%） */
function env(p: AudioParam, when: number, a: number, peak: number, d: number) {
  p.setValueAtTime(0, when)
  p.linearRampToValueAtTime(peak, when + a)
  p.setTargetAtTime(0, when + a, d / 4)
}

interface BurstOpts {
  type?: BiquadFilterType
  f: number
  f2?: number
  q?: number
  a?: number
  d: number
  g: number
}
/** 一下滤过的噪声：碰、擦、溅 */
function burst(ctx: BaseAudioContext, out: AudioNode, when: number, o: BurstOpts, rnd: () => number) {
  const a = o.a ?? 0.002
  const len = a + o.d * 1.3
  const s = noiseSrc(ctx, when, len, rnd)
  const f = ctx.createBiquadFilter()
  f.type = o.type ?? 'bandpass'
  f.frequency.setValueAtTime(o.f, when)
  if (o.f2) f.frequency.exponentialRampToValueAtTime(o.f2, when + len)
  f.Q.value = o.q ?? 1
  const g = ctx.createGain()
  env(g.gain, when, a, o.g, o.d)
  s.connect(f).connect(g).connect(out)
}

interface ToneOpts {
  type?: OscillatorType
  f: number
  f2?: number
  glide?: number
  a?: number
  d: number
  g: number
}
/** 一个音：木头、碗、玻璃的"身子"，水泡 */
function tone(ctx: BaseAudioContext, out: AudioNode, when: number, o: ToneOpts) {
  const a = o.a ?? 0.003
  const osc = ctx.createOscillator()
  osc.type = o.type ?? 'sine'
  osc.frequency.setValueAtTime(o.f, when)
  if (o.f2) osc.frequency.exponentialRampToValueAtTime(o.f2, when + (o.glide ?? o.d))
  const g = ctx.createGain()
  env(g.gain, when, a, o.g, o.d)
  osc.connect(g).connect(out)
  osc.start(when)
  osc.stop(when + a + o.d * 1.3 + 0.02)
}

interface TextureOpts {
  f: number
  f2?: number
  q: number
  hp?: number
  dur: number
  g: number
  a?: number
  r?: number
  /** 起伏的颗粒有多长（秒）、起伏多深（0～1） */
  grain: number
  depth: number
}
/** 一段持续的、有颗粒起伏的噪声：刮、擦、沙沙、绳子拉过 */
function texture(ctx: BaseAudioContext, out: AudioNode, when: number, o: TextureOpts, rnd: () => number) {
  const a = Math.min(o.a ?? 0.05, o.dur * 0.4)
  const r = Math.min(o.r ?? 0.12, o.dur * 0.4)
  const s = noiseSrc(ctx, when, o.dur + r * 2, rnd)
  const f = ctx.createBiquadFilter()
  f.type = 'bandpass'
  f.frequency.setValueAtTime(o.f, when)
  if (o.f2) f.frequency.linearRampToValueAtTime(o.f2, when + o.dur)
  f.Q.value = o.q
  let node: AudioNode = s.connect(f)
  if (o.hp) {
    const h = ctx.createBiquadFilter()
    h.type = 'highpass'
    h.frequency.value = o.hp
    node = node.connect(h)
  }
  const g = ctx.createGain()
  const p = g.gain
  p.setValueAtTime(0, when)
  p.linearRampToValueAtTime(o.g * (1 - o.depth * rnd()), when + a)
  for (let t = when + a; t < when + o.dur - r; t += o.grain * (0.6 + 0.8 * rnd())) p.setTargetAtTime(o.g * (1 - o.depth * rnd()), t, o.grain * 0.3)
  p.setTargetAtTime(0, when + o.dur - r, r / 3)
  node.connect(g).connect(out)
}

/** 小水泡：频率往上滑一下（水泡破的声音） */
function bubble(ctx: BaseAudioContext, out: AudioNode, when: number, f: number, g: number) {
  tone(ctx, out, when, { f, f2: f * 2.2, glide: 0.04, a: 0.002, d: 0.05, g })
}

export const VOICES = {
  /** 软的一下：果子落进篮里、落在案上 */
  thud(ctx, out, when, v) {
    const f = 150 * v.pitch
    tone(ctx, out, when, { f: f * 1.7, f2: f, glide: 0.04, d: 0.16, g: 0.17 * v.gain })
    burst(ctx, out, when, { type: 'lowpass', f: 700 * v.pitch, q: 0.7, d: 0.05, g: 0.17 * v.gain }, v.rnd)
  },
  /** 轻轻一碰：竹筛、竹盘、片落在片上 */
  tap(ctx, out, when, v) {
    const f = 1900 * v.pitch * (0.92 + 0.16 * v.rnd())
    burst(ctx, out, when, { f, q: 3, d: 0.035, g: 0.7 * v.gain }, v.rnd)
    tone(ctx, out, when, { f: f * 0.55, d: 0.05, g: 0.056 * v.gain })
  },
  /** 木板放下：闷的一声，带一点木头的共鸣 */
  knock(ctx, out, when, v) {
    const f = 150 * v.pitch
    tone(ctx, out, when, { f: f * 1.15, f2: f, glide: 0.05, d: 0.26, g: 0.17 * v.gain })
    tone(ctx, out, when, { f: f * 2.7, d: 0.11, g: 0.04 * v.gain })
    burst(ctx, out, when, { type: 'lowpass', f: 1100, q: 0.6, d: 0.05, g: 0.14 * v.gain }, v.rnd)
  },
  /** 石头放在木板上：更低、更沉，带点砂 */
  stone(ctx, out, when, v) {
    const f = 92 * v.pitch
    tone(ctx, out, when, { f: f * 1.2, f2: f, glide: 0.06, d: 0.3, g: 0.19 * v.gain })
    burst(ctx, out, when, { type: 'lowpass', f: 520, q: 0.7, d: 0.11, g: 0.17 * v.gain }, v.rnd)
    burst(ctx, out, when + 0.004, { f: 2300, q: 1.6, d: 0.03, g: 0.034 * v.gain }, v.rnd)
  },
  /** 果子落进滚水：扑通，后面跟两个小水泡 */
  plop(ctx, out, when, v) {
    const f = 380 * v.pitch * (0.85 + 0.3 * v.rnd())
    burst(ctx, out, when, { f: 1500, q: 0.8, d: 0.12, g: 0.18 * v.gain }, v.rnd)
    tone(ctx, out, when + 0.006, { f, f2: f * 2.6, glide: 0.06, d: 0.07, g: 0.2 * v.gain })
    for (let k = 0; k < 2; k++) bubble(ctx, out, when + 0.08 + v.rnd() * 0.25, 700 + v.rnd() * 900, 0.04 * v.gain)
  },
  /** 一滴水 */
  drip(ctx, out, when, v) {
    bubble(ctx, out, when, 1200 * v.pitch * (0.8 + 0.5 * v.rnd()), 0.06 * v.gain)
  },
  /** 笊篱伸进水里：哗的一下 */
  swish(ctx, out, when, v) {
    burst(ctx, out, when, { f: 600, f2: 1500, q: 0.9, a: v.dur * 0.3, d: v.dur * 0.7, g: 0.16 * v.gain }, v.rnd)
  },
  /** 捞起来，水从笊篱里沥下去：沙沙的水声，越来越稀的水滴 */
  pour(ctx, out, when, v) {
    texture(ctx, out, when, { f: 1800, q: 0.7, dur: v.dur, g: 0.09 * v.gain, a: 0.04, r: v.dur * 0.5, grain: 0.03, depth: 0.5 }, v.rnd)
    let t = 0.05
    while (t < v.dur) {
      VOICES.drip(ctx, out, when + t, { ...v, gain: v.gain * (1 - (t / v.dur) * 0.6) })
      t += 0.04 + (t / v.dur) * 0.25 * v.rnd() + 0.03 * v.rnd()
    }
  },
  /** 小刀划开果皮：细细的嘶 */
  slice(ctx, out, when, v) {
    texture(ctx, out, when, { f: 3200 * v.pitch, f2: 2600 * v.pitch, q: 1, hp: 1400, dur: v.dur, g: 0.16 * v.gain, a: 0.08, r: 0.1, grain: 0.05, depth: 0.45 }, v.rnd)
    texture(ctx, out, when, { f: 520, q: 1.2, dur: v.dur, g: 0.07 * v.gain, a: 0.1, r: 0.1, grain: 0.08, depth: 0.6 }, v.rnd)
  },
  /** 铲刀刮白瓤：一下一下的沙沙 */
  scrape(ctx, out, when, v) {
    texture(ctx, out, when, { f: 1900 * v.pitch, q: 1.4, dur: v.dur, g: 0.2 * v.gain, a: 0.05, r: 0.12, grain: 0.07, depth: 0.85 }, v.rnd)
  },
  /** 掏果瓤：湿湿软软的一下 */
  squish(ctx, out, when, v) {
    burst(ctx, out, when, { type: 'lowpass', f: 520, q: 0.8, a: 0.02, d: 0.24 * v.dur, g: 0.22 * v.gain }, v.rnd)
    tone(ctx, out, when, { type: 'triangle', f: 180, f2: 90, glide: 0.2, a: 0.01, d: 0.2, g: 0.06 * v.gain })
    for (let k = 0; k < 3; k++) bubble(ctx, out, when + 0.03 + v.rnd() * 0.2, 260 + v.rnd() * 240, 0.05 * v.gain)
  },
  /** 果瓤落进碗里：软的一下，碗嗡一声 */
  bowl(ctx, out, when, v) {
    VOICES.thud(ctx, out, when, { ...v, pitch: 1.15 })
    tone(ctx, out, when, { f: 1650, d: 0.3, g: 0.012 * v.gain })
    tone(ctx, out, when, { f: 2710, d: 0.18, g: 0.006 * v.gain })
  },
  /** 晒干的皮、折皮：细碎的窸窣 */
  crinkle(ctx, out, when, v) {
    const n = Math.max(3, Math.round(24 * v.dur))
    for (let k = 0; k < n; k++) {
      const t = when + v.rnd() * v.dur
      burst(ctx, out, t, { type: 'highpass', f: 2400 + v.rnd() * 3000, q: 0.7, d: 0.004 + v.rnd() * 0.01, g: (0.03 + v.rnd() * 0.06) * v.gain }, v.rnd)
    }
  },
  /** 沙沙：篮里的果挪动、叶子、竹筛上一筛果滚一下 */
  rustle(ctx, out, when, v) {
    texture(ctx, out, when, { f: 2600 * v.pitch, q: 0.6, dur: v.dur, g: 0.1 * v.gain, a: 0.08, r: v.dur * 0.35, grain: 0.04, depth: 0.8 }, v.rnd)
  },
  /** 秤砣的绳顺着秤杆挪：细的摩擦声 */
  slide(ctx, out, when, v) {
    texture(ctx, out, when, { f: 1150 * v.pitch, f2: 1300 * v.pitch, q: 5, dur: v.dur, g: 0.3 * v.gain, a: 0.06, r: 0.1, grain: 0.05, depth: 0.5 }, v.rnd)
  },
  /** 切药刀切压果：脆的一下，落在木座上 */
  chop(ctx, out, when, v) {
    burst(ctx, out, when, { type: 'highpass', f: 2200, q: 0.7, d: 0.025, g: 0.09 * v.gain }, v.rnd)
    tone(ctx, out, when + 0.004, { f: 240 * v.pitch, f2: 205 * v.pitch, glide: 0.05, d: 0.09, g: 0.14 * v.gain })
    burst(ctx, out, when + 0.004, { type: 'lowpass', f: 900, q: 0.7, d: 0.04, g: 0.1 * v.gain }, v.rnd)
  },
  /** 红头绳拉过、绕过 */
  rope(ctx, out, when, v) {
    texture(ctx, out, when, { f: 950, f2: 1300, q: 1.6, dur: v.dur, g: 0.2 * v.gain, a: 0.1, r: 0.2, grain: 0.045, depth: 0.7 }, v.rnd)
  },
  /** 结勒紧：一下摩擦，带一点吱 */
  cinch(ctx, out, when, v) {
    texture(ctx, out, when, { f: 1300, q: 2, dur: 0.22, g: 0.22 * v.gain, a: 0.03, r: 0.08, grain: 0.03, depth: 0.5 }, v.rnd)
    tone(ctx, out, when + 0.12, { f: 1100, f2: 1450, glide: 0.06, a: 0.01, d: 0.06, g: 0.02 * v.gain })
  },
  /** 玻璃罐盖盖上：几个不成谐音的泛音，叮一声慢慢散 */
  clink(ctx, out, when, v) {
    const k = 0.97 + 0.06 * v.rnd()
    const parts: [number, number, number][] = [
      [1320, 0.9, 0.03],
      [2210, 0.7, 0.02],
      [3530, 0.5, 0.013],
      [5080, 0.35, 0.007],
    ]
    for (const [f, d, g] of parts) tone(ctx, out, when, { f: f * k * v.pitch, d, g: g * v.gain })
    VOICES.thud(ctx, out, when, { ...v, gain: v.gain * 0.25, pitch: 2 })
  },
  /** 果子落进玻璃罐里：闷的一下，罐子轻轻应一声 */
  glass(ctx, out, when, v) {
    VOICES.thud(ctx, out, when, { ...v, pitch: 1.3 })
    tone(ctx, out, when, { f: 1240 * v.pitch, d: 0.35, g: 0.008 * v.gain })
    tone(ctx, out, when, { f: 2080 * v.pitch, d: 0.25, g: 0.005 * v.gain })
  },
  /** 标题卡上盖印：轻轻按下去的一声 */
  stamp(ctx, out, when, v) {
    tone(ctx, out, when, { f: 115, f2: 72, glide: 0.06, d: 0.12, g: 0.12 * v.gain })
    burst(ctx, out, when, { type: 'lowpass', f: 420, q: 0.7, d: 0.06, g: 0.1 * v.gain }, v.rnd)
  },
  /** 翻一页纸 */
  page(ctx, out, when, v) {
    burst(ctx, out, when, { f: 500, f2: 1300, q: 0.7, a: 0.22, d: 0.45, g: 0.11 * v.gain }, v.rnd)
    VOICES.crinkle(ctx, out, when + 0.15, { ...v, dur: 0.3, gain: v.gain * 0.35 })
  },
  /** 洒一把水在竹匾上：一阵细细的嗒嗒 */
  sprinkle(ctx, out, when, v) {
    burst(ctx, out, when, { f: 1200, f2: 2600, q: 0.8, a: 0.08, d: 0.25, g: 0.1 * v.gain }, v.rnd)
    for (let k = 0; k < 26; k++) {
      const t = when + 0.12 + v.rnd() * 0.45
      burst(ctx, out, t, { f: 3000 + v.rnd() * 2500, q: 2, d: 0.006, g: (0.05 + v.rnd() * 0.1) * v.gain }, v.rnd)
    }
  },
  /** 翻一面：带过一点风 */
  flip(ctx, out, when, v) {
    burst(ctx, out, when, { f: 700, f2: 1400, q: 0.8, a: 0.1, d: 0.2, g: 0.1 * v.gain }, v.rnd)
  },
  /** 热的东西刚放上去：一阵轻轻的嘶 */
  hiss(ctx, out, when, v) {
    texture(ctx, out, when, { f: 4200, q: 0.8, hp: 2000, dur: v.dur, g: 0.05 * v.gain, a: v.dur * 0.25, r: v.dur * 0.5, grain: 0.06, depth: 0.4 }, v.rnd)
  },
  /** 拉线开关：咔嗒 */
  click(ctx, out, when, v) {
    burst(ctx, out, when, { f: 2600, q: 2.5, d: 0.006, g: 0.45 * v.gain }, v.rnd)
    burst(ctx, out, when + 0.05, { f: 2100, q: 2.5, d: 0.008, g: 0.38 * v.gain }, v.rnd)
  },
} satisfies Record<string, VoiceFn>

export type SoundName = keyof typeof VOICES

// ———— 环境里一直在的声音：由引擎按节奏一个个放 ————

/** 一声鸟叫：两三个快速滑音 */
export function birdCall(ctx: BaseAudioContext, out: AudioNode, when: number, rnd: () => number, g: number) {
  const base = 2600 + rnd() * 1800
  const n = 2 + Math.floor(rnd() * 4)
  const shape = rnd()
  let t = when
  for (let k = 0; k < n; k++) {
    const d = 0.05 + rnd() * 0.07
    const f0 = base * (0.9 + 0.2 * rnd())
    const f1 = shape < 0.5 ? f0 * (1.25 + 0.3 * rnd()) : f0 * (0.7 + 0.15 * rnd())
    tone(ctx, out, t, { f: f0, f2: f1, glide: d, a: 0.008, d, g: g * (0.7 + 0.3 * rnd()) })
    t += d + 0.03 + rnd() * 0.08
  }
}

/** 蛐蛐一声：载波上开关三四下 */
export function cricketChirp(ctx: BaseAudioContext, out: AudioNode, when: number, f: number, g: number, pulses: number) {
  const osc = ctx.createOscillator()
  osc.frequency.value = f
  const gn = ctx.createGain()
  const p = gn.gain
  p.setValueAtTime(0, when)
  for (let k = 0; k < pulses; k++) {
    const t = when + k * 0.034
    p.setValueAtTime(0, t)
    p.linearRampToValueAtTime(g, t + 0.006)
    p.linearRampToValueAtTime(g * 0.7, t + 0.016)
    p.linearRampToValueAtTime(0, t + 0.022)
  }
  osc.connect(gn).connect(out)
  osc.start(when)
  osc.stop(when + pulses * 0.034 + 0.03)
}

/** 锅里一个水泡 */
export function boilBubble(ctx: BaseAudioContext, out: AudioNode, when: number, rnd: () => number, g: number) {
  bubble(ctx, out, when, 220 + rnd() * rnd() * 900, g * (0.5 + 0.5 * rnd()))
}

/** 柴火、炭火的一下噼啪 */
export function crackle(ctx: BaseAudioContext, out: AudioNode, when: number, rnd: () => number, g: number) {
  const n = rnd() < 0.3 ? 2 : 1
  for (let k = 0; k < n; k++) burst(ctx, out, when + k * (0.012 + rnd() * 0.02), { type: 'highpass', f: 1600 + rnd() * 2600, q: 0.8, d: 0.003 + rnd() * 0.008, g: g * (0.4 + 0.6 * rnd()) }, rnd)
}

/** 一直响着的底：循环的噪声过一串滤波器 */
export function bed(ctx: BaseAudioContext, out: AudioNode, filters: [BiquadFilterType, number, number][]) {
  const s = ctx.createBufferSource()
  s.buffer = noiseBuffer(ctx)
  s.loop = true
  let node: AudioNode = s
  for (const [type, f, q] of filters) {
    const b = ctx.createBiquadFilter()
    b.type = type
    b.frequency.value = f
    b.Q.value = q
    node = node.connect(b)
  }
  const g = ctx.createGain()
  g.gain.value = 0
  node.connect(g).connect(out)
  s.start(0, Math.random() * 2.8)
  return g
}
