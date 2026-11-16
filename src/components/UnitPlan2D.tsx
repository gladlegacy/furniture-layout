import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { formatMm } from '../layout/dimensions.ts'
import { furnitureQuad } from '../layout/geometry.ts'
import { isPictureWindow } from '../layout/pictureWindow.ts'
import { doorSwingPoints, joinMinSpan, neighborOnSegment, neighborsAcrossDoor, passageSpans, roomBoxFits, roomDoors, roomFits, settleRoom, wallLinks, wallSegments, type UnitOpening, type UnitPlan, type UnitRoom, type UnitRoomKind } from '../layout/unitPlan.ts'
import type { FurnitureType, Placed, Wall } from '../types.ts'
import { FURNITURE_LABEL } from '../types.ts'
import { DoorSwing, WindowStroke } from './planMarks.tsx'
import { usePlanZoom } from './usePlanZoom.ts'

const FURNITURE_FILL: Record<FurnitureType, string> = {
  bed: '#e6e1d6',
  desk: '#e2c48f',
  chair: '#d7b07a',
  sofa: '#d7dbd6',
  table: '#edd8b6',
  wardrobe: '#f6f3ec',
  bookshelf: '#c9a36b',
  dresser: '#f0e4d0',
  nightstand: '#f7f4ee',
  shower: '#d5e6ee',
  bathtub: '#e7f1f4',
  sink: '#dfe8ee',
  toilet: '#f4f7f8',
  shoeCabinet: '#efe6d6',
}

const FILL: Record<UnitRoomKind, string> = {
  bedroom: '#e6dcc8',
  bathroom: '#d5ddd6',
  living: '#e4e7d4',
  entrance: '#ead9be',
  corridor: '#f3efe6',
  kitchen: '#ead7c2',
  utility: '#e4d8c6',
  dress: '#ddd4c6',
}

type OpeningKind = 'door' | 'window'
type NodeEnd = 'start' | 'end'

type Drag = {
  room: UnitRoom
  kind: OpeningKind
  end: NodeEnd
  opening: UnitOpening
  slot: number
}

type RoomDrag = {
  id: string
  grabX: number
  grabY: number
  originX: number
  originY: number
  x: number
  y: number
  valid: boolean
  moved: boolean
  clientX: number
  clientY: number
}

const RESIZE_EDGES = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as const
type ResizeEdge = (typeof RESIZE_EDGES)[number]

type ResizeDrag = {
  id: string
  edge: ResizeEdge
  originX: number
  originY: number
  originW: number
  originD: number
  x: number
  y: number
  w: number
  d: number
  valid: boolean
  moved: boolean
  clientX: number
  clientY: number
}

