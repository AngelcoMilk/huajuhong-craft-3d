import { Color, DoubleSide, Vector3, Vector4 } from 'three'
import { procPhysical, procStandard } from '../gfx/proc'
import { P } from '../palette'

// 场景里共用的程序化材质：木、砖、灰墙、水泥地、竹编、铁锅、陶、瓷、搪瓷、石头、树皮、瓦。
// 全部在着色器里按坐标现算花纹，不用任何贴图。

/** 全局共享的 uniform：时间、太阳方向 */
export const SHARED = {
  uTime: { value: 0 },
  uSunDir: { value: new Vector3(0, 1, 0) },
  uSunCol: { value: new Color('#ffffff') },
  uWind: { value: 1 },
}

const c = (h: string) => new Color(h)

type Axis = 'x' | 'y' | 'z'
const swz = (a: Axis) => (a === 'x' ? 'p.xyz' : a === 'y' ? 'p.yxz' : 'p.zxy')

export function woodMat(o: { light?: string; dark?: string; ring?: number; axis?: Axis; rough?: number; seed?: number; worn?: number; scale?: number; plank?: number } = {}) {
  return procStandard(
    { roughness: o.rough ?? 0.74, metalness: 0 },
    {
      uniforms: {
        uLight: { value: c(o.light ?? '#9A7253') },
        uDark: { value: c(o.dark ?? '#5A4030') },
        uRing: { value: o.ring ?? 1.6 },
        uSeed: { value: o.seed ?? 0 },
        uWorn: { value: o.worn ?? 0.3 },
        uScale: { value: o.scale ?? 1 },
        uPlank: { value: o.plank ?? 0 },
      },
      color: /* glsl */ `
        vec3 p = vPos * uScale;
        vec3 g = ${swz(o.axis ?? 'x')};
        // 木板：沿 g.z 方向分成几块，每块自己的纹理和深浅
        float pk = uPlank > 0.0 ? floor(g.z / uPlank) : 0.0;
        float pf = uPlank > 0.0 ? fract(g.z / uPlank) : 0.5;
        float ps = hash11(pk * 3.7 + uSeed * 11.0);
        vec3 q = g + vec3(ps * 300.0, 0.0, ps * 50.0);
        float warp = snoise(vec3(q.x * 0.012, q.y * 0.2, q.z * 0.2)) * 0.9 + snoise(vec3(q.x * 0.003, 0.0, q.z * 0.05)) * 1.6;
        float r = length(vec2(q.y + 18.0 + ps * 25.0, (pf - 0.5) * max(uPlank, 12.0) * 0.8 + ps * 6.0)) * uRing + warp;
        float ring = fract(r);
        float late = smoothstep(0.62, 0.9, ring) * (1.0 - smoothstep(0.94, 1.0, ring));
        float fiber = snoise(vec3(q.x * 0.035, q.y * 4.0, q.z * 4.0)) * 0.5 + 0.5;
        float blot = fbm3(p * 0.025 + uSeed) * 0.5 + 0.5;
        vec3 col = mix(uLight, uDark, clamp(late * 0.42 + fiber * 0.18, 0.0, 1.0));
        col *= 0.86 + 0.26 * ps;
        col = mix(col, col * vec3(0.78, 0.76, 0.74), (1.0 - blot) * uWorn);
        float seam = uPlank > 0.0 ? 1.0 - smoothstep(0.0, 0.25 / uPlank, min(pf, 1.0 - pf)) : 0.0;
        col *= 1.0 - seam * 0.65;
        diffuseColor.rgb = col;
        procBump = -late * 0.012 + fiber * 0.006 - seam * 0.25;
      `,
      rough: /* glsl */ `roughnessFactor = clamp(roughnessFactor + late * 0.06 - blot * 0.1, 0.3, 1.0);`,
      bump: true,
    },
  )
}

