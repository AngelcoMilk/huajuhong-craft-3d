import { Color, InstancedMesh, Object3D, PCFSoftShadowMap, PerspectiveCamera, Vector2, Vector3, WebGLRenderer } from 'three'
import { Sound } from './audio/sound'
import { Director } from './director'
import { Post, type PostParams } from './gfx/post'
import { LINES } from './lines'

// ?look=1|2 三档调子（0 或不给是原来的样子）。只动后处理的调色，不碰灯光、材质和构图，
// 所以三档之间可以来回对着看，选定一档再写死。
// 变化的方向：暗部压得更实（lift↓）、高光多溢一点（bloom↑）、暗角略重、饱和略收
const LOOKS = [
  { lift: 1, bloom: 1, exposure: 1.12, sat: 1.07, vignette: 0.34 },
  { lift: 0.62, bloom: 1.2, exposure: 1.14, sat: 0.99, vignette: 0.4 },
  { lift: 0.45, bloom: 1.5, exposure: 1.18, sat: 0.93, vignette: 0.46 },
] as const
let LOOK: (typeof LOOKS)[number] = LOOKS[0]
import type { LineDef } from './lines/types'
import { installShot } from './shot'
import { UI, type UIHost } from './ui/ui'
import { clamp } from './util'
import { SHARED } from './world/materials'
import { World } from './world/world'

// 整个动画：16:9 舞台、渲染循环、播放控制。
// 网址参数：?line=qizhua|wuzhua|yaguo|tai 选哪一段（不带就是入口页，四段任选）。
// 调试参数：?t=秒 从某一刻开始，?speed=2 倍速，?debug 显示帧率，?autoplay 跳过封面

export class App implements UIHost {
  playing = false
  started = false
  speed = 1
  private T = 0
  private renderer: WebGLRenderer
  private camera = new PerspectiveCamera(35, 16 / 9, 1, 30000)
  private world: World
  private director: Director
  private sound: Sound
  private post: Post
  private ui: UI
  private stage: HTMLElement
  private canvas: HTMLCanvasElement
  private params: PostParams
  private mouse = new Vector2()
  private mouseS = new Vector2()
  private scale = 1
  private frameMs = 16
  private last = performance.now()
  private ambient = 0
  private fpsAcc = { n: 0, t: 0, ms: 0, k: 0, text: '' }
  private slow = 0
  private fast = 0
  private pendingScale = false

  private duration: number

