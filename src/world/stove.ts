import {
  BackSide,
  DoubleSide,
  BoxGeometry,
  Color,
  CylinderGeometry,
  ExtrudeGeometry,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  LatheGeometry,
  Mesh,
  Object3D,
  Path,
  PlaneGeometry,
  PointLight,
  Shape,
  TorusGeometry,
  Vector2,
  Vector3,
  Vector4,
} from 'three'
import { procPhysical, procStandard } from '../gfx/proc'
import { rng } from '../util'
import { Puffs, flameMaterial } from './fx'
import { LAYOUT } from './layout'
import { bambooMat, bambooPlainMat, barkMat, brickMat, ironMat, SHARED, woodMat } from './materials'

// 柴灶：砖砌灶身、抹灰灶面、一口大铁锅，锅里的水会滚；灶口里有柴火；
// 旁边是烟囱、柴堆、靠墙的锅盖、沥水的小竹筛；捞果子用的竹笊篱。

/** 圆竹筛：平底 + 一圈矮沿 + 篾圈 */
export function roundSieve(r: number, rim: number, o: { w?: number; holes?: boolean } = {}) {
  const g = new Group()
  const prof = [new Vector2(0, 0), new Vector2(r - 1.5, 0), new Vector2(r, 1.2), new Vector2(r + 0.4, rim)]
  const body = new Mesh(new LatheGeometry(prof, 64), bambooMat({ w: o.w ?? 1.2, holes: o.holes, radius: r }))
  body.castShadow = true
  body.receiveShadow = true
  g.add(body)
  const hoop = new Mesh(new TorusGeometry(r + 0.6, 0.65, 8, 72), bambooPlainMat({ axis: 'x' }))
  hoop.rotation.x = Math.PI / 2
  hoop.position.y = rim
  hoop.castShadow = true
  g.add(hoop)
  return g
}

/** 竹笊篱：一兜竹篾编的深勺 + 长竹柄，一勺能兜三四个果。原点在兜底（果子坐的地方），柄朝 +x */
export const STRAINER_R = 12
export const STRAINER_DEPTH = 6.5
export function strainer() {
  const g = new Group()
  const r = STRAINER_R
  const depth = STRAINER_DEPTH
  const prof: Vector2[] = []
  for (let i = 0; i <= 14; i++) {
    const t = i / 14
    prof.push(new Vector2(r * Math.sin((t * Math.PI) / 2), depth * (1 - Math.cos((t * Math.PI) / 2))))
  }
  const bowl = new Mesh(new LatheGeometry(prof, 48), bambooMat({ w: 1.15, holes: true, mode: 'polar', gap: 0.24, color: '#B88F58', dark: '#7A5A36' }))
  bowl.castShadow = true
  bowl.receiveShadow = true
  bowl.customDepthMaterial = undefined
  g.add(bowl)
  const hoopMat = bambooPlainMat({ axis: 'x', color: '#A9824F' })
  const hoop = new Mesh(new TorusGeometry(r, 0.7, 8, 56), hoopMat)
  hoop.rotation.x = Math.PI / 2
  hoop.position.y = depth
  hoop.castShadow = true
  g.add(hoop)
  // 柄：从兜沿伸出去，微微往上翘
  const handle = new Mesh(new CylinderGeometry(0.75, 0.95, 42, 10), bambooPlainMat({ axis: 'y', node: 13, color: '#B58C55' }))
  handle.geometry.translate(0, 21, 0)
  handle.position.set(r - 0.6, depth - 0.2, 0)
  handle.rotation.z = -Math.PI / 2 + 0.42
  handle.castShadow = true
  g.add(handle)
  // 柄和兜接头处缠的篾
  const wrap = new Mesh(new CylinderGeometry(1.15, 1.15, 3.2, 12), hoopMat)
  wrap.position.set(r + 0.6, depth + 0.4, 0)
  wrap.rotation.z = -Math.PI / 2 + 0.42
  g.add(wrap)
  return g
}

export class Stove {
  readonly group = new Group()
  readonly steam: Puffs
  readonly smoke: Puffs
  readonly fireLight: PointLight
  readonly fireI = { value: 1 }
  readonly waterU: Record<string, { value: number | Vector3 | Vector4 }>
  readonly drain: Group
  readonly strainer: Group
  readonly waterY: number

