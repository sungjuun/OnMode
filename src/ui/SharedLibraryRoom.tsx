import { useState } from 'react'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Move } from 'lucide-react'
import { groupLibrary, LibraryConflict } from '../data/groupLibrary'
import { items } from '../domain/model'
import { constrainPosition, moveLayer, normalizeOrder, normalizePositions, roomPosition, sameOrder, samePositions, sharedRoomItems, type MovableItem, type RoomLayout, type RoomPosition } from '../domain/room'
import { useApp } from '../state/context'
import { ErrorState, messageOf } from './base'
import { Room } from './Room'
import { RoomLayerControls } from './RoomLayerControls'

const furniture = sharedRoomItems

export function SharedLibraryRoom({ groupId, room, saved, refresh }: {
  groupId: string; room: RoomLayout; saved: (room: RoomLayout) => void; refresh: () => void;
}) {
  const { notify } = useApp()
  const [draft, setDraft] = useState(room)
  const [baseline, setBaseline] = useState(room)
  const [editing, setEditing] = useState(false)
  const [selected, setSelected] = useState<MovableItem>('desk')
  const [busy, setBusy] = useState(false)
  const [issue, setIssue] = useState('')
  const [conflict, setConflict] = useState(false)
  const name = items.find(item => item.id === selected)!.name
  function move(id: MovableItem, point: RoomPosition) {
    if (!busy) setDraft(current => ({ ...current, positions: { ...current.positions, [id]: constrainPosition(id, point) } }))
  }
  function layer(id: MovableItem, direction: -1 | 1) {
    if (!busy) setDraft(current => ({ ...current, order: moveLayer(current.order, id, direction, furniture, furniture) }))
  }
  async function save() {
    if (busy || conflict) return
    setBusy(true); setIssue('')
    try {
      const result = await groupLibrary.layout(groupId, draft.revision, normalizePositions(draft.positions), normalizeOrder(draft.order ?? [], furniture))
      saved(result.room); setEditing(false); notify('공동 도서관 배치를 저장했어요.')
    } catch (error) { setIssue(messageOf(error)); setConflict(error instanceof LibraryConflict) }
    finally { setBusy(false) }
  }
  return <div className="shared-library-room">
    <div className="challenges-heading"><div><h3>함께 꾸미는 공간</h3><p className="muted text-sm">멤버 누구나 공용 가구 5개의 위치를 바꿀 수 있어요.</p></div>
      {!editing && <button className="btn btn-soft" onClick={() => { setDraft(room); setBaseline(room); setIssue(''); setConflict(false); setEditing(true) }}><Move size={15} />공동 배치 편집</button>}
    </div>
    <Room label={editing ? '공동 도서관 배치 편집' : '가구가 배치된 공동 도서관'} placed={furniture} positions={editing ? draft.positions : room.positions}
      editing={editing && !busy} selected={selected} onSelect={setSelected} onMove={move} order={editing ? draft.order : room.order} onLayer={layer} />
    {editing && <div className="room-editor-controls">
      <p className="muted text-sm">가구를 끌거나, 초점을 둔 가구의 화살표 키로 이동하세요. 저장하면 그룹에 반영돼요.</p>
      <label className="field"><span>이동할 공용 가구</span><select value={selected} onChange={e => setSelected(e.target.value as MovableItem)} disabled={busy}>{furniture.map(id => <option key={id} value={id}>{items.find(item => item.id === id)!.name}</option>)}</select></label>
      <div className="row-actions" role="group" aria-label="공용 가구 이동">{([[ArrowLeft, '왼쪽', -8, 0], [ArrowUp, '위', 0, -8], [ArrowDown, '아래', 0, 8], [ArrowRight, '오른쪽', 8, 0]] as const).map(([Icon, label, x, y]) => <button className="btn btn-soft" key={label} aria-label={name + ' ' + label + ' 이동'} disabled={busy} onClick={() => { const p = roomPosition(draft.positions, selected); move(selected, { x: p.x + x, y: p.y + y }) }}><Icon size={17} /></button>)}</div>
      {issue && <ErrorState message={issue} />}
      <RoomLayerControls selected={selected} order={draft.order} visible={furniture} disabled={busy || conflict} change={direction => layer(selected, direction)} />
      {conflict && <button className="btn btn-soft" onClick={() => { setEditing(false); refresh() }}>초안 취소하고 최신 공동 배치 보기</button>}
      <div className="row-actions"><button className="btn btn-quiet" disabled={busy} onClick={() => setDraft(current => ({ ...current, positions: {}, order: [] }))}>공동 가구 기본 위치</button><button className="btn btn-quiet" disabled={busy} onClick={() => setEditing(false)}>공동 배치 취소</button><button className="btn btn-primary" disabled={busy || conflict || samePositions(draft.positions, baseline.positions) && sameOrder(draft.order, baseline.order, furniture)} onClick={() => void save()}>{busy ? '저장 중…' : '공동 배치 저장'}</button></div>
    </div>}
  </div>
}
