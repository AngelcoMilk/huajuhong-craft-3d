import { Color, CylinderGeometry, Scene, Vector3, type BufferGeometry, type WebGLRenderer } from 'three'
import { Environment } from '../gfx/env'
import { procStandard } from '../gfx/proc'
import { FRUIT } from '../palette'
import { Batch } from './batch'
import { CakeSet } from './cake'
import { Cutter, Winnow } from './cutter'
import { Bundle } from './bundle'
import { Drops, Motes, Puffs, Scatter } from './fx'
import { LAYOUT } from './layout'
import { Peel, PeelState } from './peel'
import { Props } from './props'
import { DryingRack, Oven } from './stations'
import { Steelyard } from './steelyard'
import { Stove } from './stove'
import { Jar, TaiBatch } from './tai'
import { Table } from './table'
import { Tree } from './tree'
import { Yard } from './yard'

// 把院子里的东西拼起来。导演每帧只改这些对象的位置和状态。
// 院子、灶、焙炉、案台、工具、小物件每条线都一样；主角和"一批"按线换（cast）：
// peel 是会割、会折的果皮（七爪、大五爪），tai 是三十个小果（橘红胎）。

export interface Cast {
  kind: 'peel' | 'tai' | 'cake'
  /** 果皮几瓣：七爪 7（默认），大五爪 5 */
  petals?: number
}

export class World {
  readonly scene = new Scene()
  readonly env: Environment
  readonly yard = new Yard()
  readonly stove = new Stove()
  readonly table = new Table()
  readonly oven = new Oven()
  readonly tree = new Tree()
  readonly props = new Props()
  readonly steelyard = new Steelyard()
  readonly hero: Peel
  readonly dry: DryingRack
  readonly batch: Batch
  /** 对折好、还没压的形状（压板上另外九片先用它） */
  readonly foldedGeo: BufferGeometry
  /** 烫完摊在竹筛上的那一批冒的热气 */
  readonly batchSteam: Puffs
  readonly bundle: Bundle
  readonly drops = new Drops(80)
  readonly shavings: Scatter
  readonly heroSteam: Puffs
  readonly dust: Motes
  /** 橘红胎的三十个小果（别的线没有） */
  readonly tai: TaiBatch | null = null
  /** 装橘红胎的玻璃罐 */
  readonly jar: Jar | null = null
  /** 压果片的十个果（压扁、切片） */
  readonly cakes: CakeSet | null = null
  /** 切药刀、簸箕（压果片） */
  readonly cutter: Cutter | null = null
  readonly winnow: Winnow | null = null

  constructor(
    renderer: WebGLRenderer,
    readonly cast: Cast = { kind: 'peel' },
  ) {
    const s = this.scene
    this.env = new Environment(renderer, s)
    const petals = cast.petals ?? 7
    this.hero = new Peel(undefined, petals)
    s.add(this.yard.group, this.stove.group, this.table.group, this.oven.group, this.tree.group, this.props.group)
    s.add(this.hero.group)
    this.steelyard.group.position.copy(LAYOUT.steelyard)
    s.add(this.steelyard.group)
    this.dry = new DryingRack()
    s.add(this.dry.group)
    // 主角以外的九个（整果 → 皮），十个一起
    this.batch = new Batch(this.hero.geometry)
    s.add(this.batch.group)

    // 成品的形状：另起一个果皮，直接设成最后的状态，拷一份
    const tmp = new Peel(undefined, petals)
    const st = new PeelState()
    st.cut.fill(1)
    st.open.fill(1)
    st.cap = 1
    st.scrape.fill(1)
    st.hub = 1
    st.dry = 1
    st.soak = 1
    st.shrink = 1
    st.fold = 1
    st.press = 0
    tmp.state.copy(st)
    tmp.update()
    this.foldedGeo = tmp.snapshot()
    st.press = 1
    tmp.state.copy(st)
    tmp.update()
    this.bundle = new Bundle(tmp.snapshot(), tmp.foldDir, petals)
    tmp.geometry.dispose()
    // 竹盘盘面（竹盘比台面抬了 0.15）
    this.bundle.group.position.set(LAYOUT.tray.x, LAYOUT.tableTop + 0.15, LAYOUT.tray.z)
    s.add(this.bundle.group)

    s.add(this.drops.mesh)
    // 刮下来的白瓤屑：卷起来的小薄片
    const curl = new CylinderGeometry(0.3, 0.3, 1.3, 10, 1, true, 0, Math.PI * 1.2)
    curl.rotateZ(Math.PI / 2)
    this.shavings = new Scatter(
      curl,
      procStandard(
        { roughness: 0.9, metalness: 0, side: 2 },
        {
          uniforms: { uPith: { value: new Color(FRUIT.pith[1]) } },
          color: /* glsl */ `diffuseColor.rgb = uPith * (0.9 + 0.12 * snoise(vPos * 3.0));`,
        },
      ),
      90,
    )
    s.add(this.shavings.mesh)
    this.batchSteam = new Puffs({ count: 44, life: 3.2, rise: 26, spread: 5, size: 10, radius: 17, drift: new Vector3(3, 0, 4), opacity: 0.32, seed: 23 })
    s.add(this.batchSteam.mesh)
    this.heroSteam = new Puffs({ count: 26, life: 2.8, rise: 22, spread: 3, size: 7, radius: 2.4, drift: new Vector3(2, 0, 3), opacity: 0.4, seed: 21 })
    s.add(this.heroSteam.mesh)
    // 光里的灰尘：在镜头附近飘
    this.dust = new Motes({ count: 140, life: 9, box: new Vector3(160, 120, 160), rise: 6, size: 0.35, color: '#FFE9C8', seed: 5, jitter: 4 })
    s.add(this.dust.mesh)

    if (cast.kind === 'tai') {
      // 小果：主角 + 二十九个，一半烫。果皮那一套藏起来不用
      this.tai = new TaiBatch(30, 15)
      s.add(this.tai.group, this.tai.heroGroup)
      this.hero.group.visible = false
      this.jar = new Jar()
      // 罐子放在案上成品竹盘和压板之间的空处
      this.jar.group.position.set(17, LAYOUT.tableTop + 0.01, -38)
      s.add(this.jar.group, this.jar.lid)
    }
    if (cast.kind === 'cake') {
      this.cakes = new CakeSet()
      s.add(this.cakes.group, this.cakes.heroGroup)
      this.hero.group.visible = false
      renderer.localClippingEnabled = true
      this.cutter = new Cutter()
      this.winnow = new Winnow()
      s.add(this.cutter.group, this.winnow.group)
    }
  }
}
