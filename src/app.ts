import { Color, InstancedMesh, Object3D, PCFSoftShadowMap, PerspectiveCamera, Vector2, Vector3, WebGLRenderer, type BufferGeometry, type Material, type Mesh, type Texture } from 'three'
import { Sound } from './audio/sound'
import { Director } from './director'
import { Post, type PostParams } from './gfx/post'
import { findLine, LINES } from './lines'
import { LIGHTS, mixLight, type LightName } from './gfx/env'

// ?look=1|2 三档调子（0 或不给是原来的样子）。只动后处理的调色，不碰灯光、材质和构图，
// 所以三档之间可以来回对着看，选定一档再写死。
// 变化的方向：暗部压得更实（lift↓）、高光多溢一点（bloom↑）、暗角略重、饱和略收
const LOOKS = [
  { lift: 1, bloom: 1, exposure: 1.12, sat: 1.07, vignette: 0.34 },
  { lift: 0.62, bloom: 1.2, exposure: 1.14, sat: 0.99, vignette: 0.4 },
  { lift: 0.45, bloom: 1.5, exposure: 1.18, sat: 0.93, vignette: 0.46 },
] as const
let LOOK: (typeof LOOKS)[number] = LOOKS[0]
import type { LineDef, LineId } from './lines/types'
import { installShot } from './shot'
import { UI, type Mode, type UIHost } from './ui/ui'
import { clamp, lerp } from './util'
import { SHARED } from './world/materials'
import { World } from './world/world'

// 整个动画：16:9 舞台、渲染循环、播放控制、换线。
// 网址参数：?line=qizhua|wuzhua|yaguo|tai 直接打开某一条线（先看封面）；不带就是入口页，四种做法任选。
// 在入口页选了以后不换网页：盖一张纸，纸后面把院子换成那条线的，纸揭开就开演；地址栏照样变，后退能回入口页。
// 调试参数：?t=秒 从某一刻开始，?speed=2 倍速，?debug 显示帧率，?autoplay 跳过封面

/** 入口页、封面上的院子：虚焦、淡淡一层纸 */
const COVER_POST = { fade: 0.14, focus: 2, aperture: 1.2, maxCoc: 13 }
/** 入口页悬停某种做法时院子偏向的时辰 */
const MOODS: Record<LineId, LightName> = { qizhua: 'morning', wuzhua: 'forenoon', yaguo: 'evening', tai: 'golden' }

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

export class App implements UIHost {
  playing = false
  started = false
  speed = 1
  mode: Mode
  private line!: LineDef
  private T = 0
  private renderer: WebGLRenderer
  private camera = new PerspectiveCamera(35, 16 / 9, 1, 30000)
  private world!: World
  private director!: Director
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
  private duration = 0
  /** 0 = 入口页、封面（虚焦、淡纸）；1 = 片子本身。开演时缓过去 */
  private blend = 0
  /** 入口页上悬停的那一种 */
  private hovered: LineId | null = null
  /** 正在换线（纸盖着），这时候别的操作先不理 */
  private busy = false
  /** 换线途中按了后退/前进，换完再照地址栏对一次 */
  private routePending = false
  /** 从封面点了开始，再过这么多秒才开始走 */
  private startIn = 0

  constructor(line: LineDef, mode: Mode) {
    const q = new URLSearchParams(location.search)
    this.mode = mode
    this.stage = document.getElementById('stage')!
    this.canvas = document.getElementById('gl') as HTMLCanvasElement
    this.renderer = new WebGLRenderer({ canvas: this.canvas, antialias: false, powerPreference: 'high-performance', stencil: false })
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = PCFSoftShadowMap
    this.sound = new Sound([])
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
    this.assemble(line)
    // 入口页上每种做法的时长：拿这个舞台把各线的段排一遍（段的构造只看主角，不建东西）
    const cards = LINES.map((l) => ({ line: l, dur: l.ready ? l.acts(this.director.stage).reduce((a, b) => a + b.dur, 0) : 0 }))
    this.ui = new UI(document.getElementById('ui')!, this, q.has('debug'), cards)
    this.install()
    if (q.has('t')) this.T = clamp(Number(q.get('t')), 0, this.duration)
    if (q.has('speed')) this.speed = Number(q.get('speed')) || 1
    if (q.has('autoplay') || q.has('t')) {
      this.mode = 'play'
      this.started = true
      this.playing = !q.has('pause')
      this.blend = 1
    }
    this.ui.setMode(this.mode)
    history.replaceState({ line: this.mode === 'choose' ? null : line.id }, '')
    // 浏览器前进后退：换线换到一半的时候先记着，换完再对一次
    addEventListener('popstate', () => {
      if (this.busy) this.routePending = true
      else this.sync()
    })

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
    this.renderer.setAnimationLoop(() => this.tick())
    installShot(this.canvas, () => this.render(0))
    ;(window as unknown as { __seek: (t: number) => void }).__seek = (t: number) => {
      this.mode = 'play'
      this.ui.setMode('play')
      this.started = true
      this.blend = 1
      this.seek(t)
    }
    ;(window as unknown as { __sound: Sound }).__sound = this.sound
    ;(window as unknown as { __app: App }).__app = this
  }

  /** 把一条线搭起来：院子、导演、声音、台本；旧的院子先拆掉还显存 */
  private build(line: LineDef) {
    this.disposeWorld(this.world)
    this.assemble(line)
    this.install()
  }

