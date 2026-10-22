import './ui.css'
import { BOOK, type LineDef, type LineId, type Story } from '../lines/types'
import { clamp, easeOut, smoothstep } from '../util'
import { productArt } from './art'

// 网页层：入口页（四条屏）、封面、章节题签、角标、字幕、书页、结尾、控制条、换线时的那张纸。
// 全都按 1920×1080 排，再整体缩放。片子里的东西每帧按当前时间 T 摆一遍（只在变化时才碰 DOM），
// 所以拖进度、暂停、倒回去看，题签和书页都跟着时间走。

export type Mode = 'choose' | 'cover' | 'play'

export interface UIHost {
  play(): void
  pause(): void
  toggle(): void
  seek(T: number): void
  setSpeed(s: number): void
  setMuted(m: boolean): void
  /** 入口页上选了一种做法 */
  choose(id: LineId): void
  /** 回入口页 */
  home(): void
  /** 入口页上鼠标停在哪一幅上（null 是都没停） */
  hover(id: LineId | null): void
  readonly muted: boolean
  readonly playing: boolean
  readonly started: boolean
  readonly speed: number
  readonly mode: Mode
}

const el = (tag: string, cls = '', html = '') => {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (html) e.innerHTML = html
  return e
}

function seal(ch: string) {
  const s = el('div', 'seal' + ([...ch].length > 1 ? ' two' : ''))
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

/** 每种做法的印：入口页、封面上用 */
const SEALS: Record<LineId, string> = { qizhua: '七', wuzhua: '五', yaguo: '片', tai: '胎' }
const CN = ['零', '一', '两', '三', '四', '五', '六', '七', '八', '九']

const PUNCT = '，。、；：？！…—～·（）《》「」『』“”‘’'

/** 竖排用：引号换成直角引号，数字前后的空格去掉 */
const vert = (s: string) => s.replace(/"([^"]*)"/g, '「$1」').replace(/\s+/g, '')

/** 竖排的一串字：一两位的数字横着挤进一格（纵中横），更长的数字一个个立起来 */
function vhtml(s: string) {
  return vert(s).replace(/[0-9A-Za-z]+/g, (m) => (m.length <= 2 ? `<span class="tcy">${m}</span>` : [...m].map((c) => `<span class="up">${c}</span>`).join('')))
}

/** 拆成一格一格的字（书页、题签上一个字一个字落墨） */
function cells(s: string) {
  const out: { s: string; cls: string }[] = []
  for (const m of vert(s).matchAll(/[0-9]{1,2}|[\s\S]/gu)) {
    const c = m[0]
    out.push({ s: c, cls: /[0-9]/.test(c) ? 'tcy' : PUNCT.includes(c) ? 'pu' : '' })
  }
  return out
}

/** 一格字在纸上的样子：没写到是淡朱红的空心字（描红的底样），落墨时洇开一点再收干 */
function inkStyle(e: HTMLElement, r: number) {
  if (r <= 0) e.style.cssText = ''
  else if (r >= 1) e.style.cssText = 'color: var(--ink); -webkit-text-stroke-color: transparent'
  else {
    const wet = 1 - r
    e.style.cssText = `color: rgba(47, 36, 32, ${Math.pow(r, 0.6).toFixed(3)}); -webkit-text-stroke-color: rgba(190, 70, 50, ${(0.4 * wet).toFixed(3)});
      filter: blur(${(wet * wet * 2.6).toFixed(2)}px); text-shadow: 0 0 ${(4 + wet * 9).toFixed(1)}px rgba(52, 36, 30, ${(0.5 * wet * Math.min(1, r * 4)).toFixed(3)})`
  }
}

