import './ui.css'
import type { LineDef, Story } from '../lines/types'
import { clamp, smoothstep } from '../util'

// 网页层：封面、章节标题卡、角标、字幕、本子、结尾、控制条。
// 全都按 1920×1080 排，再整体缩放。每帧按当前时间 T 摆一遍（只在变化时才碰 DOM）。

export interface UIHost {
  play(): void
  pause(): void
  toggle(): void
  seek(T: number): void
  setSpeed(s: number): void
  setMuted(m: boolean): void
  readonly muted: boolean
  readonly playing: boolean
  readonly started: boolean
  readonly speed: number
}

const el = (tag: string, cls = '', html = '') => {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (html) e.innerHTML = html
  return e
}

function seal(ch: string) {
  const s = el('div', 'seal')
  s.append(el('span', '', ch))
  return s
}

const ICON = {
  play: '<svg viewBox="0 0 24 24"><path d="M7 4.5v15l12.5-7.5z"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M6 4.5h4.2v15H6zM13.8 4.5H18v15h-4.2z"/></svg>',
  prev: '<svg viewBox="0 0 24 24"><path d="M6 5h2.4v14H6zM20 5v14L9.5 12z"/></svg>',
  next: '<svg viewBox="0 0 24 24"><path d="M15.6 5H18v14h-2.4zM4 5l10.5 7L4 19z"/></svg>',
  full: '<svg viewBox="0 0 24 24"><path d="M4 9V4h5v2.2H6.2V9zM15 4h5v5h-2.2V6.2H15zM20 15v5h-5v-2.2h2.8V15zM9 20H4v-5h2.2v2.8H9z"/></svg>',
  sound: '<svg viewBox="0 0 24 24"><path d="M4 9.2h3.6L12.5 5v14l-4.9-4.2H4z"/><path d="M15.2 8.6a4.6 4.6 0 0 1 0 6.8M17.6 6.2a8 8 0 0 1 0 11.6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  mute: '<svg viewBox="0 0 24 24"><path d="M4 9.2h3.6L12.5 5v14l-4.9-4.2H4z"/><path d="M15.5 9.5l5 5M20.5 9.5l-5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
}