export function UnitPlan2D({
  plan,
  width,
  depth,
  selectedId,
  onSelect,
  onRename,
  onAddSpace,
  onOpening,
  onMoveRoom,
  onResizeRoom,
  onWalk,
  onDelete,
  onOpenDoor,
  onDoorSwing,
  onAddDoor,
  onRemoveDoor,
  onToggleWall,
  onSplit,
  onRemoveWindow,
  onAddWindow,
  onFurnish,
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false,
  onPictureWindow,
  furnitureByRoom,
}: {
  plan: UnitPlan
  width: number
  depth: number
  selectedId: string | null
  onSelect: (room: UnitRoom) => void
  onRename: (roomId: string, name: string) => void
  onAddSpace?: (kind: UnitRoomKind, x: number, y: number) => void
  onOpening: (roomId: string, kind: OpeningKind, opening: UnitOpening, slot?: number) => void
  onMoveRoom?: (roomId: string, x: number, y: number) => void
  onResizeRoom?: (roomId: string, x: number, y: number, width: number, depth: number) => boolean | void
  onWalk?: (room: UnitRoom) => void
  onDelete?: (roomId: string) => void
  onOpenDoor?: (roomId: string) => void
  onDoorSwing?: (roomId: string, part: 'hinge' | 'side') => void
  onAddDoor?: (roomId: string, place?: { wall: Wall; at: number }) => void
  onRemoveDoor?: (roomId: string, index: number) => void
  onToggleWall?: (roomId: string, neighborId: string, open: boolean) => void
  onSplit?: (roomId: string) => void
  onRemoveWindow?: (roomId: string) => void
  onAddWindow?: (roomId: string) => void
  onFurnish?: (room: UnitRoom) => void
  onUndo?: () => void
  onRedo?: () => void
  canUndo?: boolean
  canRedo?: boolean
  onPictureWindow?: (roomId: string) => void
  furnitureByRoom?: Record<string, Placed[]>
}) {
  const dragRef = useRef<Drag | null>(null)
  const roomDragRef = useRef<RoomDrag | null>(null)
  const resizeRef = useRef<ResizeDrag | null>(null)
  const [roomDrag, setRoomDrag] = useState<RoomDrag | null>(null)
  const [resize, setResize] = useState<ResizeDrag | null>(null)
  const [hoverId, setHoverId] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ id: string; value: string } | null>(null)
  const [sizeEdit, setSizeEdit] = useState<{ id: string; name: string; width: string; depth: string; error: string | null; left: number; top: number; point: { x: number; y: number } | null } | null>(null)
  const [wallMenu, setWallMenu] = useState<{ roomId: string; neighborId: string | null; name: string; wall: Wall; at: number; left: number; top: number } | null>(null)
  const [windowMenu, setWindowMenu] = useState<{ roomId: string; left: number; top: number } | null>(null)
  const [doorMenu, setDoorMenu] = useState<{ roomId: string; index: number; left: number; top: number } | null>(null)
  const [blankMenu, setBlankMenu] = useState<{ x: number; y: number; left: number; top: number } | null>(null)
  const padLeft = 128
  const padRight = 28
  const padTop = 72
  const padBottom = 148
  const maxW = 760
  const maxH = 560
  const shown = plan.rooms.map((room) => {
    if (resize?.id === room.id) return fitDrawnOpenings({ ...room, x: resize.x, y: resize.y, w: resize.w, d: resize.d })
    if (roomDrag?.id === room.id) return { ...room, x: roomDrag.x, y: roomDrag.y }
    return room
  })
  const lifted = resize?.id ?? roomDrag?.id
  const ordered = [...shown].sort((a, b) => Number(a.id === lifted) - Number(b.id === lifted))
  const scale = width > 0 && depth > 0 ? Math.min((maxW - padLeft - padRight) / width, (maxH - padTop - padBottom) / depth) : 1
  const viewW = width * scale + padLeft + padRight
  const viewH = depth * scale + padTop + padBottom
  const { svgRef, viewBox, zoom, zoomBy } = usePlanZoom(viewW, viewH)
  const spans = passageSpans(shown, plan.passages ?? [])
  const editedRoom = sizeEdit ? plan.rooms.find((room) => room.id === sizeEdit.id) ?? null : null
  const canOpenDoor = editedRoom ? neighborsAcrossDoor(plan.rooms, editedRoom).length > 0 : false
  const links = editedRoom ? wallLinks(plan.rooms, plan.passages ?? [], editedRoom) : []
  const covered = plan.rooms.reduce((sum, room) => sum + room.w * room.d, 0)
  const filled = width > 0 && depth > 0 && Math.abs(covered - width * depth) < 2
  const X = (x: number) => padLeft + x * scale
  const Y = (y: number) => padTop + (depth - y) * scale

  useEffect(() => {
    if (!sizeEdit && !wallMenu && !windowMenu && !doorMenu && !blankMenu) return
    const close = (event: PointerEvent) => {
      if (event.button === 2) return
      const target = event.target
      if (target instanceof Element && target.closest('.room-size, .wall-menu')) return
      setSizeEdit(null)
      setWallMenu(null)
      setWindowMenu(null)
      setDoorMenu(null)
      setBlankMenu(null)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSizeEdit(null)
        setWallMenu(null)
        setWindowMenu(null)
        setDoorMenu(null)
        setBlankMenu(null)
      }
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [sizeEdit, wallMenu, windowMenu, doorMenu, blankMenu])

  const openSizeEdit = (event: ReactMouseEvent<SVGGElement>, room: UnitRoom) => {
    event.preventDefault()
    event.stopPropagation()
    const host = event.currentTarget.ownerSVGElement?.closest('.plan')
    const bounds = host?.getBoundingClientRect()
    const left = bounds ? Math.max(8, Math.min(event.clientX - bounds.left, bounds.width - 144)) : 8
    const top = bounds ? Math.max(8, Math.min(event.clientY - bounds.top, Math.max(8, bounds.height - 360))) : 8
    onSelect(room)
    setWallMenu(null)
    setWindowMenu(null)
    setDoorMenu(null)
    setBlankMenu(null)
    const point = svgRef.current ? clientToCm(svgRef.current, event.clientX, event.clientY, padLeft, padTop, scale, depth) : null
    setSizeEdit({ id: room.id, name: room.name, width: String(Math.round(room.w * 10)), depth: String(Math.round(room.d * 10)), error: null, left, top, point })
  }

  const menuPoint = (event: ReactMouseEvent<SVGElement>) => {
    const host = event.currentTarget.ownerSVGElement?.closest('.plan')
    const bounds = host?.getBoundingClientRect()
    const left = bounds ? Math.max(8, Math.min(event.clientX - bounds.left, bounds.width - 144)) : 8
    const top = bounds ? Math.max(8, Math.min(event.clientY - bounds.top, Math.max(8, bounds.height - 80))) : 8
    return { left, top }
  }

  const beginRoomDrag = (event: ReactPointerEvent, room: UnitRoom) => {
    if (event.button !== 0) return
    const svg = svgRef.current
    if (!svg) return
    const point = clientToCm(svg, event.clientX, event.clientY, padLeft, padTop, scale, depth)
    if (!point) return
    event.preventDefault()
    event.stopPropagation()
    onSelect(room)
    roomDragRef.current = {
      id: room.id,
      grabX: point.x - room.x,
      grabY: point.y - room.y,
      originX: room.x,
      originY: room.y,
      x: room.x,
      y: room.y,
      valid: true,
      moved: false,
      clientX: event.clientX,
      clientY: event.clientY,
    }
  }

  const openWallMenu = (
    event: ReactMouseEvent<SVGLineElement>,
    room: UnitRoom,
    neighbor: UnitRoom | null,
    segment: { wall: Wall; x1: number; y1: number; x2: number; y2: number },
  ) => {
    event.preventDefault()
    event.stopPropagation()
    onSelect(room)
    setSizeEdit(null)
    setWindowMenu(null)
    setDoorMenu(null)
    setBlankMenu(null)
    const point = svgRef.current ? clientToCm(svgRef.current, event.clientX, event.clientY, padLeft, padTop, scale, depth) : null
    const horizontal = segment.wall === 'south' || segment.wall === 'north'
    const along = point ? (horizontal ? point.x : point.y) : (horizontal ? (segment.x1 + segment.x2) / 2 : (segment.y1 + segment.y2) / 2)
    const from = horizontal ? Math.min(segment.x1, segment.x2) : Math.min(segment.y1, segment.y2)
    const to = horizontal ? Math.max(segment.x1, segment.x2) : Math.max(segment.y1, segment.y2)
    setWallMenu({
      roomId: room.id,
      neighborId: neighbor?.id ?? null,
      name: neighbor?.name ?? '',
      wall: segment.wall,
      at: Math.max(from, Math.min(to, along)),
      ...menuPoint(event),
    })
  }

  const removeRoom = () => {
    if (!sizeEdit) return
    onDelete?.(sizeEdit.id)
    setSizeEdit(null)
  }

  const enterWalk = () => {
    const room = plan.rooms.find((item) => item.id === sizeEdit?.id)
    if (!room) return
    onWalk?.(room)
    setSizeEdit(null)
  }

  const applySize = () => {
    if (!sizeEdit) return
    const room = plan.rooms.find((item) => item.id === sizeEdit.id)
    const width = Math.round(Number(sizeEdit.width) / 10)
    const depth = Math.round(Number(sizeEdit.depth) / 10)
    if (!room || !Number.isFinite(width) || !Number.isFinite(depth)) {
      setSizeEdit({ ...sizeEdit, error: '가로와 세로를 숫자로 입력해 주세요.' })
      return
    }
    const name = sizeEdit.name.trim()
    if (name && name !== room.name) onRename(room.id, name)
    const ok = onResizeRoom?.(room.id, room.x, room.y, width, depth)
    if (ok === false) {
      setSizeEdit({ ...sizeEdit, error: '다른 칸과 겹치거나 너무 작아 적용되지 않습니다.' })
      return
    }
    setSizeEdit(null)
  }

  const openBlankMenu = (event: ReactMouseEvent<SVGElement>) => {
    event.preventDefault()
    event.stopPropagation()
    const point = svgRef.current ? clientToCm(svgRef.current, event.clientX, event.clientY, padLeft, padTop, scale, depth) : null
    if (!point) return
    if (plan.rooms.some((room) => point.x > room.x && point.x < room.x + room.w && point.y > room.y && point.y < room.y + room.d)) return
    setSizeEdit(null)
    setWallMenu(null)
    setWindowMenu(null)
    setDoorMenu(null)
    setBlankMenu({ x: point.x, y: point.y, ...menuPoint(event) })
  }

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const svg = svgRef.current
      const resizing = resizeRef.current
      if (resizing && svg) {
        const point = clientToCm(svg, event.clientX, event.clientY, padLeft, padTop, scale, depth)
        if (!point) return
        if (!resizing.moved && Math.hypot(event.clientX - resizing.clientX, event.clientY - resizing.clientY) < 4) return
        const kind = plan.rooms.find((room) => room.id === resizing.id)?.kind ?? 'bedroom'
        const next = resizeFromPointer(plan.rooms, resizing, point, joinMinSpan(kind))
        const placed = { ...resizing, ...next, moved: true }
        resizeRef.current = placed
        setResize(placed)
        return
      }
      const moving = roomDragRef.current
      if (moving && svg) {
        const point = clientToCm(svg, event.clientX, event.clientY, padLeft, padTop, scale, depth)
        if (!point) return
        if (!moving.moved && Math.hypot(event.clientX - moving.clientX, event.clientY - moving.clientY) < 4) return
        const raw = {
          x: Math.round(point.x - moving.grabX),
          y: Math.round(point.y - moving.grabY),
        }
        const snapped = snapRoom(plan.rooms, moving.id, raw.x, raw.y)
        const next = roomFits(plan.rooms, moving.id, snapped.x, snapped.y) ? snapped : raw
        const placed = { ...moving, ...next, valid: roomFits(plan.rooms, moving.id, next.x, next.y), moved: true }
        roomDragRef.current = placed
        setRoomDrag(placed)
        return
      }
      const drag = dragRef.current
      if (!drag || !svg) return
      const point = clientToCm(svg, event.clientX, event.clientY, padLeft, padTop, scale, depth)
      if (!point) return
      const hit = closestWall(drag.room, point.x, point.y)
      const minWidth = drag.kind === 'door' ? 70 : 80
      onOpening(drag.room.id, drag.kind, moveNode(drag.opening, drag.end, hit.wall, hit.t, hit.span, minWidth), drag.slot)
    }
    const up = () => {
      const resizing = resizeRef.current
      resizeRef.current = null
      setResize(null)
      if (resizing?.moved && resizing.valid) {
        const same = resizing.x === resizing.originX && resizing.y === resizing.originY && resizing.w === resizing.originW && resizing.d === resizing.originD
        if (!same) onResizeRoom?.(resizing.id, resizing.x, resizing.y, resizing.w, resizing.d)
      }
      const moving = roomDragRef.current
      roomDragRef.current = null
      setRoomDrag(null)
      if (moving?.moved) {
        const distance = Math.hypot(moving.x - moving.originX, moving.y - moving.originY)
        const spot = moving.valid || distance >= 40 ? settleRoom(plan.rooms, moving.id, moving.x, moving.y) : null
        if (spot && (spot.x !== moving.originX || spot.y !== moving.originY)) onMoveRoom?.(moving.id, spot.x, spot.y)
      }
      dragRef.current = null
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [depth, onMoveRoom, onOpening, onResizeRoom, padLeft, padTop, plan.rooms, scale])

  const startDrag = (event: ReactPointerEvent, room: UnitRoom, kind: OpeningKind, end: NodeEnd, opening: UnitOpening, slot = 0) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    onSelect(room)
    dragRef.current = { room, kind, end, opening, slot }
  }

  return (
    <figure className="plan">
      <figcaption>
        <span>배치 시안</span>
        <span className="plan-zoom">
          <button type="button" onClick={onUndo} disabled={!canUndo}>되돌리기</button>
          <button type="button" onClick={onRedo} disabled={!canRedo}>다시 실행</button>
          <button type="button" onClick={() => zoomBy(1 / 1.25)}>축소</button>
          <button type="button" onClick={() => zoomBy(1.25)}>확대</button>
        </span>
      </figcaption>
      <svg ref={svgRef} className={[roomDrag?.moved ? 'moving-room' : '', resize?.moved ? `resizing-room resize-${edgeCursor(resize.edge)}` : ''].filter(Boolean).join(' ') || undefined} viewBox={viewBox} role="img" aria-label="방 배치 평면도">
        <rect className="plan-paper" x={-4000} y={-4000} width={8000} height={8000} fill="transparent" onContextMenu={openBlankMenu} />
        <rect x={X(0)} y={Y(depth)} width={width * scale} height={depth * scale} fill={filled ? '#f4ecdf' : '#f7f5f2'} stroke={filled ? '#1c1c1c' : '#c8c2b6'} strokeWidth={filled ? 7 : 1.5} onContextMenu={openBlankMenu} />
        {ordered.map((room) => (
          <g
            key={room.id}
            onClick={() => onSelect(room)}
            onContextMenu={(event) => openSizeEdit(event, room)}
            onPointerEnter={() => setHoverId(room.id)}
            onPointerLeave={() => setHoverId((current) => (current === room.id ? null : current))}
            onPointerDown={(event) => {
              const target = event.target
              if (!(target instanceof Element) || target.closest('.plan-name-input, .room-resize, .room-size, .piece-label')) return
              beginRoomDrag(event, room)
            }}
          >
            <rect
              className="room-body"
              x={X(room.x)}
              y={Y(room.y + room.d)}
              width={room.w * scale}
              height={room.d * scale}
              fill={FILL[room.kind]}
              stroke="none"
              opacity={(roomDrag?.id === room.id && !roomDrag.valid) || (resize?.id === room.id && !resize.valid) ? 0.72 : 1}
            >
              <title>끌어서 위치를 바꿉니다. 우클릭하면 이름, 가로·세로, 문, 창문, 벽, 삭제가 열립니다.</title>
            </rect>
            {(furnitureByRoom?.[room.id] ?? []).map((item) => {
              const quad = furnitureQuad({ ...item, x: item.x + room.x, y: item.y + room.y })
              const points = quad.map((point) => `${X(point.x)},${Y(point.y)}`).join(' ')
              const labelAt = quad.reduce((sum, point) => ({ x: sum.x + point.x / 4, y: sum.y + point.y / 4 }), { x: 0, y: 0 })
              return (
                <g key={item.id} className="room-furniture" pointerEvents="none">
                  <polygon points={points} fill={FURNITURE_FILL[item.type]} stroke="#1c1c1c" strokeWidth={1.2} />
                  {item.nominalWidth * scale > 36 && (
                    <text x={X(labelAt.x)} y={Y(labelAt.y)} textAnchor="middle" dominantBaseline="middle" fontSize={11} fill="#1c1c1c">
                      {FURNITURE_LABEL[item.type]}
                    </text>
                  )}
                </g>
              )
            })}
            {wallSegments(room, spans).map((segment) => (
              <line
                key={`${segment.wall}-${segment.x1}-${segment.y1}-${segment.x2}-${segment.y2}`}
                x1={X(segment.x1)}
                y1={Y(segment.y1)}
                x2={X(segment.x2)}
                y2={Y(segment.y2)}
                stroke={(roomDrag?.id === room.id && !roomDrag.valid) || (resize?.id === room.id && !resize.valid) ? '#b42318' : room.id === selectedId ? '#3d5a80' : '#1c1c1c'}
                strokeWidth={roomDrag?.id === room.id || resize?.id === room.id || room.id === selectedId ? 3 : 1.2}
                strokeLinecap="square"
                pointerEvents="none"
              />
            ))}
            {editing?.id === room.id ? (
              <foreignObject x={X(room.x + room.w / 2) - 58} y={Y(room.y + room.d / 2) - 16} width={116} height={32}>
                <input
                  className="plan-name-input"
                  aria-label={`${room.name} 이름 편집`}
                  value={editing.value}
                  autoFocus
                  onClick={(event) => event.stopPropagation()}
                  onChange={(event) => setEditing({ id: room.id, value: event.target.value })}
                  onBlur={(event) => {
                    const next = event.currentTarget.value.trim()
                    onRename(room.id, next || room.name)
                    setEditing(null)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur()
                    if (event.key === 'Escape') setEditing(null)
                  }}
                />
              </foreignObject>
            ) : room.w * scale > 46 && room.d * scale > 28 ? (
              <text
                x={X(room.x + room.w / 2)}
                y={Y(room.y + room.d / 2)}
                textAnchor="middle"
                className="piece-label"
                onClick={(event) => {
                  event.stopPropagation()
                  onSelect(room)
                  setEditing({ id: room.id, value: room.name })
                }}
              >
                <title>클릭하면 이름을 바꿉니다.</title>
                <tspan x={X(room.x + room.w / 2)} dy="-0.35em">{room.name}</tspan>
                <tspan x={X(room.x + room.w / 2)} dy="1.25em" className="piece-size">{(room.w * room.d / 10000).toFixed(1)}㎡</tspan>
              </text>
            ) : null}
          </g>
        ))}
        {shown.map((room) => wallSegments(room, spans).map((segment) => {
          const neighbor = neighborOnSegment(plan.rooms, room, segment)
          return (
            <line
              key={`${room.id}-${segment.wall}-${segment.x1}-${segment.y1}-${segment.x2}-${segment.y2}`}
              className="wall-hit"
              x1={X(segment.x1)}
              y1={Y(segment.y1)}
              x2={X(segment.x2)}
              y2={Y(segment.y2)}
              stroke="transparent"
              strokeWidth={16}
              onPointerDown={(event) => beginRoomDrag(event, room)}
              onContextMenu={(event) => openWallMenu(event, room, neighbor, segment)}
            >
              <title>{neighbor ? `${neighbor.name} 쪽 벽입니다. 우클릭하면 이 벽을 없앨 수 있습니다.` : '바깥 벽입니다.'}</title>
            </line>
          )
        }))}
        {ordered.map((room) => (room.id === selectedId || room.id === hoverId || room.id === resize?.id) && RESIZE_EDGES.map((edge) => {
          const point = edgePoint(room, edge)
          const shift = resizeShift(edge)
          const cursor = edgeCursor(edge)
          return (
            <rect
              key={`${room.id}-${edge}`}
              className={`room-resize ${cursor}`}
              x={X(point.x) + shift.x - 9}
              y={Y(point.y) + shift.y - 9}
              width={18}
              height={18}
              onPointerDown={(event) => {
                if (event.button !== 0) return
                event.preventDefault()
                event.stopPropagation()
                onSelect(room)
                resizeRef.current = {
                  id: room.id,
                  edge,
                  originX: room.x,
                  originY: room.y,
                  originW: room.w,
                  originD: room.d,
                  x: room.x,
                  y: room.y,
                  w: room.w,
                  d: room.d,
                  valid: true,
                  moved: false,
                  clientX: event.clientX,
                  clientY: event.clientY,
                }
              }}
            >
              <title>끌어서 가로·세로를 바꿉니다.</title>
            </rect>
          )
        }))}
        {shown.map((room) => (
          <g key={`${room.id}-openings`}>
            {roomDoors(room).map((door, index) => (
              <OpeningShape
                key={`${room.id}-door-${index}`}
                room={room}
                opening={door}
                kind="door"
                zoom={zoom}
                X={X}
                Y={Y}
                onFlip={index === 0 ? () => {
                  onSelect(room)
                  onDoorSwing?.(room.id, 'hinge')
                } : undefined}
                onDoorMenu={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  onSelect(room)
                  setSizeEdit(null)
                  setWallMenu(null)
                  setWindowMenu(null)
                  setBlankMenu(null)
                  setDoorMenu({ roomId: room.id, index, ...menuPoint(event) })
                }}
                onNode={(event, end) => startDrag(event, room, 'door', end, door, index)}
              />
            ))}
            {room.window && (
              <OpeningShape
                room={room}
                opening={room.window}
                kind="window"
                zoom={zoom}
                X={X}
                Y={Y}
                onNode={(event, end) => startDrag(event, room, 'window', end, room.window!)}
                onWindowMenu={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  onSelect(room)
                  setSizeEdit(null)
                  setWallMenu(null)
                  setBlankMenu(null)
                  setWindowMenu({ roomId: room.id, ...menuPoint(event) })
                }}
              />
            )}
          </g>
        ))}
        <WallDimensions plan={plan} width={width} depth={depth} X={X} Y={Y} />
        <Sunlight width={width} depth={depth} scale={scale} X={X} Y={Y} />
      </svg>
      {sizeEdit && (
        <form
          className="room-size"
          style={{ left: sizeEdit.left, top: sizeEdit.top }}
          onSubmit={(event) => {
            event.preventDefault()
            applySize()
          }}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <label className="wide">
            이름
            <input
              aria-label="공간 이름"
              value={sizeEdit.name}
              onChange={(event) => setSizeEdit({ ...sizeEdit, name: event.target.value })}
              onBlur={(event) => {
                const room = plan.rooms.find((item) => item.id === sizeEdit.id)
                const name = event.currentTarget.value.trim()
                if (room && name && name !== room.name) onRename(room.id, name)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur()
              }}
            />
          </label>
          <label>
            가로 mm
            <input aria-label="가로 mm" inputMode="decimal" value={sizeEdit.width} onChange={(event) => setSizeEdit({ ...sizeEdit, width: event.target.value, error: null })} />
          </label>
          <label>
            세로 mm
            <input aria-label="세로 mm" inputMode="decimal" value={sizeEdit.depth} onChange={(event) => setSizeEdit({ ...sizeEdit, depth: event.target.value, error: null })} />
          </label>
          <button type="submit">적용</button>
          <button type="button" onClick={enterWalk}>3D로 보기</button>
          {editedRoom && editedRoom.kind !== 'corridor' && (
            <button type="button" className="wide" onClick={() => { onFurnish?.(editedRoom); setSizeEdit(null) }}>이 공간에 가구 두기</button>
          )}
          {editedRoom?.door && (
            <>
              <button type="button" onClick={() => onDoorSwing?.(sizeEdit.id, 'hinge')}>경첩 {editedRoom.door.hinge === 'end' ? '끝' : '시작'}</button>
              <button type="button" onClick={() => onDoorSwing?.(sizeEdit.id, 'side')}>{editedRoom.door.swing === 'out' ? '바깥' : '안쪽'}</button>
            </>
          )}
          <button
            type="button"
            className="wide"
            onClick={() => {
              if (!editedRoom) return
              const point = sizeEdit.point
              if (!point) {
                onAddDoor?.(sizeEdit.id)
              } else {
                const hit = closestWall(editedRoom, point.x, point.y)
                const at = hit.wall === 'south' || hit.wall === 'north' ? editedRoom.x + hit.t : editedRoom.y + hit.t
                onAddDoor?.(sizeEdit.id, { wall: hit.wall, at })
              }
              setSizeEdit(null)
            }}
          >
            문 추가
          </button>
          {editedRoom && roomDoors(editedRoom).map((door, index) => (
            <button key={`${door.wall}-${door.offset}-${index}`} type="button" className="wide" onClick={() => { onRemoveDoor?.(sizeEdit.id, index); setSizeEdit(null) }}>
              {doorName(door, roomDoors(editedRoom))} 없애기
            </button>
          ))}
          {editedRoom?.window ? (
            <button type="button" className="wide" onClick={() => onRemoveWindow?.(sizeEdit.id)}>창문 없애기</button>
          ) : (
            <button type="button" className="wide" onClick={() => onAddWindow?.(sizeEdit.id)}>창문 추가</button>
          )}
          {canOpenDoor && (
            <button type="button" className="wide" onClick={() => { onOpenDoor?.(sizeEdit.id); setSizeEdit(null) }}>문 없애고 잇기</button>
          )}
          {editedRoom?.kind === 'living' && editedRoom.name.includes('주방') && (
            <button type="button" className="wide" onClick={() => { onSplit?.(sizeEdit.id); setSizeEdit(null) }}>거실과 주방으로 나누기</button>
          )}
          {links.map((link) => (
            <button key={link.id} type="button" className="wide" onClick={() => onToggleWall?.(sizeEdit.id, link.id, link.open)}>
              {link.name} {link.open ? '벽 추가' : '벽 없애기'}
            </button>
          ))}
          <button type="button" className="danger" onClick={removeRoom}>삭제</button>
          {sizeEdit.error && <p>{sizeEdit.error}</p>}
        </form>
      )}
      {wallMenu && (
        <form
          className="room-size wall-menu"
          style={{ left: wallMenu.left, top: wallMenu.top }}
          onSubmit={(event) => event.preventDefault()}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <button
            type="button"
            className="wide"
            onClick={() => {
              onAddDoor?.(wallMenu.roomId, { wall: wallMenu.wall, at: wallMenu.at })
              setWallMenu(null)
            }}
          >
            여기에 문 추가
          </button>
          {wallMenu.neighborId ? (
            <button
              type="button"
              className="wide"
              onClick={() => {
                onToggleWall?.(wallMenu.roomId, wallMenu.neighborId!, false)
                setWallMenu(null)
              }}
            >
              {wallMenu.name} 벽 없애기
            </button>
          ) : (
            <p>바깥 벽은 없앨 수 없습니다.</p>
          )}
        </form>
      )}
      {windowMenu && (
        <form
          className="room-size wall-menu"
          style={{ left: windowMenu.left, top: windowMenu.top }}
          onSubmit={(event) => event.preventDefault()}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <button
            type="button"
            className="wide"
            onClick={() => {
              onPictureWindow?.(windowMenu.roomId)
              setWindowMenu(null)
            }}
          >
            {pictureLabel(plan.rooms.find((room) => room.id === windowMenu.roomId))}
          </button>
        </form>
      )}
      {doorMenu && (
        <form
          className="room-size wall-menu"
          style={{ left: doorMenu.left, top: doorMenu.top }}
          onSubmit={(event) => event.preventDefault()}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <button
            type="button"
            className="wide"
            onClick={() => {
              onRemoveDoor?.(doorMenu.roomId, doorMenu.index)
              setDoorMenu(null)
            }}
          >
            이 문 없애기
          </button>
        </form>
      )}
      {blankMenu && (
        <form
          className="room-size blank-menu"
          style={{ left: blankMenu.left, top: blankMenu.top }}
          onSubmit={(event) => event.preventDefault()}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <p className="menu-title">공간 추가</p>
          {SPACE_KINDS.map((item) => (
            <button
              key={item.kind}
              type="button"
              onClick={() => {
                onAddSpace?.(item.kind, blankMenu.x, blankMenu.y)
                setBlankMenu(null)
              }}
            >
              {item.label}
            </button>
          ))}
        </form>
      )}
    </figure>
  )
}

