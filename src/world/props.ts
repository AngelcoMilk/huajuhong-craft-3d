import {
  BoxGeometry,
  BufferGeometry,
  CatmullRomCurve3,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  LatheGeometry,
  Mesh,
  MeshPhysicalMaterial,
  Object3D,
  PlaneGeometry,
  Shape,
  TorusGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
  type Material,
} from 'three'
import { procPhysical, procStandard } from '../gfx/proc'
import { rng } from '../util'
import { LAYOUT } from './layout'
import { bambooMat, bambooPlainMat, barkMat, ceramicMat, clayMat, clothMat, enamelMat, ironMat, woodMat } from './materials'
import { roundSieve } from './stove'

// 家常的小物件：都是代码画的，摆在镜头真正拍得到的地方，当背景用。
//   案台：搪瓷杯、暖水瓶、蒲扇、抹布
//   灶台：盐罐、油瓶、火柴盒；灶前：火钳、吹火筒；灶后墙：灶君纸和小香炉
//   焙炉前：炭篓、矮凳、靠着的蒲扇
//   门口和窗台：旧对联、草帽、日历、收音机、玻璃罐、竹扫帚、咸菜坛、脸盆架
//   晒场边：矮凳上一簸箕晒着的辣椒
// 头顶不放东西：加工的特写里不要从上面打下来的大块影子（用户要求）。
// 红色只用暗一点、褪了色的红，发夹红 #C8452F 仍然只给红头绳和印章。

function mesh(geo: BufferGeometry, mat: Material, cast = true, receive = true) {
  const m = new Mesh(geo, mat)
  m.castShadow = cast
  m.receiveShadow = receive
  return m
}

const lathe = (pts: [number, number][], segs = 32) => new LatheGeometry(pts.map(([r, y]) => new Vector2(r, y)), segs)

/** 褪了色的红纸（对联、灶君纸）：纸纹、起皱、边上撕破，上面几行看不清的墨字 */
function paperMat(o: { color?: string; chars?: number; w: number; h: number; ink?: string; fade?: number }) {
  return procStandard(
    { roughness: 0.92, metalness: 0, side: DoubleSide },
    {
      uniforms: {
        uPaper: { value: new Color(o.color ?? '#B4493A') },
        uInk: { value: new Color(o.ink ?? '#2A1A16') },
        uChars: { value: o.chars ?? 7 },
        uSize: { value: new Vector2(o.w, o.h) },
        uFade: { value: o.fade ?? 0.55 },
      },
      discard: /* glsl */ `
        {
          vec2 e = (vPos.xy / uSize + 0.5);
          float rag = (snoise(vec3(vPos.xy * 0.9, 3.0)) * 0.5 + 0.5) * 0.035;
          if (min(min(e.x, 1.0 - e.x) * uSize.x, min(e.y, 1.0 - e.y) * uSize.y) < rag * 10.0 - 0.15) discard;
        }
      `,
      color: /* glsl */ `
        vec2 e = vPos.xy / uSize + 0.5;
        float n = fbm3(vec3(vPos.xy * 0.35, 1.0)) * 0.5 + 0.5;
        vec3 col = uPaper * (0.78 + 0.3 * n);
        // 日晒雨淋：上半截褪得更厉害，泛白发粉
        float sun = smoothstep(0.2, 1.0, e.y) * 0.35 + (1.0 - n) * 0.25;
        col = mix(col, vec3(0.86, 0.66, 0.6), sun * uFade);
        // 字：每格里几笔，笔画随机，已经洇淡了（看不清写的什么，只看得出是字）
        bool vertical = uSize.y > uSize.x;
        vec2 g = vertical ? vec2(e.x, e.y * uChars) : vec2(e.x * uChars, e.y);
        vec2 cell = floor(g);
        vec2 f = fract(g);
        float ink = 0.0;
        for (int i = 0; i < 5; i++) {
          vec2 h1 = hash22(cell + float(i) * 7.3);
          vec2 h2 = hash22(cell + float(i) * 3.1 + 11.0);
          vec2 a = 0.22 + 0.56 * h1;
          vec2 b = 0.22 + 0.56 * h2;
          vec2 pa = f - a, ba = b - a;
          float t = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
          float d = length(pa - ba * t);
          ink = max(ink, 1.0 - smoothstep(0.035, 0.06, d));
        }
        ink *= step(0.08, f.x) * step(0.08, f.y) * step(f.x, 0.92) * step(f.y, 0.92);
        col = mix(col, uInk, ink * (0.75 - 0.45 * uFade) * (0.7 + 0.3 * n));
        diffuseColor.rgb = col;
        procBump = (n - 0.5) * 0.04;
      `,
      bump: true,
    },
  )
}

