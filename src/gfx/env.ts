import {
  BackSide,
  Color,
  DirectionalLight,
  FogExp2,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  PMREMGenerator,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  CircleGeometry,
  type WebGLRenderTarget,
  type WebGLRenderer,
} from 'three'
import { NOISE } from './glsl'
import { lerp, lerpColor } from '../util'

// 天空、太阳、天光、雾和环境反射。一天里的光用几套预设插值，晒的那一章太阳会走一整圈。

// 填充光（天光 + 环境反射）的系数。压下去，直射阳光就明确了：亮面亮、暗面真的暗，
// 影子也有形状。?fill=1.3 可以回到原来那种平一点的光，?fill=0.8 更硬。
const FILL = (() => {
  try {
    const v = Number(new URLSearchParams(location.search).get('fill'))
    return Number.isFinite(v) && v > 0 ? Math.min(2, v) : 1
  } catch {
    return 1
  }
})()

export interface LightState {
  sun: Vector3 // 指向太阳
  sunColor: Color
  sunI: number
  zenith: Color
  horizon: Color
  ground: Color
  hemiSky: Color
  hemiGround: Color
  hemiI: number
  envI: number
  fog: Color
  fogD: number
  cloud: number
  cloudLit: Color
  cloudShade: Color
  exposure: number
  warm: Color // 调色：亮部偏暖
  lift: number // 调色：暗部抬向影紫
}

const L = (o: {
  sun: [number, number, number]
  sunColor: string
  sunI: number
  zenith: string
  horizon: string
  ground: string
  hemiSky: string
  hemiGround: string
  hemiI: number
  envI: number
  fog: string
  fogD: number
  cloud: number
  cloudLit: string
  cloudShade: string
  exposure: number
  warm: string
  lift: number
}): LightState => ({
  ...o,
  sun: new Vector3(...o.sun).normalize(),
  sunColor: new Color(o.sunColor),
  zenith: new Color(o.zenith),
  horizon: new Color(o.horizon),
  ground: new Color(o.ground),
  hemiSky: new Color(o.hemiSky),
  hemiGround: new Color(o.hemiGround),
  fog: new Color(o.fog),
  cloudLit: new Color(o.cloudLit),
  cloudShade: new Color(o.cloudShade),
  warm: new Color(o.warm),
})

