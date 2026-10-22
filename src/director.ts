import { Color, Euler, PerspectiveCamera, Vector2, Vector3, type Vector4 } from 'three'
import type { Act } from './acts/act'
import { collectCues, type Ambience, type Cue } from './audio/sound'
import { Blanch, STRAINER_REST_YAW } from './acts/blanch'
import { newCam, ShotList } from './camera'
import { cloneLight, LIGHTS, mixLight, type LightName, type LightState } from './gfx/env'
import type { PostParams } from './gfx/post'
import { resolveStory, type LineDef, type Story } from './lines/types'
import { P } from './palette'
import { Stage } from './stage'
import { clamp, fbm1, lerp, setCast, smoother, smoothstep } from './util'
import { LAYOUT } from './world/layout'
import { SHARED } from './world/materials'
import { setLook } from './world/peel'
import { setTaiLook } from './world/tai'
import { setCakeLook } from './world/cake'
import type { World } from './world/world'

// 导演：给一个时间 T（秒），把整个院子摆成那一刻的样子。
// 所有东西都是 T 的函数，所以可以随便拖进度、跳章节、倒着看。
// 一条线由几段（Act）接起来；章与章之间有一层纸色的"翻页"，镜头在这一下切到下一个工位，东西也在这一下挪过去。
//
// 每一帧：
// 1. 带下来的状态清回默认，按段的先后让每一段往上叠（锅开没开、皮割到哪、晒没晒……）
// 2. 能动的东西都放回原处
// 3. 正在演的那一段摆主角、工具、一批果、水汽水珠
// 4. 院子里一直在的东西（灶火、焙炉、灯）按带下来的状态亮；光、镜头、后期

const UP = new Vector3(0, 1, 0)

export interface Frame {
  post: Partial<PostParams> & { focus: number; aperture: number; maxCoc: number; fade: number }
  light: LightState
  chapter: number
  /** 院子里此刻的声音状态 */
  ambience: Ambience
}

export class Director {
  readonly stage: Stage
  readonly acts: Act[]
  readonly story: Story
  readonly duration: number
  private shotList = new ShotList()
  private lightKeys: [number, LightName][] = []
  private camS = newCam()
  private light = cloneLight(LIGHTS.morning)
  private mouse = new Vector2()
  readonly frame: Frame
  /** 整条线上的动作声音 */
  readonly cues: Cue[]
  /** 烫果那一段（篮子在它里面倒果，叶子要在这时飘出去） */
  private readonly blanch?: Blanch

  constructor(
    private w: World,
    line: LineDef,
  ) {
    this.stage = new Stage(w)
    this.acts = line.acts(this.stage)
    let t = 0
    for (const a of this.acts) {
      a.start = t
      t += a.dur
    }
    this.duration = t
    this.story = resolveStory(line, this.acts)
    for (const a of this.acts) {
      a.shots(this.shotList.adder(a.start))
      for (const [k, name] of a.lights()) this.lightKeys.push([a.start + k, name])
    }
    this.blanch = this.acts.find((a) => a instanceof Blanch)
    // 篮子里的叶子：按这条线的果堆摆一次
    this.w.leaves.build(this.stage)
    // 章节之间翻一页纸、标题卡上盖印；结尾那一页翻出来
    this.cues = collectCues(this.acts, (add) => {
      this.story.chapters.forEach((c, i) => {
        if (i > 0) add(c.start - 0.6, 'page', { gain: 0.8 })
        add((i === 0 ? 0.6 : c.start) + 1.22, 'stamp', { gain: 0.7 })
      })
      add(this.duration - 13.6, 'page', { gain: 0.7 })
      // 书页翻开、合上：比章节翻页轻
      for (const m of this.story.moments) {
        add(m.open + 0.05, 'page', { gain: 0.4 })
        add(m.close - 0.75, 'page', { gain: 0.22 })
      }
    })
    // 果瓤从果子里拎出来以后挂在场景上（不跟着果皮转）
    w.scene.attach(w.hero.pulp)
    this.frame = {
      post: { focus: 100, aperture: 0.1, maxCoc: 9, fade: 0 },
      light: this.light,
      chapter: 0,
      ambience: { boil: 0, fire: 1, oven: 0, day: 1, night: 0 },
    }
  }

  /** 入口页上悬停某种做法时，院子的光往那一种的时辰偏过去（k = 0 就是原样） */
  readonly mood = { light: cloneLight(LIGHTS.morning), k: 0 }

  setMouse(x: number, y: number) {
    this.mouse.set(x, y)
  }

  /** 正在演哪一段 */
  private actAt(T: number) {
    const A = this.acts
    for (let i = A.length - 1; i >= 0; i--) if (T >= A[i].start) return A[i]
    return A[0]
  }