/** 刷了漆的铁皮（暖水瓶壳）：一圈浅色碎花，旧了以后漆面有磕碰 */
function tinMat(base: string, flower: string) {
  return procPhysical(
    { roughness: 0.35, metalness: 0.15, clearcoat: 0.5, clearcoatRoughness: 0.3 },
    {
      uniforms: { uBase: { value: new Color(base) }, uFlower: { value: new Color(flower) } },
      color: /* glsl */ `
        vec3 p = vPos;
        float a = atan(p.z, p.x);
        vec2 q = vec2(a * 6.0, p.y * 0.8);
        vec2 c = fract(q) - 0.5;
        float r = length(c);
        float petal = abs(cos(atan(c.y, c.x) * 2.5));
        float fl = (1.0 - smoothstep(0.18, 0.22, r / (0.6 + 0.4 * petal))) * step(10.0, p.y) * step(p.y, 24.0);
        vec3 col = mix(uBase, uFlower, fl * 0.85);
        float chip = step(0.94, hash13(floor(p * 2.0))) * 0.6;
        col = mix(col, vec3(0.55, 0.55, 0.52), chip);
        col *= 0.9 + 0.1 * (fbm3(p * 0.3) * 0.5 + 0.5);
        diffuseColor.rgb = col;
      `,
    },
  )
}

/** 蒲扇：葵叶扇面（放射状的叶脉，边缘一圈包边）+ 叶柄 */
function palmFan() {
  const g = new Group()
  const mat = procStandard(
    { roughness: 0.75, metalness: 0, side: DoubleSide },
    {
      uniforms: { uA: { value: new Color('#CDB27A') }, uB: { value: new Color('#9C7F4E') } },
      color: /* glsl */ `
        vec2 p = vPos.xz;
        float r = length(p);
        float a = atan(p.y, p.x);
        float rib = smoothstep(0.75, 1.0, abs(sin(a * 22.0)));
        float rim = smoothstep(10.6, 11.2, r);
        vec3 col = mix(uA, uB, rib * 0.45 + rim * 0.8);
        col *= 0.88 + 0.16 * (fbm3(vec3(p * 0.5, 0.0)) * 0.5 + 0.5);
        diffuseColor.rgb = col;
        procBump = rib * 0.03;
      `,
      bump: true,
    },
  )
  // 扇面：一个略扁的圆，柄那头收一点
  const s = new Shape()
  const N = 48
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI * 2
    const r = 11.6 * (1 - 0.12 * Math.max(0, Math.cos(a)) ** 3)
    const x = Math.cos(a) * r
    const y = Math.sin(a) * r * 0.92
    if (i === 0) s.moveTo(x, y)
    else s.lineTo(x, y)
  }
  const face = new ExtrudeGeometry(s, { depth: 0.12, bevelEnabled: false })
  face.rotateX(-Math.PI / 2)
  g.add(mesh(face, mat))
  const handle = mesh(new CylinderGeometry(0.55, 0.7, 13, 8), bambooPlainMat({ axis: 'y', color: '#B08A55' }))
  handle.rotation.z = Math.PI / 2
  handle.position.set(17, 0.3, 0)
  g.add(handle)
  return g
}

/** 矮木凳：方凳面 + 四条略外撇的腿 */
function lowStool(seed: number, h = 24) {
  const g = new Group()
  const top = mesh(new BoxGeometry(26, 2.6, 20), woodMat({ axis: 'x', seed, light: '#94704F', dark: '#5A3F2D', plank: 10, worn: 0.5 }))
  top.position.y = h - 1.3
  g.add(top)
  const legMat = woodMat({ axis: 'y', seed: seed + 1, light: '#8A6447', dark: '#4E372A' })
  for (const [x, z] of [[-10, -7], [10, -7], [-10, 7], [10, 7]]) {
    const leg = mesh(new CylinderGeometry(1.2, 1.5, h - 2.6, 8), legMat)
    leg.position.set(x * 1.05, (h - 2.6) / 2, z * 1.05)
    leg.rotation.set(z > 0 ? 0.07 : -0.07, 0, x > 0 ? -0.07 : 0.07)
    g.add(leg)
  }
  return g
}

