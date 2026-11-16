import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import type { LayoutResult, Opening, Placed, Point, Room } from '../types.ts'
import { FURNITURE_LABEL } from '../types.ts'
import type { FurnitureType } from '../types.ts'
import { formatMm, measureRoom, type EdgeMeasure, type TriangleMeasure } from '../layout/dimensions.ts'
import { backSegment, furnitureAnchor, furnitureQuad, resizePlaced } from '../layout/geometry.ts'
import { isPictureWindow } from '../layout/pictureWindow.ts'
import { alongEdge, boundsOf, getEdge, inwardNormal, pointAt, signedArea, slideOpening, snap10, type Bounds } from '../layout/polygon.ts'
import { DoorSwing, WindowStroke } from './planMarks.tsx'
import { usePlanZoom } from './usePlanZoom.ts'

const FILL: Record<FurnitureType, string> = {
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

export type ShapeTool = 'add' | 'move' | 'delete'

type FloorPlanProps = {
  room: Room
  openings: Opening[]
  layout: LayoutResult | null
  tool?: ShapeTool | null
  onInsert?: (point: Point) => void
  onMoveVertex?: (index: number, point: Point) => void
  onDeleteVertex?: (index: number) => void
  onMoveFurniture?: (id: string, x: number, y: number) => void
  onResizeFurniture?: (id: string, next: Pick<Placed, 'x' | 'y' | 'w' | 'd' | 'nominalWidth' | 'nominalDepth'>) => void
  onMoveOpening?: (id: string, edge: number, offset: number) => void
  onRotateFurniture?: (id: string) => void
  onUndo?: () => void
  onRedo?: () => void
  canUndo?: boolean
  canRedo?: boolean
  onPictureWindow?: (id: string) => void
}

type MoveDrag =
  | { kind: 'item'; id: string; grabX: number; grabY: number; x: number; y: number; moved: boolean }
  | { kind: 'resize'; id: string; anchor: Point; signW: number; signD: number; origin: Placed; item: Placed; moved: boolean }
  | { kind: 'opening'; id: string; grab: number; width: number; edge: number; offset: number; moved: boolean }

const PAD = 64
const MAX_W = 680
const MAX_H = 520

type Frame = {
  minX: number
  maxY: number
  scale: number
  width: number
  height: number
}

function frameFor(outline: Point[]): Frame {
  const box = boundsOf(outline)
  const spanW = Math.max(box.width, 1)
  const spanD = Math.max(box.depth, 1)
  const scale = Math.min((MAX_W - PAD * 2) / spanW, (MAX_H - PAD * 2) / spanD)
  return {
    minX: box.minX,
    maxY: box.maxY,
    scale,
    width: spanW * scale + PAD * 2,
    height: spanD * scale + PAD * 2,
  }
}

function pointFromClient(svg: SVGSVGElement, clientX: number, clientY: number, frame: Frame, snap = true): Point | null {
  const pt = svg.createSVGPoint()
  pt.x = clientX
  pt.y = clientY
  const ctm = svg.getScreenCTM()
  if (!ctm) return null
  const local = pt.matrixTransform(ctm.inverse())
  const x = (local.x - PAD) / frame.scale + frame.minX
  const y = frame.maxY - (local.y - PAD) / frame.scale
  return snap ? { x: snap10(x), y: snap10(y) } : { x, y }
}

export function FloorPlan2D({ room, openings, layout, tool = null, onInsert, onMoveVertex, onDeleteVertex, onMoveFurniture, onResizeFurniture, onMoveOpening, onRotateFurniture, onUndo, onRedo, canUndo = false, canRedo = false, onPictureWindow }: FloorPlanProps) {
  const frameRef = useRef<Frame | null>(null)
  const stopDrag = useRef<(() => void) | null>(null)
  const moveRef = useRef<MoveDrag | null>(null)
  const [move, setMove] = useState<MoveDrag | null>(null)
  const [windowMenu, setWindowMenu] = useState<{ id: string; left: number; top: number } | null>(null)
  const [frozen, setFrozen] = useState<Frame | null>(null)
  const live = frameFor(room.outline)
  const frame = frozen ?? live
  const { svgRef, viewBox, zoom, zoomBy } = usePlanZoom(frame.width, frame.height)
  const X = (x: number) => PAD + (x - frame.minX) * frame.scale
  const Y = (y: number) => PAD + (frame.maxY - y) * frame.scale
  const placed = (layout?.ok ? layout.placed : []).map((item) => {
    if (move?.kind === 'item' && move.id === item.id) return { ...item, x: move.x, y: move.y }
    if (move?.kind === 'resize' && move.id === item.id) return move.item
    return item
  })
  const drawnOpenings = openings.map((opening) => (
    move?.kind === 'opening' && move.id === opening.id ? { ...opening, edge: move.edge, offset: move.offset } : opening
  ))
  const points = room.outline.map((point) => `${X(point.x)},${Y(point.y)}`).join(' ')
  const dims = measureRoom(room.outline)
  const ccw = signedArea(room.outline) >= 0

  useEffect(() => () => stopDrag.current?.(), [])

  useEffect(() => {
    if (!windowMenu) return
    const close = (event: PointerEvent) => {
      if (event.button === 2) return
      const target = event.target
      if (target instanceof Element && target.closest('.wall-menu')) return
      setWindowMenu(null)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setWindowMenu(null)
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [windowMenu])

  useEffect(() => {
    const movePointer = (event: PointerEvent) => {
      const drag = moveRef.current
      const svg = svgRef.current
      const current = frameRef.current
      if (!drag || !svg || !current) return
      const point = pointFromClient(svg, event.clientX, event.clientY, current, false)
      if (!point) return
      if (drag.kind === 'item') {
        const next = { ...drag, x: Math.round(point.x - drag.grabX), y: Math.round(point.y - drag.grabY), moved: true }
        moveRef.current = next
        setMove(next)
        return
      }
      if (drag.kind === 'resize') {
        const next = { ...drag, item: resizePlaced(drag.origin, drag.anchor, drag.signW, drag.signD, point), moved: true }
        moveRef.current = next
        setMove(next)
        return
      }
      const slid = slideOpening(room.outline, drag.width, point, drag.grab)
      if (!slid) return
      const next = { ...drag, edge: slid.edge, offset: slid.offset, moved: true }
      moveRef.current = next
      setMove(next)
    }
    const end = () => {
      const drag = moveRef.current
      if (!drag) return
      moveRef.current = null
      frameRef.current = null
      setFrozen(null)
      setMove(null)
      if (drag.moved) {
        if (drag.kind === 'item') onMoveFurniture?.(drag.id, drag.x, drag.y)
        else if (drag.kind === 'resize') onResizeFurniture?.(drag.id, drag.item)
        else onMoveOpening?.(drag.id, drag.edge, drag.offset)
      }
    }
    window.addEventListener('pointermove', movePointer)
    window.addEventListener('pointerup', end)
    return () => {
      window.removeEventListener('pointermove', movePointer)
      window.removeEventListener('pointerup', end)
    }
  }, [onMoveFurniture, onResizeFurniture, onMoveOpening, room.outline])

  const beginMove = (event: ReactPointerEvent, next: MoveDrag) => {
    event.preventDefault()
    event.stopPropagation()
    const frameNow = frameFor(room.outline)
    frameRef.current = frameNow
    setFrozen(frameNow)
    moveRef.current = next
    setMove(next)
  }

  const toRoom = (event: ReactPointerEvent<SVGSVGElement>): Point | null => {
    const svg = svgRef.current
    if (!svg) return null
    return pointFromClient(svg, event.clientX, event.clientY, frameRef.current ?? frameFor(room.outline))
  }

  const startDrag = (index: number, event: ReactPointerEvent<SVGCircleElement>) => {
    event.stopPropagation()
    event.preventDefault()
    const next = frameFor(room.outline)
    frameRef.current = next
    setFrozen(next)
    const move = (pointer: PointerEvent) => {
      const svg = svgRef.current
      const current = frameRef.current
      if (!svg || !current) return
      const point = pointFromClient(svg, pointer.clientX, pointer.clientY, current)
      if (point) onMoveVertex?.(index, point)
    }
    const end = () => {
      frameRef.current = null
      setFrozen(null)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      stopDrag.current = null
    }
    stopDrag.current?.()
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    stopDrag.current = end
  }

  return (
    <figure className="plan">
      <figcaption>
        2D 평면도
        <ZoomButtons zoomBy={zoomBy} onUndo={onUndo} onRedo={onRedo} canUndo={canUndo} canRedo={canRedo} />
      </figcaption>
      <svg
        ref={svgRef}
        className={[tool ? 'editing' : '', move?.moved ? 'moving-piece' : ''].filter(Boolean).join(' ') || undefined}
        data-pan={tool === 'add' ? 'off' : undefined}
        viewBox={viewBox}
        role="img"
        aria-label="가구 배치 평면도"
        onPointerDown={(event) => {
          if (tool !== 'add') return
          const point = toRoom(event)
          if (point) onInsert?.(point)
        }}
      >
        <polygon points={points} fill="#f4ecdf" stroke="#1c1c1c" strokeWidth={7} strokeLinejoin="round" />
        {layout?.openRect && (
          <rect
            x={X(layout.openRect.x)}
            y={Y(layout.openRect.y + layout.openRect.d)}
            width={layout.openRect.w * frame.scale}
            height={layout.openRect.d * frame.scale}
            fill="rgba(33, 92, 73, 0.14)"
            stroke="#215c49"
            strokeDasharray="6 4"
          />
        )}
        {drawnOpenings.filter((opening) => opening.kind === 'door').map((door) => (
          <DoorMark
            key={door.id}
            door={door}
            room={room}
            X={X}
            Y={Y}
            onPointerDown={(event) => {
              const point = pointFromClient(svgRef.current!, event.clientX, event.clientY, frameFor(room.outline), false)
              const edge = getEdge(room.outline, door.edge)
              if (!point || !edge) return
              beginMove(event, { kind: 'opening', id: door.id, grab: alongEdge(edge, point) - door.offset, width: door.width, edge: door.edge, offset: door.offset, moved: false })
            }}
          />
        ))}
        {drawnOpenings.filter((opening) => opening.kind === 'window').map((win) => (
          <WindowMark
            key={win.id}
            win={win}
            room={room}
            openings={openings}
            X={X}
            Y={Y}
            onPointerDown={(event) => {
              if (event.button !== 0) return
              const point = pointFromClient(svgRef.current!, event.clientX, event.clientY, frameFor(room.outline), false)
              const edge = getEdge(room.outline, win.edge)
              if (!point || !edge) return
              beginMove(event, { kind: 'opening', id: win.id, grab: alongEdge(edge, point) - win.offset, width: win.width, edge: win.edge, offset: win.offset, moved: false })
            }}
            onMenu={(event) => {
              event.preventDefault()
              event.stopPropagation()
              const host = svgRef.current?.closest('.plan')
              const bounds = host?.getBoundingClientRect()
              const left = bounds ? Math.max(8, Math.min(event.clientX - bounds.left, bounds.width - 156)) : 8
              const top = bounds ? Math.max(8, Math.min(event.clientY - bounds.top, Math.max(8, bounds.height - 52))) : 8
              setWindowMenu({ id: win.id, left, top })
            }}
          />
        ))}
        {placed.map((item) => (
          <FurnitureMark
            key={item.id}
            item={item}
            placed={placed}
            scale={frame.scale}
            X={X}
            Y={Y}
            onPointerDown={(event) => {
              const point = pointFromClient(svgRef.current!, event.clientX, event.clientY, frameFor(room.outline), false)
              if (!point) return
              beginMove(event, { kind: 'item', id: item.id, grabX: point.x - item.x, grabY: point.y - item.y, x: item.x, y: item.y, moved: false })
            }}
            onRotate={() => onRotateFurniture?.(item.id)}
            onResizeStart={(event, signW, signD) => {
              const anchor = furnitureAnchor(item, -signW, -signD)
              beginMove(event, { kind: 'resize', id: item.id, anchor, signW, signD, origin: item, item, moved: false })
            }}
          />
        ))}
        <DimensionLayer outline={room.outline} dims={dims} ccw={ccw} X={X} Y={Y} />
        <VertexNames outline={room.outline} X={X} Y={Y} />
        {tool && room.outline.map((point, index) => (
          <circle
            key={index}
            className="vertex"
            cx={X(point.x)}
            cy={Y(point.y)}
            r={12 / zoom}
            fill={tool === 'delete' ? '#8a3d2f' : '#215c49'}
            stroke="#fffdf8"
            strokeWidth={2 / zoom}
            onPointerDown={(event) => {
              if (tool === 'delete') {
                event.stopPropagation()
                onDeleteVertex?.(index)
                return
              }
              if (tool === 'move') startDrag(index, event)
            }}
          />
        ))}
      </svg>
      {layout && !layout.ok && <p className="problem">{layout.message}</p>}
      {windowMenu && (
        <form
          className="room-size wall-menu"
          style={{ left: windowMenu.left, top: windowMenu.top }}
          onSubmit={(event) => event.preventDefault()}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <button type="button" className="wide" onClick={() => { onPictureWindow?.(windowMenu.id); setWindowMenu(null) }}>
            {pictureWindowLabel(room, openings, windowMenu.id)}
          </button>
        </form>
      )}
    </figure>
  )
}

function VertexNames({ outline, X, Y }: { outline: Point[]; X: (x: number) => number; Y: (y: number) => number }) {
  const cx = outline.reduce((sum, point) => sum + point.x, 0) / outline.length
  const cy = outline.reduce((sum, point) => sum + point.y, 0) / outline.length
  return (
    <g className="vertex-names" pointerEvents="none">
      {outline.map((point, index) => {
        const dx = point.x - cx
        const dy = point.y - cy
        const len = Math.hypot(dx, dy) || 1
        const vx = dx / len
        const vy = -dy / len
        return (
          <text
            key={index}
            x={X(point.x) + vx * 18}
            y={Y(point.y) + vy * 18}
            textAnchor={vx > 0.35 ? 'start' : vx < -0.35 ? 'end' : 'middle'}
            dominantBaseline={vy > 0.35 ? 'hanging' : vy < -0.35 ? 'auto' : 'middle'}
            className="vertex-name"
          >
            점 {index + 1}
          </text>
        )
      })}
    </g>
  )
}

function DimensionLayer({
  outline,
  dims,
  ccw,
  X,
  Y,
}: {
  outline: Point[]
  dims: ReturnType<typeof measureRoom>
  ccw: boolean
  X: (x: number) => number
  Y: (y: number) => number
}) {
  const box = boundsOf(outline)
  return (
    <g pointerEvents="none">
      {dims.edges.filter((edge) => !coveredByOverall(edge, box)).map((edge) => (
        <EdgeDimension key={edge.index} edge={edge} ccw={ccw} X={X} Y={Y} />
      ))}
      {dims.corners.filter((corner) => corner.bent).map((corner) => (
        <CornerAngle key={corner.index} corner={corner} outline={outline} X={X} Y={Y} />
      ))}
      {dims.triangle && <AltitudeMark triangle={dims.triangle} edges={dims.edges} X={X} Y={Y} />}
      <OverallDimensions box={box} X={X} Y={Y} />
    </g>
  )
}

function coveredByOverall(edge: EdgeMeasure, box: Bounds): boolean {
  if (edge.diagonal) return false
  const flat = (left: number, right: number) => Math.abs(left - right) < 1
  const onBottom = flat(edge.a.y, box.minY) && flat(edge.b.y, box.minY)
  const onTop = flat(edge.a.y, box.maxY) && flat(edge.b.y, box.maxY)
  const onLeft = flat(edge.a.x, box.minX) && flat(edge.b.x, box.minX)
  const onRight = flat(edge.a.x, box.maxX) && flat(edge.b.x, box.maxX)
  if ((onBottom || onTop) && flat(edge.length, box.width)) return true
  if ((onLeft || onRight) && flat(edge.length, box.depth)) return true
  return false
}

function EdgeDimension({
  edge,
  ccw,
  X,
  Y,
}: {
  edge: EdgeMeasure
  ccw: boolean
  X: (x: number) => number
  Y: (y: number) => number
}) {
  const ax = X(edge.a.x)
  const ay = Y(edge.a.y)
  const bx = X(edge.b.x)
  const by = Y(edge.b.y)
  const dx = bx - ax
  const dy = by - ay
  const length = Math.hypot(dx, dy) || 1
  let nx = -dy / length
  let ny = dx / length
  const inward = inwardNormal(edge.a, edge.b, ccw)
  const outwardX = -inward.x
  const outwardY = inward.y
  if (nx * outwardX + ny * outwardY < 0) {
    nx = -nx
    ny = -ny
  }
  const mx = (ax + bx) / 2 + nx * 16
  const my = (ay + by) / 2 + ny * 16
  let deg = (Math.atan2(dy, dx) * 180) / Math.PI
  if (deg > 90) deg -= 180
  else if (deg < -90) deg += 180
  return (
    <g>
      <line x1={ax + nx * 11} y1={ay + ny * 11} x2={bx + nx * 11} y2={by + ny * 11} className="dim-line" />
      <line x1={ax} y1={ay} x2={ax + nx * 14} y2={ay + ny * 14} className="dim-line" />
      <line x1={bx} y1={by} x2={bx + nx * 14} y2={by + ny * 14} className="dim-line" />
      <text x={mx} y={my} textAnchor="middle" dominantBaseline="middle" className="dim" transform={`rotate(${deg} ${mx} ${my})`}>
        {formatMm(edge.length)}
      </text>
    </g>
  )
}

function CornerAngle({
  corner,
  outline,
  X,
  Y,
}: {
  corner: { angle: number; point: Point }
  outline: Point[]
  X: (x: number) => number
  Y: (y: number) => number
}) {
  const sx = X(corner.point.x)
  const sy = Y(corner.point.y)
  let cx = 0
  let cy = 0
  for (const point of outline) {
    cx += point.x
    cy += point.y
  }
  cx /= outline.length
  cy /= outline.length
  const dx = X(cx) - sx
  const dy = Y(cy) - sy
  const length = Math.hypot(dx, dy) || 1
  return (
    <text x={sx + (dx / length) * 26} y={sy + (dy / length) * 26} textAnchor="middle" dominantBaseline="middle" className="dim">
      {Math.round(corner.angle)}°
    </text>
  )
}

function AltitudeMark({
  triangle,
  edges,
  X,
  Y,
}: {
  triangle: TriangleMeasure
  edges: EdgeMeasure[]
  X: (x: number) => number
  Y: (y: number) => number
}) {
  const x1 = X(triangle.apex.x)
  const y1 = Y(triangle.apex.y)
  const x2 = X(triangle.foot.x)
  const y2 = Y(triangle.foot.y)
  const base = edges.find((edge) => edge.index === triangle.baseIndex)
  const towardX = base ? (X(base.a.x) + X(base.b.x)) / 2 : x2
  const towardY = base ? (Y(base.a.y) + Y(base.b.y)) / 2 : y2
  const midX = (x1 + x2) / 2
  const midY = (y1 + y2) / 2
  const dx = towardX - midX
  const dy = towardY - midY
  const length = Math.hypot(dx, dy) || 1
  const mx = midX + (dx / length) * 18
  const my = midY + (dy / length) * 18
  return (
    <g className="altitude">
      <line x1={x1} y1={y1} x2={x2} y2={y2} />
      <text x={mx} y={my} textAnchor="middle" dominantBaseline="middle" className="dim">
        높이 {formatMm(triangle.height)}
      </text>
    </g>
  )
}

function OverallDimensions({
  box,
  X,
  Y,
}: {
  box: Bounds
  X: (x: number) => number
  Y: (y: number) => number
}) {
  const left = X(box.minX)
  const right = X(box.maxX)
  const bottom = Y(box.minY)
  const top = Y(box.maxY)
  const dimY = bottom + 40
  const dimX = left - 40
  return (
    <g>
      <line x1={left} y1={bottom} x2={left} y2={dimY} className="dim-line" />
      <line x1={right} y1={bottom} x2={right} y2={dimY} className="dim-line" />
      <line x1={left} y1={dimY} x2={right} y2={dimY} className="dim-line" />
      <text x={(left + right) / 2} y={dimY - 5} textAnchor="middle" className="dim">전체 가로 {formatMm(box.width)}</text>
      <line x1={left} y1={top} x2={dimX} y2={top} className="dim-line" />
      <line x1={left} y1={bottom} x2={dimX} y2={bottom} className="dim-line" />
      <line x1={dimX} y1={top} x2={dimX} y2={bottom} className="dim-line" />
      <text x={dimX} y={(top + bottom) / 2} textAnchor="middle" dominantBaseline="middle" className="dim" transform={`rotate(-90 ${dimX} ${(top + bottom) / 2})`}>
        전체 세로 {formatMm(box.depth)}
      </text>
    </g>
  )
}

function resizeCursor(signW: number, signD: number, rotation: number): string {
  const rad = (rotation * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const wx = signW * cos + signD * sin
  const wy = -signW * sin + signD * cos
  const deg = ((Math.atan2(-wy, wx) * 180) / Math.PI + 360) % 180
  if (deg < 22.5 || deg >= 157.5) return 'ew-resize'
  if (deg < 67.5) return 'nwse-resize'
  if (deg < 112.5) return 'ns-resize'
  return 'nesw-resize'
}

function FurnitureMark({
  item,
  placed,
  scale,
  X,
  Y,
  onPointerDown,
  onRotate,
  onResizeStart,
}: {
  item: Placed
  placed: Placed[]
  scale: number
  X: (x: number) => number
  Y: (y: number) => number
  onPointerDown: (event: ReactPointerEvent) => void
  onRotate: () => void
  onResizeStart: (event: ReactPointerEvent, signW: number, signD: number) => void
}) {
  const same = placed.filter((other) => other.type === item.type)
  const name = same.length === 1 ? FURNITURE_LABEL[item.type] : `${FURNITURE_LABEL[item.type]} ${same.findIndex((other) => other.id === item.id) + 1}`
  const quad = furnitureQuad(item)
  const edge = backSegment(item)
  const points = quad.map((point) => `${X(point.x)},${Y(point.y)}`).join(' ')
  return (
    <g className="furniture-body" onPointerDown={onPointerDown}>
      <polygon points={points} fill={FILL[item.type]} stroke="#1c1c1c" strokeWidth={1.4} />
      <line
        x1={X(edge.a.x)}
        y1={Y(edge.a.y)}
        x2={X(edge.b.x)}
        y2={Y(edge.b.y)}
        stroke="#215c49"
        strokeWidth={4}
      />
      {item.w * scale > 34 && item.d * scale > 28 && (
        <text x={X(item.x + item.w / 2)} y={Y(item.y + item.d / 2)} textAnchor="middle" className="piece-label">
          <tspan x={X(item.x + item.w / 2)} dy={item.d * scale > 46 ? '-0.35em' : '0.35em'}>{name}</tspan>
          {item.d * scale > 46 && (
            <tspan x={X(item.x + item.w / 2)} dy="1.25em" className="piece-size">
              {Math.round(item.nominalWidth * 10)}×{Math.round(item.nominalDepth * 10)}mm
            </tspan>
          )}
        </text>
      )}
      {([
        [-1, 1],
        [1, 1],
        [1, -1],
        [-1, -1],
        [0, 1],
        [1, 0],
        [0, -1],
        [-1, 0],
      ] as const).map(([signW, signD]) => {
        const world = furnitureAnchor(item, signW, signD)
        const length = Math.hypot(signW, signD) || 1
        const reach = 8 / Math.max(scale, 0.001)
        const lx = (signW / length) * reach
        const lz = (signD / length) * reach
        const rad = (item.rotation * Math.PI) / 180
        const cos = Math.cos(rad)
        const sin = Math.sin(rad)
        const hx = X(world.x + lx * cos + lz * sin)
        const hy = Y(world.y - lx * sin + lz * cos)
        return (
          <rect
            key={`${signW}-${signD}`}
            className="furniture-resize"
            x={hx - 6}
            y={hy - 6}
            width={12}
            height={12}
            style={{ cursor: resizeCursor(signW, signD, item.rotation) }}
            onPointerDown={(event) => {
              event.preventDefault()
              event.stopPropagation()
              onResizeStart(event, signW, signD)
            }}
          >
            <title>끌어서 크기를 바꿉니다.</title>
          </rect>
        )
      })}
      <g
        className="furniture-turn"
        role="button"
        aria-label={`${name} 90도 회전`}
        onPointerDown={(event) => {
          event.preventDefault()
          event.stopPropagation()
        }}
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          onRotate()
        }}
      >
        <title>90도 회전</title>
        <rect x={X(item.x + item.w) - 30} y={Y(item.y + item.d) + 4} width={26} height={14} />
        <text x={X(item.x + item.w) - 17} y={Y(item.y + item.d) + 14} textAnchor="middle">90°</text>
      </g>
    </g>
  )
}

function pictureWindowLabel(room: Room, openings: Opening[], id: string): string {
  const win = openings.find((opening) => opening.id === id)
  const edge = win ? getEdge(room.outline, win.edge) : null
  if (!win || !edge) return '통창으로 바꾸기'
  const blocked = openings.filter((opening) => opening.edge === win.edge && opening.id !== win.id)
  return isPictureWindow(win, edge.length, room.height, blocked) ? '일반 창으로' : '통창으로 바꾸기'
}

function WindowMark({
  win,
  room,
  openings,
  X,
  Y,
  onPointerDown,
  onMenu,
}: {
  win: Opening
  room: Room
  openings: Opening[]
  X: (x: number) => number
  Y: (y: number) => number
  onPointerDown: (event: ReactPointerEvent) => void
  onMenu: (event: ReactMouseEvent<SVGElement>) => void
}) {
  const edge = getEdge(room.outline, win.edge)
  if (!edge) return null
  const a = pointAt(edge, win.offset)
  const b = pointAt(edge, win.offset + win.width)
  const blocked = openings.filter((opening) => opening.edge === win.edge && opening.id !== win.id)
  const full = isPictureWindow(win, edge.length, room.height, blocked)
  return (
    <g className="plan-opening" onPointerDown={onPointerDown} onContextMenu={onMenu}>
      <title>{full ? '통창입니다. 우클릭하면 일반 창으로 바꿉니다.' : '우클릭하면 통창으로 바꿉니다.'}</title>
      <line x1={X(a.x)} y1={Y(a.y)} x2={X(b.x)} y2={Y(b.y)} stroke="transparent" strokeWidth={22} />
      <WindowStroke a={a} b={b} X={X} Y={Y} full={full} />
    </g>
  )
}

function DoorMark({
  door,
  room,
  X,
  Y,
  onPointerDown,
}: {
  door: Opening
  room: Room
  X: (x: number) => number
  Y: (y: number) => number
  onPointerDown: (event: ReactPointerEvent) => void
}) {
  const edge = getEdge(room.outline, door.edge)
  if (!edge) return null
  const hinge = pointAt(edge, door.offset)
  const closed = pointAt(edge, door.offset + door.width)
  const inward = inwardNormal(edge.a, edge.b, signedArea(room.outline) >= 0)
  const open = { x: hinge.x + inward.x * door.width, y: hinge.y + inward.y * door.width }
  return (
    <g className="plan-opening" onPointerDown={onPointerDown}>
      <line x1={X(hinge.x)} y1={Y(hinge.y)} x2={X(closed.x)} y2={Y(closed.y)} stroke="transparent" strokeWidth={22} />
      <line x1={X(hinge.x)} y1={Y(hinge.y)} x2={X(open.x)} y2={Y(open.y)} stroke="transparent" strokeWidth={16} />
      <DoorSwing hinge={hinge} closed={closed} open={open} X={X} Y={Y} />
    </g>
  )
}

function ZoomButtons({ zoomBy, onUndo, onRedo, canUndo, canRedo }: { zoomBy: (factor: number) => void; onUndo?: () => void; onRedo?: () => void; canUndo: boolean; canRedo: boolean }) {
  return (
    <span className="plan-zoom">
      <button type="button" onClick={onUndo} disabled={!canUndo}>되돌리기</button>
      <button type="button" onClick={onRedo} disabled={!canRedo}>다시 실행</button>
      <button type="button" onClick={() => zoomBy(1 / 1.25)}>축소</button>
      <button type="button" onClick={() => zoomBy(1.25)}>확대</button>
    </span>
  )
}
