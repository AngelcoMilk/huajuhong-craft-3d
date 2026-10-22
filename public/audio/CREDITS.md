# 音频素材来源

本项目除这两段真实录音外，其余声音全部由 Web Audio 实时合成（见 `src/audio/voices.ts`）。
两段素材均为 **CC0（公共领域）**：可商用、可修改、可随本仓库公开分发，无需署名。
以下是出于透明的记录。

## yard-garden.mp3（院子环境：远处鸟叫 + 风）

- 原始素材：**Atmo_Garden_Birds_Spring_Loop_01.wav** by LamaMakesMusic
- 来源：https://freesound.org/people/LamaMakesMusic/sounds/575353/
- 许可：CC0 1.0
- 处理：取原素材 30–70 秒 → 尾部 2 秒与开头交叉淡化做无缝循环 → 高通 110Hz、低通 2600Hz（削掉鸟叫的高频亮度，听感变远）→ 3.4kHz/5.6kHz 各衰减 5/9dB → 单声道 32kHz 48kbps mp3，38.05 秒，228KB

## fire-hearth.mp3（灶膛 / 焙炉的火）

- 原始素材：**Fireplace** by myLoop
- 来源：https://freesound.org/people/myLoop/sounds/852107/
- 许可：CC0 1.0
- 处理：取 0–8.6 秒 → 尾部 1.2 秒与开头交叉淡化做无缝循环 → 高通 55Hz、低通 1800Hz → 单声道 32kHz 48kbps mp3，7.42 秒，45KB

## 播放时的分工

| 层 | 谁负责 |
|---|---|
| 院子空气、树叶、远处的鸟 | `yard-garden.mp3`（随昼夜淡入淡出，夜里几乎退干净） |
| 灶膛的火、焙炉的炭 | `fire-hearth.mp3`（同一段录音，灶与炉用不同的闷度与相位错开） |
| 水开程度、水泡、炭嘶、火的强弱变化、夜里的蛐蛐 | 合成（`sound.ts` + `voices.ts`），素材表达不了这些变化 |
| 正在燃烧的随机噼啪 | 合成，同时用来打散 7 秒录音的循环感 |

素材加载失败（离线、404）会自动回退到全合成底噪，不会哑场。
调试开关：`?audio=sfx=0` 回退合成做 A/B，`?audio=bed=,wind=,fire=` 单独调各层。