/** 一棵小树枝做的火钳：两根铁条，上头弯成环 */
function tongs() {
  const g = new Group()
  const mat = ironMat({ polish: 0.2, rust: 0.5, polishR: 6 })
  for (const side of [-1, 1]) {
    const curve = new CatmullRomCurve3([
      new Vector3(side * 0.8, 0, 0),
      new Vector3(side * 0.5, 20, 0),
      new Vector3(side * 0.2, 42, 0),
      new Vector3(side * 1.6, 46, 0),
      new Vector3(0, 48.5, 0),
    ])
    g.add(mesh(new TubeGeometry(curve, 30, 0.32, 6, false), mat))
  }
  return g
}

export class Props {
  readonly group = new Group()

  constructor() {
    this.table()
    this.stove()
    this.oven()
    this.facade()
    this.washstand()
    this.dryingSide()
  }

  private add(m: Object3D, x: number, y: number, z: number, ry = 0) {
    m.position.set(x, y, z)
    m.rotation.y = ry
    this.group.add(m)
    return m
  }

  // ———— 案台 ————
  private table() {
    const top = LAYOUT.tableTop
    // 搪瓷杯：白底蓝边，杯里半杯茶
    const mug = new Group()
    mug.add(mesh(lathe([[0, 0], [3.9, 0], [4.1, 0.4], [4.1, 8.4], [4.35, 8.6], [4.2, 8.8], [3.85, 8.6], [3.85, 0.6], [0, 0.6]], 36), enamelMat({ rimY: 8.9 })))
    const handle = mesh(new TorusGeometry(2.3, 0.42, 8, 20, Math.PI * 1.2), enamelMat({ rimY: 99 }))
    handle.rotation.z = -Math.PI * 0.1 - Math.PI / 2
    handle.position.set(4.4, 4.6, 0)
    mug.add(handle)
    const tea = mesh(new CylinderGeometry(3.82, 3.82, 0.05, 30), new MeshPhysicalMaterial({ color: '#6B4A22', roughness: 0.05, clearcoat: 1 }), false)
    tea.position.y = 5.6
    mug.add(tea)
    this.add(mug, LAYOUT.mug.x, top + 0.01, LAYOUT.mug.z, 2.4)

    // 暖水瓶：铁皮壳刷绿漆、一圈碎花，铝盖、木塞
    const flask = new Group()
    flask.add(mesh(lathe([[0, 0], [5.6, 0], [6.0, 0.6], [6.0, 26], [5.2, 28.5], [3.0, 30.5], [2.6, 31], [0, 31]], 36), tinMat('#4F7766', '#E9E0C9')))
    const cap = mesh(lathe([[0, 31], [2.9, 31], [2.9, 34.5], [2.6, 35], [0, 35]], 24), new MeshPhysicalMaterial({ color: '#C9C7C1', metalness: 1, roughness: 0.35 }))
    flask.add(cap)
    const ring = mesh(new TorusGeometry(6.05, 0.25, 6, 40), new MeshPhysicalMaterial({ color: '#BDBAB2', metalness: 1, roughness: 0.4 }))
    ring.rotation.x = Math.PI / 2
    ring.position.y = 1.0
    flask.add(ring)
    this.add(flask, -92, top + 0.01, -22)

    // 蒲扇：随手搁在案上
    const fan = palmFan()
    fan.rotation.y = 0.5
    this.add(fan, 100, top + 0.15, -10, 0.5)

    // 抹布：叠起来的一块蓝格子布
    const cloth = mesh(new BoxGeometry(14, 0.8, 10), clothMat({ color: '#6F86A0', scale: 1.2 }))
    this.add(cloth, -40, top + 0.41, -78, 0.15)
  }

