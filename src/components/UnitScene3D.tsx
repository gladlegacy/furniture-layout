import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Edges, OrbitControls } from '@react-three/drei'
import { NoToneMapping, type OrthographicCamera } from 'three'
import { passageSpans, roomDoors, type OpenSpan, type UnitPlan, type UnitRoom, type UnitRoomKind } from '../layout/unitPlan.ts'
import type { FurnitureType, Placed, Wall } from '../types.ts'
import { DEFAULT_SIZE } from '../types.ts'
import { FurnitureModel } from './RoomScene3D.tsx'

const HEIGHT = 2.5
const THICK = 0.12
const DOOR_HEIGHT = 2

const FLOOR: Record<UnitRoomKind, string> = {
  bedroom: '#e6dcc8',
  bathroom: '#d5ddd6',
  living: '#e4e7d4',
  entrance: '#ead9be',
  corridor: '#f3efe6',
  kitchen: '#ead7c2',
  utility: '#e4d8c6',
  dress: '#ddd4c6',
}

type Hole = {
  a: number
  b: number
  y0: number
  y1: number
  kind: 'door' | 'window' | 'open'
  hingeEnd?: boolean
  into?: 1 | -1
}

type Interval = {
  from: number
  to: number
  holes: Hole[]
}

type Piece = {
  axis: 'x' | 'z'
  fixed: number
  from: number
  to: number
  hole: Hole | null
}

type PieceModel = {
  id: string
  type: FurnitureType
  w: number
  d: number
  h: number
  rot: number
  x: number
  z: number
}

function quant(value: number): number {
  return Math.round(value * 1000) / 1000
}

function pushInterval(map: Map<number, Interval[]>, fixed: number, from: number, to: number, holes: Hole[]) {
  const key = quant(fixed)
  const list = map.get(key) ?? []
  list.push({ from, to, holes })
  map.set(key, list)
}

function piecesOf(axis: 'x' | 'z', fixed: number, intervals: Interval[]): Piece[] {
  const cuts = new Set<number>()
  for (const item of intervals) {
    cuts.add(quant(item.from))
    cuts.add(quant(item.to))
    for (const hole of item.holes) {
      cuts.add(quant(Math.max(item.from, hole.a)))
      cuts.add(quant(Math.min(item.to, hole.b)))
    }
  }
  const points = [...cuts].sort((left, right) => left - right)
  const pieces: Piece[] = []
  for (let index = 0; index < points.length - 1; index++) {
    const from = points[index]!
    const to = points[index + 1]!
    if (to - from < 0.015) continue
    const mid = (from + to) / 2
    const covering = intervals.filter((item) => item.from < mid - 0.001 && item.to > mid + 0.001)
    if (covering.length === 0) continue
    const holes = covering.flatMap((item) => item.holes).filter((item) => item.a < mid && item.b > mid)
    const hole = holes.find((item) => item.kind === 'open') ?? holes[0] ?? null
    pieces.push({ axis, fixed, from, to, hole })
  }
  return pieces
}

