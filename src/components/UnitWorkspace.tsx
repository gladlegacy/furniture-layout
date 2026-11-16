import { useEffect, useMemo, useRef, useState } from 'react'
import type { InventoryEntry } from '../inventory.ts'
import { addInventory, renameInventory } from '../inventory.ts'
import {
  DEFAULT_PROGRAM,
  doorWidth,
  generateUnitPlans,
  moveRoom,
  planBounds,
  addRoomDoor,
  addRoomDoorAt,
  addUnitSpace,
  removeRoomDoorAt,
  closeSharedWall,
  openDoorway,
  openSharedWall,
  removeUnitRoom,
  resizeRoomBox,
  roomDoors,
  splitLivingKitchen,
  sceneFromEnvelope,
  sceneFromUnitRoom,
  type UnitOpening,
  type UnitPlan,
  type UnitProgram,
  type UnitRoom,
} from '../layout/unitPlan.ts'
import { nextWindowSize } from '../layout/pictureWindow.ts'
import type { RoomFocus, RoomFurnishing } from '../layout/roomLayouts.ts'
import type { Placed, Scene, Wall } from '../types.ts'
import { uid } from '../types.ts'
import { InventoryPanel } from './InventoryPanel.tsx'
import { useHistory } from './useHistory.ts'
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