function OpeningShape({
  room,
  opening,
  kind,
  zoom,
  X,
  Y,
  onNode,
  onFlip,
  onWindowMenu,
  onDoorMenu,
}: {
  room: UnitRoom
  opening: UnitOpening & { sill?: number; height?: number }
  kind: OpeningKind
  zoom: number
  X: (value: number) => number
  Y: (value: number) => number
  onNode: (event: ReactPointerEvent, end: NodeEnd) => void
  onFlip?: () => void
  onWindowMenu?: (event: ReactMouseEvent<SVGElement>) => void
  onDoorMenu?: (event: ReactMouseEvent<SVGElement>) => void
}) {
  const horizontal = opening.wall === 'north' || opening.wall === 'south'
  const y = opening.wall === 'north' ? room.y + room.d : opening.wall === 'south' ? room.y : room.y + opening.offset
  const x = opening.wall === 'east' ? room.x + room.w : opening.wall === 'west' ? room.x : room.x + opening.offset
  const x2 = horizontal ? x + opening.width : x
  const y2 = horizontal ? y : y + opening.width
  const swing = kind === 'door' ? doorSwingPoints(room, opening) : null
  const span = opening.wall === 'north' || opening.wall === 'south' ? room.w : room.d
  const full = kind === 'window' && opening.sill != null && opening.height != null && isPictureWindow(
    { offset: opening.offset, width: opening.width, sill: opening.sill, height: opening.height },
    span,
    250,
    roomDoors(room).filter((door) => door.wall === opening.wall),
  )
  const stroke = kind === 'window' || !swing ? (
    <g onContextMenu={onWindowMenu}>
      <title>{full ? '통창입니다. 우클릭하면 일반 창으로 바꿉니다.' : '우클릭하면 통창으로 바꿉니다.'}</title>
      <line x1={X(x)} y1={Y(y)} x2={X(x2)} y2={Y(y2)} stroke="transparent" strokeWidth={22} />
      <WindowStroke a={{ x, y }} b={{ x: x2, y: y2 }} X={X} Y={Y} full={full} />
    </g>
  ) : (
        <g
          onPointerDown={(event) => {
            if (event.button !== 0) return
            event.preventDefault()
            event.stopPropagation()
          }}
          onClick={(event) => {
            event.stopPropagation()
            onFlip?.()
          }}
          onContextMenu={onDoorMenu}
        >
          <title>클릭하면 경첩이 반대쪽으로 바뀝니다. 우클릭하면 이 문을 없앱니다.</title>
          <line x1={X(swing.hinge.x)} y1={Y(swing.hinge.y)} x2={X(swing.open.x)} y2={Y(swing.open.y)} stroke="transparent" strokeWidth={14} />
          <DoorSwing hinge={swing.hinge} closed={swing.closed} open={swing.open} X={X} Y={Y} />
        </g>
      )
  return (
    <g onContextMenu={onDoorMenu}>
      {stroke}
      <OpeningNode cx={X(x)} cy={Y(y)} kind={kind} zoom={zoom} label={kind === 'door' ? '문 시작' : '창문 시작'} onPointerDown={(event) => onNode(event, 'start')} />
      <OpeningNode cx={X(x2)} cy={Y(y2)} kind={kind} zoom={zoom} label={kind === 'door' ? '문 끝' : '창문 끝'} onPointerDown={(event) => onNode(event, 'end')} />
    </g>
  )
}