  // ———— 灶 ————
  private stove() {
    const top = LAYOUT.stoveTop
    // 灶面右后角：盐罐、油瓶、火柴盒
    const salt = new Group()
    salt.add(mesh(lathe([[0, 0], [3.4, 0], [4.2, 2], [4.4, 6], [3.6, 8.4], [2.4, 9], [0, 9]], 28), ceramicMat({ glaze: '#D9CFB6', bandY: [6.5, 1.5], band: '#6B7E92' })))
    const lid = mesh(lathe([[0, 9.6], [2.6, 9.6], [2.8, 9.0], [0, 9.0]], 20), ceramicMat({ glaze: '#CFC4A8' }))
    salt.add(lid)
    this.add(salt, -224, top + 0.01, -287)
    const oilGlass = new MeshPhysicalMaterial({ color: '#C79A4A', roughness: 0.08, metalness: 0, transparent: true, opacity: 0.55, clearcoat: 1 })
    const bottle = mesh(lathe([[0, 0], [3, 0], [3.2, 0.5], [3.2, 13], [1.4, 16], [1.1, 19], [0, 19]], 28), oilGlass)
    this.add(bottle, -214, top + 0.01, -279)
    const oil = mesh(new CylinderGeometry(2.95, 2.95, 7, 24), new MeshPhysicalMaterial({ color: '#9A6A18', roughness: 0.2, transparent: true, opacity: 0.8 }), false)
    this.add(oil, -214, top + 3.6, -279)
    const match = mesh(new BoxGeometry(5.2, 1.6, 3.6), procStandard(
      { roughness: 0.8, metalness: 0 },
      {
        uniforms: { uA: { value: new Color('#C9B98F') }, uB: { value: new Color('#3E5F7F') } },
        color: /* glsl */ `
          float label = step(abs(vPos.x), 1.8) * step(abs(vPos.z), 1.2) * step(0.7, vPos.y);
          float side = 1.0 - step(0.7, abs(vNrm.y));
          vec3 col = mix(uA, uB, label);
          col = mix(col, vec3(0.32, 0.2, 0.16), side * step(1.6, abs(vPos.z)));
          diffuseColor.rgb = col;
        `,
      },
    ))
    this.add(match, -297, top + 0.81, -222, 0.3)

    // 灶前：靠着灶墙的火钳和吹火筒，地上几根柴
    const front = LAYOUT.stove.z + 43
    const tg = tongs()
    tg.rotation.set(-0.22, 0.3, 0)
    this.add(tg, -228, 0.2, front + 9.5, 0.3)
    const pipe = mesh(new CylinderGeometry(1.6, 1.8, 62, 10), bambooPlainMat({ axis: 'y', node: 18, color: '#A88452' }))
    pipe.rotation.set(-0.3, 0, 0.08)
    this.add(pipe, -300, 30, front + 9.5)
    const twigs = new InstancedMesh(new CylinderGeometry(0.9, 1.1, 40, 6), barkMat({ color: '#6A5442' }), 5)
    const d = new Object3D()
    const r = rng(31)
    for (let i = 0; i < 5; i++) {
      d.position.set(-245 + (r() - 0.5) * 30, 1.0 + (i % 2) * 1.6, front + 22 + (r() - 0.5) * 10)
      d.rotation.set(Math.PI / 2, 0, 0.6 + (r() - 0.5) * 0.9)
      d.updateMatrix()
      twigs.setMatrixAt(i, d.matrix)
    }
    twigs.castShadow = true
    twigs.receiveShadow = true
    this.group.add(twigs)

    // 灶后墙：一张褪色的灶君红纸，底下一个小香炉插着几支香
    const paper = mesh(new PlaneGeometry(16, 24, 1, 1), paperMat({ w: 16, h: 24, chars: 3, color: '#A9473A', fade: 0.6 }), false)
    this.add(paper, -288, 104, LAYOUT.wallZ + 0.4)
    const burner = new Group()
    burner.add(mesh(lathe([[0, 0], [2.4, 0], [3.2, 1.6], [3.4, 3.4], [3.0, 3.8], [0, 3.6]], 20), clayMat({ color: '#6E4A36' })))
    const stickMat = new MeshPhysicalMaterial({ color: '#7A2E22', roughness: 0.8 })
    for (let i = 0; i < 3; i++) {
      const st = mesh(new CylinderGeometry(0.12, 0.12, 9, 5), stickMat, false)
      st.position.set((i - 1) * 0.8, 7.5, 0)
      st.rotation.z = (i - 1) * 0.08
      burner.add(st)
    }
    this.add(burner, -288, LAYOUT.stoveTop + 0.01, LAYOUT.wallZ + 6)
  }