export function brickMat(o: { plasterTop?: boolean; soot?: Vector4; brick?: string; mortar?: string; whitewash?: number } = {}) {
  return procStandard(
    { roughness: 0.9, metalness: 0 },
    {
      uniforms: {
        uBrick: { value: c(o.brick ?? '#A65A40') },
        uBrick2: { value: c('#7E4636') },
        uMortar: { value: c(o.mortar ?? '#B9AD98') },
        uPlaster: { value: c('#E6DCCB') },
        uTop: { value: o.plasterTop ? 1 : 0 },
        uSoot: { value: o.soot ?? new Vector4(0, -999, 0, 1) },
        uWash: { value: o.whitewash ?? 0 },
      },
      color: /* glsl */ `
        vec3 n = normalize(vNrm);
        vec3 p = vPos;
        vec2 uv = abs(n.x) > 0.5 ? vec2(p.z, p.y) : (abs(n.z) > 0.5 ? vec2(p.x, p.y) : vec2(p.x, p.z));
        vec2 b = uv / vec2(24.0, 6.4);
        float row = floor(b.y);
        b.x += mod(row, 2.0) * 0.5;
        vec2 cell = floor(b);
        vec2 f = fract(b);
        vec2 mw = vec2(0.55 / 24.0, 0.55 / 6.4);
        float inside = smoothstep(0.0, mw.x, f.x) * smoothstep(0.0, mw.x, 1.0 - f.x) * smoothstep(0.0, mw.y, f.y) * smoothstep(0.0, mw.y, 1.0 - f.y);
        // 砖缝只有半厘米宽：一个像素比砖缝还宽的时候（远看）砖缝淡成平均色，不然一闪一闪
        vec2 uvw = fwidth(uv);
        float maa = 1.0 - smoothstep(0.25, 0.7, max(uvw.x, uvw.y));
        float mortar = mix(0.12, 1.0 - inside, maa);
        float h = hash12(cell);
        float tex = snoise(vec3(uv * 0.45, h * 10.0)) * 0.5 + 0.5;
        vec3 bc = uBrick * (0.78 + 0.34 * h) * (0.9 + 0.18 * tex);
        bc = mix(bc, uBrick2, step(0.82, hash12(cell + 3.1)) * 0.7);
        vec3 col = mix(bc, uMortar * (0.9 + 0.1 * tex), mortar);
        float wash = uWash * smoothstep(0.35, 0.65, fbm3(vWPos * 0.02) * 0.5 + 0.5 + uWash * 0.3);
        col = mix(col, uPlaster * (0.9 + 0.1 * tex), wash);
        procBump = (-mortar * 0.35 * maa + tex * 0.06) * (1.0 - wash);
        if (uTop > 0.5 && vWNrm.y > 0.5) {
          float pn = fbm3(vWPos * 0.06) * 0.5 + 0.5;
          col = uPlaster * (0.82 + 0.18 * pn);
          procBump = pn * 0.05;
        }
        float sd = length(vWPos - uSoot.xyz) / uSoot.w;
        float soot = (1.0 - smoothstep(0.2, 1.0, sd + snoise(vPos * 0.08) * 0.2));
        col = mix(col, vec3(0.06, 0.05, 0.05), soot * 0.88);
        diffuseColor.rgb = col;
      `,
      bump: true,
    },
  )
}

export function plasterMat(o: { color?: string; damp?: string; dampH?: number } = {}) {
  return procStandard(
    { roughness: 0.95, metalness: 0 },
    {
      uniforms: { uPlaster: { value: c(o.color ?? '#E2D7C4') }, uDamp: { value: c(o.damp ?? '#A99C8C') }, uDampH: { value: o.dampH ?? 55 } },
      color: /* glsl */ `
        vec3 p = vWPos;
        float n = fbm3(p * 0.01);
        float n2 = fbm3(p * 0.07) * 0.5 + 0.5;
        vec3 col = uPlaster * (0.9 + 0.1 * n2);
        float streak = smoothstep(0.15, 0.7, fbm3(vec3(p.x * 0.035, p.y * 0.004, p.z * 0.035)));
        col = mix(col, col * vec3(0.86, 0.83, 0.79), streak * 0.55);
        float patchy = smoothstep(0.35, 0.6, fbm3(p * 0.006 + 2.0));
        col = mix(col, col * vec3(0.9, 0.88, 0.86), patchy * 0.5);
        float damp = 1.0 - smoothstep(uDampH * 0.3, uDampH, p.y + n * 25.0);
        col = mix(col, uDamp, damp * 0.55);
        diffuseColor.rgb = col;
        procBump = n2 * 0.06 - streak * 0.02;
      `,
      bump: true,
    },
  )
}