const SPACE_KINDS: { kind: UnitRoomKind; label: string }[] = [
  { kind: 'bedroom', label: '방' },
  { kind: 'bathroom', label: '화장실' },
  { kind: 'living', label: '거실' },
  { kind: 'kitchen', label: '주방' },
  { kind: 'entrance', label: '현관' },
  { kind: 'corridor', label: '복도' },
  { kind: 'dress', label: '드레스룸' },
  { kind: 'utility', label: '다용도실' },
]

const DOOR_SIDE: Record<Wall, string> = { south: '남쪽', north: '북쪽', east: '동쪽', west: '서쪽' }

function doorName(door: UnitOpening, doors: UnitOpening[]): string {
  const side = DOOR_SIDE[door.wall]
  const twins = doors.filter((item) => item.wall === door.wall).length
  return twins > 1 ? `${side} 문 ${formatMm(door.offset)}` : `${side} 문`
}

function WallDimensions({
  plan,
  width,
  depth,
  X,
  Y,
}: {
  plan: UnitPlan
  width: number
  depth: number
  X: (value: number) => number
  Y: (value: number) => number
}) {
  const xs = stops([0, width, ...plan.rooms.flatMap((room) => [room.x, room.x + room.w])])
  const ys = stops([0, depth, ...plan.rooms.flatMap((room) => [room.y, room.y + room.d])])
  const south = Y(0)
  const west = X(0)
  return (
    <g className="opening-dim" pointerEvents="none">
      <SegmentChain horizontal from={xs} toSvg={X} face={south} chain={48} overall={92} total={Math.round(width)} />
      <SegmentChain horizontal={false} from={ys} toSvg={Y} face={west} chain={-52} overall={-96} total={Math.round(depth)} />
    </g>
  )
}