export class UI {
  readonly root: HTMLElement
  private chooseEl: HTMLElement
  private scrolls = new Map<LineId, HTMLElement>()
  private cover!: HTMLElement
  private card: HTMLElement
  private slip: HTMLElement
  private cardNum: HTMLElement
  private cardTitle: HTMLElement
  private cardSeal: HTMLElement
  private cardBrush: HTMLElement
  private cardPhrase: HTMLElement
  private tag: HTMLElement
  private caption: HTMLElement
  private book!: HTMLElement
  private bookLeaf!: HTMLElement
  private bookShade!: HTMLElement
  /** 书页上每一格字：属于第几截、这一截里第几个字 */
  private bookCells: { e: HTMLElement; p: number; k: number; pu: boolean }[] = []
  /** 每一截属于第几章 */
  private phraseChapter: number[] = []
  private end!: HTMLElement
  private endWrap!: HTMLElement
  private endLeaf!: HTMLElement
  private endShade!: HTMLElement
  private endSeal!: HTMLElement
  private endSide!: HTMLElement
  private curtain: HTMLElement
  private ctrl: HTMLElement
  private bar: HTMLElement
  private fill!: HTMLElement
  private knob!: HTMLElement
  private time: HTMLElement
  private playBtn: HTMLElement
  private speedBtn: HTMLElement
  private soundBtn: HTMLElement
  private fps: HTMLElement | null = null
  private last: Record<string, string> = {}
  private idleT = 0
  private pinBook = false
  private pinA = 0
  private cardChapter = -1
  private story!: Story
  private T = 0