function buildPieces(plan: UnitPlan): Piece[] {
  const horizontal = new Map<number, Interval[]>()
  const vertical = new Map<number, Interval[]>()
  const passages = passageSpans(plan.rooms, plan.passages ?? [])
  for (const room of plan.rooms) {
    const edges: { wall: Wall; axis: 'x' | 'z'; fixed: number; from: number; to: number }[] = [
      { wall: 'south', axis: 'x', fixed: room.y, from: room.x, to: room.x + room.w },
      { wall: 'north', axis: 'x', fixed: room.y + room.d, from: room.x, to: room.x + room.w },
      { wall: 'west', axis: 'z', fixed: room.x, from: room.y, to: room.y + room.d },
      { wall: 'east', axis: 'z', fixed: room.x + room.w, from: room.y, to: room.y + room.d },
    ]
    for (const edge of edges) {
      const holes: Hole[] = []
      const origin = edge.axis === 'x' ? room.x : room.y
      for (const door of roomDoors(room)) {
        if (door.wall !== edge.wall) continue
        const inward = edge.wall === 'south' || edge.wall === 'west' ? 1 : -1
        holes.push({
          a: (origin + door.offset) / 100,
          b: (origin + door.offset + door.width) / 100,
          y0: 0,
          y1: DOOR_HEIGHT,
          kind: 'door',
          hingeEnd: door.hinge === 'end',
          into: door.swing === 'out' ? (inward === 1 ? -1 : 1) : inward,
        })
      }
      if (room.window?.wall === edge.wall) {
        holes.push({
          a: (origin + room.window.offset) / 100,
          b: (origin + room.window.offset + room.window.width) / 100,
          y0: room.window.sill / 100,
          y1: Math.min(HEIGHT, (room.window.sill + room.window.height) / 100),
          kind: 'window',
        })
      }
      const spanAxis = edge.axis === 'x' ? 'x' : 'y'
      for (const span of passages) {
        if (span.axis !== spanAxis || Math.abs(span.at - edge.fixed) > 2) continue
        const a = Math.max(edge.from, span.from) / 100
        const b = Math.min(edge.to, span.to) / 100
        if (b - a > 0.05) holes.push({ a, b, y0: 0, y1: HEIGHT, kind: 'open' })
      }
      const target = edge.axis === 'x' ? horizontal : vertical
      pushInterval(target, edge.fixed / 100, edge.from / 100, edge.to / 100, holes)
    }
  }
  return [
    ...[...horizontal.entries()].flatMap(([fixed, intervals]) => piecesOf('x', fixed, intervals)),
    ...[...vertical.entries()].flatMap(([fixed, intervals]) => piecesOf('z', fixed, intervals)),
  ]
}

function furnitureFor(room: UnitRoom): PieceModel | null {
  const source = room.kind === 'bedroom' ? DEFAULT_SIZE.bed : room.kind === 'living' ? DEFAULT_SIZE.sofa : null
  if (!source) return null
  const type: FurnitureType = room.kind === 'bedroom' ? 'bed' : 'sofa'
  let w = source.width / 100
  let d = source.depth / 100
  const h = source.height / 100
  let rot = 0
  const maxW = Math.max(0.4, room.w / 100 - 0.35)
  const maxD = Math.max(0.4, room.d / 100 - 0.35)
  if (w > maxW || d > maxD) {
    if (d <= maxW && w <= maxD) {
      rot = 90
      const swap = w
      w = d
      d = swap
    } else {
      const scale = Math.min(maxW / w, maxD / d)
      w *= scale
      d *= scale
    }
  }
  return { id: `${room.id}-stock`, type, w, d, h, rot, x: (room.x + room.w / 2) / 100, z: (room.y + room.d / 2) / 100 }
}

function placedPiece(room: UnitRoom, item: Placed): PieceModel {
  return {
    id: `${room.id}-${item.id}`,
    type: item.type,
    w: item.nominalWidth / 100,
    d: item.nominalDepth / 100,
    h: item.h / 100,
    rot: item.rotation,
    x: (room.x + item.x + item.w / 2) / 100,
    z: (room.y + item.y + item.d / 2) / 100,
  }
}

function Solid({
  axis,
  fixed,
  from,
  to,
  y0,
  y1,
  color,
  glass = false,
}: {
  axis: 'x' | 'z'
  fixed: number
  from: number
  to: number
  y0: number
  y1: number
  color: string
  glass?: boolean
}) {
  const length = to - from
  const height = y1 - y0
  if (length < 0.02 || height < 0.02) return null
  const position: [number, number, number] = axis === 'x'
    ? [(from + to) / 2, (y0 + y1) / 2, fixed]
    : [fixed, (y0 + y1) / 2, (from + to) / 2]
  const depth = glass ? 0.02 : THICK
  const size: [number, number, number] = axis === 'x' ? [length, height, depth] : [depth, height, length]
  return (
    <mesh position={position} castShadow={!glass} receiveShadow>
      <boxGeometry args={size} />
      <meshStandardMaterial color={color} transparent={glass} opacity={glass ? 0.42 : 1} roughness={glass ? 0.05 : 0.78} />
      {!glass && <Edges color="#1a1a1a" threshold={15} />}
    </mesh>
  )
}

