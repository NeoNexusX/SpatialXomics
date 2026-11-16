/**
 * jsdom 没有 2D canvas：把 getContext('2d') 换成一个记录对象，测试通过它看写了哪些像素、
 * 什么顺序。每个 canvas 一个上下文，puts 按写入顺序记录全部 putImageData。
 */
export function installCanvasStub(): { puts: ImageData[] } {
  const puts: ImageData[] = []
  const contexts = new WeakMap<HTMLCanvasElement, unknown>()
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string) {
    if (type !== '2d') return null
    let ctx = contexts.get(this)
    if (!ctx) {
      ctx = {
        canvas: this,
        imageSmoothingEnabled: true,
        fillStyle: '',
        setTransform() {},
        clearRect() {},
        fillRect() {},
        drawImage() {},
        createImageData(w: number, h: number) {
          return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h }
        },
        putImageData(img: ImageData) {
          puts.push(img)
        },
      }
      contexts.set(this, ctx)
    }
    return ctx
  } as unknown as HTMLCanvasElement['getContext']
  return { puts }
}

/** 第 i 个像素的 RGBA */
export function px(img: ImageData, i: number) {
  return [img.data[i * 4], img.data[i * 4 + 1], img.data[i * 4 + 2], img.data[i * 4 + 3]]
}