export function cementMat() {
  return procStandard(
    { roughness: 0.92, metalness: 0 },
    {
      uniforms: { uCement: { value: c('#9C9488') } },
      color: /* glsl */ `
        vec2 p = vWPos.xz;
        float n = fbm2(p * 0.008);
        float n2 = fbm2(p * 0.09);
        vec3 col = uCement * (0.8 + 0.32 * n) * (0.94 + 0.1 * n2);
        vec2 g = abs(fract(p / 160.0 + 0.5) - 0.5) * 160.0;
        float joint = 1.0 - smoothstep(0.25, 0.9, min(g.x, g.y));
        vec3 v = voronoi2(p * 0.011);
        // 细裂纹、碎石点比像素细的时候（远看）淡掉，不然一闪一闪
        vec2 pw = fwidth(p);
        float px = max(pw.x, pw.y);
        float crack = (1.0 - smoothstep(0.0, 0.018, v.y)) * step(0.55, hash12(vec2(v.z, 1.0))) * smoothstep(0.4, 0.6, fbm2(p * 0.02)) * (1.0 - smoothstep(1.2, 3.0, px));
        col *= 1.0 - 0.38 * joint - 0.35 * crack;
        float stain = smoothstep(0.55, 0.85, fbm2(p * 0.004 + 3.0));
        col = mix(col, col * vec3(0.78, 0.8, 0.74), stain * 0.6);
        float pebble = mix(0.14, step(0.86, hash12(floor(p * 1.3))), 1.0 - smoothstep(0.17, 0.46, px));
        col *= 1.0 - pebble * 0.08;
        diffuseColor.rgb = col;
        procBump = -joint * 0.25 - crack * 0.12 + n2 * 0.04;
      `,
      bump: true,
    },
  )
}

const WEAVE = /* glsl */ `
// 平纹竹编：x 方向和 y 方向的篾条一上一下。返回 (高度, 篾条编号, 空隙, 沿篾条方向的位置)
vec4 weave(vec2 uv, float w, float g) {
  vec2 q = uv / w;
  vec2 cl = floor(q);
  vec2 f = fract(q);
  float over = mod(cl.x + cl.y, 2.0);
  float inX = smoothstep(0.0, g, f.y) * smoothstep(0.0, g, 1.0 - f.y);
  float inY = smoothstep(0.0, g, f.x) * smoothstep(0.0, g, 1.0 - f.x);
  float ax = sin(f.x * 3.14159);
  float ay = sin(f.y * 3.14159);
  float hx = inX * (over > 0.5 ? 0.6 + 0.4 * ax : 0.3 * (1.0 - ax));
  float hy = inY * (over < 0.5 ? 0.6 + 0.4 * ay : 0.3 * (1.0 - ay));
  float h = max(hx, hy);
  float id = hx > hy ? cl.y * 1.37 + 3.0 : cl.x * 2.11 + 50.0;
  float hole = (1.0 - inX) * (1.0 - inY);
  return vec4(h, id, hole, hx > hy ? q.x : q.y);
}
`

