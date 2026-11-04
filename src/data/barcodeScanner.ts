import { normalizeIsbn } from '../domain/isbn'

export function barcodeIsbn(value: string) { return /^97[89]\d{10}$/.test(value) ? normalizeIsbn(value) : null }
export function cameraMessage(error: unknown) {
  const name = error instanceof Error ? error.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError') return '카메라 권한이 허용되지 않았어요. 브라우저 권한을 확인하거나 바코드 사진을 선택해 주세요.'
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return '사용할 수 있는 카메라가 없어요. 바코드 사진을 선택하거나 ISBN을 입력해 주세요.'
  if (name === 'NotReadableError') return '다른 앱이 카메라를 사용 중일 수 있어요. 카메라를 확인하거나 사진을 선택해 주세요.'
  return '카메라를 시작하지 못했어요. 다시 시도하거나 바코드 사진을 선택해 주세요.'
}

export async function startBarcodeCamera(video: HTMLVideoElement, signal: AbortSignal, detected: (isbn: string) => void, notice: (message: string) => void, failed: (message: string) => void): Promise<() => void> {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw Error('카메라는 HTTPS 또는 이 기기의 로컬 주소에서 사용할 수 있어요. 사진을 선택하거나 ISBN을 입력해 주세요.')
  let stream: MediaStream | undefined, controls: { stop: () => void } | undefined, stopped = false
  function ended() { if (!stopped) { stop(); failed('카메라 연결이 종료됐어요. 다시 시작하거나 사진을 선택해 주세요.') } }
  function stop() {
    if (stopped) return
    stopped = true
    signal.removeEventListener('abort', stop)
    controls?.stop()
    stream?.getTracks().forEach(track => { track.removeEventListener('ended', ended); track.stop() })
    video.pause(); video.srcObject = null
  }
  signal.throwIfAborted()
  signal.addEventListener('abort', stop, { once: true })
  try {
    const { barcodeReader, barcodeMiss } = await import('./barcodeDecoder')
    signal.throwIfAborted()
    stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } })
    if (stopped) { stream.getTracks().forEach(track => track.stop()); signal.throwIfAborted() }
    stream.getTracks().forEach(track => track.addEventListener('ended', ended, { once: true }))
    controls = await barcodeReader().decodeFromStream(stream, video, (result, error, active) => {
      if (stopped) return
      if (!result) {
        if (error && !barcodeMiss(error)) { active.stop(); stop(); failed('카메라 영상을 읽지 못했어요. 다시 시작하거나 사진을 선택해 주세요.') }
        return
      }
      const isbn = barcodeIsbn(result.getText())
      if (!isbn) { notice('도서의 978·979로 시작하는 ISBN 바코드를 비춰 주세요.'); return }
      active.stop(); stop(); detected(isbn)
    })
    if (stopped) controls.stop()
    return stop
  } catch (error) {
    stop(); signal.throwIfAborted()
    throw Error(cameraMessage(error), { cause: error })
  }
}

export async function scanBarcodePhoto(file: File, signal: AbortSignal): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 12 * 1024 * 1024) throw Error('12MB 이하의 JPG·PNG·WebP 바코드 사진을 선택해 주세요.')
  signal.throwIfAborted()
  const url = URL.createObjectURL(file), image = new Image()
  try {
    image.src = url
    await image.decode()
    signal.throwIfAborted()
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 40000000) throw Error('Image dimensions')
    const scale = Math.min(1, 2048 / Math.max(image.naturalWidth, image.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(image.naturalWidth * scale); canvas.height = Math.round(image.naturalHeight * scale)
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw Error('Canvas unavailable')
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    const { barcodeReader } = await import('./barcodeDecoder')
    signal.throwIfAborted()
    const isbn = barcodeIsbn(barcodeReader().decodeFromCanvas(canvas).getText())
    if (!isbn) throw Error('Not a book ISBN')
    return isbn
  } catch (error) {
    signal.throwIfAborted()
    throw Error('사진에서 도서 ISBN을 찾지 못했어요. 바코드 전체가 선명하게 나온 사진을 선택하거나 직접 입력해 주세요.', { cause: error })
  } finally { URL.revokeObjectURL(url); image.removeAttribute('src') }
}
