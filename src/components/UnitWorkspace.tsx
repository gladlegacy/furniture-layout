import { useMemo, useState } from 'react'
import type { InventoryEntry } from '../inventory.ts'
import { addInventory } from '../inventory.ts'
import {
  DEFAULT_PROGRAM,
  attachToWall,
  blankJoinPlan,
  doorWidth,
  generateUnitPlans,
  linkDoorWidth,
  planBounds,
  shiftToOrigin,
  sceneFromEnvelope,
  sceneFromUnitRoom,
  type UnitOpening,
  type UnitPlan,
  type UnitProgram,
  type UnitRoom,
  type UnitRoomKind,
} from '../layout/unitPlan.ts'
import type { Scene, Wall } from '../types.ts'
import { uid, WALLS, WALL_LABEL } from '../types.ts'
import { Fold } from './Fold.tsx'
import { InventoryPanel } from './InventoryPanel.tsx'
import { NumberField } from './NumberField.tsx'
import { UnitPlan2D } from './UnitPlan2D.tsx'
import { UnitScene3D } from './UnitScene3D.tsx'

function wallSpan(room: UnitRoom, wall: Wall): number {
  return wall === 'north' || wall === 'south' ? room.w : room.d
}

function fitOpening(span: number, offset: number, width: number, minWidth: number) {
  const nextWidth = Math.max(minWidth, Math.min(width, Math.max(minWidth, span - 8)))
  const nextOffset = Math.max(0, Math.min(offset, Math.max(0, span - nextWidth)))
  return { offset: Math.round(nextOffset), width: Math.round(nextWidth) }
}

function makeWindow(room: UnitRoom): NonNullable<UnitRoom['window']> {
  const walls: Wall[] = ['south', 'north', 'east', 'west']
  const wall = walls.reduce((best, side) => (wallSpan(room, side) > wallSpan(room, best) ? side : best))
  const span = wallSpan(room, wall)
  const fitted = fitOpening(span, (span - 120) / 2, Math.min(150, span - 36), 80)
  return { wall, ...fitted, sill: 90, height: 110 }
}

function programKey(program: UnitProgram): string {
  return JSON.stringify(program)
}

const JOIN_KINDS: { kind: UnitRoomKind; label: string; along: number; depth: number }[] = [
  { kind: 'corridor', label: '복도', along: 240, depth: 120 },
  { kind: 'bedroom', label: '방', along: 280, depth: 320 },
  { kind: 'bathroom', label: '화장실', along: 180, depth: 200 },
  { kind: 'living', label: '거실', along: 420, depth: 360 },
  { kind: 'kitchen', label: '주방', along: 260, depth: 220 },
]

function attachNear(
  rooms: UnitRoom[],
  hostId: string,
  wall: Wall,
  at: number,
  along: number,
  depth: number,
  kind: UnitRoomKind,
) {
  const desired = Math.round(at - along / 2)
  const direct = attachToWall(rooms, hostId, wall, desired, along, depth, kind)
  if (direct) return direct
  for (let step = 5; step <= 30; step += 5) {
    const lower = attachToWall(rooms, hostId, wall, desired - step, along, depth, kind)
    if (lower) return lower
    const upper = attachToWall(rooms, hostId, wall, desired + step, along, depth, kind)
    if (upper) return upper
  }
  return null
}

