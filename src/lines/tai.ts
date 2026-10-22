import { Blanch } from '../acts/blanch'
import { Pick } from '../acts/pick'
import { TaiJar } from '../acts/taiJar'
import { TaiOven } from '../acts/taiOven'
import { Weigh } from '../acts/weigh'
import type { LineDef } from './types'

// 橘红胎：疏下来的小果，不割不压，整个烘干。
// 本子上前半是《化州县志》第六篇对正毛橘红胎的形态描述（原文，可引），
// 末两句按 2006 年质检总局第 219 号公告的记载（沸水漂后烘干，或直接高温烘干）补写成说明。

export const TAI: LineDef = {
  id: 'tai',
  name: '橘红胎',
  blurb: '疏下来的小果，不割不压，一半烫过、一半直接，整个烘干。',
  ready: true,
  cast: { kind: 'tai' },
  acts: (s) => [new Pick(s, 0.62), new Weigh(s, 0.7), new Blanch(s), new TaiOven(s), new TaiJar(s)],
  script: {
    cover: { title: '橘红胎', sub: '小果整个烘，不割不压', play: '开始' },
    sentence: [
      { key: 'q1', text: '正毛橘红胎呈圆球形或近似圆球柱形，', clear: ['pick', 12.5] },
      { key: 'q2', text: '直径约1～5厘米，', clear: ['weigh', 7.6] },
      { key: 'q3', text: '表面青褐色或黄棕色，', clear: ['oven', 14.5] },
      { key: 'q4', text: '披白色密绒毛，', clear: ['oven', 24] },
      { key: 'q5', text: '果蒂明显，顶部稍凹，', clear: ['oven', 29] },
      { key: 'q6', text: '质地干燥坚实，不易剖开。', clear: ['oven', 41.5] },
      { key: 'q7', text: '系整果不割不压，', clear: ['oven', 43] },
      { key: 'q8', text: '经沸水烫后烘干或直接烘干即得。', clear: ['jar', 8] },
    ],
    source: '——《化州县志》第六篇',
    sourceNote: '',
    quote: true,
    chapters: [
      { num: '一', title: '青果', seal: '摘', from: 'pick', phrases: ['q1', 'q2'] },
      { num: '二', title: '烫果', seal: '烫', from: 'blanch', phrases: [], card: '一半烫过再烘，一半直接烘。' },
      { num: '三', title: '连烘几天', seal: '烘', from: 'oven', phrases: ['q3', 'q4', 'q5', 'q6', 'q7'], card: '表面青褐色或黄棕色，披白色密绒毛，果蒂明显，顶部稍凹，质地干燥坚实，不易剖开。' },
      { num: '', title: '一罐橘红胎', seal: '成', from: 'jar', phrases: ['q8'], card: '不割、不压，整个烘干就成了。' },
    ],
    captions: [
      ['pick', 8.6, 13.6, '疏果疏下来的小果，个头小，绒毛密。'],
      ['weigh', 1.4, 4.4, '挑一个放上秤称一称。'],
      ['weigh', 4.9, 8.2, '七钱。不到三两的小果，整个烘，做橘红胎。'],
      ['blanch', 2.5, 7.5, '一半直接摊上竹筛，一半下锅烫。'],
      ['blanch', 8.2, 12.0, '十五个一起下锅。'],
      ['blanch', 13.8, 18.6, '一烫就捞，颜色转亮了。'],
      ['blanch', 21.4, 27, '两种做法都有：烫过再烘，或者直接烘。'],
      ['oven', 2.5, 7.5, '不割、不压，整个上焙炉烘。'],
      ['oven', 9.6, 13.6, '火不断，白天烘，夜里也烘。'],
      ['oven', 16.2, 19.6, '隔一阵翻一翻。'],
      ['oven', 23, 28.5, '颜色慢慢转成青褐、黄棕，白绒越来越显。'],
      ['oven', 35, 40, '烘到干透，摸着坚实。'],
      ['jar', 2.4, 8.4, '一层密白绒，果蒂明显，顶上微微凹进去。'],
      ['jar', 12.6, 17.6, '比胎大些、三两到四两半的叫橘红珠，也是整个烘。'],
    ],
    ending: { title: '橘红胎', seal: '成', replay: '再看一遍', more: '去展厅看看现在怎么做' },
  },
}
