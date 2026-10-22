import { Color, PCFSoftShadowMap, PerspectiveCamera, Vector2, Vector3, WebGLRenderer } from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { LIGHTS } from './gfx/env'
import { Post, type PostParams } from './gfx/post'
import { SHARED } from './world/materials'
import { World } from './world/world'
import { installShot } from './shot'

// 调试：整个院子，?view=x,y,z,tx,ty,tz 指定机位，?light= 指定时辰

export function startWorldLab(canvas: HTMLCanvasElement) {
  document.getElementById('stage')!.style.inset = '0'
  const renderer = new WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' })
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = PCFSoftShadowMap
  const world = new World(renderer)
  const q = new URLSearchParams(location.search)
  const camera = new PerspectiveCamera(Number(q.get('fov') ?? 40), 16 / 9, 2, 30000)
  const v = (q.get('view') ?? '120,260,520,0,90,-120').split(',').map(Number)
  camera.position.set(v[0], v[1], v[2])
  const controls = new OrbitControls(camera, canvas)
  controls.target.set(v[3], v[4], v[5])
  controls.update()
  const post = new Post(renderer)
  const light = (q.get('light') ?? 'forenoon') as keyof typeof LIGHTS
  const params: PostParams = {
    focus: 300, aperture: Number(q.get('ap') ?? 0.05), maxCoc: 8, bloom: 0.25, exposure: 1, lift: 0.1, vignette: 0.3, grain: 0.03, sat: 1.05,
    shadowTint: new Color('#6E6278'), warm: new Color('#FFF0D8'), haze: new Vector3(), hazeR: new Vector2(0.1, 0.1), fade: 0, fadeColor: new Color('#F2E9D8'),
  }
  const w = world
  w.stove.steam.set(new Vector3(-262, 80 - 4.5, -255), 0.8)
  w.stove.waterU.uBoil.value = 0.9
  w.hero.group.position.copy(w.table.heroSlot)
  w.bundle.update(0, 0, null)
  w.table.topBoard.position.set(60, 79.2, -10)
  w.table.stone.position.set(80, 78, -12)
  w.drops.begin()
  w.drops.end()
  w.shavings.begin()
  w.shavings.end()
  w.heroSteam.set(new Vector3(), 0)
  function resize() {
    const cw = canvas.clientWidth
    const ch = canvas.clientHeight
    const dpr = Math.min(devicePixelRatio, 1.5)
    renderer.setPixelRatio(dpr)
    renderer.setSize(cw, ch, false)
    post.setSize(cw * dpr, ch * dpr)
    camera.aspect = cw / ch
    camera.updateProjectionMatrix()
  }
  addEventListener('resize', resize)
  resize()
  const t0 = performance.now()
  const frame = () => {
    const time = (performance.now() - t0) / 1000
    SHARED.uTime.value = time
    SHARED.uSunDir.value.copy(LIGHTS[light].sun)
    SHARED.uSunCol.value.copy(LIGHTS[light].sunColor)
    controls.update()
    w.env.setShadowFocus(controls.target, Number(q.get('sr') ?? 500))
    w.env.apply(LIGHTS[light], time)
    w.dust.set(controls.target, 0.6)
    params.focus = camera.position.distanceTo(controls.target)
    params.exposure = w.env.state.exposure
    params.lift = w.env.state.lift
    params.warm.copy(w.env.state.warm)
    post.render(w.scene, camera, params, time)
  }
  renderer.setAnimationLoop(frame)
  installShot(canvas, frame)
  ;(window as unknown as { cam: unknown }).cam = { camera, controls }
}
