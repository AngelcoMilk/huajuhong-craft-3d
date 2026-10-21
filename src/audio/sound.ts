import { Vector3, type PerspectiveCamera } from 'three'
import { clamp, fbm1, rng } from '../util'
import { LAYOUT } from '../world/layout'
import { bed, birdCall, boilBubble, crackle, cricketChirp, VOICES, type SoundName } from './voices'

// 声音：跟着动画的时间 T 走。
// - 动作的声音（落水、下刀、刮、压板、打结……）是各段按自己的时间点报上来的"提示"，播到那一刻放一下；
//   拖进度、跳章节的时候不补放跳过去的。
// - 院子里一直在的声音（风、鸟、夜里的蛐蛐、锅里的水、灶火、焙炉的炭）按当时的状态调大小，
//   离镜头远就小、偏左偏右就往那边放。
// - 暂停时环境声收小一半；切到别的标签页就整个停。浏览器规定点过一下以后才能出声。

export interface SoundOpts {
  gain?: number
  pitch?: number
  dur?: number
  /** 在院子里哪儿响（不给就是镜头跟前） */
  at?: Vector3
}
export type AddSound = (t: number, name: SoundName, o?: SoundOpts) => void

export interface Cue {
  t: number
  name: SoundName
  gain: number
  pitch: number
  dur: number
  at: Vector3 | null
  seed: number
}

/** 院子里此刻的状态（导演每帧给） */
export interface Ambience {
  /** 锅里的水开到什么程度 0～1 */
  boil: number
  /** 灶火（压小了是 0.6） */
  fire: number
  /** 焙炉的炭火 0～1 */
  oven: number
  /** 白天、夜里 0～1 */
  day: number
  night: number
}

const v3 = (x: number, y: number, z: number) => new Vector3(x, y, z)
const SPOT = {
  wok: v3(LAYOUT.wok.x, LAYOUT.stoveTop - 6, LAYOUT.wok.z),
  stove: v3(LAYOUT.wok.x, 24, LAYOUT.stove.z + 43),
  oven: v3(LAYOUT.oven.x, 30, LAYOUT.oven.z),
  tree: v3(-322, 318, 52),
}

/** 一处声源：增益（远近）→ 左右 → 总线 */
class Spot {
  readonly input: GainNode
  private pan: StereoPannerNode
  constructor(ctx: AudioContext, out: AudioNode) {
    this.input = ctx.createGain()
    this.pan = ctx.createStereoPanner()
    this.input.connect(this.pan).connect(out)
  }
  set(g: number, pan: number, now: number) {
    this.input.gain.setTargetAtTime(g, now, 0.12)
    this.pan.pan.setTargetAtTime(pan, now, 0.12)
  }
}

export class Sound {
  muted = false
  private ctx: AudioContext | null = null
  private master!: GainNode
  private bus!: GainNode
  private amb!: GainNode
  private spots!: Record<keyof typeof SPOT, Spot>
  private beds!: Record<'air' | 'wind' | 'leaves' | 'simmer' | 'fire' | 'coals' | 'coalHiss', GainNode>
  private crickets: { pan: StereoPannerNode; f: number; next: number; every: number; pulses: number }[] = []
  private next = { bird: 0, bubble: 0, crackle: 0, coal: 0 }
  private rnd = rng(2027)
  private v = new Vector3()
  private live = false

  constructor(private cues: Cue[]) {
    this.cues.sort((a, b) => a.t - b.t)
    try {
      this.muted = localStorage.getItem('hjh-mute') === '1'
    } catch {
      /* 存不了就算了 */
    }
  }

  /** 第一次点（或按键）的时候建；切走标签页就停 */
  unlock() {
    if (!this.ctx) this.build()
    if (this.ctx && this.ctx.state === 'suspended' && !document.hidden) void this.ctx.resume()
  }
  suspend() {
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend()
  }

  setMuted(m: boolean) {
    this.muted = m
    try {
      localStorage.setItem('hjh-mute', m ? '1' : '0')
    } catch {
      /* 存不了就算了 */
    }
  }

