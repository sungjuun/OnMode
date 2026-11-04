import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'
import { Camera, ImagePlus } from 'lucide-react'
import { scanBarcodePhoto, startBarcodeCamera } from '../data/barcodeScanner'
import { messageOf } from './base'

export function BarcodeScanner({ detected, disabled }: { detected: (isbn: string) => void; disabled: boolean }) {
  const video = useRef<HTMLVideoElement>(null)
  const request = useRef<AbortController | null>(null)
  const [active, setActive] = useState(false)
  const [photoBusy, setPhotoBusy] = useState(false)
  const [status, setStatus] = useState('')
  const stop = useCallback(() => { request.current?.abort(); setActive(false); setPhotoBusy(false) }, [])
  useEffect(() => { if (disabled) stop() }, [disabled, stop])
  useEffect(() => {
    const hide = () => { if (document.visibilityState === 'hidden') stop() }
    document.addEventListener('visibilitychange', hide); window.addEventListener('pagehide', stop)
    return () => { request.current?.abort(); document.removeEventListener('visibilitychange', hide); window.removeEventListener('pagehide', stop) }
  }, [stop])
  async function start() {
    stop()
    const controller = new AbortController(); request.current = controller
    setActive(true); setStatus('카메라 권한을 허용하고 바코드 전체를 비춰 주세요.')
    try {
      await startBarcodeCamera(video.current!, controller.signal, isbn => { stop(); setStatus('ISBN ' + isbn + '을 인식했어요. 번호를 확인하고 검색하세요.'); detected(isbn) }, setStatus, message => { setActive(false); setStatus(message) })
    } catch (error) { if (!controller.signal.aborted) { setActive(false); setStatus(messageOf(error)) } }
  }
  async function photo(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file) return
    stop()
    const controller = new AbortController(); request.current = controller
    setPhotoBusy(true); setStatus('사진에서 바코드를 읽고 있어요…')
    try {
      const isbn = await scanBarcodePhoto(file, controller.signal)
      if (!controller.signal.aborted) { setStatus('ISBN ' + isbn + '을 인식했어요. 번호를 확인하고 검색하세요.'); detected(isbn) }
    } catch (error) { if (!controller.signal.aborted) setStatus(messageOf(error)) }
    finally { if (!controller.signal.aborted) setPhotoBusy(false) }
  }
  return <div className="barcode-scanner" role="group" aria-label="ISBN 바코드 스캔">
    <div className="row-actions"><button type="button" className="btn btn-soft" disabled={disabled || photoBusy || active} onClick={() => void start()}><Camera size={16} />카메라로 스캔</button>
      <label className="btn btn-soft barcode-file"><ImagePlus size={16} />{photoBusy ? '사진 인식 중…' : '바코드 사진 선택'}<input type="file" aria-label="바코드 사진 선택" accept="image/png,image/jpeg,image/webp" disabled={disabled || photoBusy} onChange={event => void photo(event)} /></label></div>
    <video ref={video} hidden={!active} muted playsInline aria-label="바코드 카메라 미리보기" />
    {(active || photoBusy) && <button type="button" className="btn btn-quiet" onClick={() => { stop(); setStatus('스캔을 중지했어요.') }}>스캔 중지</button>}
    <p className="muted text-xs">카메라는 버튼을 누를 때 켜집니다. 영상·사진은 기기 안에서 인식해요. 인식한 ISBN을 확인한 뒤 검색하세요.</p>
    <p className="text-sm" role="status" aria-live="polite">{status}</p>
  </div>
}