export const LIGHTS = {
  // 清早：太阳低，从右前方来，金黄
  morning: L({
    sun: [0.72, 0.36, 0.5], sunColor: '#FFD9AE', sunI: 3.4,
    zenith: '#5E9AD8', horizon: '#FBE7CE', ground: '#B9A894',
    hemiSky: '#B8C8E2', hemiGround: '#8A7A88', hemiI: 0.85, envI: 0.55,
    fog: '#E8DCCB', fogD: 0.00032, cloud: 0.42, cloudLit: '#FFF1DE', cloudShade: '#B9AFC2',
    exposure: 0.86, warm: '#FFF0D8', lift: 0.12,
  }),
  // 上午：亮一些，太阳高起来
  forenoon: L({
    sun: [0.5, 0.62, 0.6], sunColor: '#FFE8C8', sunI: 3.7,
    zenith: '#4F91D6', horizon: '#EFF3F2', ground: '#B4A795',
    hemiSky: '#BCD0EA', hemiGround: '#8E7F8A', hemiI: 0.8, envI: 0.55,
    fog: '#E2E1DA', fogD: 0.00028, cloud: 0.4, cloudLit: '#FFFFFF', cloudShade: '#B8B6C8',
    exposure: 0.83, warm: '#FFF3E2', lift: 0.1,
  }),
  noon: L({
    sun: [0.12, 0.93, 0.34], sunColor: '#FFF2DE', sunI: 3.9,
    zenith: '#4A8CD4', horizon: '#EBF1F4', ground: '#B6AA98',
    hemiSky: '#C0D3EC', hemiGround: '#8F808C', hemiI: 0.78, envI: 0.55,
    fog: '#E0E3E2', fogD: 0.00026, cloud: 0.38, cloudLit: '#FFFFFF', cloudShade: '#BCBACB',
    exposure: 0.80, warm: '#FFF4E6', lift: 0.1,
  }),
  afternoon: L({
    sun: [-0.56, 0.52, 0.6], sunColor: '#FFE1B8', sunI: 3.6,
    zenith: '#5791D2', horizon: '#F8E8D2', ground: '#B7A693',
    hemiSky: '#BCCBE4', hemiGround: '#8C7B88', hemiI: 0.8, envI: 0.55,
    fog: '#E6DCCD', fogD: 0.0003, cloud: 0.42, cloudLit: '#FFF4E4', cloudShade: '#BBB2C6',
    exposure: 0.83, warm: '#FFEFD6', lift: 0.11,
  }),
  golden: L({
    sun: [-0.72, 0.27, 0.6], sunColor: '#FFC48A', sunI: 3.3,
    zenith: '#7290C4', horizon: '#F6CB9E', ground: '#B09A88',
    hemiSky: '#AFB8DA', hemiGround: '#86707F', hemiI: 0.85, envI: 0.55,
    fog: '#EBCDAE', fogD: 0.00036, cloud: 0.46, cloudLit: '#FFD9AE', cloudShade: '#A99ABA',
    exposure: 0.88, warm: '#FFE6C4', lift: 0.13,
  }),
  dusk: L({
    sun: [-0.78, 0.1, 0.58], sunColor: '#FF9E62', sunI: 2.4,
    zenith: '#5B6E9E', horizon: '#F0A57C', ground: '#9C8478',
    hemiSky: '#959CC6', hemiGround: '#6F5A69', hemiI: 0.9, envI: 0.5,
    fog: '#D9A88E', fogD: 0.0004, cloud: 0.5, cloudLit: '#FFB98A', cloudShade: '#8A7898',
    exposure: 0.96, warm: '#FFDDB8', lift: 0.15,
  }),
  // 傍晚：太阳刚落，天还亮着，屋檐下的灯点起来
  evening: L({
    sun: [-0.8, 0.035, 0.55], sunColor: '#FF8C5A', sunI: 1.3,
    zenith: '#4C5A8C', horizon: '#E59674', ground: '#7E6B6C',
    hemiSky: '#7F86B5', hemiGround: '#5E4C5E', hemiI: 0.95, envI: 0.45,
    fog: '#B98C85', fogD: 0.00042, cloud: 0.52, cloudLit: '#F5A487', cloudShade: '#6E6386',
    exposure: 1.12, warm: '#FFD9B5', lift: 0.17,
  }),
  // 夜里：月光偏蓝、很弱，暖光靠炉火和屋檐下的灯泡（压果那一夜、橘红胎日夜烘）
  night: L({
    sun: [0.42, 0.62, -0.38], sunColor: '#A9BCE6', sunI: 0.42,
    zenith: '#111A30', horizon: '#2A3350', ground: '#1A1A22',
    hemiSky: '#3A4A78', hemiGround: '#1F1B26', hemiI: 0.42, envI: 0.22,
    fog: '#20263A', fogD: 0.00045, cloud: 0.3, cloudLit: '#56617F', cloudShade: '#1C2036',
    exposure: 1.6, warm: '#FFE2C4', lift: 0.1,
  }),
}
export type LightName = keyof typeof LIGHTS

export function cloneLight(a: LightState): LightState {
  return {
    ...a,
    sun: a.sun.clone(),
    sunColor: a.sunColor.clone(),
    zenith: a.zenith.clone(),
    horizon: a.horizon.clone(),
    ground: a.ground.clone(),
    hemiSky: a.hemiSky.clone(),
    hemiGround: a.hemiGround.clone(),
    fog: a.fog.clone(),
    cloudLit: a.cloudLit.clone(),
    cloudShade: a.cloudShade.clone(),
    warm: a.warm.clone(),
  }
}

export function mixLight(out: LightState, a: LightState, b: LightState, t: number) {
  out.sun.copy(a.sun).lerp(b.sun, t).normalize()
  for (const k of ['sunColor', 'zenith', 'horizon', 'ground', 'hemiSky', 'hemiGround', 'fog', 'cloudLit', 'cloudShade', 'warm'] as const)
    lerpColor(out[k], a[k], b[k], t)
  for (const k of ['sunI', 'hemiI', 'envI', 'fogD', 'cloud', 'exposure', 'lift'] as const) out[k] = lerp(a[k], b[k], t)
  return out
}

