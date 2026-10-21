import type { AddSound } from '../audio/sound'
import type { AddShot } from '../camera'
import type { LightName } from '../gfx/env'
import type { Stage } from '../stage'

// 一段：一个独立的小动画（自己的动作、镜头、光）。同一段在不同的线里用同一份代码，只换参数。
// 时间都是这一段自己的本地时间 t（0 是这一段开头）。

export abstract class Act {
  /** 在整条时间线上从哪一秒开始（排时间线的时候填） */
  start = 0

  constructor(
    protected s: Stage,
    readonly id: string,
    readonly dur: number,
  ) {}

  get end() {
    return this.start + this.dur
  }

  /** 这一段的镜头 */
  abstract shots(add: AddShot): void

  /** 这一段的光：[本地时间, 预设]，相邻两个关键帧之间缓过去（会和前后段的关键帧连起来） */
  lights(): [number, LightName][] {
    return []
  }

  /**
   * 每一帧、每一段都会调（不管演没演到），t = T - start，可以小于 0 或大于 dur。
   * 用来往后带状态：主角的形状和颜色、锅开没开、炉子点没点。只能写 Stage 上的 carry、look 和主角的形状参数。
   */
  carry(t: number): void {
    void t
  }

  /** 这一段的动作声音：[本地时间, 哪种声音, 音量/音高/多长/在哪]，播到那一刻放一下 */
  sounds(add: AddSound): void {
    void add
  }

  /** 开场前预热时调一次：这一段要现建的东西先建好（着色器、模型一起预热，演到时不卡） */
  prepare(): void {}

  /** 每帧、每一段都调（在 pose 之前）：这一段自己加进场景的东西先藏起来 */
  hide(): void {}

  /** 正在演这一段的时候调：摆主角、工具、一批果、水汽水珠这些 */
  abstract pose(t: number, time: number): void
}