  // ———— 能动的东西放回原处 ————

  private rest() {
    const w = this.w
    const L = LAYOUT
    const tb = w.table
    w.stove.strainer.position.set(-171, L.stoveTop + 0.05, -246)
    w.stove.strainer.quaternion.setFromEuler(new Euler(0, STRAINER_REST_YAW, 0, 'YXZ'))
    // 放着不用的笊篱不投影（下午斜阳会把它的长影子拖到焙炉竹筛上）
    setCast(w.stove.strainer, false)
    tb.knife.position.copy(tb.knifeRest.pos)
    tb.knife.quaternion.copy(tb.knifeRest.quat)
    tb.scraper.position.copy(tb.scraperRest.pos)
    tb.scraper.quaternion.copy(tb.scraperRest.quat)
    tb.topBoard.position.copy(tb.boardRest)
    // 顶板摆正盖住底下十片（转太多，角上那几片会露在板外）
    tb.topBoard.rotation.set(0, 0.04, 0)
    tb.stone.position.copy(tb.stoneRest)
    tb.stone.rotation.set(0, 0.4, 0)
    w.steelyard.set(0, 0)
    w.hero.pulp.visible = false
    w.batch.fruits.visible = false
    w.tai?.show(false)
    w.cakes?.show(false)
    if (w.cakes) {
      w.cakes.heroGroup.visible = true
      w.cakes.matHero.clippingPlanes = null
    }
    if (w.jar) {
      w.jar.group.visible = false
      w.jar.lid.visible = false
    }
    w.batch.hidePieces()
    w.bundle.group.visible = false
    w.batchSteam.set(w.batchSteam.mesh.position, 0)
    w.heroSteam.set(w.heroSteam.mesh.position, 0)
    ;(w.stove.waterU.uSplash.value as Vector4).w = 0
  }

  // ———— 光 ————

  private lightAt(T: number) {
    const ks = this.lightKeys
    let i = 0
    while (i < ks.length - 1 && T > ks[i + 1][0]) i++
    const [ta, a] = ks[i]
    const [tb, b] = ks[Math.min(i + 1, ks.length - 1)]
    const t = tb > ta ? smoother(clamp((T - ta) / (tb - ta))) : 0
    return mixLight(this.light, LIGHTS[a], LIGHTS[b], t)
  }

  /** 纸色遮罩：章节之间翻一页 */
  veil(T: number) {
    const C = this.story.chapters
    let f = 1 - smoothstep(0.2, 2.4, T)
    for (let i = 1; i < C.length; i++) {
      const b = C[i].start
      const up = smoothstep(b - 0.75, b - 0.05, T)
      const down = 1 - smoothstep(b + 1.5, b + 2.5, T)
      f = Math.max(f, Math.min(up, down) * 0.92)
    }
    f = Math.max(f, smoothstep(this.duration - 3.5, this.duration - 0.5, T) * 0.55)
    return f
  }

  // ———— 每帧 ————