/** 竹编。mode：flat 平面（看 xz），cyl 筒壁（看角度和高度），auto 按法线自己选 */
export function bambooMat(o: { w?: number; holes?: boolean; color?: string; mode?: 'flat' | 'cyl' | 'auto' | 'polar'; radius?: number; rot?: number; dark?: string; gap?: number } = {}) {
  const holes = o.holes ?? false
  const mode = o.mode ?? 'auto'
  const coords = /* glsl */ `
    vec2 wuv;
    {
      vec3 n = normalize(vNrm);
      bool flatMode = ${mode === 'flat' ? 'true' : mode === 'cyl' ? 'false' : 'abs(n.y) > 0.6'};
      ${mode === 'polar' ? 'flatMode = false;' : ''}
      if (${mode === 'polar' ? 'true' : 'false'}) {
        float rr = length(vPos.xz);
        wuv = vec2(atan(vPos.z, vPos.x) * max(rr, 1.5), rr * 1.1);
      } else if (flatMode) {
        float cr = cos(uRot), sr = sin(uRot);
        wuv = mat2(cr, -sr, sr, cr) * vPos.xz;
      } else {
        wuv = vec2(atan(vPos.z, vPos.x) * uRadius, vPos.y);
      }
    }
    vec4 wv = weave(wuv, uW, ${(o.gap ?? 0.16).toFixed(3)});
    // 篾条比像素还细的时候（远看）淡成平均色，孔也不再挖（不然一闪一闪）
    vec2 wfw = fwidth(wuv / uW);
    float waa = 1.0 - smoothstep(0.22, 0.6, max(wfw.x, wfw.y));
    wv.x = mix(0.42, wv.x, waa);
  `
  const discard = holes ? `${coords}\nif (wv.z > 0.5 && waa > 0.5) discard;` : ''
  return procStandard(
    { roughness: 0.68, metalness: 0, side: DoubleSide },
    {
      uniforms: {
        uBamboo: { value: c(o.color ?? P.bamboo) },
        uBambooDark: { value: c(o.dark ?? '#8C6A3E') },
        uW: { value: o.w ?? 1.1 },
        uRadius: { value: o.radius ?? 20 },
        uRot: { value: o.rot ?? 0.785 },
      },
      fragmentHead: WEAVE,
      discard,
      color: /* glsl */ `
        ${holes ? '' : coords}
        float sv = mix(0.5, hash11(wv.y), waa);
        float fib = mix(0.5, snoise(vec3(wv.w * 6.0, wv.y * 3.0, 0.0)) * 0.5 + 0.5, waa * waa);
        float node = smoothstep(0.92, 1.0, sin(wv.w * 0.9 + wv.y * 5.0) * 0.5 + 0.5);
        vec3 col = uBamboo * (0.8 + 0.32 * sv) * (0.9 + 0.12 * fib);
        col = mix(col, uBambooDark, (1.0 - wv.x) * 0.75 + node * 0.25);
        col *= 0.92 + 0.08 * (fbm3(vPos * 0.08) * 0.5 + 0.5);
        diffuseColor.rgb = col;
        procBump = (wv.x * 0.18 + fib * 0.02) * waa;
      `,
      bump: true,
    },
  )
}

/** 竹子本身（竹竿、篾圈、手柄）：顺着长度有纤维和竹节 */
export function bambooPlainMat(o: { color?: string; axis?: Axis; node?: number } = {}) {
  return procStandard(
    { roughness: 0.55, metalness: 0 },
    {
      uniforms: { uBamboo: { value: c(o.color ?? P.bamboo) }, uNode: { value: o.node ?? 0 } },
      color: /* glsl */ `
        vec3 p = vPos;
        vec3 g = ${swz(o.axis ?? 'y')};
        float fib = snoise(vec3(g.x * 0.05, g.y * 4.0, g.z * 4.0)) * 0.5 + 0.5;
        float node = uNode > 0.0 ? smoothstep(0.035, 0.0, abs(fract(g.x / uNode) - 0.5) - 0.465) : 0.0;
        vec3 col = uBamboo * (0.86 + 0.18 * fib);
        col = mix(col, col * 0.7, node);
        col *= 0.9 + 0.1 * (fbm3(p * 0.1) * 0.5 + 0.5);
        diffuseColor.rgb = col;
        procBump = fib * 0.01 + node * 0.05;
      `,
      bump: true,
    },
  )
}

export function ironMat(o: { polish?: number; rust?: number; polishR?: number } = {}) {
  return procStandard(
    { roughness: 0.6, metalness: 0.55, color: P.iron },
    {
      uniforms: { uIron: { value: c(P.iron) }, uPolish: { value: o.polish ?? 0 }, uRust: { value: o.rust ?? 0.3 }, uPolishR: { value: o.polishR ?? 20 } },
      color: /* glsl */ `
        vec3 p = vPos;
        float n = fbm3(p * 0.12) * 0.5 + 0.5;
        float rust = smoothstep(0.6, 0.82, fbm3(p * 0.04 + 4.0) * 0.5 + 0.5) * uRust;
        vec3 col = mix(uIron * 0.8, uIron * 1.5, n * 0.5);
        col = mix(col, vec3(0.3, 0.16, 0.1), rust);
        float pol = uPolish * (1.0 - smoothstep(0.2, 1.0, length(p.xz) / uPolishR)) * step(0.0, -vNrm.y + 0.6);
        diffuseColor.rgb = col;
        procBump = n * 0.02;
      `,
      rough: /* glsl */ `roughnessFactor = clamp(0.62 - pol * 0.35 + rust * 0.25, 0.2, 1.0);`,
      metal: /* glsl */ `metalnessFactor = 0.55 - rust * 0.4;`,
      bump: true,
    },
  )
}

