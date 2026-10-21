import {
  BufferAttribute,
  BufferGeometry,
  CatmullRomCurve3,
  Color,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  Object3D,
  Quaternion,
  TubeGeometry,
  Vector3,
} from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { procDepth, procPhysical, type ProcOpts } from '../gfx/proc'
import { rng } from '../util'
import { LAYOUT } from './layout'
import { barkMat, SHARED } from './materials'
import { peelMaterial, setLook, wholeFruitGeometry } from './peel'

// 院子西南角的柚子树：枝干按递归生长，叶子几千片（实例化），挂着十几个青果。
// 叶子在顶点着色器里随风轻摆，影子也跟着摆，地上和案上的光斑一直在动。

/** 一片柚子叶：卵形尖头，沿主脉微微对折，叶尖往下垂。叶柄在原点，叶身沿 +y */
function leafGeometry() {
  const L = 11
  const W = 2.7
  const ny = 9
  const nx = 4
  const pos: number[] = []
  const uv: number[] = []
  const idx: number[] = []
  for (let j = 0; j <= ny; j++) {
    const t = j / ny
    const half = W * Math.sin(Math.PI * Math.min(1, t * 1.08)) ** 0.8 * (1 - 0.25 * t)
    for (let i = 0; i <= nx; i++) {
      const u = -1 + (2 * i) / nx
      const x = u * half
      const y = t * L
      const z = Math.abs(u) * half * 0.28 - t * t * 2.2
      pos.push(x, y, z)
      uv.push(u * 0.5 + 0.5, t)
    }
  }
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i
      const b = a + nx + 1
      idx.push(a, a + 1, b, a + 1, b + 1, b)
    }
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3))
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

const SWAY = /* glsl */ `
{
  vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
  float ph = dot(ip, vec3(0.031, 0.017, 0.027));
  float gust = 0.6 + 0.4 * sin(uTime * 0.35 + ip.x * 0.004);
  float w = uWind * gust * (sin(uTime * 1.9 + ph * 6.0) * 0.55 + sin(uTime * 3.3 + ph * 11.0) * 0.3 + sin(uTime * 0.7 + ph * 3.0) * 0.35);
  float bend = transformed.y / 11.0;
  float ang = w * 0.22 * bend;
  float c = cos(ang), s = sin(ang);
  transformed.yz = mat2(c, -s, s, c) * transformed.yz;
  float tw = w * 0.18 * bend;
  transformed.xz = mat2(cos(tw), -sin(tw), sin(tw), cos(tw)) * transformed.xz;
}
`

export class Tree {
  readonly group = new Group()
  readonly leaves: InstancedMesh
  readonly fruits: InstancedMesh
  readonly fruitSpots: Vector3[] = []