function SegmentChain({
  horizontal,
  from,
  toSvg,
  face,
  chain,
  overall,
  total,
}: {
  horizontal: boolean
  from: number[]
  toSvg: (value: number) => number
  face: number
  chain: number
  overall: number
  total: number
}) {
  const points = from.map(toSvg)
  const first = points[0] ?? 0
  const last = points[points.length - 1] ?? first
  return (
    <g>
      {from.slice(0, -1).map((start, index) => {
        const end = from[index + 1]!
        const a = points[index]!
        const b = points[index + 1]!
        return (
          <DimSpan
            key={`${start}-${end}`}
            horizontal={horizontal}
            a={a}
            b={b}
            face={face}
            at={face + chain}
            label={formatMm(end - start)}
          />
        )
      })}
      <DimSpan horizontal={horizontal} a={first} b={last} face={face} at={face + overall} label={formatMm(total)} />
    </g>
  )
}

function DimSpan({
  horizontal,
  a,
  b,
  face,
  at,
  label,
}: {
  horizontal: boolean
  a: number
  b: number
  face: number
  at: number
  label: string
}) {
  const start = Math.min(a, b)
  const end = Math.max(a, b)
  const mid = (start + end) / 2
  const tick = 3.5
  if (horizontal) {
    return (
      <g>
        <line x1={start} y1={face} x2={start} y2={at + Math.sign(at - face) * 5} />
        <line x1={end} y1={face} x2={end} y2={at + Math.sign(at - face) * 5} />
        <line x1={start} y1={at} x2={end} y2={at} />
        <line x1={start - tick} y1={at + tick} x2={start + tick} y2={at - tick} />
        <line x1={end - tick} y1={at + tick} x2={end + tick} y2={at - tick} />
        <text x={mid} y={at - 8} textAnchor="middle" className="dim">{label}</text>
      </g>
    )
  }
  return (
    <g>
      <line x1={face} y1={start} x2={at + Math.sign(at - face) * 5} y2={start} />
      <line x1={face} y1={end} x2={at + Math.sign(at - face) * 5} y2={end} />
      <line x1={at} y1={start} x2={at} y2={end} />
      <line x1={at - tick} y1={start + tick} x2={at + tick} y2={start - tick} />
      <line x1={at - tick} y1={end + tick} x2={at + tick} y2={end - tick} />
      <text x={at - 10} y={mid} textAnchor="middle" dominantBaseline="middle" className="dim" transform={`rotate(-90 ${at - 10} ${mid})`}>{label}</text>
    </g>
  )
}