export function clayMat(o: { color?: string; sootTop?: number } = {}) {
  return procStandard(
    { roughness: 0.92, metalness: 0 },
    {
      uniforms: { uClay: { value: c(o.color ?? '#9A5A3E') }, uSootTop: { value: o.sootTop ?? 999 } },
      color: /* glsl */ `
        vec3 p = vPos;
        float n = fbm3(p * 0.09) * 0.5 + 0.5;
        float n2 = snoise(p * 0.7) * 0.5 + 0.5;
        vec3 col = uClay * (0.8 + 0.3 * n) * (0.95 + 0.08 * n2);
        float soot = smoothstep(uSootTop - 10.0, uSootTop, p.y + snoise(p * 0.15) * 4.0);
        col = mix(col, vec3(0.08, 0.06, 0.05), soot * 0.85);
        diffuseColor.rgb = col;
        procBump = n2 * 0.05 + n * 0.08;
      `,
      bump: true,
    },
  )
}

/** 上釉的瓷：碗。y 是高度，band 是一圈青色线 */
export function ceramicMat(o: { glaze?: string; band?: string; bandY?: number[]; footY?: number } = {}) {
  const bands = o.bandY ?? []
  return procPhysical(
    { roughness: 0.22, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.15 },
    {
      uniforms: {
        uGlaze: { value: c(o.glaze ?? '#F1E8D6') },
        uBand: { value: c(o.band ?? P.blue) },
        uFootY: { value: o.footY ?? -999 },
        uBandA: { value: bands[0] ?? -999 },
        uBandB: { value: bands[1] ?? -999 },
      },
      color: /* glsl */ `
        vec3 p = vPos;
        vec3 col = uGlaze * (0.97 + 0.03 * snoise(p * 0.6));
        float b = max(smoothstep(0.32, 0.12, abs(p.y - uBandA)), smoothstep(0.14, 0.04, abs(p.y - uBandB)));
        col = mix(col, uBand, b * 0.9);
        vec3 v = voronoi3(p * 0.9);
        col *= 1.0 - (1.0 - smoothstep(0.0, 0.03, v.y)) * 0.05;
        float foot = step(p.y, uFootY);
        col = mix(col, vec3(0.78, 0.66, 0.5), foot);
        diffuseColor.rgb = col;
      `,
      rough: /* glsl */ `roughnessFactor = mix(0.2, 0.85, foot);`,
    },
  )
}

/** 搪瓷脸盆：白底，盆沿一圈蓝，磕掉漆的地方露出黑铁 */
export function enamelMat(o: { rimY?: number } = {}) {
  return procPhysical(
    { roughness: 0.18, metalness: 0, clearcoat: 0.8, clearcoatRoughness: 0.1 },
    {
      uniforms: { uWhite: { value: c('#EFEAE0') }, uBlue: { value: c(P.blue) }, uRimY: { value: o.rimY ?? 10 } },
      color: /* glsl */ `
        vec3 p = vPos;
        vec3 col = uWhite;
        float rim = smoothstep(uRimY - 1.6, uRimY - 1.2, p.y);
        col = mix(col, uBlue, rim);
        vec3 v = voronoi3(p * 0.55);
        float chip = step(0.93, v.z) * (1.0 - smoothstep(0.12, 0.2, v.x)) * (0.4 + 0.6 * rim);
        col = mix(col, vec3(0.08, 0.07, 0.08), chip);
        diffuseColor.rgb = col;
      `,
      rough: /* glsl */ `roughnessFactor = mix(0.16, 0.7, chip);`,
    },
  )
}