  // ———— 焙炉 ————
  private oven() {
    const O = LAYOUT.oven
    const front = O.z + 29
    // 炭篓：竹编小篓，装着黑炭
    const basket = new Group()
    basket.add(mesh(lathe([[0, 0], [9, 0], [10.5, 2], [12.5, 14], [13, 16]], 32), bambooMat({ w: 1.0, radius: 11, mode: 'cyl', color: '#9C7A48', dark: '#5E4528' })))
    const coal = new InstancedMesh(new IcosahedronGeometry(2.2, 0), procStandard(
      { roughness: 0.95, metalness: 0 },
      { color: /* glsl */ `diffuseColor.rgb = vec3(0.09, 0.085, 0.085) * (0.8 + 0.5 * (fbm3(vPos * 0.6) * 0.5 + 0.5));` },
    ), 16)
    const d = new Object3D()
    const r = rng(12)
    for (let i = 0; i < 16; i++) {
      const a = r() * Math.PI * 2
      const rr = Math.sqrt(r()) * 8.5
      d.position.set(Math.cos(a) * rr, 12 + r() * 3, Math.sin(a) * rr)
      d.rotation.set(r() * 6, r() * 6, r() * 6)
      d.scale.set(0.8 + r() * 0.6, 0.6 + r() * 0.5, 0.8 + r() * 0.5)
      d.updateMatrix()
      coal.setMatrixAt(i, d.matrix)
    }
    coal.castShadow = true
    basket.add(coal)
    this.add(basket, O.x - 52, 0.01, front + 14)
    // 矮凳 + 搭在凳上的蒲扇（扇火用）
    const stool = lowStool(61)
    this.add(stool, O.x + 6, 0, front + 34, -0.25)
    const fan = palmFan()
    fan.rotation.set(0, 2.2, 0)
    this.add(fan, O.x + 4, 24.2, front + 33, 2.2)
  }

