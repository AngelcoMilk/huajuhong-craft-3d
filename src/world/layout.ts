import { Vector3 } from 'three'

// 院子的平面布置（厘米）。x 向右（东），z 朝镜头（南），y 向上。
// 老屋在北边，墙面在 z = -300；灶、焙炉靠墙在屋檐下；案台在院子中间；竹匾在东南边晒太阳；柚子树在西南角。

export const LAYOUT = {
  wallZ: -300,
  eaveZ: -165,
  tableTop: 78,
  // 案台 240×90：台面上每样东西各占一块，互不重叠（量过圆心距和半径）
  table: new Vector3(0, 0, -40),
  tableW: 240,
  tableD: 90,
  board: new Vector3(-52, 83, -40), // 砧板面中心（砧板半径 21.5）
  bowl: new Vector3(-14, 78, -70), // 装果瓤的碗（半径 9.6）
  basket: new Vector3(-92, 78, -62), // 竹篮（底半径 13，口半径 18）
  knifeRest: new Vector3(-88, 78, -5), // 小刀放在案前沿，刀尖朝西
  scraperRest: new Vector3(8, 78, -6), // 铲刀放在案前沿
  press: new Vector3(56, 80, -42), // 压的底板面中心（底板 60×42，十片对折的摆两行）
  boardRest: new Vector3(156, 0, -70), // 压的顶板平时平放在案子右边的地上（离案边留几厘米，抬起来不擦着桌子）
  stoneRest: new Vector3(152, 0, -24), // 压石平时放在地上
  tray: new Vector3(-6, 78.6, -36), // 结尾放成品的竹盘（半径 15.6）
  spool: new Vector3(-24, 78, -8),
  mug: new Vector3(16, 78, -78), // 搪瓷杯
  washstand: new Vector3(150, 0, -140), // 脸盆架（原来案上的搪瓷盆挪到这上面）：案台后头、门前空地上，不占晒场

  stove: new Vector3(-235, 0, -257), // 灶身中心（地面）
  stoveTop: 80,
  wok: new Vector3(-262, 80, -255), // 锅沿中心
  wokR: 31,
  water: -4.5, // 水面在锅沿下面多少
  drain: new Vector3(-200, 80.15, -252), // 灶面上的小竹筛（灶面 80），只是摆着
  jar: new Vector3(-345, 0, -232), // 水缸
  basketFloor: new Vector3(-185, 0.15, -175), // 称果、烫果时篮子放在灶前地上
  steelyard: new Vector3(-218, 186, -288), // 杆秤：灶后墙上木楔伸出来的那头（秤头朝 +x，让开烟囱）

  oven: new Vector3(-118, 0, -258), // 焙炉中心（地面）
  ovenTop: 54.3, // 焙炉上竹筛的筛面（竹筛底在 y = 0）；竹筛半径 34，烫完沥水、再焙都用它
  ovenSieveR: 34,
  dry: new Vector3(205, 0, 55), // 晒的竹匾中心（地面）
  dryY: 44.02, // 竹匾面高（竹匾底在 44）
  tree: new Vector3(-360, 0, 110),
  door: new Vector3(150, 0, -300),
  window: new Vector3(-10, 0, -300),
  bulb: new Vector3(46, 292, -222),
}