export function stoneMat(o: { color?: string; river?: boolean } = {}) {
  // river：河里的卵石，水磨过，几乎没有麻点，只有深浅的晕和一两道浅色的石英纹
  return procStandard(
    { roughness: o.river ? 0.62 : 0.85, metalness: 0 },
    {
      uniforms: { uStone: { value: c(o.color ?? '#8F8B86') }, uRiver: { value: o.river ? 1 : 0 } },
      color: /* glsl */ `
        vec3 p = vPos;
        float n = fbm3(p * 0.12) * 0.5 + 0.5;
        float saa = aaFade3(p * 3.0);
        float sp = hash13(floor(p * 3.0)) * (1.0 - uRiver);
        vec3 col = uStone * (0.75 + 0.35 * n);
        col = mix(col, col * 0.45, mix(0.1, step(0.9, sp), saa) * (1.0 - uRiver));
        col = mix(col, col * 1.3, mix(0.05, step(0.95, hash13(floor(p * 2.3) + 5.0)), saa) * (1.0 - uRiver));
        float vein = 1.0 - smoothstep(0.0, 0.22, abs(sin(p.y * 0.55 + p.x * 0.2 + fbm3(p * 0.12) * 1.4)));
        col = mix(col, vec3(0.8, 0.78, 0.74), vein * 0.18 * uRiver);
        diffuseColor.rgb = col;
        procBump = mix(n * 0.25 + step(0.9, sp) * 0.02, n * 0.04, uRiver);
      `,
      bump: true,
    },
  )
}

export function barkMat(o: { color?: string } = {}) {
  return procStandard(
    { roughness: 0.95, metalness: 0 },
    {
      uniforms: { uBark: { value: c(o.color ?? '#6E5C4E') } },
      color: /* glsl */ `
        vec3 p = vWPos;
        float fis = abs(snoise(vec3(p.x * 0.35, p.y * 0.05, p.z * 0.35)));
        float n = fbm3(p * 0.08) * 0.5 + 0.5;
        vec3 col = uBark * (0.72 + 0.4 * n);
        col = mix(col, col * 0.45, 1.0 - smoothstep(0.0, 0.18, fis));
        float lichen = smoothstep(0.62, 0.8, fbm3(p * 0.05 + 9.0) * 0.5 + 0.5);
        col = mix(col, vec3(0.62, 0.66, 0.55), lichen * 0.5);
        diffuseColor.rgb = col;
        procBump = smoothstep(0.0, 0.2, fis) * 0.4 + n * 0.1;
      `,
      bump: true,
    },
  )
}

/** 青瓦：沿坡方向一垄一垄 */
export function tileMat() {
  return procStandard(
    { roughness: 0.8, metalness: 0, shadowSide: DoubleSide },
    {
      uniforms: { uTile: { value: c('#7B7D80') } },
      color: /* glsl */ `
        vec3 p = vPos;
        float row = floor(p.y / 18.0);
        float lane = floor(p.x / 22.0);
        float h = hash12(vec2(row, lane));
        float n = fbm3(vWPos * 0.04) * 0.5 + 0.5;
        vec3 col = uTile * (0.8 + 0.25 * h) * (0.85 + 0.25 * n);
        float moss = smoothstep(0.6, 0.85, fbm3(vWPos * 0.015 + 3.0) * 0.5 + 0.5);
        col = mix(col, vec3(0.38, 0.42, 0.28), moss * 0.45);
        float edge = smoothstep(0.82, 1.0, fract(p.y / 18.0));
        col *= 1.0 - edge * 0.35;
        diffuseColor.rgb = col;
        procBump = -edge * 0.6 + n * 0.1;
      `,
      bump: true,
    },
  )
}

/** 粗布（盖布、抹布）：经纬纹 */
export function clothMat(o: { color?: string; scale?: number } = {}) {
  return procStandard(
    { roughness: 0.95, metalness: 0, side: DoubleSide },
    {
      uniforms: { uCloth: { value: c(o.color ?? '#D9CCB4') }, uScale: { value: o.scale ?? 3 } },
      color: /* glsl */ `
        vec2 q = vPos.xz * uScale;
        float wx = sin(q.x * 6.2832) * 0.5 + 0.5;
        float wy = sin(q.y * 6.2832) * 0.5 + 0.5;
        float n = fbm3(vPos * 0.3) * 0.5 + 0.5;
        vec3 col = uCloth * (0.86 + 0.12 * max(wx, wy)) * (0.9 + 0.12 * n);
        diffuseColor.rgb = col;
        procBump = max(wx, wy) * 0.02;
      `,
      bump: true,
    },
  )
}