  private build() {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return
    const ctx = (this.ctx = new AC({ latencyHint: 'playback' }))
    // 总线 → 收一点高频 → 只在偶尔叠得太响的时候压一下峰（门槛设高：压缩器会自己补增益，门槛低了整体都变响）→ 总音量
    this.master = ctx.createGain()
    this.master.gain.value = 0
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -8
    comp.knee.value = 4
    comp.ratio.value = 6
    comp.attack.value = 0.003
    comp.release.value = 0.2
    const soft = ctx.createBiquadFilter()
    soft.type = 'lowpass'
    soft.frequency.value = 9000
    soft.Q.value = 0.5
    this.bus = ctx.createGain()
    this.bus.connect(soft).connect(comp).connect(this.master).connect(ctx.destination)
    this.amb = ctx.createGain()
    this.amb.connect(this.bus)
    this.spots = {
      wok: new Spot(ctx, this.amb),
      stove: new Spot(ctx, this.amb),
      oven: new Spot(ctx, this.amb),
      tree: new Spot(ctx, this.amb),
    }
    this.beds = {
      air: bed(ctx, this.amb, [['lowpass', 260, 0.5]]),
      wind: bed(ctx, this.amb, [['bandpass', 650, 0.5], ['lowpass', 2200, 0.5]]),
      leaves: bed(ctx, this.spots.tree.input, [['bandpass', 3200, 0.7], ['highpass', 1500, 0.5]]),
      simmer: bed(ctx, this.spots.wok.input, [['bandpass', 1100, 0.6]]),
      fire: bed(ctx, this.spots.stove.input, [['lowpass', 170, 0.7]]),
      coals: bed(ctx, this.spots.oven.input, [['lowpass', 210, 0.7]]),
      coalHiss: bed(ctx, this.spots.oven.input, [['bandpass', 2600, 0.6]]),
    }
    // 两只蛐蛐，一左一右，叫得不一样快
    for (const [p, f, every, pulses] of [
      [-0.55, 4550, 0.62, 3],
      [0.5, 4300, 0.83, 4],
    ] as const) {
      const pan = ctx.createStereoPanner()
      pan.pan.value = p
      pan.connect(this.amb)
      this.crickets.push({ pan, f, next: 0, every, pulses })
    }
  }

  /** 放一个动作的声音 */
  private fire(c: Cue, when: number, cam: PerspectiveCamera) {
    const ctx = this.ctx!
    let out: AudioNode = this.bus
    let g = c.gain
    if (c.at) {
      const { gain, pan } = this.place(c.at, cam, 95)
      g *= gain
      if (g < 0.01) return
      const p = ctx.createStereoPanner()
      p.pan.value = pan
      p.connect(this.bus)
      out = p
    }
    VOICES[c.name](ctx, out, when, { gain: g, pitch: c.pitch, dur: c.dur, rnd: rng(c.seed) })
  }

  /** 离镜头多远、在画面哪边：远了小一点，偏左偏右往那边放一点 */
  private place(at: Vector3, cam: PerspectiveCamera, ref: number) {
    const p = this.v.copy(at).applyMatrix4(cam.matrixWorldInverse)
    const d = p.length()
    const gain = Math.pow(Math.min(1, ref / Math.max(d, 1)), 0.85)
    const half = Math.tan((cam.fov * Math.PI) / 360) * Math.max(Math.abs(p.z), 1) * cam.aspect
    const pan = clamp(p.x / half, -1, 1) * 0.55
    return { gain, pan }
  }

