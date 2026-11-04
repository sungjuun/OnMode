import type { Page } from '@playwright/test'

/** Independent EAN-13 encoding fixture; production decoding uses ZXing. */
export function barcodeBits(value = '9780140328721') {
  const left = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011']
  const parity = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL']
  const invert = (bits: string) => [...bits].map(bit => bit === '1' ? '0' : '1').join('')
  return '101' + [...value.slice(1, 7)].map((digit, i) => parity[Number(value[0])][i] === 'L' ? left[Number(digit)] : invert([...left[Number(digit)]].reverse().join(''))).join('')
    + '01010' + [...value.slice(7)].map(digit => invert(left[Number(digit)])).join('') + '101'
}

declare global {
  interface Window { barcodeFixture: { calls: number; tracks: MediaStreamTrack[]; release?: () => void } }
}
export async function installCameraFixture(page: Page, mode: 'barcode' | 'blank' | 'denied' | 'delayed' = 'barcode', value = '9780140328721') {
  await page.addInitScript(({ mode, bits }) => {
    window.barcodeFixture = { calls: 0, tracks: [] }
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => {
      window.barcodeFixture.calls++
      if (mode === 'denied') throw new DOMException('Fixture permission denied', 'NotAllowedError')
      const canvas = document.createElement('canvas'); canvas.width = 476; canvas.height = 200
      const context = canvas.getContext('2d')!
      const draw = () => {
        context.fillStyle = '#fff'; context.fillRect(0, 0, 476, 200)
        if (mode === 'barcode') { context.fillStyle = '#000'; [...bits].forEach((bit, i) => { if (bit === '1') context.fillRect(48 + i * 4, 25, 4, 150) }) }
      }
      draw()
      const stream = canvas.captureStream(10)
      window.barcodeFixture.tracks.push(...stream.getTracks())
      const interval = setInterval(() => { if (stream.getTracks().every(track => track.readyState === 'ended')) clearInterval(interval); else draw() }, 100)
      if (mode === 'delayed') return new Promise<MediaStream>(resolve => { window.barcodeFixture.release = () => resolve(stream) })
      return stream
    } })
  }, { mode, bits: barcodeBits(value) })
}

export async function barcodePhoto(page: Page, value = '9780140328721') {
  const data = await page.evaluate(bits => {
    const canvas = document.createElement('canvas'); canvas.width = 476; canvas.height = 200
    const context = canvas.getContext('2d')!
    context.fillStyle = '#fff'; context.fillRect(0, 0, 476, 200); context.fillStyle = '#000'
    ;[...bits].forEach((bit, i) => { if (bit === '1') context.fillRect(48 + i * 4, 25, 4, 150) })
    return canvas.toDataURL('image/png').split(',')[1]
  }, barcodeBits(value))
  return { name: 'isbn-barcode.png', mimeType: 'image/png', buffer: Buffer.from(data, 'base64') }
}