  constructor() {
    const g = this.group
    const S = LAYOUT.stove
    const top = LAYOUT.stoveTop
    const w = 152
    const d = 86
    const x0 = S.x - w / 2
    const z0 = S.z - d / 2
    const wok = LAYOUT.wok
    const front = S.z + d / 2

    // 灶身：前墙挖灶口，其余三面和灶面
    const bodyH = top - 18
    const brick = brickMat({ plasterTop: true, whitewash: 0.25, soot: new Vector4(wok.x, 24, front, 36) })
    const fs = new Shape()
    fs.moveTo(-w / 2, 0)
    fs.lineTo(w / 2, 0)
    fs.lineTo(w / 2, bodyH)
    fs.lineTo(-w / 2, bodyH)
    fs.closePath()
    const mouth = new Path()
    const mx = wok.x - S.x
    mouth.moveTo(mx - 16, 10)
    mouth.lineTo(mx + 16, 10)
    mouth.lineTo(mx + 16, 26)
    mouth.absarc(mx, 26, 16, 0, Math.PI, false)
    mouth.lineTo(mx - 16, 10)
    fs.holes.push(mouth)
    const frontWall = new Mesh(new ExtrudeGeometry(fs, { depth: 10, bevelEnabled: false, curveSegments: 16 }), brick)
    frontWall.position.set(S.x, 0, front - 10)
    frontWall.castShadow = frontWall.receiveShadow = true
    g.add(frontWall)
    const side = (bw: number, bd: number, x: number, z: number) => {
      const m = new Mesh(new BoxGeometry(bw, bodyH, bd), brick)
      m.position.set(x, bodyH / 2, z)
      m.castShadow = m.receiveShadow = true
      g.add(m)
    }
    side(10, d - 10, x0 + 5, z0 + (d - 10) / 2)
    side(10, d - 10, x0 + w - 5, z0 + (d - 10) / 2)
    side(w - 20, 10, S.x, z0 + 5)
    // 灶膛里：黑的。往里缩一点、离地抬一点：贴着砖墙内面、灶面底、地面画会和它们抢深度，灶膛里一片片地闪
    const fire = new Mesh(new BoxGeometry(w - 20 - 2 * SOOT_INSET, bodyH - 1 - 2 * SOOT_INSET, d - 20 - 2 * SOOT_INSET), sootMat())
    fire.position.set(S.x, SOOT_INSET + (bodyH - 1 - 2 * SOOT_INSET) / 2, S.z)
    g.add(fire)

    // 灶面：一块厚板，挖出锅口
    const ts = new Shape()
    ts.moveTo(-w / 2 - 2, -d / 2 - 2)
    ts.lineTo(w / 2 + 2, -d / 2 - 2)
    ts.lineTo(w / 2 + 2, d / 2 + 2)
    ts.lineTo(-w / 2 - 2, d / 2 + 2)
    ts.closePath()
    const wh = new Path()
    wh.absarc(wok.x - S.x, -(wok.z - S.z), LAYOUT.wokR + 0.3, 0, Math.PI * 2, true)
    ts.holes.push(wh)
    // 倒角会在上下各多出 1 厘米：灶面顶 = bodyH + 17 + 1 = 80
    const slab = new Mesh(new ExtrudeGeometry(ts, { depth: 17, bevelEnabled: true, bevelThickness: 1, bevelSize: 1, bevelSegments: 2, curveSegments: 48 }), brick)
    slab.rotation.x = -Math.PI / 2
    slab.position.set(S.x, bodyH, S.z)
    slab.castShadow = slab.receiveShadow = true
    g.add(slab)

    // 铁锅：车出来的薄壳
    const R = LAYOUT.wokR
    const prof: Vector2[] = []
    const depth = 15
    for (let i = 0; i <= 16; i++) {
      const t = i / 16
      prof.push(new Vector2(R * Math.sin((t * Math.PI) / 2), -depth * Math.cos((t * Math.PI) / 2)))
    }
    prof.push(new Vector2(R + 1.4, 0.4), new Vector2(R + 1.4, 1.1), new Vector2(R - 0.4, 1.0))
    for (let i = 16; i >= 0; i--) {
      const t = i / 16
      prof.push(new Vector2((R - 0.5) * Math.sin((t * Math.PI) / 2), -(depth - 0.5) * Math.cos((t * Math.PI) / 2) + 0.01))
    }
    const wokMat = ironMat({ polish: 0.8, rust: 0.15, polishR: 18 })
    wokMat.side = DoubleSide
    const wokMesh = new Mesh(new LatheGeometry(prof, 72), wokMat)
    wokMesh.position.set(wok.x, top + 0.2, wok.z)
    wokMesh.castShadow = wokMesh.receiveShadow = true
    g.add(wokMesh)

    // 锅里的水
    this.waterY = top + LAYOUT.water
    const wr = R * Math.sin(Math.acos(Math.min(1, -LAYOUT.water / depth))) - 0.4
    this.waterU = {
      uBoil: { value: 0 },
      uSplash: { value: new Vector4(0, 0, -100, 0) },
      uTime: SHARED.uTime as { value: number },
      uR: { value: wr },
    }
    const water = new Mesh(
      new CylinderGeometry(wr, wr, 0.1, 72, 1),
      procPhysical(
        { color: '#5E6A4E', roughness: 0.06, metalness: 0, transparent: true, opacity: 0.86, clearcoat: 0, envMapIntensity: 2.2 },
        {
          uniforms: this.waterU as Record<string, { value: number | Vector3 | Vector4 }>,
          color: /* glsl */ `
            vec2 p = vPos.xz;
            float t = uTime;
            float b = uBoil;
            // 火在锅底正中，滚得最凶的是中间：越往锅边越平
            float center = 1.0 - smoothstep(uR * 0.15, uR * 0.95, length(p));
            // 大的翻滚：几团慢慢鼓起、塌下去的水
            float churn = fbm2(p * 0.085 + vec2(t * 0.32, -t * 0.27)) - 0.5;
            churn += (fbm2(p * 0.16 + vec2(-t * 0.5, t * 0.41) + 7.0) - 0.5) * 0.6;
            float h = churn * 3.2 * b * (0.25 + 0.75 * center);
            h += sin(length(p) * 0.45 - t * 1.6) * 0.05 * (0.3 + b);
            // 两层气泡：一大一小，集中在中间；鼓起来，破掉，留一圈涟漪
            float bubbles = 0.0;
            for (int L = 0; L < 2; L++) {
              float sc = L == 0 ? 2.6 : 1.5;
              vec2 q = p / sc + float(L) * 17.0;
              vec2 cell = floor(q);
              vec2 f = fract(q) - 0.5;
              float rr = hash12(cell);
              float chance = b * (L == 0 ? 0.08 + 0.8 * center : 0.04 + 0.6 * center);
              float act = step(1.0 - chance, hash12(cell + 9.1));
              float ph = fract(t * (0.9 + rr * 1.1) + rr * 7.0);
              vec2 off = (hash22(cell) - 0.5) * 0.4;
              float d = length(f - off);
              float rad = 0.14 + 0.22 * ph;
              float dome = (1.0 - smoothstep(rad * 0.4, rad, d)) * smoothstep(0.0, 0.4, ph) * (1.0 - step(0.88, ph));
              float ring = (1.0 - smoothstep(0.0, 0.05, abs(d - (ph - 0.88) * 2.8))) * step(0.88, ph) * (1.0 - ph) * 8.0;
              h += (dome * 0.25 + ring * 0.06) * act * sc;
              bubbles += dome * act;
            }
            // 果子下锅时的一圈水花
            vec2 sd = p - uSplash.xy;
            float st = t - uSplash.z;
            if (st > 0.0 && st < 3.0) {
              float dd = length(sd);
              h += sin(dd * 1.6 - st * 9.0) * exp(-st * 1.4) * exp(-dd * 0.08) * smoothstep(st * 9.0 + 2.0, st * 9.0 - 2.0, dd * 1.6) * 0.9 * uSplash.w;
            }
            procBump = h * 0.4;
            // 泡沫：气泡挤在一起、水翻上来的地方发白
            float foam = clamp(bubbles * 0.45 + smoothstep(0.2, 0.7, churn) * center * 0.8, 0.0, 1.0) * b;
            // 水本身：浅一点的黄绿浑水，翻滚处更亮
            diffuseColor.rgb *= 1.0 + 0.35 * churn * b;
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.92, 0.86), foam * 0.6);
            diffuseColor.a = mix(diffuseColor.a, 1.0, foam * 0.5);
          `,
          bump: true,
        },
      ),
    )
    water.position.set(wok.x, this.waterY, wok.z)
    water.receiveShadow = true
    g.add(water)

    // 水汽
    this.steam = new Puffs({ count: 60, life: 4.2, rise: 70, spread: 10, size: 24, radius: wr * 0.8, drift: new Vector3(6, 0, 10), opacity: 0.26, seed: 3, nearFade: [20, 70] })
    g.add(this.steam.mesh)

    // 灶口里的火：几片交叉的火苗 + 一盏会跳的暖灯
    const flames = new InstancedMesh(new PlaneGeometry(14, 22), flameMaterial(this.fireI), 6)
    const seeds = new Float32Array(6)
    const dummy = new Object3D()
    const r = rng(2)
    for (let i = 0; i < 6; i++) {
      dummy.position.set(wok.x - 9 + i * 3.6, 10 + 11, front - 26 + (i % 2) * 6)
      dummy.rotation.set(0, (i % 3) * 0.9 - 0.6, 0)
      dummy.scale.setScalar(0.8 + r() * 0.5)
      dummy.updateMatrix()
      flames.setMatrixAt(i, dummy.matrix)
      seeds[i] = r()
    }
    flames.geometry.setAttribute('aSeed', new InstancedBufferAttribute(seeds, 1))
    flames.frustumCulled = false
    g.add(flames)
    // 柴
    const logs = new InstancedMesh(new CylinderGeometry(2.6, 3, 40, 8), barkMat({ color: '#5E4A3A' }), 4)
    for (let i = 0; i < 4; i++) {
      dummy.position.set(wok.x - 8 + i * 5, 12.5, front - 12 - i * 3)
      dummy.rotation.set(Math.PI / 2 + 0.1 * (i - 1.5), 0.25 * (i - 1.5), 0)
      dummy.scale.setScalar(1)
      dummy.updateMatrix()
      logs.setMatrixAt(i, dummy.matrix)
    }
    g.add(logs)
    this.fireLight = new PointLight('#FF8C3E', 8000, 0, 2)
    this.fireLight.position.set(wok.x, 24, front + 4)
    g.add(this.fireLight)

    // 烟囱 + 炊烟：立在灶的右后角，让开锅口
    const chimX = x0 + w - 16
    const chimZ = z0 + 15
    const chim = new Mesh(new BoxGeometry(28, 330, 28), brickMat({ whitewash: 0.5 }))
    chim.position.set(chimX, top + 165, chimZ)
    // 烟囱不投影：中午它的影子正好横在焙炉竹筛上，而且阴影只算焦点附近一段，会切成一道道直边
    chim.castShadow = false
    chim.receiveShadow = true
    g.add(chim)
    this.smoke = new Puffs({ count: 40, life: 9, rise: 260, spread: 40, size: 90, radius: 8, drift: new Vector3(80, 0, 40), lit: '#F4EEE6', shade: '#A9A2B0', opacity: 0.32, seed: 9 })
    this.smoke.set(new Vector3(chimX, top + 335, chimZ), 1)
    g.add(this.smoke.mesh)

    // 柴堆：焙炉右手边，靠墙（灶和焙炉之间放不下）
    const pileX = LAYOUT.oven.x + 33 + 42
    const pile = new InstancedMesh(new CylinderGeometry(3.2, 3.6, 62, 7), barkMat(), 34)
    let n = 0
    for (let row = 0; row < 5; row++) {
      for (let k = 0; k < 7 - row; k++) {
        dummy.position.set(pileX, 3.5 + row * 6.2, z0 + 12 + k * 7.2 + row * 3.6)
        dummy.rotation.set(0, 0, Math.PI / 2 + (r() - 0.5) * 0.1)
        dummy.position.x += (r() - 0.5) * 8
        dummy.scale.setScalar(0.85 + r() * 0.3)
        dummy.updateMatrix()
        if (n < 34) pile.setMatrixAt(n++, dummy.matrix)
      }
    }
    pile.count = n
    pile.castShadow = pile.receiveShadow = true
    g.add(pile)

    // 靠墙的木锅盖
    const lid = new Group()
    const lidDisk = new Mesh(new CylinderGeometry(34, 34, 3, 48), woodMat({ axis: 'x', plank: 11, seed: 12, light: '#9A7A58', dark: '#5C4331' }))
    lidDisk.castShadow = lidDisk.receiveShadow = true
    lid.add(lidDisk)
    const bar = new Mesh(new BoxGeometry(30, 4, 5), woodMat({ axis: 'x', seed: 13 }))
    bar.position.y = 3
    lid.add(bar)
    lid.rotation.set(Math.PI / 2 - 0.22, 0, 0)
    lid.position.set(pileX + 66, 36, z0 + 6)
    g.add(lid)

    // 灶面上沥水的小竹筛
    this.drain = roundSieve(15, 2.6)
    this.drain.position.copy(LAYOUT.drain)
    g.add(this.drain)

    // 笊篱
    this.strainer = strainer()
    g.add(this.strainer)
  }
}

/** 灶膛内壁：烟熏的黑 */
/** 灶膛（背面朝里画的黑盒子）比墙、地往里缩多少 */
export const SOOT_INSET = 0.6

export function sootMat() {
  return procStandard(
    { roughness: 1, metalness: 0, side: BackSide },
    {
      uniforms: { uSoot: { value: new Color('#1E1716') } },
      color: /* glsl */ `
        float n = fbm3(vPos * 0.1) * 0.5 + 0.5;
        diffuseColor.rgb = uSoot * (0.7 + 0.6 * n);
      `,
    },
  )
}