  update(T: number, time: number, camera: PerspectiveCamera) {
    const w = this.w
    const s = this.stage
    const L = LAYOUT
    T = clamp(T, 0, this.duration)

    // 1. 带下来的状态
    s.reset()
    for (const a of this.acts) a.carry(T - a.start)
    w.hero.update()
    const k = s.look
    const fuzz = lerp(1, 0.45, k.blanch) + 0.2 * k.dry + 0.25 * k.product
    setLook(w.hero.material, { blanch: k.blanch, wetGloss: k.wet, dry: k.dry, soak: k.soak, product: k.product, fuzz, press: k.press })
    w.batch.syncLook(w.hero.material)
    if (w.tai) {
      // 小果：烫过的（含主角）跟着烫、湿；直接烘的一直是鲜果色；烘干两组一起变，缩一点
      const t = w.tai
      setTaiLook(t.matHero, { blanch: k.blanch, wet: k.wet, dry: k.dry, fuzz: 1 })
      setTaiLook(t.matBlanched, { blanch: k.blanch, wet: k.wet, dry: k.dry, fuzz: 1 })
      setTaiLook(t.matRaw, { blanch: 0, wet: 0, dry: k.dry, fuzz: 1 })
      t.shrink = 1 - 0.1 * k.dry
      t.setHeroLocal()
    }
    if (w.cakes) {
      // 压果：十个一起压扁、一起烘干
      const c = w.cakes
      c.press(k.press)
      setCakeLook(c.matHero, { blanch: k.blanch, wet: k.wet, dry: k.dry, press: k.press })
      setCakeLook(c.matOthers, { blanch: k.blanch, wet: k.wet, dry: k.dry, press: k.press })
      setCakeLook(c.matSlice, { blanch: k.blanch, wet: 0, dry: k.dry, press: k.press })
      setCakeLook(c.matSliceClip, { blanch: k.blanch, wet: 0, dry: k.dry, press: k.press })
    }

    // 2、3. 放回原处，再让正在演的那一段摆
    this.rest()
    for (const a of this.acts) a.hide()
    w.drops.begin()
    w.shavings.begin()
    const act = this.actAt(T)
    act.pose(T - act.start, time)
    w.drops.end()
    w.shavings.end()
    w.table.basket.position.copy(s.basketPos)
    w.table.basket.quaternion.copy(s.basketQuat)
    // 篮里的叶子：跟着篮子，倒果那一下脱开、飘落、淡出
    w.leaves.update(T, w.table.basket, this.blanch)

    // 4. 一直在的东西
    const c = s.carry
    w.stove.waterU.uBoil.value = c.boil
    w.stove.steam.set(new Vector3(L.wok.x, w.stove.waterY + 1, L.wok.z), 0.25 + c.boil * 0.85)
    // 灶火、炭火都是稳的：亮度不跳，火光不起伏（一跳，灶膛里、灶面上就一明一暗地闪）
    w.stove.fireI.value = c.fireLow ? 0.6 : 1
    w.stove.fireLight.intensity = c.fireLow ? 5000 : 9000
    w.oven.glowI.value = c.ovenOn
    w.oven.light.intensity = c.ovenOn * 4200
    w.oven.upLight.intensity = c.ovenOn * 3200
    w.oven.sparks.set(new Vector3(L.oven.x, L.ovenTop + 2, L.oven.z), c.ovenOn)
    const bulb = c.bulb
    w.yard.bulbMat.emissiveIntensity = bulb * 6
    w.yard.bulbLight.intensity = bulb * 26000
    w.yard.interiorLight.intensity = c.interior * 30000

    // 光
    const light = this.lightAt(T)
    if (this.mood.k > 0.001) mixLight(light, light, this.mood.light, this.mood.k)
    w.env.apply(light, time + c.lapse)
    SHARED.uSunDir.value.copy(light.sun)
    SHARED.uSunCol.value.copy(light.sunColor)
    SHARED.uWind.value = 0.8 + 0.4 * Math.sin(time * 0.13)

    // 镜头
    const cam = this.shotList.at(T, this.camS)
    const shake = cam.shake
    const az = cam.az + fbm1(time * 0.23 + 3) * 0.6 * shake + this.mouse.x * 2.2
    const el = cam.el + fbm1(time * 0.19 + 11) * 0.4 * shake - this.mouse.y * 1.4
    const ar = (az * Math.PI) / 180
    const er = (el * Math.PI) / 180
    const tgt = cam.target
    camera.position.set(tgt.x + Math.cos(er) * Math.sin(ar) * cam.dist, tgt.y + Math.sin(er) * cam.dist, tgt.z + Math.cos(er) * Math.cos(ar) * cam.dist)
    camera.up.copy(UP)
    camera.lookAt(tgt)
    camera.fov = cam.fov
    camera.near = clamp(cam.dist * 0.05, 0.5, 10)
    camera.far = 30000
    camera.updateProjectionMatrix()

    w.env.setShadowFocus(tgt, clamp(cam.dist * 0.75, 22, 420))
    w.dust.set(tgt, 0.55 * clamp(light.sun.y * 3))

    // 后期参数
    const f = this.frame
    const C = this.story.chapters
    f.chapter = Math.max(0, C.findIndex((ch) => T >= ch.start && T < ch.end))
    if (T >= this.duration) f.chapter = C.length - 1
    f.post.focus = camera.position.distanceTo(tgt)
    f.post.aperture = cam.ap
    f.post.maxCoc = 9
    f.post.fade = this.veil(T)
    f.post.bloom = c.bloom
    // 焙炉上的热浪
    if (c.haze > 0) {
      const p = new Vector3(L.oven.x, L.ovenTop + 10, L.oven.z).project(camera)
      const size = 18 / f.post.focus
      f.post.haze = new Vector3(p.x * 0.5 + 0.5, p.y * 0.5 + 0.5, c.haze * 0.9)
      f.post.hazeR = new Vector2(size * 0.9, size * 1.6)
    } else f.post.haze = new Vector3(0, 0, 0)
    f.post.fadeColor = PAPER
    // 声音：锅、灶火、焙炉按带下来的状态；白天夜里按太阳（月亮）有多亮
    const am = f.ambience
    am.boil = c.boil
    am.fire = c.fireLow ? 0.6 : 1
    am.oven = c.ovenOn
    am.day = smoothstep(1.8, 3.2, light.sunI)
    am.night = 1 - smoothstep(0.8, 2.6, light.sunI)
    return f
  }
}

const PAPER = new Color(P.paper)