function pictureLabel(room: UnitRoom | undefined): string {
  if (!room?.window) return '통창으로 바꾸기'
  const span = room.window.wall === 'north' || room.window.wall === 'south' ? room.w : room.d
  const blocked = roomDoors(room).filter((door) => door.wall === room.window?.wall)
  return isPictureWindow(room.window, span, 250, blocked) ? '일반 창으로' : '통창으로 바꾸기'
}

function stops(values: number[]): number[] {
  const sorted = values.map((value) => Math.round(value)).sort((left, right) => left - right)
  const unique: number[] = []
  for (const value of sorted) {
    if (unique.length === 0 || value - unique[unique.length - 1]! > 1) unique.push(value)
  }
  return unique
}

function OpeningNode({
  cx,
  cy,
  kind,
  zoom,
  label,
  onPointerDown,
}: {
  cx: number
  cy: number
  kind: OpeningKind
  zoom: number
  label: string
  onPointerDown: (event: ReactPointerEvent) => void
}) {
  const radius = 4.5 / zoom
  return (
    <circle
      className={kind === 'window' ? 'opening-node window' : 'opening-node'}
      cx={cx}
      cy={cy}
      r={radius}
      strokeWidth={1.15 / zoom}
      onPointerDown={onPointerDown}
    >
      <title>{label}. 끌어서 위치와 폭을 바꿉니다.</title>
    </circle>
  )
}