  constructor() {
    const base = LAYOUT.tree
    const r = rng(42)
    const tubes: BufferGeometry[] = []
    const leafMats: Matrix4[] = []
    const fruitAt: Vector3[] = []
    const q = new Quaternion()
    const up = new Vector3(0, 1, 0)

    const grow = (start: Vector3, dir: Vector3, len: number, rad: number, depth: number) => {
      const pts = [start.clone()]
      let d = dir.clone()
      let p = start.clone()
      const steps = 4
      for (let i = 1; i <= steps; i++) {
        d.add(new Vector3((r() - 0.5) * 0.35, (r() - 0.35) * 0.25, (r() - 0.5) * 0.35)).normalize()
        // 越细的枝越往外、往下垂
        if (depth >= 2) d.y -= 0.08 * i
        d.normalize()
        p = p.clone().addScaledVector(d, len / steps)
        pts.push(p)
      }
      const curve = new CatmullRomCurve3(pts)
      const tube = new TubeGeometry(curve, depth < 2 ? 10 : 6, rad, depth < 2 ? 9 : 5, false)
      // 往末端收细
      const pa = tube.attributes.position
      const segs = depth < 2 ? 10 : 6
      const rs = depth < 2 ? 9 : 5
      for (let i = 0; i <= segs; i++) {
        const t = i / segs
        const c = curve.getPointAt(t)
        const k = 1 - 0.55 * t
        for (let j = 0; j <= rs; j++) {
          const vi = i * (rs + 1) + j
          const vx = pa.getX(vi) - c.x
          const vy = pa.getY(vi) - c.y
          const vz = pa.getZ(vi) - c.z
          pa.setXYZ(vi, c.x + vx * k, c.y + vy * k, c.z + vz * k)
        }
      }
      tubes.push(tube)

      if (depth >= 2) {
        // 叶子：沿枝条后段一簇簇
        const n = depth === 2 ? 26 : 34
        for (let i = 0; i < n; i++) {
          const t = 0.25 + 0.75 * r()
          const at = curve.getPointAt(t)
          const tan = curve.getTangentAt(t)
          const out = new Vector3(r() - 0.5, r() * 0.9 - 0.2, r() - 0.5).normalize()
          const leafDir = tan.clone().multiplyScalar(0.6).add(out).normalize()
          q.setFromUnitVectors(up, leafDir)
          const spin = new Quaternion().setFromAxisAngle(leafDir, r() * Math.PI * 2)
          q.premultiply(spin)
          const s = 0.75 + r() * 0.5
          leafMats.push(new Matrix4().compose(at.clone().addScaledVector(out, 1.5), q.clone(), new Vector3(s, s, s)))
        }
        if (depth === 3 && r() < 0.4) fruitAt.push(curve.getPointAt(0.7 + 0.3 * r()))
      }
      if (depth >= 3) return
      const kids = depth === 0 ? 4 : 3 + (r() < 0.5 ? 1 : 0)
      for (let i = 0; i < kids; i++) {
        const t = depth === 0 ? 0.62 + 0.38 * (i / kids) : 0.35 + 0.65 * r()
        const at = curve.getPointAt(t)
        const tan = curve.getTangentAt(t)
        const side = new Vector3(Math.cos((i / kids) * Math.PI * 2 + r()), 0, Math.sin((i / kids) * Math.PI * 2 + r()))
        const nd = tan.clone().multiplyScalar(0.55).addScaledVector(side, 0.8 + 0.3 * r())
        nd.y += depth === 0 ? 0.55 : 0.25
        nd.normalize()
        grow(at, nd, len * (0.62 + 0.15 * r()), rad * (0.55 + 0.1 * r()), depth + 1)
      }
    }
    // 主干微微往院子里倾
    grow(base.clone(), new Vector3(0.18, 1, -0.08).normalize(), 160, 13, 0)

    const wood = mergeGeometries(tubes)
    const trunk = new Mesh(wood, barkMat({ color: '#6A5A4C' }))
    trunk.castShadow = true
    trunk.receiveShadow = true
    this.group.add(trunk)

    // 叶
    const leafOpts: ProcOpts = {
      uniforms: {
        uTime: SHARED.uTime,
        uWind: SHARED.uWind,
        uSunDir: SHARED.uSunDir,
        uSunCol: SHARED.uSunCol,
        uTop: { value: new Color('#3E6A2E') },
        uBottom: { value: new Color('#7C9C55') },
      },
      vertex: SWAY,
      color: /* glsl */ `
        vec2 lu = vec2(vPos.x / 2.7, vPos.y / 11.0);
        float mid = 1.0 - smoothstep(0.0, 0.07, abs(lu.x));
        float vein = smoothstep(0.88, 1.0, abs(sin((lu.y - abs(lu.x) * 0.45) * 26.0))) * (1.0 - mid) * 0.5;
        vec3 base = gl_FrontFacing ? uTop : uBottom;
        float tint = hash13(floor(vWPos * 0.05));
        vec3 leafCol = base * (0.85 + 0.3 * tint) * (1.0 + 0.45 * mid + 0.12 * vein);
        diffuseColor.rgb *= leafCol;
      `,
      emissive: /* glsl */ `
        // 逆光时叶子透出黄绿
        vec3 V = normalize(cameraPosition - vWPos);
        float back = pow(max(dot(-V, uSunDir), 0.0), 3.0);
        totalEmissiveRadiance += uSunCol * vec3(0.55, 0.75, 0.2) * back * 0.55 * max(uSunDir.y + 0.1, 0.0);
      `,
    }
    const leafMat = procPhysical({ roughness: 0.42, metalness: 0, clearcoat: 0.5, clearcoatRoughness: 0.35, side: 2 }, leafOpts)
    this.leaves = new InstancedMesh(leafGeometry(), leafMat, leafMats.length)
    const tint = new Color()
    leafMats.forEach((m, i) => {
      this.leaves.setMatrixAt(i, m)
      tint.setHSL(0.24 + r() * 0.05, 0.25 + r() * 0.2, 0.62 + r() * 0.2)
      this.leaves.setColorAt(i, tint)
    })
    this.leaves.castShadow = true
    this.leaves.receiveShadow = true
    this.leaves.customDepthMaterial = procDepth(leafOpts)
    this.group.add(this.leaves)

    // 树上的青果
    const fm = peelMaterial(9)
    setLook(fm, { fuzz: 1 })
    this.fruits = new InstancedMesh(wholeFruitGeometry(3.6), fm, Math.max(1, fruitAt.length))
    const dummy = new Object3D()
    fruitAt.forEach((p, i) => {
      dummy.position.copy(p).add(new Vector3(0, -4.2, 0))
      dummy.rotation.set(r(), r(), r())
      dummy.scale.setScalar(0.85 + r() * 0.3)
      dummy.updateMatrix()
      this.fruits.setMatrixAt(i, dummy.matrix)
      this.fruitSpots.push(dummy.position.clone())
    })
    this.fruits.count = fruitAt.length
    this.fruits.castShadow = true
    this.group.add(this.fruits)
  }
}
