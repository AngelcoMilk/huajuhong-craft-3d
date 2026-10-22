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
  /** 本子上那句的出处 */
  source: string
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
  /** 本子上的每一截：clear 是这一步做完的时刻，ink 是开始落墨的时刻，ring 是开始圈点的时刻 */
  sentence: { key: string; text: string; clear: number; ink: number; ring: number }[]
  chapters: { num: string; title: string; seal: string; start: number; end: number; phrases: string[]; card: string }[]
  captions: [number, number, string][]
  /** 书页翻开的几回：每章一回 */
  moments: Moment[]
}

/** 书页的节奏：每章翻开一次，把这一章的句子一个字一个字写上去，圈点，停一会儿，合上 */
export const BOOK = {
  open: 0.9,
  /** 每个字 */
  per: 0.075,
  /** 句与句之间 */
  pause: 0.35,
  /** 一个字从落墨到收干 */
  wet: 0.45,
  /** 圈点：一个字一个圈 */
  ring: 0.03,
  hold: 2.6,
  close: 0.8,
}

export interface Moment {
  chapter: number
  open: number
  close: number
  /** 这一回写哪几截（sentence 里的下标） */
  phrases: number[]
}

const len = (s: string) => [...s].length

/**
 * 给每章排一回书页：
 * - 不跨章：标题卡走了才翻开，换章翻页之前合好（最后一章要在结尾那页出来之前合好）
 * - 尽量在这一章最后一步做完时翻开
 * - 翻开、写字的那几秒，尽量不和字幕换句撞在一起
 */
function scheduleBook(story: Omit<Story, 'moments'>) {
  const { sentence, chapters, captions, duration } = story
  const moments: Moment[] = []
  chapters.forEach((c, ci) => {
    const idx = c.phrases.map((k) => sentence.findIndex((p) => p.key === k)).filter((i) => i >= 0)
    if (!idx.length) return
    const write = idx.reduce((a, i) => a + len(sentence[i].text) * BOOK.per, 0) + (idx.length - 1) * BOOK.pause + BOOK.wet
    const rings = 0.3 + Math.max(...idx.map((i) => len(sentence[i].text))) * BOOK.ring
    const need = BOOK.open + write + rings + BOOK.close
    const lo = c.start + 3.3
    const hi = ci === chapters.length - 1 ? duration - 15 : c.end - 0.8
    const hold = Math.max(1.2, Math.min(BOOK.hold, hi - lo - need))
    const span = need + hold
    const target = Math.max(...idx.map((i) => sentence[i].clear)) - 1
    let best = lo
    let bestScore = Infinity
    for (let o = lo; o <= Math.max(lo, hi - span) + 1e-6; o += 0.1) {
      const w0 = o + 0.2
      const w1 = o + BOOK.open + write
      const hits = captions.filter(([a]) => a > w0 && a < w1).length
      const score = Math.abs(o - target) + 3 * hits
      if (score < bestScore) {
        bestScore = score
        best = o
      }
    }
    let t = best + BOOK.open
    for (const i of idx) {
      const n = len(sentence[i].text)
      sentence[i].ink = t
      sentence[i].ring = t + n * BOOK.per + BOOK.wet * 0.6
      t += n * BOOK.per + BOOK.pause
    }
    moments.push({ chapter: ci, open: best, close: best + span, phrases: idx })
  })
  return moments
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
  // 不在哪一章里的句子（理论上没有）就在做完的那一刻写
  const sentence = sc.sentence.map((p) => ({ key: p.key, text: p.text, clear: at(p.clear), ink: at(p.clear), ring: at(p.clear) + 1 }))
  const story = {
    line: line.id,
    name: line.name,
    duration,
    cover: sc.cover,
    ending: sc.ending,
    source: sc.source,
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
  return { ...story, moments: scheduleBook(story) }
}