function clientToCm(svg: SVGSVGElement, clientX: number, clientY: number, padLeft: number, padTop: number, scale: number, depth: number) {
  const ctm = svg.getScreenCTM()
  if (!ctm) return null
  const point = svg.createSVGPoint()
  point.x = clientX
  point.y = clientY
  const local = point.matrixTransform(ctm.inverse())
  return { x: (local.x - padLeft) / scale, y: depth - (local.y - padTop) / scale }
}

function resizeShift(edge: ResizeEdge): { x: number; y: number } {
  const east = edge.includes('e') ? 1 : edge.includes('w') ? -1 : 0
  const south = edge.includes('s') ? 1 : edge.includes('n') ? -1 : 0
  const length = Math.hypot(east, south) || 1
  const gap = 22
  return { x: (east / length) * gap, y: (south / length) * gap }
}

function edgeCursor(edge: ResizeEdge): 'ew' | 'ns' | 'nesw' | 'nwse' {
  if (edge === 'e' || edge === 'w') return 'ew'
  if (edge === 'n' || edge === 's') return 'ns'
  if (edge === 'ne' || edge === 'sw') return 'nesw'
  return 'nwse'
}

function edgePoint(room: UnitRoom, edge: ResizeEdge): { x: number; y: number } {
  const east = room.x + room.w
  const north = room.y + room.d
  const x = edge.includes('w') ? room.x : edge.includes('e') ? east : room.x + room.w / 2
  const y = edge.includes('s') ? room.y : edge.includes('n') ? north : room.y + room.d / 2
  return { x, y }
}

function fitDrawnOpenings(room: UnitRoom): UnitRoom {
  return {
    ...room,
    door: room.door ? fitDrawnOpening(room, room.door) : null,
    extraDoors: room.extraDoors?.map((opening) => fitDrawnOpening(room, opening)),
    window: room.window ? fitDrawnOpening(room, room.window) : null,
  }
}

