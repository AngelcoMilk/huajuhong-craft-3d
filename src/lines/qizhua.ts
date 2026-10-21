import { Bake } from '../acts/bake'
import { Blanch } from '../acts/blanch'
import { Bundle } from '../acts/bundle'
import { Cut } from '../acts/cut'
import { Fold } from '../acts/fold'
import { Pick } from '../acts/pick'
import { Sun } from '../acts/sun'
import { Weigh } from '../acts/weigh'
import type { LineDef } from './types'

// 七爪橘红：药典 1963 年版原句（保留原书"出去果瓤"），分句照 site/src/game/story/notes.ts。
// 字幕不给时长、温度这类资料里没有的数字，只说看得见、摸得着的变化。

export const PHARMACOPOEIA = [
  { key: 'p1', text: '柚类橘红系将未成熟的果实，' },
  { key: 'p2', text: '先投入沸水中，即捞出，' },
  { key: 'p3', text: '将果皮割成5-7瓣，' },
  { key: 'p4', text: '出去果瓤及内面部分白色的中果皮' },
  { key: 'p5', text: '后晒干或焙干，' },
  { key: 'p6', text: '再以水润透，对折以木板压平，' },
  { key: 'p7', text: '再焙干即得。' },
]
export const PHARMACOPOEIA_SOURCE = '——《中国药典》1963 年版一部"橘红"条'
export const PHARMACOPOEIA_NOTE = '原书作"出去果瓤"，1985 年版起作"除去"。'

const text = (k: string) => PHARMACOPOEIA.find((p) => p.key === k)!.text

export const QIZHUA: LineDef = {
  id: 'qizhua',
  name: '七爪橘红',
  blurb: '割七瓣、刮白瓤、晒干，润透后整片对折压平，再焙，十片一扎。',
  ready: true,
  cast: { kind: 'peel' },
  acts: (s) => [new Pick(s), new Weigh(s, 4.8), new Blanch(s), new Cut(s), new Sun(s), new Fold(s), new Bake(s), new Bundle(s)],
  script: {
    cover: { title: '七爪橘红', sub: '一句古法，从青果到成品', play: '开始' },
    sentence: [
      { key: 'p1', text: text('p1'), clear: ['pick', 12.5] },
      { key: 'p2', text: text('p2'), clear: ['blanch', 16] },
      { key: 'p3', text: text('p3'), clear: ['cut', 16] },
      { key: 'p4', text: text('p4'), clear: ['cut', 36.5] },
      { key: 'p5', text: text('p5'), clear: ['sun', 18.5] },
      { key: 'p6', text: text('p6'), clear: ['fold', 29.5] },
      { key: 'p7', text: text('p7'), clear: ['bake', 18] },
    ],
    source: PHARMACOPOEIA_SOURCE,
    sourceNote: PHARMACOPOEIA_NOTE,
    quote: true,
    chapters: [
      { num: '一', title: '青果', seal: '摘', from: 'pick', phrases: ['p1'] },
      { num: '二', title: '烫果', seal: '烫', from: 'blanch', phrases: ['p2'] },
      { num: '三', title: '割皮去瓤', seal: '割', from: 'cut', phrases: ['p3', 'p4'] },
      { num: '四', title: '晒干', seal: '晒', from: 'sun', phrases: ['p5'] },
      { num: '五', title: '润、折、压', seal: '压', from: 'fold', phrases: ['p6'] },
      { num: '六', title: '再焙', seal: '焙', from: 'bake', phrases: ['p7'] },
      { num: '', title: '十片一扎', seal: '成', from: 'bundle', phrases: [], card: '十片一扎，红头绳捆好。' },
    ],
    captions: [
      ['pick', 8.6, 13.6, '青果还没熟，皮上一层细细的白绒。'],
      ['weigh', 1.4, 4.4, '挑个大的，放上秤称一称。'],
      ['weigh', 4.9, 8.2, '四两八。四两半以上的大果，才拿来割皮。'],
      ['blanch', 2.5, 7.5, '水要滚透了才下锅。'],
      ['blanch', 8.2, 12.0, '一篮十个，一起下锅。'],
      ['blanch', 13.8, 18.6, '一烫就捞，颜色转亮了。'],
      ['blanch', 21.4, 27, '摊在竹筛上放凉，沥干水。'],
      ['cut', 4.5, 10, '从果顶往下划，底下留一截连着。'],
      ['cut', 16.6, 20.8, '七瓣掰开，像开了一朵花。'],
      ['cut', 21.4, 25.4, '果瓤整个掏出来。'],
      ['cut', 26, 31.5, '白瓤刮掉，刮到见油眼就停。'],
      ['cut', 41, 47, '十个都这样割好、刮好。'],
      ['sun', 2.5, 8, '十片摊在竹匾上，天好就晒。'],
      ['sun', 11, 17, '晒到颜色暗下来，边也卷起来。'],
      ['fold', 2.4, 7.6, '干透的皮发脆，先洒水润透。'],
      ['fold', 9.4, 15, '润软了，一片片整片对折，两边的瓣错开。'],
      ['fold', 17.6, 22.6, '十片一起用木板压平，只压这一回。'],
      ['bake', 2.4, 7.6, '火要细，隔着筛焙。'],
      ['bake', 9.6, 14.6, '勤翻着，焙到干透就成了。'],
      ['bundle', 6, 11.5, '十片一扎，红头绳捆好。'],
    ],
    ending: { title: '七爪橘红', seal: '成', replay: '再看一遍', more: '去展厅看看现在怎么做' },
  },
}
