import { BoxGeometry, Color, Mesh, PerspectiveCamera, PlaneGeometry, Scene, Vector2, Vector3, WebGLRenderer, PCFShadowMap } from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { Environment, LIGHTS } from './gfx/env'
import { Post, type PostParams } from './gfx/post'
import { cementMat, woodMat, SHARED } from './world/materials'
import { Peel, setLook } from './world/peel'

// 调试用的小场景：?lab=状态名，看果皮单独某一步的样子，可以拖动转着看

export function startLab(canvas: HTMLCanvasElement, mode: string) {
  document.getElementById('stage')!.style.inset = '0'
  const renderer = new WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' })
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = PCFShadowMap
  renderer.autoClear = true
  const scene = new Scene()
  const camera = new PerspectiveCamera(32, 16 / 9, 0.5, 30000)
  const q = new URLSearchParams(location.search)
  // ?cam=距离,方位角,仰角（度）
  const [dist, az, el] = (q.get('cam') ?? '55,40,38').split(',').map(Number)
  const ty = Number(q.get('ty') ?? 80)
  const ar = (az * Math.PI) / 180
  const er = (el * Math.PI) / 180
  camera.position.set(Math.cos(er) * Math.sin(ar) * dist, ty + Math.sin(er) * dist, Math.cos(er) * Math.cos(ar) * dist)
  const controls = new OrbitControls(camera, canvas)
  controls.target.set(0, ty, 0)
  controls.update()

  const env = new Environment(renderer, scene)
  const post = new Post(renderer)

  const ground = new Mesh(new PlaneGeometry(6000, 6000), cementMat())
  ground.rotation.x = -Math.PI / 2
  ground.receiveShadow = true
  scene.add(ground)
  const table = new Mesh(new BoxGeometry(120, 6, 70), woodMat({ axis: 'x', plank: 17.5 }))
  table.position.set(0, 75, 0)
  table.castShadow = table.receiveShadow = true
  scene.add(table)

  const peel = new Peel(undefined, Number(q.get('petals') ?? 7))
  peel.group.position.set(0, 78, 0)
  scene.add(peel.group)
  const st = peel.state
  const look = { blanch: 0, wetGloss: 0, dry: 0, soak: 0, product: 0, fuzz: 1, press: 0 }
  const all = (a: Float32Array, v: number) => a.fill(v)
  switch (mode) {
    case 'blanch':
      look.blanch = 1
      look.wetGloss = 1
      look.fuzz = 0.4
      break
    case 'cut':
      look.blanch = 1
      look.fuzz = 0.5
      all(st.cut, 1)
      st.cut[6] = 0.5
      break
    case 'half':
      look.blanch = 1
      look.fuzz = 0.5
      all(st.cut, 1)
      all(st.open, 0.5)
      st.cap = 0.4
      break
    case 'open':
      look.blanch = 1
      look.fuzz = 0.5
      all(st.cut, 1)
      all(st.open, 1)
      st.cap = 1
      peel.pulp.visible = false
      break
    case 'scrape':
      look.blanch = 1
      look.fuzz = 0.5
      all(st.cut, 1)
      all(st.open, 1)
      st.cap = 1
      st.scrape.set([1, 1, 1, 0.6, 0.3, 0, 0])
      st.hub = 1
      peel.pulp.visible = false
      break
    case 'dry':
      look.blanch = 1
      look.dry = 1
      look.fuzz = 0.5
      all(st.cut, 1)
      all(st.open, 1)
      st.cap = 1
      all(st.scrape, 1)
      st.hub = 1
      st.dry = 1
      st.shrink = 1
      peel.pulp.visible = false
      break
    case 'fold':
      look.blanch = 1
      look.dry = 1
      look.soak = 1
      look.fuzz = 0.5
      all(st.cut, 1)
      all(st.open, 1)
      st.cap = 1
      all(st.scrape, 1)
      st.hub = 1
      st.dry = 1
      st.soak = 1
      st.shrink = 1
      st.fold = 0.6
      peel.pulp.visible = false
      break
    case 'final':
      look.blanch = 1
      look.dry = 1
      look.product = 1
      look.fuzz = 0.8
      look.press = 1
      all(st.cut, 1)
      all(st.open, 1)
      st.cap = 1
      all(st.scrape, 1)
      st.hub = 1
      st.dry = 1
      st.soak = 1
      st.shrink = 1
      st.fold = 1
      st.press = 1
      peel.pulp.visible = false
      break
  }
  if (q.has('o')) all(st.open, Number(q.get('o')))
  if (q.has('cap')) st.cap = Number(q.get('cap'))
  if (q.has('nopulp')) peel.pulp.visible = false
  if (q.has('f')) st.fold = Number(q.get('f'))
  if (q.has('p')) st.press = Number(q.get('p'))
  setLook(peel.material, look)
  peel.update()

  const params: PostParams = {
    focus: 50,
    aperture: 0.25,
    maxCoc: 8,
    bloom: 0.2,
    exposure: 1,
    lift: 0.1,
    vignette: 0.3,
    grain: 0.03,
    sat: 1.05,
    shadowTint: new Color('#6E6278'),
    warm: new Color('#FFF0D8'),
    haze: new Vector3(),
    hazeR: new Vector2(0.1, 0.1),
    fade: 0,
    fadeColor: new Color('#F2E9D8'),
  }
  const light = (q.get('light') ?? 'forenoon') as keyof typeof LIGHTS

  function resize() {
    const w = canvas.clientWidth
    const h = canvas.clientHeight
    const dpr = Math.min(devicePixelRatio, 1.5)
    renderer.setPixelRatio(dpr)
    renderer.setSize(w, h, false)
    post.setSize(w * dpr, h * dpr)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  }
  addEventListener('resize', resize)
  resize()

  const t0 = performance.now()
  renderer.setAnimationLoop(() => {
    const time = (performance.now() - t0) / 1000
    SHARED.uTime.value = time
    controls.update()
    env.setShadowFocus(controls.target, 40)
    env.apply(LIGHTS[light], time)
    params.focus = camera.position.distanceTo(controls.target)
    params.exposure = env.state.exposure
    params.lift = env.state.lift
    params.warm.copy(env.state.warm)
    post.render(scene, camera, params, time)
  })
}