function DoorLeaf({
  axis,
  fixed,
  from,
  to,
  hingeEnd = false,
  into = 1,
}: {
  axis: 'x' | 'z'
  fixed: number
  from: number
  to: number
  hingeEnd?: boolean
  into?: 1 | -1
}) {
  const span = to - from
  const sign = hingeEnd ? -1 : 1
  const hingeAt = hingeEnd ? to : from
  const theta = axis === 'x' ? Math.sign(-into * sign) * 0.65 : Math.sign(into * sign) * 0.65
  const hinge: [number, number, number] = axis === 'x' ? [hingeAt, 0, fixed] : [fixed, 0, hingeAt]
  return (
    <group position={hinge} rotation={[0, theta || 0.65, 0]}>
      <mesh position={axis === 'x' ? [sign * span / 2, DOOR_HEIGHT / 2, 0.03 * into] : [0.03 * into, DOOR_HEIGHT / 2, sign * span / 2]} castShadow>
        <boxGeometry args={axis === 'x' ? [span * 0.96, DOOR_HEIGHT, 0.04] : [0.04, DOOR_HEIGHT, span * 0.96]} />
        <meshStandardMaterial color="#f7f4ee" roughness={0.7} />
        <Edges color="#1a1a1a" threshold={15} />
      </mesh>
    </group>
  )
}

function WallPiece({ piece }: { piece: Piece }) {
  const { axis, fixed, from, to, hole } = piece
  if (hole?.kind === 'open') return null
  if (!hole) return <Solid axis={axis} fixed={fixed} from={from} to={to} y0={0} y1={HEIGHT} color="#fbfbfa" />
  return (
    <group>
      {hole.y0 > 0.03 && <Solid axis={axis} fixed={fixed} from={from} to={to} y0={0} y1={hole.y0} color="#fbfbfa" />}
      {HEIGHT - hole.y1 > 0.03 && <Solid axis={axis} fixed={fixed} from={from} to={to} y0={hole.y1} y1={HEIGHT} color="#fbfbfa" />}
      {hole.kind === 'window' && <Solid axis={axis} fixed={fixed} from={from} to={to} y0={hole.y0} y1={hole.y1} color="#c5ccc8" glass />}
      {hole.kind === 'door' && <DoorLeaf axis={axis} fixed={fixed} from={from} to={to} hingeEnd={hole.hingeEnd} into={hole.into} />}
    </group>
  )
}

const BODY = 0.2
const EYE = 1.55

function inRoom(x: number, z: number, room: UnitRoom): boolean {
  return x > room.x / 100 + BODY && x < (room.x + room.w) / 100 - BODY && z > room.y / 100 + BODY && z < (room.y + room.d) / 100 - BODY
}

function inDoor(x: number, z: number, room: UnitRoom): boolean {
  return roomDoors(room).some((door) => throughDoor(x, z, room, door))
}

function throughDoor(x: number, z: number, room: UnitRoom, door: NonNullable<UnitRoom['door']>): boolean {
  if (door.width < 70) return false
  const along = door.wall === 'north' || door.wall === 'south'
  const origin = along ? room.x : room.y
  const a = (origin + door.offset) / 100 + 0.08
  const b = (origin + door.offset + door.width) / 100 - 0.08
  if (b - a < 0.2) return false
  const fixed = (door.wall === 'south' ? room.y : door.wall === 'north' ? room.y + room.d : door.wall === 'west' ? room.x : room.x + room.w) / 100
  if (along) return x > a && x < b && z > fixed - BODY && z < fixed + BODY
  return z > a && z < b && x > fixed - BODY && x < fixed + BODY
}

function hitsFurniture(x: number, z: number, item: PieceModel): boolean {
  const wide = item.rot === 90 || item.rot === 270
  const hx = (wide ? item.d : item.w) / 2 + 0.08
  const hz = (wide ? item.w : item.d) / 2 + 0.08
  return Math.abs(x - item.x) < hx && Math.abs(z - item.z) < hz
}

function inPassage(x: number, z: number, spans: OpenSpan[]): boolean {
  for (const span of spans) {
    if (span.axis === 'x') {
      const at = span.at / 100
      if (x > span.from / 100 + 0.04 && x < span.to / 100 - 0.04 && Math.abs(z - at) < BODY + 0.04) return true
    } else {
      const at = span.at / 100
      if (z > span.from / 100 + 0.04 && z < span.to / 100 - 0.04 && Math.abs(x - at) < BODY + 0.04) return true
    }
  }
  return false
}

function canStand(x: number, z: number, rooms: UnitRoom[], furniture: PieceModel[], spans: OpenSpan[]): boolean {
  if (furniture.some((item) => hitsFurniture(x, z, item))) return false
  return inPassage(x, z, spans) || rooms.some((room) => inRoom(x, z, room) || inDoor(x, z, room))
}