export function UnitWorkspace({
  entries,
  onEntries,
  onOpenRoom,
}: {
  entries: InventoryEntry[]
  onEntries: (entries: InventoryEntry[]) => void
  onOpenRoom: (scene: Scene) => void
}) {
  const [draft, setDraft] = useState<UnitProgram>(DEFAULT_PROGRAM)
  const [program, setProgram] = useState<UnitProgram>(DEFAULT_PROGRAM)
  const [pinned, setPinned] = useState<UnitPlan[] | null>(null)
  const [edits, setEdits] = useState<Record<string, UnitPlan>>({})
  const [picked, setPicked] = useState(0)
  const [angleKey, setAngleKey] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [joinKind, setJoinKind] = useState<UnitRoomKind | null>(null)
  const [joinAlong, setJoinAlong] = useState(240)
  const [joinDepth, setJoinDepth] = useState(120)
  const [joinMessage, setJoinMessage] = useState<string | null>(null)
  const generated = useMemo(() => generateUnitPlans(program), [program])
  const result = pinned ? { plans: pinned, message: '' } : generated
  const base = result.plans[picked] ?? result.plans[0] ?? null
  const active = base ? (edits[base.id] ?? base) : null
  const selected = active?.rooms.find((room) => room.id === selectedId) ?? null
  const bounds = active ? planBounds(active.rooms) : { width: program.width, depth: program.depth }
  const dirty = programKey(draft) !== programKey(program)
  const saved = entries.filter((entry) => entry.kind === 'unit')

  const patch = (next: Partial<UnitProgram>) => setDraft({ ...draft, ...next })

  const writePlan = (next: UnitPlan) => {
    if (!base) return
    if (pinned) {
      setPinned(pinned.map((plan, index) => (index === picked ? next : plan)))
      return
    }
    setEdits((current) => ({ ...current, [base.id]: { ...next, id: base.id } }))
  }

  const patchRoom = (roomId: string, recipe: (room: UnitRoom) => UnitRoom) => {
    if (!active) return
    writePlan({ ...active, rooms: active.rooms.map((room) => (room.id === roomId ? recipe(room) : room)) })
  }

  const patchDoor = (room: UnitRoom, next: Partial<UnitOpening>) => {
    if (!room.door) return room
    const wall = next.wall ?? room.door.wall
    const fitted = fitOpening(wallSpan(room, wall), next.offset ?? room.door.offset, next.width ?? room.door.width, doorWidth(room.kind))
    return { ...room, door: { ...room.door, wall, ...fitted } }
  }

  const patchWindow = (room: UnitRoom, next: Partial<NonNullable<UnitRoom['window']>>) => {
    if (!room.window) return room
    const wall = next.wall ?? room.window.wall
    const fitted = fitOpening(wallSpan(room, wall), next.offset ?? room.window.offset, next.width ?? room.window.width, 80)
    return { ...room, window: { ...room.window, ...next, wall, ...fitted } }
  }

  const openSelected = () => {
    if (!selected || selected.kind === 'corridor') return
    onOpenRoom(sceneFromUnitRoom(selected))
  }

  const chooseJoin = (kind: UnitRoomKind) => {
    const preset = JOIN_KINDS.find((item) => item.kind === kind)
    setJoinKind((current) => (current === kind ? null : kind))
    if (preset && joinKind !== kind) {
      setJoinAlong(preset.along)
      setJoinDepth(preset.depth)
    }
    setJoinMessage(null)
  }

  const startBlank = () => {
    const plan = blankJoinPlan()
    setPinned([plan])
    setEdits({})
    setPicked(0)
    setSelectedId('entrance')
    setJoinKind('corridor')
    setJoinAlong(240)
    setJoinDepth(120)
    setJoinMessage(null)
  }

  const joinOnWall = (roomId: string, wall: Wall, at: number) => {
    if (!active || !joinKind) return
    const joined = attachNear(active.rooms, roomId, wall, at, joinAlong, joinDepth, joinKind)
    if (!joined) {
      const host = active.rooms.find((room) => room.id === roomId)
      const need = host ? linkDoorWidth(joinKind, host.kind) : 90
      setJoinMessage(`붙이지 못했습니다. 맞닿는 변은 ${need}cm 이상이어야 하고, 이미 방이 있는 변과는 겹칠 수 없습니다.`)
      return
    }
    writePlan({ ...active, rooms: joined.rooms })
    setSelectedId(joined.id)
    setJoinMessage(null)
  }

  return (
    <div className="workspace">
      <aside className="editor">
        <Fold title="외곽">
          <div className="fields">
            <NumberField label="가로" suffix="cm" value={draft.width} onChange={(width) => patch({ width })} />
            <NumberField label="세로" suffix="cm" value={draft.depth} onChange={(depth) => patch({ depth })} />
            <NumberField label="방" suffix="개" value={draft.bedrooms} onChange={(bedrooms) => patch({ bedrooms: Math.max(0, Math.min(6, Math.round(bedrooms))) })} />
            <NumberField label="화장실" suffix="개" value={draft.bathrooms} onChange={(bathrooms) => patch({ bathrooms: Math.max(0, Math.min(3, Math.round(bathrooms))) })} />
          </div>
          <label className="check">
            <input type="checkbox" checked={draft.living} onChange={(event) => patch({ living: event.target.checked })} />
            거실 포함
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={draft.openKitchen}
              disabled={!draft.living}
              onChange={(event) => patch({ openKitchen: event.target.checked })}
            />
            거실·주방 일체형
          </label>
          <label>
            현관 위치
            <select value={draft.entrance} onChange={(event) => patch({ entrance: event.target.value as UnitProgram['entrance'] })}>
              {WALLS.map((wall) => (
                <option key={wall} value={wall}>{WALL_LABEL[wall]}</option>
              ))}
            </select>
          </label>
        </Fold>
        {!dirty && result.message && <p className="problem">{result.message}</p>}
        {dirty && <p className="hint">입력을 바꿨습니다. 시안 만들기를 누르면 그림에 반영됩니다.</p>}
        <div className="generate-row">
          <button
            type="button"
            className="primary"
            onClick={() => {
              setProgram(draft)
              setPinned(null)
              setEdits({})
              setPicked(0)
              setSelectedId(null)
            }}
          >
            시안 만들기
          </button>
        </div>
        <Fold title="이어 붙이기">
          <p className="hint">현관, 복도, 방을 변에 붙입니다. 복도는 여러 개 둘 수 있고, 맞닿는 변은 두 실 중 더 넓은 문 이상이어야 합니다. 복도·방은 90cm, 화장실은 75cm, 거실은 110cm입니다.</p>
          <div className="generate-row">
            <button type="button" onClick={startBlank}>현관에서 시작</button>
            {selected && active && active.rooms.length > 1 && (
              <button
                type="button"
                onClick={() => {
                  writePlan({ ...active, rooms: shiftToOrigin(active.rooms.filter((room) => room.id !== selected.id)) })
                  setSelectedId(null)
                }}
              >
                선택 칸 떼기
              </button>
            )}
          </div>
          <div className="join-kinds">
            {JOIN_KINDS.map((item) => (
              <button
                key={item.kind}
                type="button"
                className={joinKind === item.kind ? 'on' : undefined}
                onClick={() => chooseJoin(item.kind)}
              >
                {item.label}
              </button>
            ))}
          </div>
          {joinKind && (
            <div className="fields">
              <NumberField label="붙는 길이" suffix="cm" value={joinAlong} onChange={setJoinAlong} />
              <NumberField label="깊이" suffix="cm" value={joinDepth} onChange={setJoinDepth} />
            </div>
          )}
          {joinMessage && <p className="problem">{joinMessage}</p>}
        </Fold>
        {active && (
          <Fold title="방">
            {active.rooms.map((room) => (
              <article key={room.id} className={room.id === selectedId ? 'block on' : 'block'}>
                <label>
                  이름
                  <input
                    value={room.name}
                    aria-label={`${room.name} 이름`}
                    onChange={(event) => patchRoom(room.id, (current) => ({ ...current, name: event.target.value }))}
                    onFocus={() => setSelectedId(room.id)}
                  />
                </label>
                {room.door && (
                  <div className="fields">
                    <label>
                      {room.kind === 'entrance' ? '현관 문' : '문'}
                      <select
                        value={room.door.wall}
                        onChange={(event) => patchRoom(room.id, (current) => patchDoor(current, { wall: event.target.value as Wall }))}
                      >
                        {WALLS.map((wall) => (
                          <option key={wall} value={wall}>{WALL_LABEL[wall]}</option>
                        ))}
                      </select>
                    </label>
                    <NumberField
                      label="문 폭"
                      suffix="cm"
                      value={room.door.width}
                      onChange={(width) => patchRoom(room.id, (current) => patchDoor(current, { width }))}
                    />
                    <NumberField
                      label="문 위치"
                      suffix="cm"
                      value={room.door.offset}
                      onChange={(offset) => patchRoom(room.id, (current) => patchDoor(current, { offset }))}
                    />
                  </div>
                )}
                <label className="check">
                  <input
                    type="checkbox"
                    checked={room.window !== null}
                    onChange={(event) => patchRoom(room.id, (current) => ({ ...current, window: event.target.checked ? makeWindow(current) : null }))}
                  />
                  창문
                </label>
                {room.window && (
                  <div className="fields">
                    <label>
                      창문 벽
                      <select
                        value={room.window.wall}
                        onChange={(event) => patchRoom(room.id, (current) => patchWindow(current, { wall: event.target.value as Wall }))}
                      >
                        {WALLS.map((wall) => (
                          <option key={wall} value={wall}>{WALL_LABEL[wall]}</option>
                        ))}
                      </select>
                    </label>
                    <NumberField
                      label="창문 폭"
                      suffix="cm"
                      value={room.window.width}
                      onChange={(width) => patchRoom(room.id, (current) => patchWindow(current, { width }))}
                    />
                    <NumberField
                      label="창문 위치"
                      suffix="cm"
                      value={room.window.offset}
                      onChange={(offset) => patchRoom(room.id, (current) => patchWindow(current, { offset }))}
                    />
                  </div>
                )}
              </article>
            ))}
          </Fold>
        )}
        <InventoryPanel
          entries={saved}
          onSave={(name) => {
            if (!active) return
            const count = saved.length + 1
            onEntries(addInventory(entries, {
              id: uid('plan'),
              name: name || `평면 ${count}`,
              createdAt: Date.now(),
              kind: 'unit',
              program,
              plan: active,
            }))
          }}
          onLoad={(entry) => {
            if (entry.kind !== 'unit') return
            const loaded = { ...entry.program, openKitchen: entry.program.openKitchen !== false }
            setDraft(loaded)
            setProgram(loaded)
            setEdits({})
            setPinned([entry.plan])
            setPicked(0)
            setSelectedId(null)
          }}
          onDelete={(id) => onEntries(entries.filter((entry) => entry.id !== id))}
        />
      </aside>
      <main className="stage">
        <div className="cards unit" role="tablist" aria-label="평면 시안">
          {result.plans.map((plan, index) => (
            <button
              key={plan.id}
              type="button"
              role="tab"
              aria-selected={plan.id === active?.id}
              className={plan.id === active?.id ? 'card on' : 'card'}
              onClick={() => {
                setPicked(index)
                setSelectedId(null)
              }}
            >
              <span>{plan.label}</span>
              <p>{plan.note}</p>
            </button>
          ))}
        </div>
        {active && (
          <div className="views">
            <UnitScene3D
              plan={active}
              width={bounds.width}
              depth={bounds.depth}
              resetKey={`${active.id}-${angleKey}-${bounds.width}-${bounds.depth}`}
              onReset={() => setAngleKey((value) => value + 1)}
            />
            <UnitPlan2D
              plan={active}
              width={bounds.width}
              depth={bounds.depth}
              selectedId={selectedId}
              joining={joinKind !== null}
              onJoin={joinOnWall}
              onSelect={(room: UnitRoom) => setSelectedId(room.id)}
              onRename={(roomId, name) => patchRoom(roomId, (room) => ({ ...room, name }))}
              onOpening={(roomId, kind, opening) => {
                if (kind === 'door') patchRoom(roomId, (room) => patchDoor(room, opening))
                else patchRoom(roomId, (room) => patchWindow(room, opening))
              }}
            />
          </div>
        )}
        <div className="generate-row">
          <button
            type="button"
            className="primary"
            disabled={!selected || selected.kind === 'corridor'}
            onClick={openSelected}
          >
            이 방으로 가구 배치
          </button>
          <button type="button" onClick={() => onOpenRoom(sceneFromEnvelope(program.width, program.depth, program.entrance))}>
            집 크기로 가구 배치
          </button>
        </div>
        <p className="hint">
          {joinKind
            ? '파란 변을 누르면 그 칸에 붙습니다. 문 폭보다 짧게 닿거나 다른 방과 겹치면 붙지 않습니다.'
            : '방 이름은 더블클릭해서 바꿉니다. 문과 창문은 양 끝 점을 끌거나 왼쪽 수치로 바꿉니다. 방을 고르면 그 방으로 넘어가고, 집 크기는 외곽 전체를 하나의 방으로 엽니다.'}
        </p>
      </main>
    </div>
  )
}
