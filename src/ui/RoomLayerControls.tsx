import { ArrowDown, ArrowUp } from 'lucide-react'
import { roomOrder, type MovableItem } from '../domain/room'

export function RoomLayerControls({ selected, order, visible, disabled, change }: {
  selected: MovableItem; order?: MovableItem[]; visible: MovableItem[]; disabled: boolean; change: (direction: -1 | 1) => void;
}) {
  const layers = roomOrder(order, visible), index = layers.indexOf(selected)
  return <div className="room-layer-controls" role="group" aria-label="가구 겹침 순서">
    <p className="text-sm font-bold">겹침 순서</p>
    <div className="row-actions"><button className="btn btn-soft" disabled={disabled || index <= 0} onClick={() => change(-1)}><ArrowDown size={16} />뒤로 보내기</button><button className="btn btn-soft" disabled={disabled || index < 0 || index >= layers.length - 1} onClick={() => change(1)}><ArrowUp size={16} />앞으로 가져오기</button></div>
    <p className="muted text-xs" role="status">선택한 가구: 뒤에서 {index + 1}번째 / {layers.length}개 · Page Up / Page Down으로도 변경</p>
  </div>
}