function findStart(room: UnitRoom, rooms: UnitRoom[], furniture: PieceModel[], spans: OpenSpan[]): { x: number; z: number } {
  const x0 = room.x / 100
  const z0 = room.y / 100
  const x1 = (room.x + room.w) / 100
  const z1 = (room.y + room.d) / 100
  for (let iz = 1; iz <= 6; iz++) {
    for (let ix = 1; ix <= 6; ix++) {
      const x = x0 + ((x1 - x0) * ix) / 7
      const z = z0 + ((z1 - z0) * iz) / 7
      if (canStand(x, z, rooms, furniture, spans)) return { x, z }
    }
  }
  return { x: (x0 + x1) / 2, z: (z0 + z1) / 2 }
}

function standingRoom(x: number, z: number, rooms: UnitRoom[]): string {
  const px = x * 100
  const pz = z * 100
  const inside = rooms.find((room) => px >= room.x && px <= room.x + room.w && pz >= room.y && pz <= room.y + room.d)
  if (inside) return inside.name
  let best = rooms[0]
  let bestD = Infinity
  for (const room of rooms) {
    const cx = Math.max(room.x, Math.min(px, room.x + room.w))
    const cz = Math.max(room.y, Math.min(pz, room.y + room.d))
    const distance = (cx - px) ** 2 + (cz - pz) ** 2
    if (distance < bestD) {
      bestD = distance
      best = room
    }
  }
  return best?.name ?? ''
}

function Walker({
  room,
  rooms,
  furniture,
  spans,
  onExit,
  onPlace,
}: {
  room: UnitRoom
  rooms: UnitRoom[]
  furniture: PieceModel[]
  spans: OpenSpan[]
  onExit: () => void
  onPlace: (name: string) => void
}) {
  const camera = useThree((state) => state.camera)
  const keys = useRef(new Set<string>())
  const look = useRef({ yaw: 0, pitch: 0 })
  const pos = useRef({ x: 0, z: 0 })
  const named = useRef('')
  const onPlaceRef = useRef(onPlace)
  onPlaceRef.current = onPlace

  useLayoutEffect(() => {
    const start = findStart(room, rooms, furniture, spans)
    pos.current = start
    const cx = (room.x + room.w / 2) / 100
    const cz = (room.y + room.d / 2) / 100
    look.current.yaw = Math.atan2(cx - start.x, cz - start.z)
    look.current.pitch = 0
    camera.position.set(-start.x, EYE, start.z)
    camera.lookAt(-cx, EYE, cz)
    const name = standingRoom(start.x, start.z, rooms)
    named.current = name
    onPlaceRef.current(name)
  }, [camera, furniture, room, rooms, spans])

  useEffect(() => {
    const typing = (event: Event) => {
      const target = event.target
      return target instanceof HTMLElement && Boolean(target.closest('input, textarea, select'))
    }
    const down = (event: KeyboardEvent) => {
      if (typing(event)) return
      keys.current.add(event.key.toLowerCase())
      if (event.key.startsWith('Arrow')) event.preventDefault()
      if (event.key === 'Escape' && !document.querySelector('.room-size')) onExit()
    }
    const up = (event: KeyboardEvent) => {
      keys.current.delete(event.key.toLowerCase())
    }
    const turn = (dx: number, dy: number) => {
      if (!dx && !dy) return
      look.current.yaw += dx * 0.0022
      look.current.pitch = Math.max(-0.9, Math.min(0.9, look.current.pitch - dy * 0.002))
    }
    const onMouseMove = (event: MouseEvent) => {
      turn(event.movementX, event.movementY)
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('mousemove', onMouseMove)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('mousemove', onMouseMove)
    }
  }, [onExit])

  useFrame((_, delta) => {
    const pressed = keys.current
    const yaw = look.current.yaw
    const forwardX = Math.sin(yaw)
    const forwardZ = Math.cos(yaw)
    const rightX = -Math.cos(yaw)
    const rightZ = Math.sin(yaw)
    let mx = 0
    let mz = 0
    if (pressed.has('w') || pressed.has('arrowup')) {
      mx += forwardX
      mz += forwardZ
    }
    if (pressed.has('s') || pressed.has('arrowdown')) {
      mx -= forwardX
      mz -= forwardZ
    }
    if (pressed.has('d') || pressed.has('arrowright')) {
      mx -= rightX
      mz -= rightZ
    }
    if (pressed.has('a') || pressed.has('arrowleft')) {
      mx += rightX
      mz += rightZ
    }
    const length = Math.hypot(mx, mz)
    if (length > 0) {
      const step = 1.55 * Math.min(delta, 0.05)
      const nx = pos.current.x + (mx / length) * step
      const nz = pos.current.z + (mz / length) * step
      if (canStand(nx, pos.current.z, rooms, furniture, spans)) pos.current.x = nx
      if (canStand(pos.current.x, nz, rooms, furniture, spans)) pos.current.z = nz
    }
    const { x, z } = pos.current
    camera.position.set(-x, EYE, z)
    camera.lookAt(-x - Math.sin(yaw), EYE + look.current.pitch, z + Math.cos(yaw))
    const name = standingRoom(x, z, rooms)
    if (name !== named.current) {
      named.current = name
      onPlaceRef.current(name)
    }
  })

  return null
}

