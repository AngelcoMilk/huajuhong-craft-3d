// 调试截图：window.__shot('名字') 立刻画一帧，存到开发服务器（.shots/名字.jpg）。
// 浏览器面板不显示的时候也能用。
export function installShot(canvas: HTMLCanvasElement, frame: () => void) {
  ;(window as unknown as { __shot: (name: string) => Promise<string> }).__shot = async (name: string) => {
    frame()
    frame()
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.88))
    if (!blob) return 'no blob'
    const res = await fetch('/__shot?name=' + encodeURIComponent(name), { method: 'POST', body: blob })
    return res.ok ? 'saved ' + name : 'fail'
  }
}