  constructor(line: LineDef, chooser: boolean) {
    const q = new URLSearchParams(location.search)
    this.stage = document.getElementById('stage')!
    this.canvas = document.getElementById('gl') as HTMLCanvasElement
    this.renderer = new WebGLRenderer({ canvas: this.canvas, antialias: false, powerPreference: 'high-performance', stencil: false })
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = PCFSoftShadowMap
    this.world = new World(this.renderer, line.cast)
    this.director = new Director(this.world, line)
    this.duration = this.director.duration
    this.sound = new Sound(this.director.cues)
    const DURATION = this.duration
    this.post = new Post(this.renderer)
    this.params = {
      focus: 100,
      aperture: 0.1,
      maxCoc: 9,
      bloom: 0.22,
      exposure: 1,
      lift: 0.1,
      vignette: 0.34,
      grain: 0.022,
      sat: 1.07,
      shadowTint: new Color('#6E6278'),
      warm: new Color('#FFF0D8'),
      haze: new Vector3(),
      hazeR: new Vector2(0.1, 0.1),
      fade: 0,
      fadeColor: new Color('#F2E9D8'),
    }
    LOOK = LOOKS[Math.min(2, Math.max(0, Math.round(Number(q.get('look') ?? 0)) || 0))]
    // ?ao=0 关掉环境光遮蔽（对比用），?ao=0.5 半强度
    this.post.aoStrength = Math.max(0, Math.min(1.5, Number(q.get('ao') ?? 0.7) || 0))
    const cards = chooser ? LINES.map((l) => ({ line: l, dur: l.ready ? l.acts(this.director.stage).reduce((a, b) => a + b.dur, 0) : 0 })) : null
    this.ui = new UI(document.getElementById('ui')!, this, q.has('debug'), this.director.story, cards)
    if (q.has('t')) this.T = clamp(Number(q.get('t')), 0, DURATION)
    if (q.has('speed')) this.speed = Number(q.get('speed')) || 1
    if (q.has('autoplay') || q.has('t')) {
      this.started = true
      this.playing = !q.has('pause')
    }

    addEventListener('resize', () => this.resize())
    addEventListener('pointermove', (e) => {
      const r = this.stage.getBoundingClientRect()
      this.mouse.set(clamp(((e.clientX - r.left) / r.width) * 2 - 1, -1, 1), clamp(((e.clientY - r.top) / r.height) * 2 - 1, -1, 1))
    })
    document.addEventListener('visibilitychange', () => {
      this.last = performance.now()
      // 切走标签页声音整个停（画面不刷新，环境声不能自己一直响）
      if (document.hidden) this.sound.suspend()
      else if (this.started) this.sound.unlock()
    })
    // 浏览器规定点过（按过键）以后才能出声：第一次点的时候把声音建起来
    const unlock = () => this.sound.unlock()
    addEventListener('pointerdown', unlock, { capture: true })
    addEventListener('keydown', unlock, { capture: true })
    this.resize()
    this.warmUp()
    this.renderer.setAnimationLoop(() => this.tick())
    installShot(this.canvas, () => this.render(0))
    ;(window as unknown as { __seek: (t: number) => void }).__seek = (t: number) => {
      this.started = true
      this.seek(t)
    }
    ;(window as unknown as { __world: World }).__world = this.world
    ;(window as unknown as { __acts: unknown }).__acts = this.director.acts.map((a) => [a.id, a.start, a.end])
    ;(window as unknown as { __sound: Sound }).__sound = this.sound
  }

  /**
   * 预热：开场前把场景里所有东西（包括这时候藏着的、镜头外的）都画一遍，着色器先编好、模型先传上显卡。
   * 不然镜头第一次转到一个新工位时要现编、现传，那一下会卡。
   */
  private warmUp() {
    for (const a of this.director.acts) a.prepare()
    this.director.update(this.T, 0, this.camera)
    const scene = this.world.scene
    const hidden: Object3D[] = []
    const culled: Object3D[] = []
    const empty: InstancedMesh[] = []
    scene.traverse((o) => {
      if (!o.visible) {
        hidden.push(o)
        o.visible = true
      }
      if (o.frustumCulled) {
        culled.push(o)
        o.frustumCulled = false
      }
      const im = o as InstancedMesh
      if (im.isInstancedMesh && im.count === 0) {
        empty.push(im)
        im.count = 1
      }
    })
    const r = this.renderer
    r.setRenderTarget(this.post.scene)
    r.render(scene, this.camera)
    r.setRenderTarget(null)
    for (const o of hidden) o.visible = false
    for (const o of culled) o.frustumCulled = true
    for (const im of empty) im.count = 0
  }

  play() {
    if (this.T >= this.duration - 0.05) this.T = 0
    this.started = true
    this.playing = true
  }
  pause() {
    this.playing = false
  }
  toggle() {
    if (this.playing) this.pause()
    else this.play()
  }
  seek(T: number) {
    this.T = clamp(T, 0, this.duration)
  }
  setSpeed(s: number) {
    this.speed = s
  }
  get muted() {
    return this.sound.muted
  }
  setMuted(m: boolean) {
    this.sound.setMuted(m)
    if (!m) this.sound.unlock()
  }

  private resize() {
    const W = innerWidth
    const H = innerHeight
    const aspect = 16 / 9
    let w = W
    let h = W / aspect
    if (h > H) {
      h = H
      w = H * aspect
    }
    const s = this.stage.style
    s.width = w + 'px'
    s.height = h + 'px'
    s.left = (W - w) / 2 + 'px'
    s.top = (H - h) / 2 + 'px'
    const ui = document.getElementById('ui')!
    ui.style.transform = `scale(${w / 1920})`
    this.renderer.setSize(w, h, false)
    this.applyScale(w, h)
  }