function fitDrawnOpening<T extends UnitOpening>(room: UnitRoom, opening: T): T {
  const span = opening.wall === 'north' || opening.wall === 'south' ? room.w : room.d
  const width = Math.max(1, Math.min(opening.width, span))
  return { ...opening, width, offset: Math.max(0, Math.min(opening.offset, Math.max(0, span - width))) }
}

function resizeFromPointer(rooms: UnitRoom[], drag: ResizeDrag, point: { x: number; y: number }, min: number) {
  const origin = { x: drag.originX, y: drag.originY, w: drag.originW, d: drag.originD }
  const east = origin.x + origin.w
  const north = origin.y + origin.d
  let x = origin.x
  let y = origin.y
  let w = origin.w
  let d = origin.d
  if (drag.edge.includes('e')) w = point.x - origin.x
  if (drag.edge.includes('w')) {
    x = point.x
    w = east - point.x
  }
  if (drag.edge.includes('n')) d = point.y - origin.y
  if (drag.edge.includes('s')) {
    y = point.y
    d = north - point.y
  }
  const snapped = snapResize(rooms, drag.id, drag.edge, { x, y, w, d }, east, north)
  const chosen = snapped.w >= min && snapped.d >= min && roomBoxFits(rooms, drag.id, snapped.x, snapped.y, snapped.w, snapped.d)
    ? snapped
    : { x, y, w, d }
  if (chosen.w < min) {
    chosen.w = min
    if (drag.edge.includes('w')) chosen.x = east - min
  }
  if (chosen.d < min) {
    chosen.d = min
    if (drag.edge.includes('s')) chosen.y = north - min
  }
  const box = {
    x: Math.round(chosen.x),
    y: Math.round(chosen.y),
    w: Math.round(chosen.w),
    d: Math.round(chosen.d),
  }
  return { ...box, valid: box.w >= min && box.d >= min && roomBoxFits(rooms, drag.id, box.x, box.y, box.w, box.d) }
}

function snapResize(
  rooms: UnitRoom[],
  id: string,
  edge: ResizeEdge,
  box: { x: number; y: number; w: number; d: number },
  east: number,
  north: number,
) {
  const xs = [0]
  const ys = [0]
  for (const other of rooms) {
    if (other.id === id) continue
    xs.push(other.x, other.x + other.w)
    ys.push(other.y, other.y + other.d)
  }
  let { x, y, w, d } = box
  if (edge.includes('e')) w = snapValue(x + w, xs, 16) - x
  if (edge.includes('w')) {
    x = snapValue(x, xs, 16)
    w = east - x
  }
  if (edge.includes('n')) d = snapValue(y + d, ys, 16) - y
  if (edge.includes('s')) {
    y = snapValue(y, ys, 16)
    d = north - y
  }
  return { x, y, w, d }
}

function snapRoom(rooms: UnitRoom[], id: string, x: number, y: number) {
  const room = rooms.find((item) => item.id === id)
  if (!room) return { x, y }
  const xs = [0]
  const ys = [0]
  for (const other of rooms) {
    if (other.id === id) continue
    xs.push(other.x, other.x + other.w, other.x - room.w, other.x + other.w - room.w)
    ys.push(other.y, other.y + other.d, other.y - room.d, other.y + other.d - room.d)
  }
  return { x: snapValue(x, xs, 16), y: snapValue(y, ys, 16) }
}

function snapValue(value: number, targets: number[], limit: number) {
  let best = value
  let dist = limit
  for (const target of targets) {
    const gap = Math.abs(target - value)
    if (gap < dist) {
      best = target
      dist = gap
    }
  }
  return best
}

function Sunlight({
  width,
  depth,
  scale,
  X,
  Y,
}: {
  width: number
  depth: number
  scale: number
  X: (value: number) => number
  Y: (value: number) => number
}) {
  const reach = Math.min(110, depth * 0.16)
  return (
    <g pointerEvents="none">
      <g className="sunlight">
        <rect x={X(0)} y={Y(reach)} width={width * scale} height={reach * scale} />
      </g>
      <g className="compass" transform={`translate(${X(width / 2)} 6)`}>
        <text y="12" textAnchor="middle">N</text>
        <path d="M0 16 L-12 44 L0 50 L12 44 Z" />
        <path d="M0 16 L12 44 L0 50 Z" />
      </g>
    </g>
  )
}

function closestWall(room: UnitRoom, x: number, y: number): { wall: Wall; t: number; span: number } {
  const sides = [
    { wall: 'south' as const, dist: Math.abs(y - room.y), t: x - room.x, span: room.w },
    { wall: 'north' as const, dist: Math.abs(y - (room.y + room.d)), t: x - room.x, span: room.w },
    { wall: 'west' as const, dist: Math.abs(x - room.x), t: y - room.y, span: room.d },
    { wall: 'east' as const, dist: Math.abs(x - (room.x + room.w)), t: y - room.y, span: room.d },
  ].sort((a, b) => a.dist - b.dist)
  const best = sides[0]!
  return { wall: best.wall, t: Math.max(0, Math.min(best.span, best.t)), span: best.span }
}

function moveNode(opening: UnitOpening, end: NodeEnd, wall: Wall, t: number, span: number, minWidth: number): UnitOpening {
  const width = Math.min(opening.width, Math.max(minWidth, span - 4))
  if (opening.wall !== wall) {
    if (end === 'end') {
      const endAt = Math.max(minWidth, Math.min(span, t))
      const nextWidth = Math.min(width, endAt)
      return { ...opening, wall, offset: endAt - nextWidth, width: nextWidth }
    }
    const offset = Math.max(0, Math.min(t, span - minWidth))
    return { ...opening, wall, offset, width: Math.min(width, span - offset) }
  }
  if (end === 'start') {
    const endAt = opening.offset + opening.width
    const offset = Math.max(0, Math.min(t, endAt - minWidth))
    return { ...opening, wall, offset, width: Math.max(minWidth, endAt - offset) }
  }
  return { ...opening, wall, width: Math.max(minWidth, Math.min(span - opening.offset, t - opening.offset)) }
}
