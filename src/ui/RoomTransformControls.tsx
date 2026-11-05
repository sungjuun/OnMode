import { RotateCcw, RotateCw } from 'lucide-react'
import { roomTransform, type MovableItem, type RoomTransform, type RoomTransforms } from '../domain/room'
import { Field } from './base'

export function RoomTransformControls({ selected, transforms, disabled, change }: {
  selected: MovableItem; transforms?: RoomTransforms; disabled: boolean; change: (transform: RoomTransform) => void;
}) {
  const value = roomTransform(transforms ?? {}, selected)
  return <div className="room-transform-controls" role="group" aria-label="가구 회전과 크기">
    <p className="text-sm font-bold">회전 · 크기</p>
    <div className="row-actions"><button className="btn btn-soft" disabled={disabled} onClick={() => change({ ...value, rotation: (value.rotation + 270) % 360 })}><RotateCcw size={16} />왼쪽 회전</button><button className="btn btn-soft" disabled={disabled} onClick={() => change({ ...value, rotation: (value.rotation + 90) % 360 })}><RotateCw size={16} />오른쪽 회전</button></div>
    <Field label="가구 크기"><select disabled={disabled} value={value.scale} onChange={e => change({ ...value, scale: Number(e.target.value) })}>{Array.from({ length: 8 }, (_, i) => 50 + i * 10).map(scale => <option key={scale} value={scale}>{scale}%</option>)}</select></Field>
    <p className="muted text-xs" role="status">회전 {value.rotation}° · 크기 {value.scale}% · 방 안에 맞게 위치가 자동 조정돼요.</p>
    <button className="btn btn-quiet" disabled={disabled || value.rotation === 0 && value.scale === 100} onClick={() => change({ rotation: 0, scale: 100 })}>선택 가구 모양 초기화</button>
  </div>
}