function CameraRig({
  width,
  depth,
  resetKey,
}: {
  width: number
  depth: number
  resetKey: string
}) {
  const camera = useThree((state) => state.camera) as OrthographicCamera
  const size = useThree((state) => state.size)
  const controls = useThree((state) => state.controls) as {
    target: { set: (x: number, y: number, z: number) => void }
    update: () => void
  } | null

  useLayoutEffect(() => {
    if (size.height < 20) return
    const frame = requestAnimationFrame(() => {
      const cx = width / 200
      const cz = depth / 200
      const span = Math.max(width, depth) / 100
      const dist = span * 0.82
      camera.position.set(-cx + dist, span * 1.7, cz - dist)
      camera.near = -80
      camera.far = 80
      camera.zoom = Math.min(size.width, size.height) / (span * 1.55)
      camera.updateProjectionMatrix()
      camera.lookAt(-cx, 0.8, cz)
      if (controls) {
        controls.target.set(-cx, 0.8, cz)
        controls.update()
      }
    })
    return () => cancelAnimationFrame(frame)
  }, [camera, controls, depth, resetKey, size.height, size.width, width])

  return null
}

export function UnitScene3D({
  plan,
  width,
  depth,
  resetKey,
  walkRoomId = null,
  onExitWalk,
  onReset,
  placedByRoom,
}: {
  plan: UnitPlan
  width: number
  depth: number
  resetKey: string
  walkRoomId?: string | null
  onExitWalk?: () => void
  onReset: () => void
  placedByRoom?: Record<string, Placed[]>
}) {
  const pieces = useMemo(() => buildPieces(plan), [plan])
  const spans = useMemo(() => passageSpans(plan.rooms, plan.passages ?? []), [plan])
  const furniture = useMemo(() => plan.rooms.flatMap((room) => {
    const saved = placedByRoom?.[room.id]
    if (saved) return saved.map((item) => placedPiece(room, item))
    const piece = furnitureFor(room)
    return piece ? [piece] : []
  }), [plan, placedByRoom])
  const span = Math.max(width, depth) / 100
  const cx = width / 200
  const cz = depth / 200
  const walkRoom = walkRoomId ? plan.rooms.find((room) => room.id === walkRoomId) ?? null : null
  const [place, setPlace] = useState('')

  useEffect(() => {
    if (!walkRoomId) return
    document.documentElement.classList.add('walk-lock')
    return () => document.documentElement.classList.remove('walk-lock')
  }, [walkRoomId])

  return (
    <figure className={walkRoom ? 'scene walking' : 'scene'}>
      <figcaption>
        {walkRoom ? '둘러보기' : '3D 보기'}
        {walkRoom ? (
          <span className="walk-exit">Esc로 나가기</span>
        ) : (
          <button type="button" onClick={onReset}>기본 각도</button>
        )}
      </figcaption>
      <div className="canvas-wrap">
        {walkRoom && <span className="walk-place">현재 위치 · {place || walkRoom.name}</span>}
        {walkRoom && <span className="walk-cross" aria-hidden="true" />}
        {walkRoom ? (
          <Canvas key="walk" orthographic={false} shadows gl={{ antialias: true, toneMapping: NoToneMapping }} dpr={[1, 1.75]} camera={{ fov: 68, near: 0.08, far: 40, position: [-cx, EYE, cz] }}>
            <color attach="background" args={['#e4dfd4']} />
            <hemisphereLight args={['#ffffff', '#f3e6d0', 1.15]} />
            <ambientLight intensity={0.72} />
            <group scale={[-1, 1, 1]}>
            <directionalLight position={[cx + span * 0.45, span * 1.5, cz + span * 0.3]} intensity={0.85} />
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[cx, -0.04, cz]} receiveShadow>
              <planeGeometry args={[span + 6, span + 6]} />
              <meshStandardMaterial color="#c5c2b0" />
            </mesh>
            {plan.rooms.map((room) => (
              <mesh
                key={room.id}
                rotation={[-Math.PI / 2, 0, 0]}
                position={[(room.x + room.w / 2) / 100, 0.004, (room.y + room.d / 2) / 100]}
                receiveShadow
              >
                <planeGeometry args={[room.w / 100, room.d / 100]} />
                <meshStandardMaterial color={FLOOR[room.kind]} roughness={0.92} />
              </mesh>
            ))}
            {pieces.map((piece) => (
              <WallPiece key={`${piece.axis}-${piece.fixed}-${piece.from}`} piece={piece} />
            ))}
            {furniture.map((item) => (
              <group key={item.id} position={[item.x, 0, item.z]} rotation={[0, (item.rot * Math.PI) / 180, 0]}>
                <FurnitureModel type={item.type} w={item.w} d={item.d} h={item.h} />
              </group>
            ))}
            </group>
            <Walker
              key={`${walkRoom.id}-${walkRoom.x}-${walkRoom.y}-${walkRoom.w}-${walkRoom.d}`}
              room={walkRoom}
              rooms={plan.rooms}
              furniture={furniture}
              spans={spans}
              onExit={() => onExitWalk?.()}
              onPlace={setPlace}
            />
          </Canvas>
        ) : (
        <Canvas key="overview" orthographic shadows gl={{ antialias: true, toneMapping: NoToneMapping }} dpr={[1, 1.75]}>
          <color attach="background" args={['#e4dfd4']} />
          <hemisphereLight args={['#ffffff', '#f3e6d0', 1.15]} />
          <ambientLight intensity={0.5} />
          <group scale={[-1, 1, 1]}>
          <directionalLight
            position={[cx + span * 0.45, span * 1.5, cz + span * 0.3]}
            intensity={1.15}
            castShadow
            shadow-mapSize-width={2048}
            shadow-mapSize-height={2048}
            shadow-camera-near={0.5}
            shadow-camera-far={span * 5}
            shadow-camera-left={-span}
            shadow-camera-right={span}
            shadow-camera-top={span}
            shadow-camera-bottom={-span}
            shadow-bias={-0.0004}
          />
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[cx, -0.04, cz]} receiveShadow>
            <planeGeometry args={[span + 6, span + 6]} />
            <meshStandardMaterial color="#c5c2b0" />
          </mesh>
          {plan.rooms.map((room) => (
            <mesh
              key={room.id}
              rotation={[-Math.PI / 2, 0, 0]}
              position={[(room.x + room.w / 2) / 100, 0.004, (room.y + room.d / 2) / 100]}
              receiveShadow
            >
              <planeGeometry args={[room.w / 100, room.d / 100]} />
              <meshStandardMaterial color={FLOOR[room.kind]} roughness={0.92} />
            </mesh>
          ))}
          {pieces.map((piece) => (
            <WallPiece key={`${piece.axis}-${piece.fixed}-${piece.from}`} piece={piece} />
          ))}
          {furniture.map((item) => (
            <group key={item.id} position={[item.x, 0, item.z]} rotation={[0, (item.rot * Math.PI) / 180, 0]}>
              <FurnitureModel type={item.type} w={item.w} d={item.d} h={item.h} />
            </group>
          ))}
          </group>
          <OrbitControls makeDefault enableDamping dampingFactor={0.12} minPolarAngle={0.18} maxPolarAngle={Math.PI / 2.05} />
          <CameraRig width={width} depth={depth} resetKey={resetKey} />
        </Canvas>
        )}
      </div>
      <p className="hint">{walkRoom ? 'Esc를 누르기 전에는 마우스가 시선만 움직입니다. WASD 또는 방향키로 걷습니다.' : '드래그로 회전, 우클릭으로 이동, 휠로 확대합니다.'}</p>
    </figure>
  )
}
