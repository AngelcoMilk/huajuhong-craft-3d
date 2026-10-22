import { Blanch } from '../acts/blanch'
import { Pick } from '../acts/pick'
import { Weigh } from '../acts/weigh'
import { CakeOven, PressCakes, Slice, Winnowed } from '../acts/yaguo'
import type { LineDef } from './types'

// 压果片：大果烫过，整个压扁（木板 + 压石压一夜，半夜翻一次），上焙炉烘干，再压一回，用切药刀切成 2～4 毫米的片。
// 没有可引的原文，本子上的字按药典的句式改写，出处标"据《化橘红制作工艺》等"。
// 圆果（整果烘干、不压）用字幕带过；"家家户户自己压果是 1980 年代分户以后"也用字幕交代（docs/14）。

export const YAGUO: LineDef = {
  id: 'yaguo',
  name: '压果片',
  blurb: '大果烫过整个压扁，压一夜、烘干、再压，用切药刀切成薄片。',
  ready: true,
  cast: { kind: 'cake' },
  acts: (s) => [new Pick(s), new Weigh(s, 4.8), new Blanch(s), new PressCakes(s, true, 'press'), new CakeOven(s), new PressCakes(s, false, 'repress'), new Slice(s), new Winnowed(s)],
  script: {
    cover: { title: '压果片', sub: '整果压扁、烘干、切片', play: '开始' },
    sentence: [
      { key: 'y1', text: '大果系将未成熟的果实，先整个投入沸水中烫过，即捞出，', clear: ['blanch', 16] },
      { key: 'y2', text: '以木板重石压制一夜，', clear: ['press', 30] },
      { key: 'y3', text: '其间翻面一次以压成扁饼，', clear: ['press', 35] },
      { key: 'y4', text: '后上焙炉烘干，', clear: ['cakeOven', 22] },
      { key: 'y5', text: '复以木板压平一回，', clear: ['repress', 10] },
      { key: 'y6', text: '切成2～4毫米的薄片即得。', clear: ['slice', 20] },
    ],
    source: '——据《化橘红制作工艺》等',
    sourceNote: '整个烘干、不压的叫圆果。家家户户自己压果切片，是 1980 年代分户以后的事，现在多由合作社和厂里做。',
    quote: false,
    chapters: [
      { num: '一', title: '青果', seal: '摘', from: 'pick', phrases: [], card: '挑四两半以上的大果。' },
      { num: '二', title: '烫果', seal: '烫', from: 'blanch', phrases: ['y1'], card: '大果整个烫过。' },
      { num: '三', title: '压果', seal: '压', from: 'press', phrases: ['y2', 'y3'], card: '木板压石压一夜，半夜翻一次。' },
      { num: '四', title: '烘干', seal: '烘', from: 'cakeOven', phrases: ['y4'], card: '上焙炉烘干。' },
      { num: '五', title: '复压', seal: '复', from: 'repress', phrases: ['y5'], card: '烘过再压一回。' },
      { num: '六', title: '切片', seal: '切', from: 'slice', phrases: ['y6'], card: '切成两到四毫米的薄片。' },
      { num: '', title: '一簸箕果片', seal: '成', from: 'winnow', phrases: [], card: '压果切成片，就是压果片。' },
    ],
    captions: [
      ['pick', 8.6, 13.6, '青果还没熟，皮上一层细细的白绒。'],
      ['weigh', 1.4, 4.4, '挑个大的，放上秤称一称。'],
      ['weigh', 4.9, 8.2, '四两八。四两半以上的大果，拿来压果。'],
      ['blanch', 2.5, 7.5, '水要滚透了才下锅。'],
      ['blanch', 8.2, 12.0, '一篮十个，一起下锅。'],
      ['blanch', 13.8, 18.6, '一烫就捞，颜色转亮了。'],
      ['blanch', 21.4, 27, '摊在竹筛上放凉，沥干水。'],
      ['press', 1.4, 6.4, '整果摆在木板上，盖板、压石，压一夜。'],
      ['press', 9.6, 13.6, '天黑了，就这样压着。'],
      ['press', 16.2, 20.6, '半夜掀开，一个个翻过面再压。'],
      ['press', 32.4, 37.4, '天亮掀开：压成了扁饼，边鼓起来，裂了几道口。'],
      ['cakeOven', 2.4, 7.6, '压果摊上焙炉烘。'],
      ['cakeOven', 11.4, 15.6, '烘一阵，翻一面。'],
      ['cakeOven', 20, 26, '颜色转成黄褐，干透变硬。'],
      ['repress', 1.6, 7, '烘过再压一回，压实。'],
      ['slice', 0.8, 4, '压果拿到切药刀上。'],
      ['slice', 5, 10.4, '推一点，切一刀，片有两到四毫米厚。'],
      ['slice', 12.4, 18, '切面上看得见外皮一圈、白瓤、压实的果肉。'],
      ['slice', 22, 28, '剩下九个，也都这样一个个切成片。'],
      ['winnow', 1.6, 6.6, '一簸箕压果片。'],
      ['winnow', 7.2, 12.4, '整个烘、不压的，叫圆果。'],
      ['winnow', 13, 19, '家家户户自己压果切片，是八十年代分户以后的事。'],
    ],
    ending: { title: '压果片', seal: '成', replay: '再看一遍', more: '去展厅看看现在怎么做' },
  },
}