const fmt = (s: number) => {
  s = Math.max(0, Math.floor(s))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

export class UI {
  readonly root: HTMLElement
  private cover: HTMLElement
  private card: HTMLElement
  private cardNum: HTMLElement
  private cardTitle: HTMLElement
  private cardSeal: HTMLElement
  private cardRule: HTMLElement
  private cardPhrase: HTMLElement
  private tag: HTMLElement
  private caption: HTMLElement
  private book: HTMLElement
  private bookPh: HTMLElement[] = []
  private end: HTMLElement
  private ctrl: HTMLElement
  private fill: HTMLElement
  private knob: HTMLElement
  private time: HTMLElement
  private playBtn: HTMLElement
  private speedBtn: HTMLElement
  private soundBtn: HTMLElement
  private fps: HTMLElement | null = null
  private last: Record<string, string> = {}
  private idleT = 0
  private pinBook = false
  private cardChapter = -1

  private story: Story

  constructor(root: HTMLElement, private host: UIHost, debug: boolean, story: Story, cards: { line: LineDef; dur: number }[] | null = null) {
    this.root = root
    this.story = story
    const { cover: COVER, sentence: SENTENCE, chapters: CHAPTERS, duration: DURATION, ending: ENDING } = story
    // 印章边缘的毛糙：SVG 噪声滤镜（程序化）
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('width', '0')
    svg.setAttribute('height', '0')
    svg.style.position = 'absolute'
    svg.innerHTML = `<filter id="seal-rough" x="-10%" y="-10%" width="120%" height="120%">
      <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="4" result="n"/>
      <feDisplacementMap in="SourceGraphic" in2="n" scale="5" xChannelSelector="R" yChannelSelector="G" result="d"/>
      <feTurbulence type="fractalNoise" baseFrequency="0.18" numOctaves="3" seed="9" result="m"/>
      <feColorMatrix in="m" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -2.6 2.15" result="mask"/>
      <feComposite in="d" in2="mask" operator="in"/>
    </filter>`
    root.append(svg)

    // 封面（没选段的时候是入口页：四种做法任选）
    this.cover = el('div', 'cover')
    if (cards) this.chooser(cards)
    else {
    this.cover.append(el('div', 't', COVER.title), el('div', 'line'), el('div', 's', COVER.sub))
    this.cover.append(el('div', 'sentence', SENTENCE.map((p) => p.text).join('')))
    const play = el('div', 'play hit', `<i></i>${COVER.play}`)
    play.addEventListener('click', () => host.play())
    this.cover.append(play)
    this.cover.append(el('div', 'tip', '挪一挪鼠标，画面会跟着偏一点；空格暂停，左右键换章，M 键开关声音'))
    const others = el('a', 'others hit', '← 四种做法') as HTMLAnchorElement
    others.href = '?'
    this.cover.append(others)
    }
    root.append(this.cover)

    // 标题卡
    this.card = el('div', 'card')
    this.cardNum = el('div', 'num')
    const row = el('div', 'title-row')
    this.cardTitle = el('div', 'title')
    this.cardSeal = seal('')
    row.append(this.cardTitle, this.cardSeal)
    this.cardRule = el('div', 'rule')
    this.cardPhrase = el('div', 'phrase')
    this.card.append(this.cardNum, row, this.cardRule, this.cardPhrase)
    root.append(this.card)

    this.tag = el('div', 'tag')
    root.append(this.tag)
    this.caption = el('div', 'caption')
    root.append(this.caption)

    // 本子：整句竖排，没做到的地方是洇糊的
    this.book = el('div', 'book away hit')
    for (const p of SENTENCE) {
      const s = el('span', 'ph', p.text)
      this.bookPh.push(s)
      this.book.append(s)
    }
    this.book.addEventListener('click', () => (this.pinBook = !this.pinBook))
    root.append(this.book)

    // 结尾
    this.end = el('div', 'end')
    const page = el('div', 'page')
    for (const p of SENTENCE) page.append(el('span', '', p.text))
    page.append(el('div', 'src', story.source), el('div', 'note', story.sourceNote))
    page.append(seal(ENDING.seal))
    const side = el('div', 'side')
    side.append(el('div', 't', ENDING.title))
    const replay = el('div', 'btn hit', ENDING.replay)
    replay.addEventListener('click', () => {
      host.seek(0)
      host.play()
    })
    const more = el('a', 'btn ghost hit', ENDING.more + ' →') as HTMLAnchorElement
    more.href = '../exhibition'
    const alt = el('a', 'btn ghost hit', '看另外几种做法 →') as HTMLAnchorElement
    alt.href = '?'
    side.append(replay, alt, more)
    this.end.append(page, side)
    root.append(this.end)

    // 控制条
    this.ctrl = el('div', 'ctrl hit idle')
    const prev = el('div', 'b', ICON.prev)
    prev.addEventListener('click', () => this.jump(-1))
    this.playBtn = el('div', 'b', ICON.play)
    this.playBtn.addEventListener('click', () => host.toggle())
    const next = el('div', 'b', ICON.next)
    next.addEventListener('click', () => this.jump(1))
    const bar = el('div', 'bar')
    bar.append(el('div', 'track'))
    this.fill = el('div', 'fill')
    bar.append(this.fill)
    for (const c of CHAPTERS) {
      const x = (c.start / DURATION) * 100
      const t = el('div', 'tick')
      t.style.left = x + '%'
      const lab = el('div', 'lab', (c.num ? c.num + ' ' : '') + c.title)
      lab.style.left = x + '%'
      bar.append(t, lab)
    }
    this.knob = el('div', 'knob')
    bar.append(this.knob)
    const seekAt = (e: PointerEvent) => {
      const r = bar.getBoundingClientRect()
      host.seek(clamp((e.clientX - r.left) / r.width) * DURATION)
    }
    bar.addEventListener('pointerdown', (e) => {
      bar.setPointerCapture(e.pointerId)
      seekAt(e)
      const move = (ev: PointerEvent) => seekAt(ev)
      const up = () => {
        bar.removeEventListener('pointermove', move)
        bar.removeEventListener('pointerup', up)
      }
      bar.addEventListener('pointermove', move)
      bar.addEventListener('pointerup', up)
    })
    this.time = el('div', 'time')
    this.speedBtn = el('div', 'speed', '1×')
    this.speedBtn.addEventListener('click', () => host.setSpeed(host.speed === 1 ? 2 : host.speed === 2 ? 0.5 : 1))
    this.soundBtn = el('div', 'b', ICON.sound)
    this.soundBtn.title = '声音（M）'
    this.soundBtn.addEventListener('click', () => host.setMuted(!host.muted))
    const full = el('div', 'b', ICON.full)
    full.addEventListener('click', () => toggleFull())
    this.ctrl.append(prev, this.playBtn, next, bar, this.time, this.speedBtn, this.soundBtn, full)
    root.append(this.ctrl)

    if (debug) {
      this.fps = el('div', 'fps')
      root.append(this.fps)
    }

    addEventListener('pointermove', () => (this.idleT = 0))
    addEventListener('keydown', (e) => {
      if (e.code === 'Space') {
        e.preventDefault()
        if (!host.started) host.play()
        else host.toggle()
      } else if (e.code === 'ArrowRight') this.jump(1)
      else if (e.code === 'ArrowLeft') this.jump(-1)
      else if (e.code === 'KeyF') toggleFull()
      else if (e.code === 'KeyM') host.setMuted(!host.muted)
      this.idleT = 0
    })
  }

  private chooser(cards: { line: LineDef; dur: number }[]) {
    const c = this.cover
    c.classList.add('choose')
    c.append(el('div', 't', '化州橘红'), el('div', 'line'), el('div', 's', '同一个院子，四种古法做法'))
    const row = el('div', 'cards')
    const seals: Record<string, string> = { qizhua: '七', wuzhua: '五', yaguo: '片', tai: '胎' }
    for (const { line, dur } of cards) {
      const a = el('a', 'lc hit' + (line.ready ? '' : ' soon')) as HTMLAnchorElement
      if (line.ready) a.href = '?line=' + line.id
      a.append(seal(seals[line.id]), el('div', 'n', line.name), el('div', 'b', line.blurb), el('div', 'd', line.ready ? `约 ${Math.round(dur / 60)} 分钟` : '制作中'))
      row.append(a)
    }
    c.append(row)
  }

  private T = 0
  private jump(d: number) {
    const CHAPTERS = this.story.chapters
    const i = CHAPTERS.findIndex((c) => this.T >= c.start && this.T < c.end)
    // 往回跳：章内过了几秒就回到本章开头
    let j = i + d
    if (d < 0 && this.T - CHAPTERS[Math.max(0, i)].start > 3) j = i
    j = clamp(j, 0, CHAPTERS.length - 1)
    this.host.seek(CHAPTERS[j].start + (j === 0 ? 0 : 0.2))
    if (!this.host.started) this.host.play()
  }

  private set(key: string, value: string, apply: () => void) {
    if (this.last[key] === value) return
    this.last[key] = value
    apply()
  }

  update(T: number, dt: number, info: { fps?: string }) {
    this.T = T
    const { chapters: CHAPTERS, duration: DURATION, captions: CAPTIONS, sentence: SENTENCE } = this.story
    const h = this.host
    this.idleT += dt
    // 封面
    this.set('cover', h.started ? '0' : '1', () => {
      this.cover.classList.toggle('hide', h.started)
      this.cover.style.pointerEvents = h.started ? 'none' : ''
      this.cover.querySelector('.play')?.classList.toggle('hit', !h.started)
    })
    const ci = Math.max(0, CHAPTERS.findIndex((c) => T >= c.start && T < c.end))
    const chap = T >= DURATION ? CHAPTERS.length - 1 : ci

    // 标题卡：每章开头，纸色遮罩上
    let cardOn = -1
    for (let i = 0; i < CHAPTERS.length; i++) {
      const s = CHAPTERS[i].start
      const a = i === 0 ? 0.4 : s - 0.35
      if (T >= a && T < s + 3.1) cardOn = i
    }
    if (!h.started) cardOn = -1
    if (cardOn !== this.cardChapter) {
      this.cardChapter = cardOn
      if (cardOn >= 0) {
        const c = CHAPTERS[cardOn]
        this.cardNum.textContent = c.num ? c.num : '终'
        this.cardTitle.textContent = c.title
        this.cardSeal.firstElementChild!.textContent = c.seal
        const text = c.card
        this.cardPhrase.innerHTML = [...text].map((ch) => `<b>${ch}</b>`).join('')
      }
    }
    if (cardOn >= 0) {
      const c = CHAPTERS[cardOn]
      const s = cardOn === 0 ? 0.6 : c.start
      const inA = smoothstep(s - 0.35, s + 0.35, T)
      const outA = 1 - smoothstep(s + 2.4, s + 3.1, T)
      this.card.style.opacity = String(Math.min(inA, outA))
      this.card.style.transform = `translateY(${(1 - inA) * 18 - (1 - outA) * 24}px)`
      this.cardRule.style.transform = `scaleX(${smoothstep(s - 0.1, s + 1.0, T)})`
      this.cardRule.style.width = '760px'
      const chars = this.cardPhrase.children
      for (let i = 0; i < chars.length; i++) {
        const r = smoothstep(s + 0.2 + i * 0.055, s + 0.75 + i * 0.055, T)
        const ch = chars[i] as HTMLElement
        ch.style.opacity = String(r)
        ch.style.filter = r < 1 ? `blur(${((1 - r) * 7).toFixed(2)}px)` : ''
      }
      const st = smoothstep(s + 1.05, s + 1.3, T)
      this.cardSeal.style.opacity = String(st)
      this.cardSeal.style.transform = `scale(${1.7 - 0.7 * st}) rotate(${-6 + 2 * st}deg)`
    } else this.card.style.opacity = '0'

    // 角标
    const showTag = h.started && T > CHAPTERS[chap].start + 2.9 && T < DURATION - 15
    this.set('tag', showTag ? 'c' + chap : '', () => {
      this.tag.innerHTML = ''
      if (!showTag) return
      const c = CHAPTERS[chap]
      this.tag.append(seal(c.seal), el('span', '', (c.num ? c.num + ' · ' : '') + c.title))
    })
    this.tag.style.opacity = showTag ? '1' : '0'

    // 字幕
    const cap = h.started ? CAPTIONS.find(([a, b]) => T >= a && T < b) : undefined
    this.set('cap', cap ? cap[2] : '', () => (this.caption.textContent = cap ? cap[2] : ''))
    if (cap) {
      const a = smoothstep(cap[0], cap[0] + 0.45, T) * (1 - smoothstep(cap[1] - 0.45, cap[1], T))
      this.caption.style.opacity = String(a)
      this.caption.style.transform = `translateY(${(1 - a) * 8}px)`
    } else this.caption.style.opacity = '0'

    // 本子：补字前后滑出来几秒
    let near = false
    SENTENCE.forEach((p, i) => {
      const clear = T >= p.clear
      const now = CHAPTERS[chap].phrases.includes(p.key)
      this.set('ph' + i, `${clear}${now}`, () => {
        this.bookPh[i].classList.toggle('clear', clear)
        this.bookPh[i].classList.toggle('now', now)
      })
      if (T > p.clear - 1.2 && T < p.clear + 3.6) near = true
    })
    const bookOn = h.started && (near || this.pinBook) && T < DURATION - 15
    this.set('book', bookOn ? '1' : '0', () => this.book.classList.toggle('away', !bookOn))

    // 结尾
    const endA = h.started ? smoothstep(DURATION - 14, DURATION - 12.5, T) : 0
    this.end.style.opacity = String(endA)
    this.set('endp', endA > 0.5 ? '1' : '0', () => this.end.querySelectorAll('.hit').forEach((b) => ((b as HTMLElement).style.pointerEvents = endA > 0.5 ? 'auto' : 'none')))

    // 控制条
    const p = (T / DURATION) * 100
    this.fill.style.width = p + '%'
    this.knob.style.left = p + '%'
    this.set('time', fmt(T), () => (this.time.textContent = `${fmt(T)} / ${fmt(DURATION)}`))
    this.set('play', h.playing ? '1' : '0', () => (this.playBtn.innerHTML = h.playing ? ICON.pause : ICON.play))
    this.set('speed', String(h.speed), () => (this.speedBtn.textContent = (h.speed === 0.5 ? '½' : h.speed) + '×'))
    this.set('mute', h.muted ? '1' : '0', () => (this.soundBtn.innerHTML = h.muted ? ICON.mute : ICON.sound))
    const idle = h.started && h.playing && this.idleT > 2.6
    this.set('idle', idle ? '1' : '0', () => this.ctrl.classList.toggle('idle', idle || !h.started))
    if (!h.started) this.ctrl.classList.add('idle')
    if (this.fps && info.fps) this.fps.textContent = info.fps
  }
}

function toggleFull() {
  if (document.fullscreenElement) document.exitFullscreen()
  else document.documentElement.requestFullscreen?.()
}
