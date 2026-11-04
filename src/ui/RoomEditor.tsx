import { useState } from 'react'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, House, Move, RotateCcw, X } from 'lucide-react'
import { items } from '../domain/model'
import { constrainPosition, emptyRoom, isMovable, moveLayer, normalizeOrder, normalizePositions, roomPosition, sameOrder, samePositions, type MovableItem, type RoomPosition, type RoomPositions } from '../domain/room'
import { useApp, useSnapshot } from '../state/context'
import { Card, CardTitle, ErrorState } from './base'
import { Room } from './Room'
import { RoomLayerControls } from './RoomLayerControls'

export function RoomEditor({ editing, setEditing }: { editing: boolean; setEditing: (editing: boolean) => void }) {
  const s = useSnapshot()
  const { busy, run, reload } = useApp()
  const room = s.room ?? emptyRoom()
  const [draft, setDraft] = useState<RoomPositions>({})
  const [baseline, setBaseline] = useState<RoomPositions>({})
  const [order, setOrder] = useState<MovableItem[]>([])
  const [baselineOrder, setBaselineOrder] = useState<MovableItem[]>([])
  const [revision, setRevision] = useState(0)
  const [selected, setSelected] = useState<MovableItem | null>(null)
  const [issue, setIssue] = useState('')
  const placed = s.placed.filter(isMovable)
  const active = selected && placed.includes(selected) ? selected : placed[0] ?? null
  const selectedName = items.find(item => item.id === active)?.name
  const dirty = !samePositions(draft, baseline) || !sameOrder(order, baselineOrder)

  function begin() {
    setDraft(room.positions)
    setBaseline(room.positions)
    setOrder(room.order ?? [])
    setBaselineOrder(room.order ?? [])
    setRevision(room.revision)
    setSelected(placed[0] ?? null)
    setIssue('')
    setEditing(true)
  }
  function move(id: MovableItem, position: RoomPosition) {
    if (!busy) setDraft(current => ({ ...current, [id]: constrainPosition(id, position) }))
  }
  function nudge(x: number, y: number) {
    if (!active) return
    const p = roomPosition(draft, active)
    move(active, { x: p.x + x, y: p.y + y })
  }
  function layer(id: MovableItem, direction: -1 | 1) {
    if (!busy) setOrder(current => moveLayer(current, id, direction, placed))
  }
  async function save() {
    if (!dirty || busy) return
    setIssue('')
    const saved = await run({ type: 'room_layout', revision, positions: normalizePositions(draft), order: normalizeOrder(order) }, '공부방 배치를 저장했어요.')
    if (saved) setEditing(false)
    else setIssue('저장하지 못했어요. 미리보기는 유지되니 다시 시도하거나 최신 배치를 불러와 주세요.')
  }

  return <Card className="room-card">
    <CardTitle icon={House} title="나만의 공부방" sub={editing ? '가구를 끌어 이동한 뒤 저장하세요.' : '집중하는 시간이 모여 완성되는 공간'}
      action={!editing && <button className="btn btn-soft" disabled={busy || !placed.length} onClick={begin}><Move size={15} />배치 편집</button>} />
    <Room placed={s.placed} positions={editing ? draft : room.positions} editing={editing && !busy}
      selected={active} onSelect={setSelected} onMove={move} order={editing ? order : room.order} onLayer={layer} />
    <div className="room-caption"><span>ONMODE ROOM / 01</span><span>{editing ? '저장 전 미리보기' : s.placed.length + '개 배치됨'}</span></div>
    {editing && <div className="room-editor-controls">
      {issue && <><ErrorState message={issue} /><button className="btn btn-soft" disabled={busy} onClick={() => { setEditing(false); reload() }}>초안 취소하고 최신 배치 보기</button></>}
      <fieldset className="room-selection"><legend>이동할 아이템</legend>
        <div className="row-actions">{placed.map(id => <button className={'btn ' + (active === id ? 'btn-primary' : 'btn-soft')} key={id}
          aria-pressed={active === id} aria-label={items.find(item => item.id === id)!.name + ' 선택'} disabled={busy} onClick={() => setSelected(id)}>
          {items.find(item => item.id === id)!.name}
        </button>)}</div>
      </fieldset>
      {active && <div className="room-nudge"><div><strong>{selectedName}</strong><p className="muted text-xs">가구에 초점을 두고 화살표로 이동<br />Shift + 화살표로 미세 이동</p></div>
        <div className="room-directions" role="group" aria-label="선택한 아이템 이동">
          {([[ArrowLeft, '왼쪽', -8, 0], [ArrowUp, '위', 0, -8], [ArrowDown, '아래', 0, 8], [ArrowRight, '오른쪽', 8, 0]] as const).map(([Icon, label, x, y]) =>
            <button className="btn btn-soft" aria-label={selectedName + ' ' + label + ' 이동'} key={label} disabled={busy} onClick={() => nudge(x, y)}><Icon size={18} /></button>)}
        </div>
      </div>}
      {active && <RoomLayerControls selected={active} order={order} visible={placed} disabled={busy} change={direction => layer(active, direction)} />}
      <div className="room-edit-actions">
        <button className="btn btn-quiet" disabled={busy} onClick={() => { setDraft({}); setOrder([]) }}><RotateCcw size={15} />기본 위치</button>
        <div className="row-actions"><button className="btn btn-quiet" disabled={busy} onClick={() => { setIssue(''); setEditing(false) }}><X size={15} />취소</button>
          <button className="btn btn-primary" disabled={busy || !dirty} onClick={() => void save()}><Check size={15} />{busy ? '저장 중…' : '배치 저장'}</button>
        </div>
      </div>
    </div>}
  </Card>
}