  // ———— 门口、窗台 ————
  private facade() {
    const W = LAYOUT.wallZ
    const door = LAYOUT.door
    // 旧对联：贴在门两边的石门框上，横批贴在门楣上
    for (const side of [-1, 1]) {
      const strip = mesh(new PlaneGeometry(13, 150), paperMat({ w: 13, h: 150, chars: 7, fade: 0.6 }), false)
      this.add(strip, door.x + side * (55 + 9), 128, W + 10.2)
    }
    const banner = mesh(new PlaneGeometry(84, 15), paperMat({ w: 84, h: 15, chars: 4, fade: 0.65 }), false)
    this.add(banner, door.x, 253, W + 12.2)

    // 草帽：挂在门右边墙上的钉子上
    const hat = mesh(
      lathe([[0, 6.2], [4.5, 6.0], [7.0, 4.2], [7.6, 1.6], [8.4, 0.6], [15.5, 0.0], [16, -0.4], [15.4, -0.2], [8.2, 0.2], [7.2, 1.4], [6.6, 3.8], [4.3, 5.6], [0, 5.8]], 48),
      bambooMat({ w: 0.55, mode: 'polar', color: '#D7BE86', dark: '#9C8050' }),
    )
    hat.rotation.x = Math.PI / 2 - 0.12
    this.add(hat, door.x + 112, 196, W + 2.2)
    // 日历：一块小木板，上面一沓纸（红抬头，一个大号的黑字）
    const cal = new Group()
    cal.add(mesh(new BoxGeometry(15, 22, 0.8), woodMat({ axis: 'y', seed: 71, light: '#8A6A4C', dark: '#5A4030' })))
    const sheet = mesh(new BoxGeometry(12, 14, 1.2), procStandard(
      { roughness: 0.9, metalness: 0 },
      {
        color: /* glsl */ `
          vec2 p = vPos.xy;
          vec3 col = vec3(0.93, 0.9, 0.84);
          col = mix(col, vec3(0.62, 0.22, 0.18), step(4.6, p.y));
          float dig = (1.0 - smoothstep(0.35, 0.6, abs(length(vec2(p.x * 1.2 + 1.6, p.y + 0.6)) - 2.0))) + (1.0 - smoothstep(0.35, 0.6, abs(p.x - 2.6))) * step(abs(p.y + 0.6), 2.6);
          col = mix(col, vec3(0.16, 0.14, 0.13), clamp(dig, 0.0, 1.0) * step(p.y, 4.0));
          diffuseColor.rgb = col;
        `,
      },
    ), false)
    sheet.position.set(0, -2.5, 0.9)
    cal.add(sheet)
    this.add(cal, door.x + 112, 150, W + 0.5)

    // 竹扫帚：靠在门右边的墙脚
    const broom = new Group()
    const pole = mesh(new CylinderGeometry(1.1, 1.3, 110, 10), bambooPlainMat({ axis: 'y', node: 26, color: '#B89660' }))
    pole.position.y = 55 + 26
    broom.add(pole)
    const twig = new InstancedMesh(new CylinderGeometry(0.15, 0.3, 34, 4), barkMat({ color: '#7B6448' }), 40)
    const d = new Object3D()
    const r = rng(19)
    for (let i = 0; i < 40; i++) {
      const a = r() * Math.PI * 2
      const spread = 0.12 + r() * 0.3
      d.position.set(Math.cos(a) * spread * 17, 14 + r() * 4, Math.sin(a) * spread * 8)
      d.rotation.set(Math.sin(a) * spread * 0.9, 0, -Math.cos(a) * spread * 0.9)
      d.updateMatrix()
      twig.setMatrixAt(i, d.matrix)
    }
    twig.castShadow = true
    broom.add(twig)
    const tie = mesh(new CylinderGeometry(2.4, 2.6, 4, 12), bambooPlainMat({ axis: 'y', color: '#8E6E42' }))
    tie.position.y = 30
    broom.add(tie)
    broom.rotation.set(-0.16, 0, 0.06)
    this.add(broom, door.x + 84, 0, W + 22)

    // 咸菜坛：门左边、锅盖旁边
    const jar = new Group()
    jar.add(mesh(lathe([[0, 0], [7, 0], [9.6, 4], [10.4, 12], [9, 20], [6, 23.5], [6.4, 25], [5.6, 25.5], [5.2, 24]], 36), procPhysical(
      { roughness: 0.3, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.25 },
      {
        uniforms: { uGlaze: { value: new Color('#5E3A26') } },
        color: /* glsl */ `
          float n = fbm3(vPos * 0.15) * 0.5 + 0.5;
          vec3 col = uGlaze * (0.75 + 0.45 * n);
          col = mix(col, vec3(0.62, 0.5, 0.38), 1.0 - smoothstep(3.0, 4.0, vPos.y));
          diffuseColor.rgb = col;
        `,
      },
    )))
    const bowlLid = mesh(lathe([[0, 25.8], [6.6, 25.4], [7.4, 27.4], [0, 26.6]], 28), ceramicMat({ glaze: '#D7CDB4', footY: 25.9 }))
    jar.add(bowlLid)
    this.add(jar, 66, 0.01, W + 21)

    // 窗台：一台收音机、一个装着几片橘红的玻璃罐、一小盆蒜苗
    const sill = 101.5
    const radio = new Group()
    radio.add(mesh(new BoxGeometry(22, 13, 8), procPhysical(
      { roughness: 0.45, metalness: 0, clearcoat: 0.4 },
      {
        uniforms: { uBody: { value: new Color('#6B4A34') } },
        color: /* glsl */ `
          vec3 p = vPos;
          vec3 col = uBody * (0.9 + 0.1 * (fbm3(p * 0.5) * 0.5 + 0.5));
          float front = step(3.9, p.z);
          vec2 g = p.xy - vec2(-5.0, 0.0);
          float grille = front * step(length(g), 4.6) * smoothstep(0.3, 0.5, abs(fract(g.x * 1.6) - 0.5));
          col = mix(col, vec3(0.78, 0.7, 0.55), front * step(length(g), 4.8) * 0.7);
          col = mix(col, vec3(0.18, 0.15, 0.13), grille * 0.8);
          float dial = front * step(abs(p.x - 5.5), 4.0) * step(abs(p.y - 2.5), 1.6);
          col = mix(col, vec3(0.86, 0.8, 0.62), dial);
          col = mix(col, vec3(0.6, 0.2, 0.15), dial * step(abs(p.x - 4.2), 0.12));
          diffuseColor.rgb = col;
        `,
      },
    )))
    for (const x of [3.5, 7.5]) {
      const knob = mesh(new CylinderGeometry(1.0, 1.0, 1.2, 14), new MeshPhysicalMaterial({ color: '#2C2622', roughness: 0.5 }))
      knob.rotation.x = Math.PI / 2
      knob.position.set(x, -3, 4.4)
      radio.add(knob)
    }
    const antenna = mesh(new CylinderGeometry(0.15, 0.2, 26, 6), new MeshPhysicalMaterial({ color: '#CFCBC3', metalness: 1, roughness: 0.3 }))
    antenna.position.set(8, 6.5 + 12, -1)
    antenna.rotation.z = -0.5
    radio.add(antenna)
    this.add(radio, 10, sill + 6.5 + 0.01, W + 6, -0.08)
    const glass = new MeshPhysicalMaterial({ color: '#E8F0EC', roughness: 0.05, metalness: 0, transparent: true, opacity: 0.32, clearcoat: 1 })
    const jarG = new Group()
    jarG.add(mesh(lathe([[0, 0], [5.2, 0], [5.6, 0.6], [5.6, 14], [4.4, 15.4], [4.4, 16.6], [0, 16.6]], 28), glass, false))
    const capG = mesh(lathe([[0, 16.4], [4.7, 16.4], [4.7, 18.2], [0, 18.2]], 20), new MeshPhysicalMaterial({ color: '#A23C2E', roughness: 0.5 }))
    jarG.add(capG)
    // 罐里几片干橘红（暗橄榄、米色）
    const chips = new InstancedMesh(new BoxGeometry(3.2, 0.25, 1.6), new MeshPhysicalMaterial({ color: '#6A6B4E', roughness: 0.85 }), 9)
    for (let i = 0; i < 9; i++) {
      d.position.set((r() - 0.5) * 6, 0.6 + i * 0.9, (r() - 0.5) * 6)
      d.rotation.set((r() - 0.5) * 1.2, r() * 6, (r() - 0.5) * 1.2)
      d.scale.setScalar(1)
      d.updateMatrix()
      chips.setMatrixAt(i, d.matrix)
    }
    jarG.add(chips)
    this.add(jarG, -24, sill + 0.01, W + 7)
    const can = new Group()
    can.add(mesh(new CylinderGeometry(4.2, 4.2, 8, 20, 1, true), new MeshPhysicalMaterial({ color: '#B6B2A8', metalness: 0.9, roughness: 0.45, side: DoubleSide })))
    const soil = mesh(new CylinderGeometry(4.1, 4.1, 0.3, 16), new MeshPhysicalMaterial({ color: '#4A3A2E', roughness: 1 }))
    soil.position.y = 3.2
    can.add(soil)
    const sprout = new InstancedMesh(new CylinderGeometry(0.12, 0.25, 12, 4), new MeshPhysicalMaterial({ color: '#7FA34E', roughness: 0.6 }), 12)
    for (let i = 0; i < 12; i++) {
      d.position.set((r() - 0.5) * 5, 9, (r() - 0.5) * 5)
      d.rotation.set((r() - 0.5) * 0.5, 0, (r() - 0.5) * 0.5)
      d.updateMatrix()
      sprout.setMatrixAt(i, d.matrix)
    }
    can.add(sprout)
    can.children.forEach((m) => {
      if (m instanceof Mesh) m.castShadow = true
    })
    this.add(can, -52, sill + 4.01, W + 7)
  }