const SKY_FRAG = /* glsl */ `
uniform vec3 uSun, uSunColor, uZenith, uHorizon, uGround, uCloudLit, uCloudShade;
uniform float uTime, uCloud, uSunDisk;
varying vec3 vDir;
${NOISE}
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 sky = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.5));
  sky = mix(sky, uGround, smoothstep(0.0, -0.06, h));
  float mu = dot(d, uSun);
  float m = max(mu, 0.0);
  // 太阳周围的光晕，贴地平线时更暖更宽
  sky += uSunColor * (pow(m, 6.0) * 0.28 + pow(m, 48.0) * 0.5) * (1.0 + 0.6 * (1.0 - smoothstep(0.0, 0.4, uSun.y)));
  // 云
  if (h > -0.02) {
    vec2 p = d.xz / (max(h, 0.0) + 0.16) * 1.4 + vec2(uTime * 0.018, uTime * 0.006);
    float n = fbm2(p * 1.2) + 0.25 * fbm2(p * 4.0 + 3.0);
    float c = smoothstep(1.0 - uCloud, 1.0 - uCloud + 0.32, n * 0.95);
    float lit = smoothstep(-0.4, 1.0, mu);
    float edge = smoothstep(0.0, 0.6, c) * (1.0 - smoothstep(0.6, 1.0, c));
    vec3 cc = mix(uCloudShade, uCloudLit, 0.35 + 0.65 * lit);
    cc += uSunColor * edge * pow(m, 4.0) * 0.6;
    sky = mix(sky, cc, c * smoothstep(-0.02, 0.1, h) * 0.92);
  }
  // 日轮
  float ang = acos(clamp(mu, -1.0, 1.0));
  sky += uSunColor * smoothstep(0.03, 0.022, ang) * uSunDisk;
  gl_FragColor = vec4(sky, 1.0);
}
`

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}
`

function skyMaterial() {
  return new ShaderMaterial({
    uniforms: {
      uSun: { value: new Vector3(0, 1, 0) },
      uSunColor: { value: new Color() },
      uZenith: { value: new Color() },
      uHorizon: { value: new Color() },
      uGround: { value: new Color() },
      uCloudLit: { value: new Color() },
      uCloudShade: { value: new Color() },
      uTime: { value: 0 },
      uCloud: { value: 0.4 },
      uSunDisk: { value: 40 },
    },
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    side: BackSide,
    depthWrite: false,
    fog: false,
  })
}

export class Environment {
  readonly sky: Mesh
  readonly sun = new DirectionalLight('#ffffff', 3)
  readonly hemi = new HemisphereLight('#ffffff', '#888888', 0.8)
  readonly state: LightState = cloneLight(LIGHTS.morning)
  private envScene = new Scene()
  private envSky: Mesh
  private pmrem: PMREMGenerator
  private envRT: WebGLRenderTarget | null = null
  private lastEnvKey = ''
  private shadowFocus = new Vector3()
  private shadowRadius = 200

  constructor(renderer: WebGLRenderer, private scene: Scene) {
    this.sky = new Mesh(new SphereGeometry(18000, 48, 24), skyMaterial())
    this.sky.renderOrder = -10
    this.sky.frustumCulled = false
    scene.add(this.sky)

    const s = this.sun
    s.castShadow = true
    s.shadow.mapSize.set(2048, 2048)
    s.shadow.bias = -0.00025
    s.shadow.normalBias = 0.04
    s.shadow.radius = 2.5
    s.shadow.camera.near = 10
    s.shadow.camera.far = 4000
    scene.add(s, s.target, this.hemi)

    scene.fog = new FogExp2('#E8DCCB', 0.0003)

    // 环境反射用的小场景：同一个天空 + 一块地
    this.envSky = new Mesh(new SphereGeometry(100, 32, 16), skyMaterial())
    this.envScene.add(this.envSky)
    const ground = new Mesh(new CircleGeometry(100, 32), new MeshBasicMaterial({ color: '#9C8E84', side: BackSide }))
    ground.rotation.x = Math.PI / 2
    ground.position.y = -4
    this.envScene.add(ground)
    this.pmrem = new PMREMGenerator(renderer)
  }

  /** 阴影只罩住镜头关心的那一块，越近越清楚 */
  setShadowFocus(center: Vector3, radius: number) {
    this.shadowFocus.copy(center)
    // 半径分档（每档约大 19%）：镜头推拉时阴影贴图的纹素大小不跟着一直变，影子边缘就不会一直抖
    this.shadowRadius = Math.pow(2, Math.ceil(Math.log2(radius) * 4) / 4)
  }

  apply(st: LightState, time: number) {
    const s = this.state
    Object.assign(s, { sunI: st.sunI, hemiI: st.hemiI, envI: st.envI, fogD: st.fogD, cloud: st.cloud, exposure: st.exposure, lift: st.lift })
    s.sun.copy(st.sun)
    for (const k of ['sunColor', 'zenith', 'horizon', 'ground', 'hemiSky', 'hemiGround', 'fog', 'cloudLit', 'cloudShade', 'warm'] as const)
      s[k].copy(st[k])

    for (const mesh of [this.sky, this.envSky]) {
      const u = (mesh.material as ShaderMaterial).uniforms
      u.uSun.value.copy(s.sun)
      u.uSunColor.value.copy(s.sunColor)
      u.uZenith.value.copy(s.zenith)
      u.uHorizon.value.copy(s.horizon)
      u.uGround.value.copy(s.ground)
      u.uCloudLit.value.copy(s.cloudLit)
      u.uCloudShade.value.copy(s.cloudShade)
      u.uCloud.value = s.cloud
      u.uTime.value = time
    }
    ;(this.envSky.material as ShaderMaterial).uniforms.uSunDisk.value = 4

    const sun = this.sun
    sun.color.copy(s.sunColor)
    // 太阳贴近地平线时光变弱
    // 太阳提一档：亮面更亮，配上压低的填充光，明暗才拉得开——只压填充光只会整体变暗
    sun.intensity = s.sunI * 1.32 * Math.min(1, Math.max(0, s.sun.y + 0.04) * 6)
    // 阴影相机：中心按纹素对齐，减少挪动时影子边缘闪
    const r = this.shadowRadius
    const cam = sun.shadow.camera
    cam.left = -r
    cam.right = r
    cam.top = r
    cam.bottom = -r
    cam.updateProjectionMatrix()
    const texel = (2 * r) / sun.shadow.mapSize.x
    const f = this.shadowFocus
    const snapped = new Vector3(Math.round(f.x / texel) * texel, Math.round(f.y / texel) * texel, Math.round(f.z / texel) * texel)
    sun.target.position.copy(snapped)
    // 阴影只算焦点前后一段里的东西：特写时，刀、果子这些就在跟前的东西还有影子，
    // 头顶的屋檐、树这些远处的东西不往加工台上投大块的影子（用户：加工特写不要从上面打下来的硬影子）
    const dCam = Math.min(1500, Math.max(80, r * 3))
    sun.position.copy(snapped).addScaledVector(s.sun, dCam)
    sun.target.updateMatrixWorld()
    cam.near = Math.max(1, dCam - r * 2.2)
    cam.far = dCam + r * 2.5
    cam.updateProjectionMatrix()
    // 特写：影子淡一点、边软一点，只留一点体现立体感；远景照常
    const wide = Math.min(1, Math.max(0, (r - 60) / 140))
    sun.shadow.intensity = 0.55 + 0.33 * wide
    sun.shadow.radius = 6 - 3.5 * wide

    this.hemi.color.copy(s.hemiSky)
    this.hemi.groundColor.copy(s.hemiGround)
    this.hemi.intensity = s.hemiI * 0.7 * FILL

    const fog = this.scene.fog as FogExp2
    fog.color.copy(s.fog)
    fog.density = s.fogD

    // 环境反射只在天色变到下一档时才重算（每档 0.08）：光在两套预设之间过渡时不再每帧都重算——
    // 每算一次都要新开一块显存、画六个面再模糊，连着算就是一下下的卡
    const key = [s.sun.x, s.sun.y, s.sun.z, s.zenith.r, s.horizon.g, s.sunColor.b, s.cloud].map((v) => Math.round(v / 0.08)).join()
    if (key !== this.lastEnvKey) {
      this.lastEnvKey = key
      const prev = this.envRT
      this.envRT = this.pmrem.fromScene(this.envScene, 0, 0.1, 1000, { size: 128 })
      this.scene.environment = this.envRT.texture
      prev?.dispose()
    }
    this.scene.environmentIntensity = s.envI * 0.78 * FILL
  }
}
