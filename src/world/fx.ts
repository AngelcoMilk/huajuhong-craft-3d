import {
  AdditiveBlending,
  Color,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshPhysicalMaterial,
  NormalBlending,
  Object3D,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  SphereGeometry,
  Vector2,
  Vector3,
  type BufferGeometry,
  type Material,
} from 'three'
import { NOISE } from '../gfx/glsl'
import { rng } from '../util'
import { SHARED } from './materials'

// 粒子：水汽、炊烟、火星、光里的灰尘。都在顶点着色器里按时间和种子现算位置，
// 所以倒带、跳章都不用模拟，画面一直在动（用的是常走的"环境时间"）。

export interface PuffOpts {
  count: number
  life: number
  rise: number
  spread: number
  size: number
  radius: number
  drift?: Vector3
  lit?: string
  shade?: string
  opacity?: number
  seed?: number
  nearFade?: [number, number]
}

export class Puffs {
  readonly mesh: Mesh
  readonly uniforms: Record<string, { value: unknown }>
  constructor(o: PuffOpts) {
    const base = new PlaneGeometry(1, 1)
    const g = new InstancedBufferGeometry()
    g.index = base.index
    g.setAttribute('position', base.attributes.position)
    g.setAttribute('uv', base.attributes.uv)
    const r = rng(o.seed ?? 7)
    const seeds = new Float32Array(o.count * 4)
    for (let i = 0; i < seeds.length; i++) seeds[i] = r()
    g.setAttribute('aSeed', new InstancedBufferAttribute(seeds, 4))
    g.instanceCount = o.count
    this.uniforms = {
      uTime: SHARED.uTime,
      uSunDir: SHARED.uSunDir,
      uSunCol: SHARED.uSunCol,
      uOrigin: { value: new Vector3() },
      uRadius: { value: o.radius },
      uLife: { value: o.life },
      uRise: { value: o.rise },
      uSpread: { value: o.spread },
      uSize: { value: o.size },
      uDrift: { value: o.drift ?? new Vector3() },
      uIntensity: { value: 1 },
      uOpacity: { value: o.opacity ?? 0.5 },
      uLit: { value: new Color(o.lit ?? '#FFF6EA') },
      uShade: { value: new Color(o.shade ?? '#B8AFC0') },
      uNearFade: { value: new Vector2(o.nearFade?.[0] ?? 8, o.nearFade?.[1] ?? 45) },
    }
    const mat = new ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */ `
        attribute vec4 aSeed;
        uniform float uTime, uLife, uRise, uSpread, uSize, uRadius, uIntensity;
        uniform vec3 uOrigin, uDrift;
        varying float vAlpha;
        varying vec2 vUv;
        varying float vSeed;
        varying float vAge;
        varying float vCam;
        void main() {
          float age = fract(uTime / uLife + aSeed.x);
          float ang = aSeed.y * 6.2832;
          float rad = sqrt(aSeed.z) * uRadius;
          vec3 p = uOrigin + vec3(cos(ang) * rad, 0.0, sin(ang) * rad);
          p.y += uRise * age * (1.5 - 0.5 * age);
          float sw = uTime * 0.5 + aSeed.w * 6.2832;
          p.x += sin(sw + age * 4.0) * uSpread * age;
          p.z += cos(sw * 0.8 + age * 3.0) * uSpread * age;
          p += uDrift * age * age;
          float size = uSize * (0.3 + 1.5 * age) * (0.7 + 0.6 * aSeed.w);
          vec4 mv = viewMatrix * vec4(p, 1.0);
          float rot = aSeed.w * 6.2832 + age * 1.5 * (aSeed.y - 0.5);
          vec2 c = position.xy;
          c = mat2(cos(rot), -sin(rot), sin(rot), cos(rot)) * c;
          mv.xy += c * size;
          gl_Position = projectionMatrix * mv;
          vCam = -mv.z;
          vAlpha = smoothstep(0.0, 0.18, age) * (1.0 - smoothstep(0.4, 1.0, age)) * uIntensity;
          vUv = uv;
          vSeed = aSeed.w;
          vAge = age;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime, uOpacity;
        uniform vec3 uLit, uShade, uSunCol;
        varying float vAlpha;
        varying vec2 vUv;
        varying float vSeed;
        varying float vAge;
        varying float vCam;
        uniform vec2 uNearFade;
        ${NOISE}
        void main() {
          vec2 q = vUv - 0.5;
          float d = length(q) * 2.0;
          float n = fbm2(vUv * 2.6 + vSeed * 17.0 + vec2(0.0, -uTime * 0.12));
          float a = (1.0 - smoothstep(0.15, 1.0, d)) * smoothstep(0.25, 0.75, n + 0.25 * (1.0 - d)) * vAlpha * uOpacity;
          a *= smoothstep(uNearFade.x, uNearFade.y, vCam);
          vec3 col = mix(uShade, uLit * mix(vec3(1.0), uSunCol, 0.35), 0.45 + 0.55 * (0.5 - q.y));
          if (a < 0.003) discard;
          gl_FragColor = vec4(col, a);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: NormalBlending,
    })
    this.mesh = new Mesh(g, mat)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 5
  }
  set(origin: Vector3, intensity: number) {
    ;(this.uniforms.uOrigin.value as Vector3).copy(origin)
    this.uniforms.uIntensity.value = intensity
    this.mesh.visible = intensity > 0.002
  }
}

/** 火星、灰尘：发光的小点 */
export class Motes {
  readonly mesh: Mesh
  readonly uniforms: Record<string, { value: unknown }>
  constructor(o: { count: number; life: number; box: Vector3; rise: number; size: number; color: string; additive?: boolean; seed?: number; jitter?: number }) {
    const base = new PlaneGeometry(1, 1)
    const g = new InstancedBufferGeometry()
    g.index = base.index
    g.setAttribute('position', base.attributes.position)
    g.setAttribute('uv', base.attributes.uv)
    const r = rng(o.seed ?? 3)
    const seeds = new Float32Array(o.count * 4)
    for (let i = 0; i < seeds.length; i++) seeds[i] = r()
    g.setAttribute('aSeed', new InstancedBufferAttribute(seeds, 4))
    g.instanceCount = o.count
    this.uniforms = {
      uTime: SHARED.uTime,
      uOrigin: { value: new Vector3() },
      uBox: { value: o.box },
      uLife: { value: o.life },
      uRise: { value: o.rise },
      uSize: { value: o.size },
      uJitter: { value: o.jitter ?? 1 },
      uIntensity: { value: 1 },
      uColor: { value: new Color(o.color) },
    }
    const mat = new ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */ `
        attribute vec4 aSeed;
        uniform float uTime, uLife, uRise, uSize, uIntensity, uJitter;
        uniform vec3 uOrigin, uBox;
        varying float vAlpha;
        varying vec2 vUv;
        void main() {
          float age = fract(uTime / (uLife * (0.6 + 0.8 * aSeed.w)) + aSeed.x);
          vec3 p = uOrigin + (vec3(aSeed.y, 0.0, aSeed.z) - vec3(0.5, 0.0, 0.5)) * uBox;
          p.y += uBox.y * aSeed.w * 0.3 + uRise * age;
          float t = uTime * 0.7 + aSeed.w * 40.0;
          p += vec3(sin(t * 1.3), sin(t * 0.9) * 0.6, cos(t * 1.1)) * uJitter * (0.4 + age);
          vec4 mv = viewMatrix * vec4(p, 1.0);
          mv.xy += position.xy * uSize * (0.6 + 0.8 * aSeed.y);
          gl_Position = projectionMatrix * mv;
          // 微微地明暗（快了一闪一闪，像屏幕在闪）
          float tw = 0.8 + 0.2 * sin(uTime * (0.8 + aSeed.z * 1.6) + aSeed.y * 30.0);
          vAlpha = smoothstep(0.0, 0.15, age) * (1.0 - smoothstep(0.6, 1.0, age)) * tw * uIntensity;
          vUv = uv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        varying float vAlpha;
        varying vec2 vUv;
        void main() {
          float d = length(vUv - 0.5) * 2.0;
          float a = (1.0 - smoothstep(0.0, 1.0, d));
          a *= a * vAlpha;
          if (a < 0.003) discard;
          gl_FragColor = vec4(uColor * a, a);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: o.additive === false ? NormalBlending : AdditiveBlending,
    })
    this.mesh = new Mesh(g, mat)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 6
  }
  set(origin: Vector3, intensity: number) {
    ;(this.uniforms.uOrigin.value as Vector3).copy(origin)
    this.uniforms.uIntensity.value = intensity
    this.mesh.visible = intensity > 0.002
  }
}