  /**
   * 每帧：T 从 prevT 走到 T（正常播放时）就把这中间的动作声放了；环境声跟着状态走。
   * 播放中按 lookahead 往前多排一点，排在准确的时刻上。
   */
  update(T: number, prevT: number, playing: boolean, started: boolean, speed: number, a: Ambience, cam: PerspectiveCamera, time: number) {
    const ctx = this.ctx
    if (!ctx || ctx.state !== 'running') return
    const now = ctx.currentTime
    const on = started && !this.muted
    this.master.gain.setTargetAtTime(on ? 1 : 0, now, on ? 0.6 : 0.08)
    if (!on) {
      this.live = false
      return
    }
    cam.updateMatrixWorld()
    cam.matrixWorldInverse.copy(cam.matrixWorld).invert()

    // 动作声：只在正常往前播的时候放（拖进度、跳章节不补放）
    const LOOK = 0.06
    const step = T - prevT
    if (playing && this.live && step >= 0 && step < 0.35) {
      const from = prevT + LOOK * speed
      const to = T + LOOK * speed
      for (const c of this.cues) {
        if (c.t <= from) continue
        if (c.t > to) break
        this.fire(c, now + Math.max(0, (c.t - T) / speed), cam)
      }
    }
    this.live = playing

    // 环境声
    this.amb.gain.setTargetAtTime(playing ? 1 : 0.5, now, 0.4)
    const gust = 0.55 + 0.45 * (fbm1(time * 0.11 + 4) * 0.5 + 0.5)
    const set = (g: GainNode, x: number) => g.gain.setTargetAtTime(x, now, 0.25)
    const day = a.day
    set(this.beds.air, 0.09)
    set(this.beds.wind, (0.05 + 0.03 * day) * gust)
    set(this.beds.leaves, 0.085 * gust * (0.4 + 0.6 * day))
    set(this.beds.simmer, 0.09 * Math.pow(a.boil, 1.4))
    set(this.beds.fire, 0.2 * a.fire)
    set(this.beds.coals, 0.22 * a.oven)
    set(this.beds.coalHiss, 0.04 * a.oven)
    const place = (k: keyof typeof SPOT, ref: number) => {
      const { gain, pan } = this.place(SPOT[k], cam, ref)
      this.spots[k].set(gain, pan, now)
      return gain
    }
    const gWok = place('wok', 110)
    const gStove = place('stove', 120)
    const gOven = place('oven', 100)
    place('tree', 260)

    // 一个个放的：水泡、噼啪、鸟、蛐蛐（往前排 0.15 秒）
    const AHEAD = now + 0.15
    const r = this.rnd
    const N = this.next
    const due = (k: keyof typeof N, every: number, live: boolean, emit: (t: number) => void) => {
      if (N[k] < now) N[k] = now + r() * every
      while (N[k] < AHEAD) {
        if (live) emit(N[k])
        N[k] += every * (0.3 + 1.4 * r())
      }
    }
    const boilRate = 1 + 26 * Math.pow(a.boil, 1.5)
    due('bubble', 1 / boilRate, gWok > 0.03, (t) => boilBubble(ctx, this.spots.wok.input, t, r, 0.015 + 0.015 * a.boil))
    due('crackle', 1 / (0.4 + 2.2 * a.fire), gStove > 0.03 && a.fire > 0, (t) => crackle(ctx, this.spots.stove.input, t, r, 0.022 * a.fire))
    due('coal', 1 / (0.2 + 1.6 * a.oven), gOven > 0.03 && a.oven > 0.05, (t) => crackle(ctx, this.spots.oven.input, t, r, 0.025 * a.oven))
    due('bird', 1 / (0.05 + 0.4 * day), day > 0.15, (t) => {
      const p = ctx.createStereoPanner()
      p.pan.value = (r() * 2 - 1) * 0.7
      p.connect(this.amb)
      birdCall(ctx, p, t, r, 0.02 * day)
    })
    if (a.night > 0.05) {
      for (const c of this.crickets) {
        if (c.next < now) c.next = now + r() * c.every
        while (c.next < AHEAD) {
          cricketChirp(ctx, c.pan, c.next, c.f, 0.0085 * a.night, c.pulses)
          c.next += c.every * (0.9 + 0.2 * r())
        }
      }
    }
  }
}

/** 把各段报上来的声音收成一张表（时间换成整条线上的） */
export function collectCues(acts: { start: number; sounds(add: AddSound): void }[], extra: (add: AddSound) => void) {
  const cues: Cue[] = []
  let seed = 1
  const at0 = (start: number): AddSound => (t, name, o = {}) =>
    cues.push({ t: start + t, name, gain: o.gain ?? 1, pitch: o.pitch ?? 1, dur: o.dur ?? 0.5, at: o.at ?? null, seed: seed++ * 7919 })
  for (const a of acts) a.sounds(at0(a.start))
  extra(at0(0))
  return cues
}