  /** 渲染分辨率：按帧时自适应，慢了降一点，快了升回来 */
  private applyScale(w = this.stage.clientWidth, h = this.stage.clientHeight) {
    const dpr = Math.min(devicePixelRatio, 2)
    // 舞台最多按 1920 宽渲染
    const cap = Math.min(1, 1920 / (w * dpr))
    const px = dpr * cap * this.scale
    this.renderer.setPixelRatio(px)
    this.renderer.setSize(w, h, false)
    this.post.setSize(w * px, h * px)
  }

  private render(dt: number) {
    const f = this.director.update(this.T, this.ambient, this.camera)
    if (!this.started) f.post.fade = 0.5
    const p = this.params
    const L = f.light
    p.focus = f.post.focus
    p.aperture = f.post.aperture * 0.8
    p.maxCoc = f.post.maxCoc
    p.fade = f.post.fade
    p.bloom = (f.post.bloom ?? 0.22) * LOOK.bloom
    p.exposure = L.exposure * LOOK.exposure
    p.lift = L.lift * 0.7 * LOOK.lift
    p.sat = LOOK.sat
    p.vignette = LOOK.vignette
    p.warm.copy(L.warm)
    if (f.post.haze) p.haze.copy(f.post.haze)
    if (f.post.hazeR) p.hazeR.copy(f.post.hazeR)
    this.post.render(this.world.scene, this.camera, p, this.ambient)
    this.ui.update(this.T, dt, { fps: this.fpsAcc.text })
  }

  private tick() {
    const now = performance.now()
    const rawDt = (now - this.last) / 1000
    const dt = Math.min(0.1, rawDt)
    this.last = now
    // 分辨率要变就在画这一帧之前变（改画布大小会把画布清空，画完再改会露出一帧黑）
    if (this.pendingScale) {
      this.pendingScale = false
      this.applyScale()
    }
    this.ambient += dt
    SHARED.uTime.value = this.ambient
    const prevT = this.T
    if (this.playing) {
      this.T += dt * this.speed
      if (this.T >= this.duration) {
        this.T = this.duration
        this.playing = false
      }
    }
    this.mouseS.lerp(this.mouse, 1 - Math.exp(-dt * 2.5))
    this.director.setMouse(this.mouseS.x, this.mouseS.y)
    this.render(dt)
    this.sound.update(this.T, prevT, this.playing, this.started, this.speed, this.director.frame.ambience, this.camera, this.ambient)

    // 帧时统计 + 自适应分辨率：每半秒看一次平均帧时（偶尔一下的大卡顿不算），连着慢 2 秒才降，连着快 5 秒才升
    const a = this.fpsAcc
    a.n++
    a.t += dt
    if (rawDt < 0.08) {
      a.ms += rawDt * 1000
      a.k++
    }
    if (a.t > 0.5) {
      const avg = a.k ? a.ms / a.k : this.frameMs
      this.frameMs = avg
      a.text = `${(a.n / a.t).toFixed(0)} fps  ${avg.toFixed(1)} ms  ×${this.scale.toFixed(2)}\nT ${this.T.toFixed(2)}`
      a.n = 0
      a.t = 0
      a.ms = 0
      a.k = 0
      this.slow = avg > 26 ? this.slow + 1 : 0
      this.fast = avg < 14 ? this.fast + 1 : 0
      const old = this.scale
      if (this.slow >= 4) {
        this.scale = Math.max(0.6, this.scale - 0.1)
        this.slow = 0
      } else if (this.fast >= 10 && this.scale < 1) {
        this.scale = Math.min(1, this.scale + 0.05)
        this.fast = 0
      }
      if (old !== this.scale) this.pendingScale = true
    }
  }
}