  constructor(
    root: HTMLElement,
    private host: UIHost,
    debug: boolean,
    cards: { line: LineDef; dur: number }[],
  ) {
    this.root = root
    // 印章边缘的毛糙、毛笔线的毛边：SVG 噪声滤镜（程序化）
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
    </filter>
    <filter id="brush" x="-5%" y="-5%" width="110%" height="110%">
      <feTurbulence type="fractalNoise" baseFrequency="0.7" numOctaves="2" seed="2" result="n"/>
      <feDisplacementMap in="SourceGraphic" in2="n" scale="2.2" xChannelSelector="R" yChannelSelector="G"/>
    </filter>
    <filter id="dry-brush" x="-30%" y="-2%" width="160%" height="104%">
      <feTurbulence type="fractalNoise" baseFrequency="0.85 0.025" numOctaves="2" seed="7" result="n"/>
      <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -2.6 2.15" result="m"/>
      <feComposite in="SourceGraphic" in2="m" operator="in" result="c"/>
      <feTurbulence type="fractalNoise" baseFrequency="0.5" numOctaves="1" seed="3" result="w"/>
      <feDisplacementMap in="c" in2="w" scale="3" xChannelSelector="R" yChannelSelector="G"/>
    </filter>`
    root.append(svg)

    this.chooseEl = this.buildChooser(cards)
    root.append(this.chooseEl)
    this.cover = el('div', 'cover hide')
    root.append(this.cover)

    // 章节题签
    this.card = el('div', 'card')
    this.slip = el('div', 'slip paper-tex')
    const head = el('div', 'head')
    this.cardNum = el('div', 'num')
    this.cardTitle = el('div', 'title')
    this.cardSeal = seal('')
    head.append(this.cardNum, this.cardTitle, this.cardSeal)
    this.cardBrush = el('div', 'brush')
    this.cardPhrase = el('div', 'phrase')
    this.slip.append(head, this.cardBrush, this.cardPhrase)
    this.card.append(this.slip)
    root.append(this.card)

    this.tag = el('div', 'tag paper-tex')
    root.append(this.tag)
    this.caption = el('div', 'caption')
    root.append(this.caption)
    this.book = el('div', 'book hit')
    this.book.addEventListener('click', () => (this.pinBook = !this.pinBook))
    root.append(this.book)
    this.end = el('div', 'end')
    root.append(this.end)

    // 控制条
    this.ctrl = el('div', 'ctrl hit idle')
    const homeBtn = el('div', 'home', '四种做法')
    homeBtn.addEventListener('click', () => host.home())
    const prev = el('div', 'b', ICON.prev)
    prev.addEventListener('click', () => this.jump(-1))
    this.playBtn = el('div', 'b', ICON.play)
    this.playBtn.addEventListener('click', () => host.toggle())
    const next = el('div', 'b', ICON.next)
    next.addEventListener('click', () => this.jump(1))
    this.bar = el('div', 'bar')
    const seekAt = (e: PointerEvent) => {
      const r = this.bar.getBoundingClientRect()
      host.seek(clamp((e.clientX - r.left) / r.width) * this.story.duration)
    }
    this.bar.addEventListener('pointerdown', (e) => {
      this.bar.setPointerCapture(e.pointerId)
      seekAt(e)
      const move = (ev: PointerEvent) => seekAt(ev)
      const up = () => {
        this.bar.removeEventListener('pointermove', move)
        this.bar.removeEventListener('pointerup', up)
      }
      this.bar.addEventListener('pointermove', move)
      this.bar.addEventListener('pointerup', up)
    })
    this.time = el('div', 'time')
    this.speedBtn = el('div', 'speed', '1×')
    this.speedBtn.addEventListener('click', () => host.setSpeed(host.speed === 1 ? 2 : host.speed === 2 ? 0.5 : 1))
    this.soundBtn = el('div', 'b', ICON.sound)
    this.soundBtn.title = '声音（M）'
    this.soundBtn.addEventListener('click', () => host.setMuted(!host.muted))
    const full = el('div', 'b', ICON.full)
    full.addEventListener('click', () => toggleFull())
    this.ctrl.append(homeBtn, prev, this.playBtn, next, this.bar, this.time, this.speedBtn, this.soundBtn, full)
    root.append(this.ctrl)

    // 换线时铺满整屏的那张纸（和片子里章节之间翻页的纸同一个颜色，接得上）
    this.curtain = el('div', 'curtain')
    this.curtain.append(el('div', 'tex'))
    root.append(this.curtain)

    if (debug) {
      this.fps = el('div', 'fps')
      root.append(this.fps)
    }

    addEventListener('pointermove', () => (this.idleT = 0))
    addEventListener('keydown', (e) => {
      const m = host.mode
      if (e.code === 'KeyM') host.setMuted(!host.muted)
      else if (e.code === 'KeyF') toggleFull()
      else if (m === 'choose') return
      else if (e.code === 'Space') {
        e.preventDefault()
        if (!host.started) host.play()
        else host.toggle()
      } else if (e.code === 'ArrowRight' && host.started) this.jump(1)
      else if (e.code === 'ArrowLeft' && host.started) this.jump(-1)
      this.idleT = 0
    })
  }

  // ———— 入口页：四条屏 ————

  private buildChooser(cards: { line: LineDef; dur: number }[]) {
    const c = el('div', 'choose')
    c.append(el('div', 'wash'))
    const head = el('div', 'head')
    const tcol = el('div', 'tcol')
    tcol.append(el('div', 't', '化州橘红'), seal('古法'))
    head.append(tcol, el('div', 's', '同一个院子　四种古法做法'))
    c.append(head)
    const row = el('div', 'scrolls')
    cards.forEach(({ line, dur }, i) => {
      const s = el('div', 'scroll hit' + (line.ready ? '' : ' soon'))
      s.style.setProperty('--i', String(i))
      s.dataset.line = line.id
      // 挂绳
      s.append(el('div', 'cord', '<svg viewBox="0 0 300 46"><path d="M28 44L150 6L272 44"/><circle cx="150" cy="6" r="3.2"/></svg>'))
      s.append(el('div', 'rod top'))
      const mount = el('div', 'mount')
      const paper = el('div', 'paper paper-tex')
      const upper = el('div', 'upper')
      const title = el('div', 'title')
      title.append(el('div', 'name', line.name), seal(SEALS[line.id]))
      upper.append(title, el('div', 'blurb', vhtml(line.blurb)), el('div', 'dur', line.ready ? `约${CN[Math.max(1, Math.round(dur / 60))] ?? ''}分钟` : '制作中'))
      const lower = el('div', 'lower')
      lower.append(el('div', 'rule'))
      lower.append(el('div', 'pic', productArt(line.id)))
      // 书页上的第一句（太长就截到第一个逗号）
      let first = line.script.sentence[0].text
      if ([...first].length > 14 && first.indexOf('，') > 0 && first.indexOf('，') < first.length - 1) first = first.slice(0, first.indexOf('，') + 1)
      lower.append(el('div', 'quote', vhtml(first.replace(/[，。]$/, '') + '……')))
      const steps = el('div', 'steps')
      line.script.chapters.forEach((ch, k) => {
        const sl = seal(ch.seal)
        sl.style.setProperty('--k', String(k))
        steps.append(sl)
      })
      lower.append(steps)
      paper.append(upper, lower)
      mount.append(paper)
      s.append(mount)
      s.append(el('div', 'rod bottom', '<i></i><i></i>'))
      if (line.ready) {
        s.addEventListener('pointerenter', () => this.host.mode === 'choose' && this.host.hover(line.id))
        s.addEventListener('pointerleave', () => this.host.mode === 'choose' && this.host.hover(null))
        s.addEventListener('click', () => {
          if (this.host.mode !== 'choose' || c.classList.contains('leaving')) return
          this.host.choose(line.id)
        })
      }
      this.scrolls.set(line.id, s)
      row.append(s)
    })
    c.append(row)
    c.append(el('div', 'hint', '停一停，看一看；点一下，就开演'))
    return c
  }

  /** 换成另一条线的台本：封面、书页、结尾、进度条上的章节都按它重排 */
  setStory(story: Story) {
    this.story = story
    this.last = {}
    this.cardChapter = -1
    this.pinBook = false
    this.pinA = 0
    const { cover: COVER, chapters: CHAPTERS, duration: DURATION, ending: ENDING } = story

    // 封面（直接打开某一条线的网址时）
    const cv = this.cover
    cv.innerHTML = ''
    cv.classList.add('hide')
    cv.append(el('div', 'wash'))
    const head = el('div', 'head')
    const tcol = el('div', 'tcol')
    tcol.append(el('div', 't', COVER.title), seal(SEALS[story.line]))
    head.append(tcol, el('div', 's', COVER.sub))
    cv.append(head)
    const play = el('div', 'go hit', `<i></i>${COVER.play}`)
    play.addEventListener('click', () => this.host.play())
    cv.append(play)
    cv.append(el('div', 'tip', '挪一挪鼠标，画面会跟着偏一点；空格暂停，左右键换章，M 键开关声音'))
    const others = el('div', 'others hit', '← 四种做法')
    others.addEventListener('click', () => this.host.home())
    cv.append(others)

    // 书页
    const [book, leaf, shade, cellsOut] = this.page(story, 'pg', false)
    this.book.innerHTML = ''
    this.book.append(book)
    this.bookLeaf = leaf
    this.bookShade = shade
    this.bookCells = cellsOut
    this.phraseChapter = story.sentence.map((p) => story.chapters.findIndex((c) => c.phrases.includes(p.key)))

    // 结尾
    this.end.innerHTML = ''
    const [endBook, endLeaf, endShade] = this.page(story, 'endbook', true)
    this.endWrap = endBook
    this.endLeaf = endLeaf
    this.endShade = endShade
    this.endSeal = seal(ENDING.seal)
    endLeaf.append(this.endSeal)
    this.endSide = el('div', 'side')
    this.endSide.append(el('div', 't', ENDING.title))
    const replay = el('div', 'btn hit', ENDING.replay)
    replay.addEventListener('click', () => {
      this.host.seek(0)
      this.host.play()
    })
    const alt = el('div', 'btn hit', '看另外几种做法')
    alt.addEventListener('click', () => this.host.home())
    this.endSide.append(replay, alt)
    this.end.append(endBook, this.endSide)

    // 进度条
    this.bar.innerHTML = ''
    this.bar.append(el('div', 'track'))
    this.fill = el('div', 'fill')
    this.bar.append(this.fill)
    for (const c of CHAPTERS) {
      const x = (c.start / DURATION) * 100
      const t = el('div', 'tick')
      t.style.left = x + '%'
      const lab = el('div', 'lab', (c.num ? c.num + ' ' : '') + c.title)
      lab.style.left = x + '%'
      this.bar.append(t, lab)
    }
    this.knob = el('div', 'knob')
    this.bar.append(this.knob)
  }

  /** 一页线装书（半叶）：四周双边的版框、界行、左边书口印鱼尾和书名；字一格一格排 */
  private page(story: Story, cls: string, inked: boolean): [HTMLElement, HTMLElement, HTMLElement, { e: HTMLElement; p: number; k: number; pu: boolean }[]] {
    const wrap = el('div', cls)
    const leaf = el('div', 'leaf paper-tex')
    const frame = el('div', 'frame')
    const kou = el('div', 'kou')
    kou.append(el('div', 'fish', '<svg viewBox="0 0 30 16"><path d="M0 0H30V15L15 6.5L0 15Z"/></svg>'), el('div', 'kt', story.name))
    const cols = el('div', 'cols')
    const out: { e: HTMLElement; p: number; k: number; pu: boolean }[] = []
    story.sentence.forEach((ph, p) => {
      cells(ph.text).forEach((c, k) => {
        const e = el('span', 'ch' + (c.cls ? ' ' + c.cls : '') + (inked ? ' inked' : ''), c.s)
        cols.append(e)
        out.push({ e, p, k, pu: c.cls === 'pu' })
      })
    })
    cols.append(el('div', 'src', vhtml(story.source)))
    frame.append(cols, kou)
    const shade = el('div', 'shade')
    leaf.append(frame, shade)
    wrap.append(leaf)
    return [wrap, leaf, shade, out]
  }

  setMode(mode: Mode) {
    this.root.dataset.mode = mode
    this.last = {}
    if (mode === 'choose') {
      this.chooseEl.classList.remove('leaving')
      for (const s of this.scrolls.values()) s.classList.remove('picked')
    }
  }

  /**
   * 盖上一张纸：选了某一幅就从那一幅的纸面铺开到整屏；回入口页就整屏淡上来。
   * 纸完全盖住以后才 resolve（这时候后面换院子，卡一下也看不出来）。
   */
  async curtainIn(id: LineId | null) {
    const c = this.curtain
    for (const a of c.getAnimations({ subtree: true })) a.cancel()
    c.style.display = 'block'
    const tex = c.firstElementChild as HTMLElement
    let anim: Animation
    if (id) {
      const s = this.scrolls.get(id)!
      this.chooseEl.classList.add('leaving')
      s.classList.add('picked')
      const r = s.querySelector('.paper')!.getBoundingClientRect()
      const box = this.root.getBoundingClientRect()
      const k = 1920 / box.width
      const t = (r.top - box.top) * k
      const l = (r.left - box.left) * k
      const b = 1080 - (r.bottom - box.top) * k
      const rr = 1920 - (r.right - box.left) * k
      const from = `inset(${t.toFixed(1)}px ${rr.toFixed(1)}px ${b.toFixed(1)}px ${l.toFixed(1)}px)`
      const opts: KeyframeAnimationOptions = { duration: 950, delay: 420, easing: 'cubic-bezier(0.7, 0, 0.3, 1)', fill: 'both' }
      anim = c.animate(
        [
          { clipPath: from, backgroundColor: '#f4ecdc', opacity: 1 },
          { clipPath: 'inset(0px 0px 0px 0px)', backgroundColor: '#e2d0af', opacity: 1 },
        ],
        opts,
      )
      tex.animate([{ opacity: 1 }, { opacity: 1, offset: 0.55 }, { opacity: 0 }], opts)
    } else {
      anim = c.animate(
        [
          { clipPath: 'inset(0px 0px 0px 0px)', backgroundColor: '#e2d0af', opacity: 0 },
          { clipPath: 'inset(0px 0px 0px 0px)', backgroundColor: '#e2d0af', opacity: 1 },
        ],
        { duration: 650, easing: 'ease-in-out', fill: 'both' },
      )
      tex.animate([{ opacity: 0.6 }, { opacity: 0 }], { duration: 650, fill: 'both' })
    }
    await anim.finished
    // 等最后那一帧真画出来，再让后面去干重活
    await new Promise((r) => setTimeout(r, 60))
  }

  /** 揭开那张纸（后面的画布这时也是同一个纸色，看不出接缝） */
  async curtainOut(ms = 650) {
    const c = this.curtain
    const anim = c.animate(
      [
        { clipPath: 'inset(0px 0px 0px 0px)', backgroundColor: '#e2d0af', opacity: 1 },
        { clipPath: 'inset(0px 0px 0px 0px)', backgroundColor: '#e2d0af', opacity: 0 },
      ],
      { duration: ms, easing: 'ease-in-out', fill: 'both' },
    )
    await anim.finished
    for (const a of c.getAnimations({ subtree: true })) a.cancel()
    c.style.display = 'none'
  }

  /** 控制条先收起来（刚开演，鼠标动了再出来） */
  quiet() {
    this.idleT = 99
  }

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
    const film = h.mode !== 'choose' && h.started
    this.idleT += dt
    // 封面
    this.set('cover', h.mode === 'cover' && !h.started ? '1' : '0', () => {
      const on = h.mode === 'cover' && !h.started
      this.cover.classList.toggle('hide', !on)
      this.cover.style.pointerEvents = on ? '' : 'none'
    })
    const ci = Math.max(0, CHAPTERS.findIndex((c) => T >= c.start && T < c.end))
    const chap = T >= DURATION ? CHAPTERS.length - 1 : ci

    // 章节题签：每章开头，翻页的纸上挂出来；纸退掉时它自己还是一张纸，字不会落在画面上
    let cardOn = -1
    for (let i = 0; i < CHAPTERS.length; i++) {
      const s = CHAPTERS[i].start
      const a = i === 0 ? 0.25 : s - 0.4
      if (T >= a && T < s + 3.2) cardOn = i
    }
    if (!film) cardOn = -1
    if (cardOn !== this.cardChapter) {
      this.cardChapter = cardOn
      if (cardOn >= 0) {
        const c = CHAPTERS[cardOn]
        this.cardNum.textContent = c.num ? '其' + c.num : '终'
        this.cardTitle.innerHTML = cells(c.title).map((x) => `<b class="${x.cls}">${x.s}</b>`).join('')
        this.cardSeal.firstElementChild!.textContent = c.seal
        this.cardPhrase.innerHTML = cells(c.card).map((x) => `<b class="${x.cls}">${x.s}</b>`).join('')
      }
    }
    if (cardOn >= 0) {
      const s = cardOn === 0 ? 0.6 : CHAPTERS[cardOn].start
      const inA = smoothstep(s - 0.35, s + 0.3, T)
      const outA = 1 - smoothstep(s + 2.45, s + 3.1, T)
      const un = easeOut(clamp((T - (s - 0.35)) / 0.75))
      this.card.style.opacity = String(Math.min(inA, outA))
      this.slip.style.clipPath = `inset(0 0 ${((1 - un) * 100).toFixed(2)}% 0)`
      this.slip.style.transform = `translateY(${(-(1 - outA) * 16).toFixed(2)}px)`
      this.cardNum.style.opacity = String(smoothstep(s - 0.1, s + 0.3, T))
      const tch = this.cardTitle.children
      for (let i = 0; i < tch.length; i++) inkStyle(tch[i] as HTMLElement, smoothstep(s + i * 0.12, s + 0.4 + i * 0.12, T))
      this.cardBrush.style.transform = `scaleY(${easeOut(clamp((T - (s + 0.3)) / 0.55)).toFixed(3)})`
      const pch = this.cardPhrase.children
      const per = Math.min(0.05, 1.25 / Math.max(1, pch.length))
      for (let i = 0; i < pch.length; i++) inkStyle(pch[i] as HTMLElement, smoothstep(s + 0.55 + i * per, s + 0.95 + i * per, T))
      // 盖印：和"嗒"的一声对上（声音在 s + 1.22）
      const st = smoothstep(s + 1.05, s + 1.28, T)
      this.cardSeal.style.opacity = String(st)
      this.cardSeal.style.transform = `scale(${(1.7 - 0.7 * st).toFixed(3)}) rotate(${(-7 + 3 * st).toFixed(2)}deg)`
    } else this.card.style.opacity = '0'

    // 角标
    const showTag = film && T > CHAPTERS[chap].start + 3 && T < DURATION - 15
    this.set('tag', showTag ? 'c' + chap : '', () => {
      this.tag.innerHTML = ''
      if (!showTag) return
      const c = CHAPTERS[chap]
      this.tag.append(seal(c.seal), el('span', '', (c.num ? '其' + c.num + ' · ' : '') + c.title))
    })
    this.tag.style.opacity = showTag ? '1' : '0'

    // 字幕
    const cap = film ? CAPTIONS.find(([a, b]) => T >= a && T < b) : undefined
    this.set('cap', cap ? cap[2] : '', () => (this.caption.textContent = cap ? cap[2] : ''))
    if (cap) {
      const a = smoothstep(cap[0], cap[0] + 0.45, T) * (1 - smoothstep(cap[1] - 0.45, cap[1], T))
      this.caption.style.opacity = String(a)
      this.caption.style.transform = `translateY(${(1 - a) * 8}px)`
    } else this.caption.style.opacity = '0'

    // 书页：每章翻开一回，一个字一个字落墨，写完朱笔圈点，停一会儿合上
    let vis = 0
    for (const m of this.story.moments) {
      vis = Math.max(vis, smoothstep(m.open, m.open + BOOK.open, T) * (1 - smoothstep(m.close - BOOK.close, m.close, T)))
    }
    this.pinA += ((this.pinBook ? 1 : 0) - this.pinA) * (1 - Math.exp(-dt * 6))
    vis = Math.max(vis, this.pinA)
    if (!film || T >= DURATION - 15) vis = 0
    this.leafPose(this.book, this.bookLeaf, this.bookShade, vis)
    if (vis > 0) {
      const chEnd = CHAPTERS[chap].end
      for (const c of this.bookCells) {
        const ph = SENTENCE[c.p]
        const r = smoothstep(ph.ink + c.k * BOOK.per, ph.ink + c.k * BOOK.per + BOOK.wet, T)
        const rq = r <= 0 ? '0' : r >= 1 ? '1' : r.toFixed(2)
        // 圈点：只圈这一章刚写上的句子
        const ring = !c.pu && this.phraseChapter[c.p] === chap && T < chEnd && T >= ph.ring ? smoothstep(ph.ring + c.k * BOOK.ring, ph.ring + c.k * BOOK.ring + 0.22, T) : 0
        const key = rq + '|' + ring.toFixed(2)
        if (c.e.dataset.s !== key) {
          c.e.dataset.s = key
          inkStyle(c.e, r)
          if (ring > 0) c.e.style.setProperty('--c', ring.toFixed(3))
          c.e.classList.toggle('ring', ring > 0)
        }
      }
    }

    // 结尾：翻开一整页，盖"成"
    const e = film ? smoothstep(DURATION - 14, DURATION - 12.6, T) : 0
    this.leafPose(this.endWrap, this.endLeaf, this.endShade, e)
    const sa = film ? smoothstep(DURATION - 13, DURATION - 12, T) : 0
    this.endSide.style.opacity = String(sa)
    this.endSide.style.transform = `translateX(${((1 - sa) * -14).toFixed(2)}px)`
    const st = film ? smoothstep(DURATION - 12.1, DURATION - 11.85, T) : 0
    this.endSeal.style.opacity = String(st)
    this.endSeal.style.transform = `scale(${(1.7 - 0.7 * st).toFixed(3)}) rotate(${(-8 + 3 * st).toFixed(2)}deg)`
    this.set('endp', sa > 0.5 ? '1' : '0', () => this.endSide.querySelectorAll('.hit').forEach((b) => ((b as HTMLElement).style.pointerEvents = sa > 0.5 ? 'auto' : 'none')))

    // 控制条
    const p = (T / DURATION) * 100
    this.fill.style.width = p + '%'
    this.knob.style.left = p + '%'
    this.set('time', fmt(T) + fmt(DURATION), () => (this.time.textContent = `${fmt(T)} / ${fmt(DURATION)}`))
    this.set('play', h.playing ? '1' : '0', () => (this.playBtn.innerHTML = h.playing ? ICON.pause : ICON.play))
    this.set('speed', String(h.speed), () => (this.speedBtn.textContent = (h.speed === 0.5 ? '½' : h.speed) + '×'))
    this.set('mute', h.muted ? '1' : '0', () => (this.soundBtn.innerHTML = h.muted ? ICON.mute : ICON.sound))
    const idle = !film || (h.playing && this.idleT > 2.6)
    this.set('idle', idle ? '1' : '0', () => this.ctrl.classList.toggle('idle', idle))
    if (this.fps && info.fps) this.fps.textContent = info.fps
  }

  /** 一页纸翻开到哪了：书脊在右，像翻线装书那样从右边转开；v = 0 合着（看不见），1 平摊 */
  private leafPose(wrap: HTMLElement, leaf: HTMLElement, shade: HTMLElement, v: number) {
    const key = v <= 0 ? '0' : v >= 1 ? '1' : v.toFixed(3)
    if (wrap.dataset.v === key) return
    wrap.dataset.v = key
    wrap.style.visibility = v <= 0 ? 'hidden' : 'visible'
    const e = easeOut(v)
    leaf.style.transform = `rotateY(${(-(1 - e) * 92).toFixed(2)}deg)`
    leaf.style.opacity = String(clamp(v * 3))
    shade.style.opacity = String(((1 - e) * 0.75).toFixed(3))
  }
}

function toggleFull() {
  if (document.fullscreenElement) document.exitFullscreen()
  else document.documentElement.requestFullscreen?.()
}
