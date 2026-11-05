import { useState } from 'react'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Move } from 'lucide-react'
import { groupLibrary, LibraryConflict } from '../data/groupLibrary'
import { items } from '../domain/model'
import { constrainPosition, defaultRoomOrder, moveLayer, normalizeOrder, normalizePositions, normalizeTransforms, roomOrder, roomPosition, roomTransform, sameOrder, samePositions, sameTransforms, sharedRoomExtras, sharedRoomItems, type MovableItem, type RoomPosition, type RoomTransform, type SharedRoomExtra, type SharedRoomLayout } from '../domain/room'
import { useApp } from '../state/context'
import { ErrorState, messageOf } from './base'
import { Room } from './Room'
import { RoomLayerControls } from './RoomLayerControls'
import { RoomTransformControls } from './RoomTransformControls'

export function SharedLibraryRoom({ groupId, room, saved, refresh }: {
  groupId: string; room: SharedRoomLayout; saved: (room: SharedRoomLayout) => void; refresh: () => void;
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
  const shown = editing ? draft : room
  const visible = [...sharedRoomItems, ...(shown.extras ?? [])]
  const palette = draft.extras === undefined ? sharedRoomItems : defaultRoomOrder
  const unchanged = samePositions(draft.positions, baseline.positions) && sameOrder(draft.order, baseline.order)
    && sameTransforms(draft.transforms, baseline.transforms) && (draft.extras ?? []).join() === (baseline.extras ?? []).join()

  function startEditing() {
    // A hidden extra may still have a saved placement or layer.
    const hasDecorLayout = sharedRoomExtras.some(id => room.positions[id] || room.transforms?.[id] || room.order?.includes(id))
    setDraft({ ...room, extras: room.extras ?? (hasDecorLayout ? [] : undefined) })
    setBaseline(room)
    setSelected('desk')
    setIssue(''); setConflict(false); setEditing(true)
  }
  function toggleExtra(id: SharedRoomExtra, show: boolean) {
    setDraft(current => ({ ...current, extras: sharedRoomExtras.filter(extra => extra === id ? show : current.extras?.includes(extra)) }))
    if (show) setSelected(id)
    else if (selected === id) setSelected('desk')
  }
  function move(id: MovableItem, point: RoomPosition) {
    if (!busy) setDraft(current => ({ ...current, positions: { ...current.positions, [id]: constrainPosition(id, point, roomTransform(current.transforms ?? {}, id)) } }))
  }
  function reshape(transform: RoomTransform) {
    if (busy || conflict) return
    setDraft(current => ({ ...current,
      transforms: normalizeTransforms({ ...current.transforms, [selected]: transform }, palette),
      positions: { ...current.positions, [selected]: constrainPosition(selected, roomPosition(current.positions, selected), transform) },
    }))
  }
  function layer(id: MovableItem, direction: -1 | 1) {
    if (!busy) setDraft(current => ({ ...current, order: moveLayer(current.order, id, direction, visible, palette) }))
  }
  async function save() {
    if (busy || conflict) return
    setBusy(true); setIssue('')
    try {
      const result = await groupLibrary.layout(groupId, {
        ...draft,
        positions: normalizePositions(draft.positions, draft.transforms),
        order: normalizeOrder(roomOrder(draft.order, palette), palette),
        transforms: normalizeTransforms(draft.transforms ?? {}, palette),
      })
      saved(result.room); setEditing(false); notify('공동 도서관 배치를 저장했어요.')
    } catch (error) { setIssue(messageOf(error)); setConflict(error instanceof LibraryConflict) }
    finally { setBusy(false) }
  }
  return <div className="shared-library-room">
    <div className="challenges-heading"><div><h3>함께 꾸미는 공간</h3><p className="muted text-sm">멤버 누구나 가구를 옮기고 액자와 노트북을 배치할 수 있어요.</p></div>
      {!editing && <button className="btn btn-soft" onClick={startEditing}><Move size={15} />공동 배치 편집</button>}
    </div>
    <Room label={editing ? '공동 도서관 배치 편집' : '가구가 배치된 공동 도서관'} placed={visible} positions={shown.positions}
      editing={editing && !busy} selected={selected} onSelect={setSelected} onMove={move} order={shown.order} onLayer={layer} transforms={shown.transforms} />
    {editing && <div className="room-editor-controls">
      <p className="muted text-sm">가구를 끌거나, 초점을 둔 가구의 화살표 키로 이동하세요. 저장하면 그룹에 반영돼요.</p>
      <div role="group" aria-label="추가 공용 소품">
        <p className="text-sm font-bold">추가 공용 소품</p>
        <div className="row-actions">{sharedRoomExtras.map(id => <label className="btn btn-soft checkbox" key={id}>
          <input type="checkbox" checked={draft.extras?.includes(id) ?? false} disabled={busy || conflict} onChange={e => toggleExtra(id, e.target.checked)} />
          {items.find(item => item.id === id)!.name}
        </label>)}</div>
        <p className="muted text-xs">소품을 숨겼다가 다시 표시하면 마지막 배치를 불러와요.</p>
      </div>
      <label className="field"><span>이동할 공용 가구</span><select value={selected} onChange={e => setSelected(e.target.value as MovableItem)} disabled={busy}>{visible.map(id => <option key={id} value={id}>{items.find(item => item.id === id)!.name}</option>)}</select></label>
      <div className="row-actions" role="group" aria-label="공용 가구 이동">{([[ArrowLeft, '왼쪽', -8, 0], [ArrowUp, '위', 0, -8], [ArrowDown, '아래', 0, 8], [ArrowRight, '오른쪽', 8, 0]] as const).map(([Icon, label, x, y]) => <button className="btn btn-soft" key={label} aria-label={name + ' ' + label + ' 이동'} disabled={busy} onClick={() => { const p = roomPosition(draft.positions, selected); move(selected, { x: p.x + x, y: p.y + y }) }}><Icon size={17} /></button>)}</div>
      {issue && <ErrorState message={issue} />}
      <RoomLayerControls selected={selected} order={draft.order} visible={visible} disabled={busy || conflict} change={direction => layer(selected, direction)} />
      <RoomTransformControls selected={selected} transforms={draft.transforms} disabled={busy || conflict} change={reshape} />
      {conflict && <button className="btn btn-soft" onClick={() => { setEditing(false); refresh() }}>초안 취소하고 최신 공동 배치 보기</button>}
      <div className="row-actions"><button className="btn btn-quiet" disabled={busy} onClick={() => setDraft(current => ({ ...current, positions: {}, order: [], transforms: {} }))}>공동 가구 기본 위치</button><button className="btn btn-quiet" disabled={busy} onClick={() => setEditing(false)}>공동 배치 취소</button><button className="btn btn-primary" disabled={busy || conflict || unchanged} onClick={() => void save()}>{busy ? '저장 중…' : '공동 배치 저장'}</button></div>
    </div>}
  </div>
}
