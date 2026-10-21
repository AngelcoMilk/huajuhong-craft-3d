import type { Act } from '../acts/act'
import type { Stage } from '../stage'
import type { Cast } from '../world/world'

// 一条线 = 用哪几段（各带参数）+ 自己的台本（章节、字幕、本子上的字、封面、结尾）。
// 台本里的时间都相对某一段的开头写（[段名, 秒]），排好时间线以后换成绝对时间。

export type LineId = 'qizhua' | 'wuzhua' | 'yaguo' | 'tai'

/** 本子上的一句（分几截，各在某一刻"显出来"） */
export interface Phrase {
  key: string
  text: string
  clear: [string, number]
}

export interface ChapterDef {
  num: string
  title: string
  seal: string
  /** 从哪一段开始 */
  from: string
  /** 这一章补全本子上的哪几截 */
  phrases: string[]
  /** 标题卡上的字（不填就用补全的那几截） */
  card?: string
}

export interface Script {
  cover: { title: string; sub: string; play: string }
  sentence: Phrase[]
  /** 本子上那句的出处；quote=false 表示是说明，不是引文 */
  source: string
  sourceNote: string
  quote: boolean
  chapters: ChapterDef[]
  captions: [string, number, number, string][]
  ending: { title: string; seal: string; replay: string; more: string }
}

export interface LineDef {
  id: LineId
  name: string
  /** 入口页上的一句话 */
  blurb: string
  ready: boolean
  /** 主角和一批用哪种果 */
  cast: Cast
  acts(s: Stage): Act[]
  script: Script
}

/** 排好时间线以后的台本（绝对时间），界面只看这个 */
export interface Story {
  line: LineId
  name: string
  duration: number
  cover: Script['cover']
  ending: Script['ending']
  source: string
  sourceNote: string
  quote: boolean
  sentence: { key: string; text: string; clear: number }[]
  chapters: { num: string; title: string; seal: string; start: number; end: number; phrases: string[]; card: string }[]
  captions: [number, number, string][]
}

export function resolveStory(line: LineDef, acts: Act[]): Story {
  const sc = line.script
  const at = ([id, t]: [string, number]) => {
    const a = acts.find((x) => x.id === id)
    if (!a) throw new Error(`台本里的段 "${id}" 不在 ${line.id} 里`)
    return a.start + t
  }
  const duration = acts[acts.length - 1].end
  const starts = sc.chapters.map((c) => at([c.from, 0]))
  const sentence = sc.sentence.map((p) => ({ key: p.key, text: p.text, clear: at(p.clear) }))
  return {
    line: line.id,
    name: line.name,
    duration,
    cover: sc.cover,
    ending: sc.ending,
    source: sc.source,
    sourceNote: sc.sourceNote,
    quote: sc.quote,
    sentence,
    chapters: sc.chapters.map((c, i) => ({
      num: c.num,
      title: c.title,
      seal: c.seal,
      start: starts[i],
      end: i + 1 < starts.length ? starts[i + 1] : duration,
      phrases: c.phrases,
      card: c.card ?? c.phrases.map((k) => sc.sentence.find((p) => p.key === k)!.text).join(''),
    })),
    captions: sc.captions.map(([id, a, b, text]) => [at([id, a]), at([id, b]), text] as [number, number, string]),
  }
}