export function UnitWorkspace({
  entries,
  onEntries,
  onOpenRoom,
  furnishings,
  live = true,
}: {
  entries: InventoryEntry[]
  onEntries: (entries: InventoryEntry[]) => void
  onOpenRoom: (scene: Scene, focus?: RoomFocus, roomKey?: string | null) => void
  furnishings: Record<string, RoomFurnishing>
  live?: boolean
}) {
  const [program, setProgram] = useState<UnitProgram>(DEFAULT_PROGRAM)
  const [pinned, setPinned] = useState<UnitPlan[] | null>(null)
  const [edits, setEdits] = useState<Record<string, UnitPlan>>({})
  const [picked, setPicked] = useState(0)
  const [angleKey, setAngleKey] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [walkRoomId, setWalkRoomId] = useState<string | null>(null)
  const walkingRef = useRef(false)
  const lockedOnce = useRef(false)
  const fullscreenOnce = useRef(false)
  const relocking = useRef(false)
  const leaveWalk = () => {
    walkingRef.current = false
    lockedOnce.current = false
    fullscreenOnce.current = false
    relocking.current = false
    setWalkRoomId(null)
    if (document.pointerLockElement) document.exitPointerLock()
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
  }
  const beginWalk = (room: UnitRoom) => {
    walkingRef.current = true
    lockedOnce.current = false
    fullscreenOnce.current = false
    relocking.current = true
    setWalkRoomId(room.id)
    const root = document.documentElement
    const pending = root.requestPointerLock?.() as void | Promise<void>
    void Promise.resolve(pending).catch(() => {
      relocking.current = false
    })
    void root.requestFullscreen?.().catch(() => {})
    const retry = () => {
      if (!walkingRef.current || document.pointerLockElement) {
        window.removeEventListener('mousemove', retry)
        return
      }
      const target = document.fullscreenElement ?? document.documentElement
      void Promise.resolve(target.requestPointerLock?.() as void | Promise<void>).catch(() => {})
    }
    window.addEventListener('mousemove', retry)
    window.setTimeout(() => {
      relocking.current = false
      window.removeEventListener('mousemove', retry)
    }, 400)
  }
  useEffect(() => {
    const stop = () => {
      walkingRef.current = false
      lockedOnce.current = false
      fullscreenOnce.current = false
      relocking.current = false
      setWalkRoomId(null)
      if (document.pointerLockElement) document.exitPointerLock()
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
    }
    const onFullscreen = () => {
      if (!walkingRef.current) return
      if (document.fullscreenElement) {
        fullscreenOnce.current = true
        relocking.current = true
        const pending = document.fullscreenElement.requestPointerLock?.() as void | Promise<void>
        void Promise.resolve(pending).catch(() => {
          relocking.current = false
        })
        window.setTimeout(() => {
          relocking.current = false
        }, 400)
        return
      }
      if (fullscreenOnce.current) stop()
    }
    const onLock = () => {
      if (!walkingRef.current) return
      if (document.pointerLockElement) {
        lockedOnce.current = true
        return
      }
      if (relocking.current) {
        const target = document.fullscreenElement ?? document.documentElement
        void Promise.resolve(target.requestPointerLock?.() as void | Promise<void>).catch(() => {})
        return
      }
      if (lockedOnce.current) stop()
    }
    const swallow = (event: Event) => {
      if (!walkingRef.current) return
      event.preventDefault()
      event.stopPropagation()
    }
    document.addEventListener('fullscreenchange', onFullscreen)
    document.addEventListener('pointerlockchange', onLock)
    for (const type of ['mousedown', 'mouseup', 'click', 'pointerdown', 'pointerup', 'auxclick', 'contextmenu'] as const) {
      window.addEventListener(type, swallow, true)
    }
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreen)
      document.removeEventListener('pointerlockchange', onLock)
      for (const type of ['mousedown', 'mouseup', 'click', 'pointerdown', 'pointerup', 'auxclick', 'contextmenu'] as const) {
        window.removeEventListener(type, swallow, true)
      }
    }
  }, [])
  const generated = useMemo(() => generateUnitPlans(program), [program])
  const result = pinned ? { plans: pinned, message: '' } : generated
  const base = result.plans[picked] ?? result.plans[0] ?? null
  const active = base ? (edits[base.id] ?? base) : null
  const selected = active?.rooms.find((room) => room.id === selectedId) ?? null
  const bounds = active ? planBounds(active.rooms) : { width: program.width, depth: program.depth }
  const saved = entries.filter((entry) => entry.kind === 'unit')
  const history = useHistory<UnitPlan>()
  if (active) history.track(active)

  const applyPlan = (next: UnitPlan) => {
    if (!base) return
    if (pinned) {
      setPinned(pinned.map((plan, index) => (index === picked ? next : plan)))
      return
    }
    setEdits((current) => ({ ...current, [base.id]: { ...next, id: base.id } }))
  }

  const writePlan = (next: UnitPlan) => {
    if (!base || !active) return
    const stored = pinned ? next : { ...next, id: base.id }
    if (JSON.stringify(stored) !== JSON.stringify(active)) history.mark()
    applyPlan(next)
  }

  const undoPlan = () => {
    const prev = history.undo()
    if (prev) applyPlan(prev)
  }

  const redoPlan = () => {
    const next = history.redo()
    if (next) applyPlan(next)
  }

  useEffect(() => {
    history.clear()
  }, [base?.id, history.clear])

  useEffect(() => {
    if (!live) return
    const onKey = (event: KeyboardEvent) => {
      const target = event.target
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return
      if (!event.ctrlKey && !event.metaKey) return
      if (event.key.toLowerCase() === 'z' && !event.shiftKey) {
        event.preventDefault()
        undoPlan()
      } else if (event.key.toLowerCase() === 'y' || (event.key.toLowerCase() === 'z' && event.shiftKey)) {
        event.preventDefault()
        redoPlan()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [history, live])

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

  const roomKey = (roomId: string) => (active ? `${active.id}:${roomId}` : null)

  const placedByRoom = useMemo(() => {
    const map: Record<string, Placed[]> = {}
    if (!active) return map
    for (const room of active.rooms) {
      const saved = furnishings[`${active.id}:${room.id}`]
      if (saved) map[room.id] = saved.placed
    }
    return map
  }, [active, furnishings])

  const openSelected = () => {
    if (!selected || selected.kind === 'corridor') return
    onOpenRoom(sceneFromUnitRoom(selected), selected.kind, roomKey(selected.id))
  }

  return (
    <div className="workspace unit">
      <aside className="editor">
        {result.message && <p className="problem">{result.message}</p>}
        {selected && active && (
          <div className="generate-row">
            <button
              type="button"
              onClick={() => {
                const removed = removeUnitRoom(active.rooms, active.passages ?? [], selected.id)
                writePlan({ ...active, rooms: removed.rooms, passages: removed.passages })
                setSelectedId(null)
                setNotice(null)
              }}
            >
              공간 삭제
            </button>
            {selected.kind === 'living' && selected.name.includes('주방') && (
              <button
                type="button"
                onClick={() => {
                  const split = splitLivingKitchen(active.rooms, selected.id)
                  if (!split) {
                    setNotice('이 칸은 거실 2400mm와 주방 1600mm로 나누기에는 작습니다.')
                    return
                  }
                  writePlan({ ...active, rooms: split.rooms })
                  setSelectedId(split.kitchenId)
                  setNotice(null)
                }}
              >
                거실과 주방으로 나누기
              </button>
            )}
          </div>
        )}
        {notice && <p className="problem">{notice}</p>}
      </aside>
      <main className="stage">
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
            setProgram(loaded)
            setEdits({})
            setPinned([entry.plan])
            setPicked(0)
            setSelectedId(null)
          }}
          onRename={(id, name) => onEntries(renameInventory(entries, id, name))}
          onDelete={(id) => onEntries(entries.filter((entry) => entry.id !== id))}
        />
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
                leaveWalk()
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
              walkRoomId={walkRoomId}
              onExitWalk={leaveWalk}
              onReset={() => setAngleKey((value) => value + 1)}
              placedByRoom={placedByRoom}
            />
            <UnitPlan2D
              plan={active}
              furnitureByRoom={placedByRoom}
              width={bounds.width}
              depth={bounds.depth}
              onUndo={undoPlan}
              onRedo={redoPlan}
              canUndo={history.canUndo}
              canRedo={history.canRedo}
              selectedId={selectedId}
              onMoveRoom={(roomId, x, y) => {
                const next = moveRoom(active.rooms, roomId, x, y)
                if (!next) return
                writePlan({ ...active, rooms: next })
              }}
              onResizeRoom={(roomId, x, y, w, d) => {
                const next = resizeRoomBox(active.rooms, roomId, x, y, w, d)
                if (!next) return false
                writePlan({ ...active, rooms: next })
                return true
              }}
              onSelect={(room: UnitRoom) => setSelectedId(room.id)}
              onRename={(roomId, name) => patchRoom(roomId, (room) => ({ ...room, name }))}
              onAddSpace={(kind, x, y) => {
                const added = addUnitSpace(active.rooms, kind, x, y)
                if (!added) {
                  setNotice('이 자리에는 공간을 놓을 수 없습니다.')
                  return
                }
                writePlan({ ...active, rooms: added.rooms })
                setSelectedId(added.id)
                setNotice(null)
              }}
              onWalk={beginWalk}
              onDelete={(roomId) => {
                const removed = removeUnitRoom(active.rooms, active.passages ?? [], roomId)
                writePlan({ ...active, rooms: removed.rooms, passages: removed.passages })
                if (selectedId === roomId) setSelectedId(null)
              }}
              onOpenDoor={(roomId) => {
                const opened = openDoorway(active.rooms, active.passages ?? [], roomId)
                if (!opened) return
                writePlan({ ...active, rooms: opened.rooms, passages: opened.passages })
              }}
              onDoorSwing={(roomId, part) => {
                patchRoom(roomId, (room) => {
                  if (!room.door) return room
                  if (part === 'hinge') return { ...room, door: { ...room.door, hinge: room.door.hinge === 'end' ? 'start' : 'end' } }
                  return { ...room, door: { ...room.door, swing: room.door.swing === 'out' ? 'in' : 'out' } }
                })
              }}
              onAddDoor={(roomId, place) => {
                const next = place
                  ? addRoomDoorAt(active.rooms, active.passages ?? [], roomId, place.wall, place.at)
                  : addRoomDoor(active.rooms, active.passages ?? [], roomId)
                if (!next) {
                  setNotice(place ? '이 위치에는 문을 넣을 수 없습니다.' : '문을 넣을 빈 벽이 없습니다.')
                  return
                }
                writePlan({ ...active, rooms: next })
                setNotice(null)
              }}
              onRemoveDoor={(roomId, index) => {
                const next = removeRoomDoorAt(active.rooms, roomId, index)
                if (!next) return
                writePlan({ ...active, rooms: next })
              }}
              onRemoveWindow={(roomId) => patchRoom(roomId, (room) => ({ ...room, window: null }))}
              onAddWindow={(roomId) => patchRoom(roomId, (room) => (room.window ? room : { ...room, window: makeWindow(room) }))}
              onPictureWindow={(roomId) => patchRoom(roomId, (room) => {
                if (!room.window) return room
                const span = wallSpan(room, room.window.wall)
                const blocked = roomDoors(room).filter((door) => door.wall === room.window?.wall)
                return { ...room, window: { ...room.window, ...nextWindowSize(room.window, span, 250, blocked) } }
              })}
              onFurnish={(room) => {
                if (room.kind === 'corridor') return
                onOpenRoom(sceneFromUnitRoom(room), room.kind, roomKey(room.id))
              }}
              onSplit={(roomId) => {
                const split = splitLivingKitchen(active.rooms, roomId)
                if (!split) {
                  setNotice('이 칸은 거실 2400mm와 주방 1600mm로 나누기에는 작습니다.')
                  return
                }
                writePlan({ ...active, rooms: split.rooms })
                setSelectedId(split.kitchenId)
                setNotice(null)
              }}
              onToggleWall={(roomId, neighborId, open) => {
                const changed = open
                  ? closeSharedWall(active.rooms, active.passages ?? [], roomId, neighborId)
                  : openSharedWall(active.rooms, active.passages ?? [], roomId, neighborId)
                if (!changed) return
                writePlan({ ...active, rooms: changed.rooms, passages: changed.passages })
              }}
              onOpening={(roomId, kind, opening, slot = 0) => {
                if (kind === 'window') {
                  patchRoom(roomId, (room) => patchWindow(room, opening))
                  return
                }
                if (slot > 0) {
                  patchRoom(roomId, (room) => {
                    const extra = [...(room.extraDoors ?? [])]
                    const current = extra[slot - 1]
                    if (!current) return room
                    const wall = opening.wall
                    const fitted = fitOpening(wallSpan(room, wall), opening.offset, opening.width, 70)
                    extra[slot - 1] = { ...current, ...opening, wall, ...fitted }
                    return { ...room, extraDoors: extra }
                  })
                  return
                }
                patchRoom(roomId, (room) => patchDoor(room, opening))
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
          <button type="button" onClick={() => onOpenRoom(sceneFromEnvelope(program.width, program.depth, program.entrance), 'general', null)}>
            집 크기로 가구 배치
          </button>
        </div>
        <p className="hint">칸을 클릭하면 그 방을 고릅니다. 이름을 클릭하거나 우클릭 메뉴에서 바꿀 수 있습니다. 도면 밖 빈 곳을 우클릭하면 공간을 추가합니다. 문 위에서 우클릭하면 그 문을 없애고, 벽 위에서 우클릭하면 그 자리에 문을 넣거나 벽을 없앨 수 있습니다.</p>
      </main>
    </div>
  )
}