  private assemble(line: LineDef) {
    this.line = line
    this.world = new World(this.renderer, line.cast)
    this.director = new Director(this.world, line)
    this.duration = this.director.duration
  }

  private install() {
    const line = this.line
    this.sound.setCues(this.director.cues)
    this.ui.setStory(this.director.story)
    this.T = 0
    this.warmUp()
    document.title = `${line.name} · 古法`
    ;(window as unknown as { __world: World }).__world = this.world
    ;(window as unknown as { __acts: unknown }).__acts = this.director.acts.map((a) => [a.id, a.start, a.end])
    ;(window as unknown as { __story: unknown }).__story = this.director.story
  }

  private disposeWorld(w: World) {
    const geos = new Set<BufferGeometry>()
    const mats = new Set<Material>()
    w.scene.traverse((o) => {
      const m = o as Mesh
      if (m.geometry) geos.add(m.geometry)
      if (m.material) for (const x of Array.isArray(m.material) ? m.material : [m.material]) mats.add(x)
    })
    for (const g of geos) g.dispose()
    for (const m of mats) {
      for (const v of Object.values(m)) if ((v as Texture | null)?.isTexture) (v as Texture).dispose()
      const u = (m as Material & { uniforms?: Record<string, { value: unknown }> }).uniforms
      if (u) for (const x of Object.values(u)) if ((x.value as Texture | null)?.isTexture) (x.value as Texture).dispose()
      m.dispose()
    }
    w.env.dispose()
    w.scene.clear()
  }

  // ———— 入口页、换线 ————

  hover(id: LineId | null) {
    this.hovered = id
  }

  choose(id: LineId) {
    const l = findLine(id)
    if (!l || this.busy) return
    const u = new URL(location.href)
    for (const k of ['t', 'pause', 'autoplay']) u.searchParams.delete(k)
    u.searchParams.set('line', id)
    history.pushState({ line: id, fromChooser: true }, '', u)
    void this.goLine(l, id)
  }

  home() {
    if (this.busy) return
    if ((history.state as { fromChooser?: boolean } | null)?.fromChooser) history.back()
    else {
      const u = new URL(location.href)
      for (const k of ['t', 'pause', 'autoplay', 'line']) u.searchParams.delete(k)
      history.pushState({ line: null }, '', u)
      void this.goHome()
    }
  }

  /** 照地址栏摆：带 ?line 的就演那一条，不带的回入口页 */
  private sync() {
    const l = findLine(new URLSearchParams(location.search).get('line'))
    if (l) {
      if (this.mode === 'choose' || l !== this.line) void this.goLine(l)
    } else if (this.mode !== 'choose') void this.goHome()
  }

  private done() {
    this.busy = false
    if (this.routePending) {
      this.routePending = false
      this.sync()
    }
  }

  /** 纸盖上 → 换院子 → 从头开演 → 纸揭开（画布这时正好也是整屏纸色） */
  private async goLine(line: LineDef, from: LineId | null = null) {
    if (this.busy) return
    this.busy = true
    this.playing = false
    await this.ui.curtainIn(from)
    if (line !== this.line) this.build(line)
    this.mode = 'play'
    this.ui.setMode('play')
    this.hovered = null
    this.director.mood.k = 0
    this.T = 0
    this.started = true
    this.blend = 1
    await wait(80)
    this.playing = true
    this.ui.quiet()
    await this.ui.curtainOut()
    this.done()
  }

  private async goHome() {
    if (this.busy) return
    this.busy = true
    this.playing = false
    await this.ui.curtainIn(null)
    this.mode = 'choose'
    this.ui.setMode('choose')
    this.started = false
    this.T = 0
    this.blend = 0
    await wait(80)
    await this.ui.curtainOut(800)
    this.done()
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
    if (this.busy || this.mode === 'choose') return
    if (this.T >= this.duration - 0.05) this.T = 0
    // 从封面开始：封面先淡掉、画面先铺成纸，再开始走（不然封面上的字和第一张题签叠在一起）
    if (!this.started) this.startIn = 0.75
    else this.playing = true
    this.mode = 'play'
    this.started = true
  }
  pause() {
    this.playing = false
  }
  toggle() {
    if (this.busy) return
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
    // 入口页：悬停哪一种，院子的光就往那一种的时辰偏过去
    const mood = this.director.mood
    const want = this.mode === 'choose' ? this.hovered : null
    if (want) mixLight(mood.light, mood.light, LIGHTS[MOODS[want]], mood.k < 0.02 ? 1 : 1 - Math.exp(-dt * 2.4))
    mood.k += ((want ? 1 : 0) - mood.k) * (1 - Math.exp(-dt * 2.2))
    const f = this.director.update(this.T, this.ambient, this.camera)
    this.blend += ((this.started ? 1 : 0) - this.blend) * (1 - Math.exp(-dt * 3.5))
    const b = this.blend
    const p = this.params
    const L = f.light
    p.focus = lerp(COVER_POST.focus, f.post.focus, b)
    p.aperture = lerp(COVER_POST.aperture, f.post.aperture * 0.8, b)
    p.maxCoc = lerp(COVER_POST.maxCoc, f.post.maxCoc, b)
    p.fade = lerp(COVER_POST.fade, f.post.fade, b)
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
    if (this.startIn > 0) {
      this.startIn -= dt
      if (this.startIn <= 0) this.playing = true
    }
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