  // ———— 脸盆架：原来案上那只搪瓷盆挪到这上面，旁边搭一条毛巾 ————
  private washstand() {
    const S = LAYOUT.washstand
    const g = new Group()
    const wood = woodMat({ axis: 'y', seed: 81, light: '#7E5A40', dark: '#4A3426' })
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.4
      const leg = mesh(new CylinderGeometry(1.1, 1.3, 78, 8), wood)
      leg.position.set(Math.cos(a) * 15, 39, Math.sin(a) * 15)
      leg.rotation.set(Math.sin(a) * 0.08, 0, -Math.cos(a) * 0.08)
      g.add(leg)
    }
    const ring = mesh(new TorusGeometry(15.6, 1.0, 8, 40), wood)
    ring.rotation.x = Math.PI / 2
    ring.position.y = 70
    g.add(ring)
    const low = mesh(new TorusGeometry(17, 0.8, 6, 36), wood)
    low.rotation.x = Math.PI / 2
    low.position.y = 22
    g.add(low)
    // 后面一根立柱和毛巾杆
    const post = mesh(new CylinderGeometry(1.2, 1.3, 140, 8), wood)
    post.position.set(0, 70, -17)
    g.add(post)
    const bar = mesh(new CylinderGeometry(0.9, 0.9, 34, 8), wood)
    bar.rotation.z = Math.PI / 2
    bar.position.set(0, 130, -17)
    g.add(bar)
    // 毛巾：搭在杆上，两边垂下来
    const towelGeo = new PlaneGeometry(24, 52, 6, 20)
    const tp = towelGeo.attributes.position
    for (let i = 0; i < tp.count; i++) {
      const x = tp.getX(i)
      const t = tp.getY(i)
      // 中间一小段绕过杆子成半圆，两边垂下来
      const R = 1.4
      const bend = 2.2
      if (Math.abs(t) <= bend) {
        const th = (t / bend) * (Math.PI / 2)
        tp.setXYZ(i, x, 130 + R * Math.cos(th), -17 + R * Math.sin(th))
      } else {
        tp.setXYZ(i, x, 130 - (Math.abs(t) - bend), -17 + R * Math.sign(t))
      }
    }
    towelGeo.computeVertexNormals()
    const towel = mesh(towelGeo, procStandard(
      { roughness: 0.95, metalness: 0, side: DoubleSide },
      {
        color: /* glsl */ `
          vec3 col = vec3(0.92, 0.9, 0.84);
          float stripe = step(0.5, fract((vPos.y - 130.0) * 0.12)) * step(abs(vPos.y - 130.0), 40.0) * step(14.0, abs(vPos.y - 130.0));
          col = mix(col, vec3(0.42, 0.55, 0.68), stripe * 0.6);
          float terry = mix(0.5, hash13(floor(vPos * 4.0)), aaFade3(vPos * 4.0));
          col *= 0.9 + 0.12 * terry;
          diffuseColor.rgb = col;
          procBump = terry * 0.02;
        `,
        bump: true,
      },
    ))
    g.add(towel)
    // 搪瓷盆 + 半盆清水（洒水润皮用的就是这盆水）
    const basin = mesh(
      new LatheGeometry(
        [[0, 0], [11, 0], [12, 0.6], [16.5, 8.4], [18.2, 9.4], [18.2, 10], [17.4, 9.9], [15.8, 8.5], [11.2, 1.0], [0, 0.5]].map(([x, y]) => new Vector2(x, y)),
        56,
      ),
      enamelMat({ rimY: 10 }),
    )
    basin.position.y = 69.2
    g.add(basin)
    const water = mesh(new CylinderGeometry(15.2, 15.2, 0.1, 48), new MeshPhysicalMaterial({ color: '#BFD3D0', roughness: 0.03, metalness: 0, transparent: true, opacity: 0.55, clearcoat: 1 }), false)
    water.position.y = 69.2 + 6.6
    g.add(water)
    g.traverse((m) => {
      if (m instanceof Mesh) m.castShadow = m.receiveShadow = true
    })
    this.add(g, S.x, 0, S.z, -0.3)
  }

  // ———— 晒场边：矮凳上一簸箕晒着的红辣椒 ————
  private dryingSide() {
    const D = LAYOUT.dry
    const stool = lowStool(91, 30)
    this.add(stool, D.x - 96, 0, D.z - 34, 0.3)
    const tray = roundSieve(22, 3, { w: 1.1 })
    this.add(tray, D.x - 96, 30.05, D.z - 34)
    const chili = new InstancedMesh(new ConeGeometry(0.9, 7, 8), procStandard(
      { roughness: 0.35, metalness: 0 },
      { color: /* glsl */ `diffuseColor.rgb = mix(vec3(0.55, 0.12, 0.08), vec3(0.72, 0.2, 0.1), smoothstep(-3.5, 3.5, vPos.y)) * (0.85 + 0.25 * (fbm3(vPos * 0.8) * 0.5 + 0.5));` },
    ), 60)
    const d = new Object3D()
    const r = rng(51)
    for (let i = 0; i < 60; i++) {
      const a = r() * Math.PI * 2
      const rr = Math.sqrt(r()) * 18
      d.position.set(D.x - 96 + Math.cos(a) * rr, 30.05 + 0.9 + (i % 3) * 0.6, D.z - 34 + Math.sin(a) * rr)
      d.rotation.set(Math.PI / 2 + (r() - 0.5) * 0.3, 0, r() * Math.PI * 2)
      d.updateMatrix()
      chili.setMatrixAt(i, d.matrix)
    }
    chili.castShadow = true
    chili.receiveShadow = true
    this.group.add(chili)
  }
}
