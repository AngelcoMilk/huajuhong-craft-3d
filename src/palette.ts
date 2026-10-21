// 色板：照 docs/10 美术规范的色板 v1，果子各阶段照 site/src/game/station/fruit.ts。
// 发夹红 #C8452F 只给红头绳和印章用。

export const P = {
  paper: '#F2E9D8', // 纸白
  beige: '#E3CFA8', // 暖米
  bamboo: '#C9A66B', // 竹黄
  wood: '#8A5A3B', // 木褐
  darkWood: '#5B3A29', // 深木
  brick: '#B5654A', // 砖红
  clay: '#7E4A35', // 陶土
  iron: '#2F2A2B', // 铁黑
  cement: '#A8A39A', // 水泥灰
  pomelo: '#9DBA4E', // 柚绿
  leaf: '#4F7A3A', // 叶绿
  shadow: '#6E6278', // 影紫
  fire: '#E8893A', // 火橙
  blue: '#5E7A93', // 布蓝
  lightBlue: '#9DB3C6', // 浅布蓝
  jade: '#B7CFA8', // 玉绿
  red: '#C8452F', // 发夹红：只给红头绳、印章
}

export const FRUIT = {
  skin: ['#4E7027', '#6A8F33', '#8EAD4A'], // 鲜果：暗、中、亮
  blanch: ['#7C9A2C', '#9CB83A', '#BFD266'], // 烫过：转黄绿，发亮
  pith: ['#DCD2B6', '#F3ECD6'], // 白瓤
  inner: ['#B9BF80', '#D6D9A2'], // 刮干净的内侧，外绿内浅
  oil: '#9DA75A', // 油眼
  dried: ['#4F4E2C', '#6F6E3C', '#8C8A52'], // 焙干：橄榄色
  driedInner: '#C4A276', // 晒干后的内侧：转成浅褐黄
  product: ['#575C41', '#6C7155', '#868A6C'], // 成品外面：暗的灰橄榄绿（refs/13、35）
  productInner: '#D9B597', // 成品里面：偏粉的暖米色（refs/13）
  pulp: '#E9DFB4', // 果瓤
}
