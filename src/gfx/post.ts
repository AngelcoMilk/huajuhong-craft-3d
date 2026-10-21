import {
  Color,
  DepthTexture,
  HalfFloatType,
  LinearFilter,
  PerspectiveCamera,
  ShaderMaterial,
  UnsignedIntType,
  Vector2,
  Vector3,
  WebGLRenderTarget,
  type Scene,
  type WebGLRenderer,
} from 'three'
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js'

// 自己写的后期：一次渲染场景（4 倍抗锯齿 + 深度图），然后
//   1. 半分辨率算弥散圆 → 2. 金角螺旋采样做散景 → 3. 泛光 mip 链
//   4. 合成：景深混合 + 泛光 + 色调映射 + 调色（暗部偏影紫、不出纯黑）+ 暗角 + 颗粒 + 热浪扭曲

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`

/** 坏像素（NaN、无穷大、负数）一律当黑处理：不然它会被景深、泛光一层层扩散出去，整片发黑一闪 */
const SANE_FN = /* glsl */ `
vec3 sane(vec3 c) {
  float s = c.r + c.g + c.b;
  return (s >= 0.0 && s < 1.0e5) ? clamp(c, vec3(0.0), vec3(60.0)) : vec3(0.0);
}
`
const DEPTH_FN = /* glsl */ `
uniform float uNear, uFar;
float viewZ(float d) { return (uNear * uFar) / ((uFar - uNear) * d - uFar); }
`

const cocMat = new ShaderMaterial({
  uniforms: {
    tColor: { value: null },
    tDepth: { value: null },
    uNear: { value: 1 },
    uFar: { value: 1000 },
    uFocus: { value: 100 },
    uAperture: { value: 0.5 },
    uMaxCoc: { value: 10 },
    uTexel: { value: new Vector2() },
  },
  vertexShader: VERT,
  fragmentShader: /* glsl */ `
    uniform sampler2D tColor, tDepth;
    uniform float uFocus, uAperture, uMaxCoc;
    uniform vec2 uTexel;
    varying vec2 vUv;
    ${DEPTH_FN}
    ${SANE_FN}
    void main() {
      vec2 o = uTexel * 0.5;
      vec3 c = sane(texture2D(tColor, vUv + vec2(-o.x, -o.y)).rgb) + sane(texture2D(tColor, vUv + vec2(o.x, -o.y)).rgb)
             + sane(texture2D(tColor, vUv + vec2(-o.x, o.y)).rgb) + sane(texture2D(tColor, vUv + vec2(o.x, o.y)).rgb);
      c *= 0.25;
      float d = texture2D(tDepth, vUv).x;
      float z = -viewZ(d);
      float coc = clamp(uAperture * (z - uFocus) / z, -1.0, 1.0) * uMaxCoc;
      gl_FragColor = vec4(min(c, vec3(60.0)), coc);
    }
  `,
  depthTest: false,
  depthWrite: false,
})

const bokehMat = new ShaderMaterial({
  uniforms: { tCoc: { value: null }, uTexel: { value: new Vector2() }, uMaxCoc: { value: 10 } },
  vertexShader: VERT,
  fragmentShader: /* glsl */ `
    uniform sampler2D tCoc;
    uniform vec2 uTexel;
    uniform float uMaxCoc;
    varying vec2 vUv;
    const float GOLDEN = 2.39996323;
    const float RAD_SCALE = 0.7;
    void main() {
      vec4 c = texture2D(tCoc, vUv);
      float centerSize = abs(c.a);
      vec3 color = c.rgb;
      float tot = 1.0;
      float radius = RAD_SCALE;
      float ang = 0.0;
      for (int i = 0; i < 120; i++) {
        if (radius >= uMaxCoc) break;
        vec2 tc = vUv + vec2(cos(ang), sin(ang)) * uTexel * radius;
        vec4 s = texture2D(tCoc, tc);
        float sampleSize = abs(s.a);
        if (s.a > c.a) sampleSize = clamp(sampleSize, 0.0, centerSize * 2.0);
        float m = smoothstep(radius - 0.5, radius + 0.5, sampleSize);
        color += mix(color / tot, s.rgb, m);
        tot += 1.0;
        radius += RAD_SCALE / radius;
        ang += GOLDEN;
      }
      gl_FragColor = vec4(color / tot, centerSize);
    }
  `,
  depthTest: false,
  depthWrite: false,
})

const brightMat = new ShaderMaterial({
  uniforms: { tSrc: { value: null }, uThreshold: { value: 1.2 }, uKnee: { value: 0.6 } },
  vertexShader: VERT,
  fragmentShader: /* glsl */ `
    uniform sampler2D tSrc;
    uniform float uThreshold, uKnee;
    varying vec2 vUv;
    void main() {
      vec3 c = texture2D(tSrc, vUv).rgb;
      float br = max(c.r, max(c.g, c.b));
      float soft = clamp(br - uThreshold + uKnee, 0.0, 2.0 * uKnee);
      soft = soft * soft / (4.0 * uKnee + 1e-4);
      float w = max(soft, br - uThreshold) / max(br, 1e-4);
      gl_FragColor = vec4(c * w, 1.0);
    }
  `,
  depthTest: false,
  depthWrite: false,
})

const downMat = new ShaderMaterial({
  uniforms: { tSrc: { value: null }, uTexel: { value: new Vector2() } },
  vertexShader: VERT,
  fragmentShader: /* glsl */ `
    uniform sampler2D tSrc;
    uniform vec2 uTexel;
    varying vec2 vUv;
    void main() {
      vec2 h = uTexel * 0.5;
      vec3 s = texture2D(tSrc, vUv).rgb * 4.0;
      s += texture2D(tSrc, vUv - h).rgb;
      s += texture2D(tSrc, vUv + h).rgb;
      s += texture2D(tSrc, vUv + vec2(h.x, -h.y)).rgb;
      s += texture2D(tSrc, vUv - vec2(h.x, -h.y)).rgb;
      gl_FragColor = vec4(s / 8.0, 1.0);
    }
  `,
  depthTest: false,
  depthWrite: false,
})

const upMat = new ShaderMaterial({
  uniforms: { tSrc: { value: null }, tAdd: { value: null }, uTexel: { value: new Vector2() }, uMix: { value: 0.7 } },
  vertexShader: VERT,
  fragmentShader: /* glsl */ `
    uniform sampler2D tSrc, tAdd;
    uniform vec2 uTexel;
    uniform float uMix;
    varying vec2 vUv;
    void main() {
      vec2 h = uTexel * 0.5;
      vec3 s = texture2D(tSrc, vUv + vec2(-h.x * 2.0, 0.0)).rgb;
      s += texture2D(tSrc, vUv + vec2(-h.x, h.y)).rgb * 2.0;
      s += texture2D(tSrc, vUv + vec2(0.0, h.y * 2.0)).rgb;
      s += texture2D(tSrc, vUv + vec2(h.x, h.y)).rgb * 2.0;
      s += texture2D(tSrc, vUv + vec2(h.x * 2.0, 0.0)).rgb;
      s += texture2D(tSrc, vUv + vec2(h.x, -h.y)).rgb * 2.0;
      s += texture2D(tSrc, vUv + vec2(0.0, -h.y * 2.0)).rgb;
      s += texture2D(tSrc, vUv + vec2(-h.x, -h.y)).rgb * 2.0;
      s /= 12.0;
      gl_FragColor = vec4(mix(texture2D(tAdd, vUv).rgb, s, uMix) , 1.0);
    }
  `,
  depthTest: false,
  depthWrite: false,
})

const finalMat = new ShaderMaterial({
  uniforms: {
    tColor: { value: null },
    tDepth: { value: null },
    tBlur: { value: null },
    tBloom: { value: null },
    uNear: { value: 1 },
    uFar: { value: 1000 },
    uFocus: { value: 100 },
    uAperture: { value: 0.5 },
    uMaxCoc: { value: 10 },
    uBloom: { value: 0.25 },
    uExposure: { value: 1 },
    uTime: { value: 0 },
    uRes: { value: new Vector2() },
    uShadowTint: { value: new Color('#6E6278') },
    uLift: { value: 0.1 },
    uWarm: { value: new Color('#FFF1DC') },
    uVignette: { value: 0.35 },
    uGrain: { value: 0.035 },
    uSat: { value: 1.08 },
    uHaze: { value: new Vector3(0.5, 0.5, 0) },
    uHazeR: { value: new Vector2(0.1, 0.2) },
    uFade: { value: 0 },
    uFadeColor: { value: new Color('#F2E9D8') },
  },
  vertexShader: VERT,
  fragmentShader: /* glsl */ `
    uniform sampler2D tColor, tDepth, tBlur, tBloom;
    uniform float uFocus, uAperture, uMaxCoc, uBloom, uExposure, uTime, uLift, uVignette, uGrain, uSat, uFade;
    uniform vec2 uRes, uHazeR;
    uniform vec3 uShadowTint, uWarm, uHaze, uFadeColor;
    varying vec2 vUv;
    ${DEPTH_FN}
    ${SANE_FN}

    const mat3 LINEAR_REC2020_TO_LINEAR_SRGB = mat3(vec3(1.6605, -0.1246, -0.0182), vec3(-0.5876, 1.1329, -0.1006), vec3(-0.0728, -0.0083, 1.1187));
    const mat3 LINEAR_SRGB_TO_LINEAR_REC2020 = mat3(vec3(0.6274, 0.0691, 0.0164), vec3(0.3293, 0.9195, 0.0880), vec3(0.0433, 0.0113, 0.8956));
    vec3 agxContrast(vec3 x) {
      vec3 x2 = x * x; vec3 x4 = x2 * x2;
      return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
    }
    vec3 agx(vec3 color) {
      const mat3 inset = mat3(vec3(0.856627153315983, 0.137318972929847, 0.11189821299995), vec3(0.0951212405381588, 0.761241990602591, 0.0767994186031903), vec3(0.0482516061458583, 0.101439036467562, 0.811302368396859));
      const mat3 outset = mat3(vec3(1.1271005818144368, -0.1413297634984383, -0.14132976349843826), vec3(-0.11060664309660323, 1.157823702216272, -0.11060664309660294), vec3(-0.016493938717834573, -0.016493938717834257, 1.2519364065950405));
      const float minEv = -12.47393;
      const float maxEv = 4.026069;
      color = LINEAR_SRGB_TO_LINEAR_REC2020 * color;
      color = inset * color;
      color = max(color, 1e-10);
      color = log2(color);
      color = (color - minEv) / (maxEv - minEv);
      color = clamp(color, 0.0, 1.0);
      color = agxContrast(color);
      color = outset * color;
      color = pow(max(vec3(0.0), color), vec3(2.2));
      color = LINEAR_REC2020_TO_LINEAR_SRGB * color;
      return clamp(color, 0.0, 1.0);
    }
    vec3 toSRGB(vec3 c) { return mix(pow(c, vec3(0.41666)) * 1.055 - 0.055, c * 12.92, vec3(lessThanEqual(c, vec3(0.0031308)))); }
    float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash12(i), hash12(i + vec2(1, 0)), f.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), f.x), f.y); }

    void main() {
      vec2 uv = vUv;
      // 热浪：焙炉上方一小块轻轻扭
      if (uHaze.z > 0.001) {
        vec2 d = (uv - uHaze.xy) / uHazeR;
        float m = exp(-dot(d, d)) * uHaze.z;
        if (m > 0.002) {
          vec2 q = uv * vec2(uRes.x / uRes.y, 1.0) * 18.0;
          float n1 = vn(q + vec2(0.0, uTime * 3.0)) - 0.5;
          float n2 = vn(q * 1.7 + vec2(5.0, uTime * 4.3)) - 0.5;
          uv += vec2(n1, n2) * 0.006 * m;
        }
      }
      vec3 sharp = sane(texture2D(tColor, uv).rgb);
      float z = -viewZ(texture2D(tDepth, uv).x);
      float coc = abs(clamp(uAperture * (z - uFocus) / z, -1.0, 1.0) * uMaxCoc);
      vec4 blur = texture2D(tBlur, uv);
      float t = smoothstep(0.35, 1.6, max(coc, blur.a));
      // 对焦清楚的地方很轻地锐化一下（四邻平均做反差）；锐化会把细碎的闪烁一起放大，所以只给一点点
      {
        vec2 px = 1.0 / uRes;
        vec3 nb = sane(texture2D(tColor, uv + vec2(px.x, 0.0)).rgb) + sane(texture2D(tColor, uv - vec2(px.x, 0.0)).rgb)
                + sane(texture2D(tColor, uv + vec2(0.0, px.y)).rgb) + sane(texture2D(tColor, uv - vec2(0.0, px.y)).rgb);
        vec3 edge = sharp - nb * 0.25;
        sharp = max(sharp + clamp(edge, -0.04, 0.04) * 0.25 * (1.0 - t), 0.0);
      }
      vec3 c = mix(sharp, blur.rgb, t);
      c += texture2D(tBloom, uv).rgb * uBloom;
      c = agx(c * uExposure);
      c = toSRGB(c);
      // 轻轻的 S 曲线：暗处实一点、亮处透一点
      c = mix(c, c * c * (3.0 - 2.0 * c), 0.22);
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      // 饱和度
      c = mix(vec3(l), c, uSat);
      // 暗部抬一点、偏影紫；亮部偏暖
      c = mix(c, uShadowTint, (1.0 - smoothstep(0.0, 0.5, l)) * uLift);
      c *= mix(vec3(1.0), uWarm, smoothstep(0.35, 1.0, l));
      // 暗角，偏暖褐
      vec2 q = vUv - 0.5;
      q.x *= uRes.x / uRes.y;
      float v = smoothstep(0.35, 1.05, length(q));
      c = mix(c, c * vec3(0.62, 0.52, 0.55), v * uVignette);
      // 胶片颗粒
      float g = hash12(vUv * uRes + fract(uTime * 13.7) * 91.0) - 0.5;
      c += g * uGrain * (0.6 + 0.4 * (1.0 - l));
      c = mix(c, uFadeColor, uFade);
      gl_FragColor = vec4(c, 1.0);
    }
  `,
  depthTest: false,
  depthWrite: false,
})

export interface PostParams {
  focus: number
  aperture: number
  maxCoc: number
  bloom: number
  exposure: number
  lift: number
  vignette: number
  grain: number
  sat: number
  shadowTint: Color
  warm: Color
  haze: Vector3
  hazeR: Vector2
  fade: number
  fadeColor: Color
}

export class Post {
  readonly scene: WebGLRenderTarget
  private coc: WebGLRenderTarget
  private blur: WebGLRenderTarget
  private down: WebGLRenderTarget[] = []
  private up: WebGLRenderTarget[] = []
  private quad = new FullScreenQuad()
  private size = new Vector2()
  private levels = 6

  constructor(private renderer: WebGLRenderer) {
    const depth = new DepthTexture(1, 1, UnsignedIntType)
    this.scene = new WebGLRenderTarget(1, 1, { type: HalfFloatType, samples: 4, depthTexture: depth })
    const opt = { type: HalfFloatType, minFilter: LinearFilter, magFilter: LinearFilter, depthBuffer: false }
    this.coc = new WebGLRenderTarget(1, 1, opt)
    this.blur = new WebGLRenderTarget(1, 1, opt)
    for (let i = 0; i < this.levels; i++) {
      this.down.push(new WebGLRenderTarget(1, 1, opt))
      this.up.push(new WebGLRenderTarget(1, 1, opt))
    }
  }

  setSize(w: number, h: number) {
    w = Math.max(2, Math.floor(w))
    h = Math.max(2, Math.floor(h))
    if (this.size.x === w && this.size.y === h) return
    this.size.set(w, h)
    this.scene.setSize(w, h)
    const hw = Math.ceil(w / 2)
    const hh = Math.ceil(h / 2)
    this.coc.setSize(hw, hh)
    this.blur.setSize(hw, hh)
    let lw = hw
    let lh = hh
    for (let i = 0; i < this.levels; i++) {
      this.down[i].setSize(lw, lh)
      this.up[i].setSize(lw, lh)
      lw = Math.max(1, Math.ceil(lw / 2))
      lh = Math.max(1, Math.ceil(lh / 2))
    }
  }

  private pass(mat: ShaderMaterial, target: WebGLRenderTarget | null) {
    this.quad.material = mat
    this.renderer.setRenderTarget(target)
    this.quad.render(this.renderer)
  }

  render(scene: Scene, camera: PerspectiveCamera, p: PostParams, time: number) {
    const r = this.renderer
    r.setRenderTarget(this.scene)
    r.clear()
    r.render(scene, camera)

    const [w, h] = [this.size.x, this.size.y]
    const hw = this.coc.width
    const hh = this.coc.height
    const near = camera.near
    const far = camera.far
    // 弥散圆按半分辨率像素算，跟着画面高度缩放，换分辨率时景深观感不变
    const maxCoc = p.maxCoc * (hh / 540)

    const cu = cocMat.uniforms
    cu.tColor.value = this.scene.texture
    cu.tDepth.value = this.scene.depthTexture
    cu.uNear.value = near
    cu.uFar.value = far
    cu.uFocus.value = p.focus
    cu.uAperture.value = p.aperture
    cu.uMaxCoc.value = maxCoc
    cu.uTexel.value.set(1 / w, 1 / h)
    this.pass(cocMat, this.coc)

    const bu = bokehMat.uniforms
    bu.tCoc.value = this.coc.texture
    bu.uTexel.value.set(1 / hw, 1 / hh)
    bu.uMaxCoc.value = Math.max(1, maxCoc * Math.min(1, Math.abs(p.aperture) * 4 + 0.25))
    this.pass(bokehMat, this.blur)

    // 泛光
    brightMat.uniforms.tSrc.value = this.coc.texture
    this.pass(brightMat, this.down[0])
    for (let i = 1; i < this.levels; i++) {
      downMat.uniforms.tSrc.value = this.down[i - 1].texture
      downMat.uniforms.uTexel.value.set(1 / this.down[i - 1].width, 1 / this.down[i - 1].height)
      this.pass(downMat, this.down[i])
    }
    let src = this.down[this.levels - 1]
    for (let i = this.levels - 2; i >= 0; i--) {
      upMat.uniforms.tSrc.value = src.texture
      upMat.uniforms.tAdd.value = this.down[i].texture
      upMat.uniforms.uTexel.value.set(1 / src.width, 1 / src.height)
      upMat.uniforms.uMix.value = 0.62
      this.pass(upMat, this.up[i])
      src = this.up[i]
    }

    const fu = finalMat.uniforms
    fu.tColor.value = this.scene.texture
    fu.tDepth.value = this.scene.depthTexture
    fu.tBlur.value = this.blur.texture
    fu.tBloom.value = this.up[0].texture
    fu.uNear.value = near
    fu.uFar.value = far
    fu.uFocus.value = p.focus
    fu.uAperture.value = p.aperture
    fu.uMaxCoc.value = maxCoc * 2
    fu.uBloom.value = p.bloom
    fu.uExposure.value = p.exposure
    fu.uTime.value = time
    fu.uRes.value.set(w, h)
    fu.uLift.value = p.lift
    fu.uVignette.value = p.vignette
    fu.uGrain.value = p.grain
    fu.uSat.value = p.sat
    fu.uShadowTint.value.copy(p.shadowTint)
    fu.uWarm.value.copy(p.warm)
    fu.uHaze.value.copy(p.haze)
    fu.uHazeR.value.copy(p.hazeR)
    fu.uFade.value = p.fade
    fu.uFadeColor.value.copy(p.fadeColor)
    this.pass(finalMat, null)
  }
}