/** 火苗：几片交叉的面，着色器里画火 */
export function flameMaterial(intensity: { value: number }) {
  return new ShaderMaterial({
    uniforms: { uTime: SHARED.uTime, uI: intensity },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying float vSeed;
      attribute float aSeed;
      void main() {
        vUv = uv;
        vSeed = aSeed;
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime, uI;
      varying vec2 vUv;
      varying float vSeed;
      ${NOISE}
      void main() {
        vec2 uv = vUv;
        // 火舌慢慢地往上舔：快了在灶膛里一闪一闪
        float t = uTime * (0.45 + 0.25 * vSeed);
        float n = fbm2(vec2(uv.x * 3.0 + vSeed * 10.0, uv.y * 2.2 - t));
        float x = uv.x - 0.5 + (n - 0.5) * 0.45 * uv.y;
        float w = 0.42 * (1.0 - uv.y * 0.85);
        float shape = smoothstep(w, w * 0.2, abs(x)) * smoothstep(1.0, 0.25, uv.y + (n - 0.5) * 0.5) * smoothstep(0.0, 0.08, uv.y);
        vec3 col = mix(vec3(1.0, 0.32, 0.06), vec3(1.0, 0.78, 0.35), smoothstep(0.2, 0.9, shape));
        col = mix(col, vec3(1.0, 0.95, 0.75), smoothstep(0.75, 1.0, shape) * (1.0 - uv.y));
        float a = shape * uI;
        if (a < 0.004) discard;
        gl_FragColor = vec4(col * a * 1.8, a);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  })
}

/** 水珠：几十个小球，位置每帧在 CPU 上按时间算（滴水、洒水、溅起） */
export class Drops {
  readonly mesh: InstancedMesh
  private m = new Matrix4()
  private q = new Quaternion()
  private s = new Vector3()
  private n = 0
  constructor(count: number) {
    const mat = new MeshPhysicalMaterial({ color: '#dfe8e6', roughness: 0.05, metalness: 0, transmission: 0, transparent: true, opacity: 0.55, clearcoat: 1 })
    this.mesh = new InstancedMesh(new SphereGeometry(1, 10, 8), mat, count)
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage)
    this.mesh.frustumCulled = false
    this.mesh.count = 0
  }
  begin() {
    this.n = 0
  }
  add(p: Vector3, r: number, stretch = 1) {
    if (this.n >= this.mesh.instanceMatrix.count) return
    this.s.set(r, r * stretch, r)
    this.m.compose(p, this.q, this.s)
    this.mesh.setMatrixAt(this.n++, this.m)
  }
  end() {
    this.mesh.count = this.n
    this.mesh.instanceMatrix.needsUpdate = true
    this.mesh.visible = this.n > 0
  }
}

/** 一组可摆放的实例（刨下来的瓤屑等） */
export class Scatter {
  readonly mesh: InstancedMesh
  /** 每一片自己的"实在程度"：材质里当 alpha 乘进去（1 是实的，0 是化没了） */
  private fade: InstancedBufferAttribute
  private dummy = new Object3D()
  private n = 0
  constructor(geo: BufferGeometry, mat: Material, count: number) {
    this.mesh = new InstancedMesh(geo, mat, count)
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage)
    this.mesh.castShadow = true
    this.mesh.receiveShadow = true
    this.mesh.frustumCulled = false
    this.mesh.count = 0
    const have = geo.getAttribute('aFade') as InstancedBufferAttribute | undefined
    this.fade = have ?? new InstancedBufferAttribute(new Float32Array(count), 1)
    if (!have) geo.setAttribute('aFade', this.fade)
  }
  begin() {
    this.n = 0
  }
  /** fade：这一片此刻多实在，不传就是实的 */
  add(p: Vector3, rx: number, ry: number, rz: number, s: number, fade = 1) {
    if (this.n >= this.mesh.instanceMatrix.count) return
    const d = this.dummy
    d.position.copy(p)
    d.rotation.set(rx, ry, rz)
    d.scale.setScalar(s)
    d.updateMatrix()
    this.fade.setX(this.n, fade)
    this.mesh.setMatrixAt(this.n++, d.matrix)
  }
  end() {
    this.mesh.count = this.n
    this.mesh.instanceMatrix.needsUpdate = true
    this.fade.needsUpdate = true
    this.mesh.visible = this.n > 0
  }
}
