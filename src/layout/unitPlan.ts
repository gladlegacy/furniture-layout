import type { Furniture, FurnitureType, Scene, Wall } from '../types.ts'
import { DEFAULT_SIZE, oppositeWall, uid } from '../types.ts'
import { rectangleOutline } from './polygon.ts'

export type UnitProgram = {
  width: number
  depth: number
  bedrooms: number
  bathrooms: number
  living: boolean
  openKitchen: boolean
  entrance: Wall
}

export type UnitRoomKind = 'entrance' | 'corridor' | 'living' | 'bedroom' | 'bathroom' | 'kitchen' | 'utility' | 'dress'

export type UnitOpening = {
  wall: Wall
  offset: number
  width: number
  hinge?: 'start' | 'end'
  swing?: 'in' | 'out'
}

export type UnitRoom = {
  id: string
  kind: UnitRoomKind
  name: string
  x: number
  y: number
  w: number
  d: number
  door: UnitOpening | null
  extraDoors?: UnitOpening[]
  window: (UnitOpening & { sill: number; height: number }) | null
}

export type UnitPassage = {
  a: string
  b: string
}

export type OpenSpan = {
  axis: 'x' | 'y'
  at: number
  from: number
  to: number
}

export type UnitPlan = {
  id: string
  label: string
  note: string
  rooms: UnitRoom[]
  passages?: UnitPassage[]
}

export type UnitResult = {
  plans: UnitPlan[]
  message: string
}

export const DEFAULT_PROGRAM: UnitProgram = {
  width: 1180,
  depth: 775,
  bedrooms: 2,
  bathrooms: 2,
  living: true,
  openKitchen: true,
  entrance: 'south',
}

type Limits = {
  entranceW: number
  entranceD: number
  livingW: number
  livingD: number
  kitchenW: number
  kitchenD: number
  masterW: number
  masterD: number
  bedW: number
  bedD: number
  bathW: number
  bathD: number
  corridor: number
  utilityW: number
  utilityD: number
  dressW: number
  dressD: number
}

type RoomNode = {
  kind: 'room'
  id: string
  roomKind: UnitRoomKind
  name: string
  minW: number
  minD: number
}

type SplitNode = {
  kind: 'v' | 'h'
  parts: { weight: number; min: number; node: PlanNode }[]
}

type PlanNode = RoomNode | SplitNode

type Scheme = {
  id: string
  label: string
  note: string
  node: PlanNode
}

function limitsFor(area: number): Limits {
  const tiny = area < 40 * 10000
  const tight = area < 62 * 10000
  return {
    entranceW: tiny ? 120 : 150,
    entranceD: tiny ? 150 : 190,
    livingW: tiny ? 240 : tight ? 280 : 320,
    livingD: tiny ? 220 : tight ? 260 : 300,
    kitchenW: tiny ? 170 : 200,
    kitchenD: tiny ? 170 : 200,
    masterW: tiny ? 230 : 260,
    masterD: tiny ? 220 : 250,
    bedW: tiny ? 210 : 230,
    bedD: tiny ? 200 : 220,
    bathW: 140,
    bathD: tiny ? 140 : 150,
    corridor: tiny ? 100 : 110,
    utilityW: 160,
    utilityD: 170,
    dressW: 150,
    dressD: 160,
  }
}

function room(id: string, roomKind: UnitRoomKind, name: string, minW: number, minD: number): RoomNode {
  return { kind: 'room', id, roomKind, name, minW, minD }
}

function bedName(index: number, count: number): string {
  if (count === 1) return '방'
  return index === 0 ? '큰방' : `방 ${index + 1}`
}

function distribute(total: number, parts: { min: number; weight: number }[]): number[] | null {
  if (parts.length === 0) return []
  const minSum = parts.reduce((sum, part) => sum + part.min, 0)
  if (minSum > total) return null
  const extra = total - minSum
  const weightSum = parts.reduce((sum, part) => sum + Math.max(0, part.weight), 0)
  const raw = parts.map((part) => part.min + (weightSum === 0 ? extra / parts.length : extra * (Math.max(0, part.weight) / weightSum)))
  const sizes = raw.map((value) => Math.floor(value))
  let rest = total - sizes.reduce((sum, value) => sum + value, 0)
  const order = parts.map((_, index) => index).sort((a, b) => (raw[b]! - sizes[b]!) - (raw[a]! - sizes[a]!))
  for (const index of order) {
    if (rest <= 0) break
    sizes[index] = (sizes[index] ?? 0) + 1
    rest -= 1
  }
  if (sizes.some((size, index) => size < parts[index]!.min)) return null
  return sizes
}

function aspectOk(kind: UnitRoomKind, w: number, d: number): boolean {
  const ratio = Math.max(w, d) / Math.max(1, Math.min(w, d))
  if (kind === 'corridor') return Math.min(w, d) >= 100 && ratio <= 40
  if (kind === 'bathroom' || kind === 'utility' || kind === 'dress' || kind === 'entrance') return ratio <= 3.4
  return ratio <= 3
}

function realize(node: PlanNode, x: number, y: number, w: number, d: number, into: UnitRoom[]): boolean {
  if (w < 1 || d < 1) return false
  if (node.kind === 'room') {
    if (w < node.minW || d < node.minD || !aspectOk(node.roomKind, w, d)) return false
    into.push({ id: node.id, kind: node.roomKind, name: node.name, x, y, w, d, door: null, window: null })
    return true
  }
  const sizes = distribute(node.kind === 'v' ? w : d, node.parts)
  if (!sizes) return false
  let cursor = node.kind === 'v' ? x : y
  for (let index = 0; index < node.parts.length; index++) {
    const size = sizes[index]!
    const child = node.parts[index]!.node
    const ok = node.kind === 'v'
      ? realize(child, cursor, y, size, d, into)
      : realize(child, x, cursor, w, size, into)
    if (!ok) return false
    cursor += size
  }
  return true
}

function overlapLength(a0: number, a1: number, b0: number, b1: number): number {
  return Math.min(a1, b1) - Math.max(a0, b0)
}

function touches(a: UnitRoom, b: UnitRoom, min = 70): { wall: Wall; start: number; end: number } | null {
  const vertical = overlapLength(a.y, a.y + a.d, b.y, b.y + b.d)
  if (Math.abs(a.x + a.w - b.x) < 0.5 && vertical >= min) {
    return { wall: 'east', start: Math.max(a.y, b.y) - a.y, end: Math.min(a.y + a.d, b.y + b.d) - a.y }
  }
  if (Math.abs(b.x + b.w - a.x) < 0.5 && vertical >= min) {
    return { wall: 'west', start: Math.max(a.y, b.y) - a.y, end: Math.min(a.y + a.d, b.y + b.d) - a.y }
  }
  const horizontal = overlapLength(a.x, a.x + a.w, b.x, b.x + b.w)
  if (Math.abs(a.y + a.d - b.y) < 0.5 && horizontal >= min) {
    return { wall: 'north', start: Math.max(a.x, b.x) - a.x, end: Math.min(a.x + a.w, b.x + b.w) - a.x }
  }
  if (Math.abs(b.y + b.d - a.y) < 0.5 && horizontal >= min) {
    return { wall: 'south', start: Math.max(a.x, b.x) - a.x, end: Math.min(a.x + a.w, b.x + b.w) - a.x }
  }
  return null
}

function exteriorWalls(room: UnitRoom, width: number, depth: number): Wall[] {
  const walls: Wall[] = []
  if (room.y <= 0.5) walls.push('south')
  if (room.x + room.w >= width - 0.5) walls.push('east')
  if (room.y + room.d >= depth - 0.5) walls.push('north')
  if (room.x <= 0.5) walls.push('west')
  return walls
}

function centeredOpening(wall: Wall, start: number, end: number, width: number): UnitOpening | null {
  const span = end - start
  if (span + 0.01 < width) return null
  return { wall, offset: Math.round(start + (span - width) / 2), width: Math.round(width) }
}

function doorTargets(current: UnitRoom): string[] {
  if (current.kind === 'entrance') return []
  if (current.id === 'ensuite' || current.id === 'dress') return ['master', 'corridor', 'living']
  if (current.kind === 'kitchen') return ['living', 'corridor', 'entrance']
  if (current.kind === 'utility') return ['kitchen', 'living', 'corridor']
  if (current.kind === 'living') return ['entrance', 'corridor', 'kitchen']
  if (current.kind === 'corridor') return ['entrance', 'living', 'kitchen']
  return ['corridor', 'living', 'kitchen', 'entrance']
}

export function doorWidth(kind: UnitRoomKind): number {
  if (kind === 'living') return 110
  if (kind === 'bedroom' || kind === 'kitchen' || kind === 'corridor') return 90
  if (kind === 'bathroom') return 75
  return 80
}

export function linkDoorWidth(from: UnitRoomKind, onto: UnitRoomKind): number {
  return Math.max(doorWidth(from), onto === 'entrance' ? 90 : doorWidth(onto))
}

function linked(a: UnitRoom, b: UnitRoom): boolean {
  return touches(a, b, linkDoorWidth(a.kind, b.kind)) !== null
}

function assignDoor(current: UnitRoom, rooms: UnitRoom[]): UnitOpening | null {
  if (current.kind === 'entrance') return centeredOpening('south', 0, current.w, Math.min(100, current.w))
  for (const id of doorTargets(current)) {
    const host = rooms.find((room) => room.id === id)
    if (!host) continue
    const need = linkDoorWidth(current.kind, host.kind)
    const edge = touches(current, host, need)
    if (edge) return centeredOpening(edge.wall, edge.start, edge.end, need)
  }
  return null
}

function windowWidth(kind: UnitRoomKind, span: number): number {
  const ratio = kind === 'living' ? 0.5 : kind === 'kitchen' ? 0.42 : kind === 'bedroom' ? 0.4 : kind === 'bathroom' ? 0.24 : 0.32
  const cap = kind === 'living' ? 420 : kind === 'bedroom' ? 220 : kind === 'kitchen' ? 200 : kind === 'bathroom' ? 80 : 120
  const min = kind === 'bathroom' ? 60 : 80
  return Math.round(Math.max(min, Math.min(cap, span * ratio, span - 24)))
}

function assignWindow(current: UnitRoom, width: number, depth: number): (UnitOpening & { sill: number; height: number }) | null {
  if (current.kind === 'entrance' || current.kind === 'corridor') return null
  const order: Record<UnitRoomKind, Wall[]> = {
    living: ['north', 'east', 'west', 'south'],
    kitchen: ['north', 'east', 'west', 'south'],
    bedroom: ['south', 'north', 'east', 'west'],
    bathroom: ['west', 'east', 'north', 'south'],
    utility: ['north', 'west', 'east', 'south'],
    dress: ['north', 'south', 'east', 'west'],
    entrance: [],
    corridor: [],
  }
  const exterior = exteriorWalls(current, width, depth)
  const ranked = order[current.kind].filter((wall) => exterior.includes(wall))
  const preferred = ranked.find((wall) => wall !== current.door?.wall) ?? ranked[0]
  if (!preferred) return null
  let span = wallSpan(current, preferred)
  let openingWidth = windowWidth(current.kind, span)
  let offset = Math.round((span - openingWidth) / 2)
  if (current.door?.wall === preferred) {
    const doorEnd = current.door.offset + current.door.width
    const right = doorEnd + 16
    const left = current.door.offset - 16
    if (span - right >= 60) {
      openingWidth = Math.min(openingWidth, span - right)
      offset = right + Math.max(0, Math.round((span - right - openingWidth) / 2))
    } else if (left >= 60) {
      openingWidth = Math.min(openingWidth, left)
      offset = Math.max(0, Math.round((left - openingWidth) / 2))
    } else {
      return null
    }
    span = wallSpan(current, preferred)
  }
  if (openingWidth < 60 || offset < 0 || offset + openingWidth > span) return null
  return { wall: preferred, offset, width: openingWidth, sill: 90, height: 110 }
}

function circulationOk(rooms: UnitRoom[]): boolean {
  const byId = (id: string) => rooms.find((room) => room.id === id)
  const corridor = byId('corridor')
  const living = rooms.find((room) => room.kind === 'living')
  const entrance = rooms.find((room) => room.kind === 'entrance')
  const kitchen = rooms.find((room) => room.kind === 'kitchen')
  const hosts = [corridor, living, entrance, kitchen].filter((room): room is UnitRoom => Boolean(room))
  for (const current of rooms) {
    if (current.kind === 'entrance' || current.kind === 'corridor') continue
    if (current.id === 'ensuite' || current.id === 'dress') {
      const master = byId('master')
      if (!master || !linked(current, master)) return false
      continue
    }
    if (current.kind === 'utility') {
      const kitchen = rooms.find((room) => room.kind === 'kitchen')
      const beside = kitchen ?? living
      if (!beside || !linked(current, beside)) return false
      continue
    }
    if (current.kind === 'kitchen') {
      if (hosts.some((host) => host.id !== current.id && linked(current, host)) || (living && linked(current, living))) continue
      return false
    }
    if (!hosts.some((host) => linked(current, host))) return false
  }
  return Boolean(entrance && entrance.y <= 0.5)
}

function finishRooms(rooms: UnitRoom[], width: number, depth: number): UnitRoom[] | null {
  if (!circulationOk(rooms)) return null
  const furnished = rooms.map((current) => ({ ...current, door: assignDoor(current, rooms) }))
  if (furnished.some((current) => current.door === null)) return null
  const withWindows = furnished.map((current) => ({ ...current, window: assignWindow(current, width, depth) }))
  const needsWindow = (room: UnitRoom) => room.kind === 'living' || room.kind === 'bedroom' || room.kind === 'kitchen'
  if (withWindows.some((room) => needsWindow(room) && room.window === null)) return null
  const living = withWindows.find((room) => room.kind === 'living')
  const bedrooms = withWindows.filter((room) => room.kind === 'bedroom')
  if (living && bedrooms.some((room) => room.w * room.d > living.w * living.d)) return null
  const master = withWindows.find((room) => room.id === 'master')
  if (master && bedrooms.some((room) => room.id !== 'master' && room.w * room.d > master.w * master.d)) return null
  const area = withWindows.reduce((sum, room) => sum + room.w * room.d, 0)
  if (area !== width * depth) return null
  return withWindows
}

function entrancePart(limits: Limits): SplitNode['parts'][number] {
  return { weight: 1, min: limits.entranceW, node: room('entrance', 'entrance', '현관', limits.entranceW, limits.entranceD) }
}

function piece(weight: number, min: number, node: PlanNode): SplitNode['parts'][number] {
  return { weight, min, node }
}

function join(kind: 'v' | 'h', parts: SplitNode['parts']): PlanNode {
  if (parts.length === 1) return parts[0]!.node
  return { kind, parts }
}

function hasEnsuite(program: UnitProgram): boolean {
  return program.bedrooms >= 1 && program.bathrooms >= 2
}

function ensuiteRoom(limits: Limits): RoomNode {
  return room('ensuite', 'bathroom', '전용 화장실', limits.bathW, limits.bathD)
}

function sharedBathRooms(program: UnitProgram, limits: Limits): RoomNode[] {
  const shared = program.bathrooms - (hasEnsuite(program) ? 1 : 0)
  const rooms: RoomNode[] = []
  for (let index = 0; index < shared; index++) {
    const id = index === 0 ? 'bath' : `bath-${index + 1}`
    const name = shared === 1 ? '화장실' : `화장실 ${index + 1}`
    rooms.push(room(id, 'bathroom', name, limits.bathW, limits.bathD))
  }
  return rooms
}

function entranceRoom(limits: Limits): RoomNode {
  return room('entrance', 'entrance', '현관', limits.entranceW, limits.entranceD)
}

function corridorRoom(limits: Limits): RoomNode {
  return room('corridor', 'corridor', '복도', limits.corridor, limits.corridor)
}

function dayBlock(program: UnitProgram, limits: Limits, openKitchen: boolean, utility: boolean, serviceOnWest: boolean, stacked = false): { node: PlanNode; minW: number; minD: number } | null {
  const living = program.living
    ? room('living', 'living', openKitchen ? '거실·주방' : '거실', limits.livingW, limits.livingD)
    : null
  const extras: RoomNode[] = []
  if (!openKitchen) extras.push(room('kitchen', 'kitchen', '주방', limits.kitchenW, limits.kitchenD))
  if (utility) extras.push(room('utility', 'utility', '다용도실', limits.utilityW, limits.utilityD))
  if (!living && extras.length === 0) return null
  if (extras.length === 0 && living) return { node: living, minW: limits.livingW, minD: limits.livingD }
  const side = join('h', extras.map((extra) => piece(1, extra.minD, extra)))
  const sideMinW = Math.max(...extras.map((extra) => extra.minW))
  const sideMinD = extras.reduce((sum, extra) => sum + extra.minD, 0)
  if (!living) return { node: side, minW: sideMinW, minD: sideMinD }
  const service = piece(0.72, stacked ? sideMinD : sideMinW, side)
  const day = piece(2.4, stacked ? limits.livingD : limits.livingW, living)
  if (stacked) {
    return {
      node: join('h', [service, day]),
      minW: Math.max(sideMinW, limits.livingW),
      minD: sideMinD + limits.livingD,
    }
  }
  return {
    node: join('v', serviceOnWest ? [service, day] : [day, service]),
    minW: sideMinW + limits.livingW,
    minD: Math.max(sideMinD, limits.livingD),
  }
}

function bedroomBand(program: UnitProgram, limits: Limits, dress: boolean): { node: PlanNode; minW: number; minD: number } | null {
  if (program.bedrooms < 1) return null
  const parts: SplitNode['parts'] = []
  if (dress) parts.push(piece(0.6, limits.dressW, room('dress', 'dress', '드레스룸', limits.dressW, limits.dressD)))
  parts.push(piece(1.7, limits.masterW, room('master', 'bedroom', bedName(0, program.bedrooms), limits.masterW, limits.masterD)))
  if (hasEnsuite(program)) parts.push(piece(0.55, limits.bathW, ensuiteRoom(limits)))
  for (let index = 1; index < program.bedrooms; index++) {
    parts.push(piece(1.1, limits.bedW, room(`bed-${index + 1}`, 'bedroom', bedName(index, program.bedrooms), limits.bedW, limits.bedD)))
  }
  return {
    node: join('v', parts),
    minW: parts.reduce((sum, part) => sum + part.min, 0),
    minD: Math.max(limits.masterD, dress ? limits.dressD : 0, hasEnsuite(program) ? limits.bathD : 0, program.bedrooms > 1 ? limits.bedD : 0),
  }
}

function foyer(program: UnitProgram, limits: Limits, entranceFirst = false): { node: PlanNode; minW: number; minD: number } {
  const shared = sharedBathRooms(program, limits)
  const baths = shared.map((bath) => piece(0.35, bath.minW, bath))
  const entry = piece(1.2, limits.entranceW, entranceRoom(limits))
  const parts = entranceFirst ? [entry, ...baths] : [...baths, entry]
  return {
    node: join('v', parts),
    minW: parts.reduce((sum, part) => sum + part.min, 0),
    minD: Math.max(limits.entranceD, shared.length > 0 ? limits.bathD : 0),
  }
}

function hallDepth(limits: Limits): number {
  return Math.max(120, limits.corridor)
}

function stackedPrivate(program: UnitProgram, limits: Limits, dress: boolean, entrance: boolean): { node: PlanNode; minW: number; minD: number } | null {
  if (program.bedrooms < 1) return null
  const parts: SplitNode['parts'] = []
  if (entrance) parts.push(piece(0.9, limits.entranceD, entranceRoom(limits)))
  parts.push(piece(0.55, hallDepth(limits), corridorRoom(limits)))
  if (dress) parts.push(piece(0.7, limits.dressD, room('dress', 'dress', '드레스룸', limits.dressW, limits.dressD)))
  parts.push(piece(1.4, limits.masterD, room('master', 'bedroom', bedName(0, program.bedrooms), limits.masterW, limits.masterD)))
  if (hasEnsuite(program)) parts.push(piece(0.7, limits.bathD, ensuiteRoom(limits)))
  for (let index = 1; index < program.bedrooms; index++) {
    parts.push(piece(1.1, limits.bedD, room(`bed-${index + 1}`, 'bedroom', bedName(index, program.bedrooms), limits.bedW, limits.bedD)))
  }
  for (const bath of sharedBathRooms(program, limits)) parts.push(piece(0.65, bath.minD, bath))
  const widths = [
    entrance ? limits.entranceW : 0,
    limits.corridor,
    dress ? limits.dressW : 0,
    limits.masterW,
    hasEnsuite(program) ? limits.bathW : 0,
    program.bedrooms > 1 ? limits.bedW : 0,
    ...sharedBathRooms(program, limits).map((bath) => bath.minW),
  ]
  return {
    node: join('h', parts),
    minW: Math.max(...widths),
    minD: parts.reduce((sum, part) => sum + part.min, 0),
  }
}

function narrowPair(
  dayOnWest: boolean,
  openKitchen: boolean,
  utility: boolean,
  dress: boolean,
  program: UnitProgram,
  limits: Limits,
  entranceInDay: boolean,
): PlanNode | null {
  const stack = stackedPrivate(program, limits, dress, !entranceInDay)
  const block = dayBlock(program, limits, openKitchen, utility, false)
  if (!stack || !block) return null
  const dayNode = entranceInDay
    ? join('h', [
        piece(0.75, limits.entranceD, entranceRoom(limits)),
        piece(2, block.minD, block.node),
      ])
    : block.node
  const dayMinW = Math.max(block.minW, entranceInDay ? limits.entranceW : 0)
  const columns = [
    piece(1.15, dayMinW, dayNode),
    piece(1.25, stack.minW, stack.node),
  ]
  if (!dayOnWest) columns.reverse()
  return join('v', columns)
}

function frontWing(openKitchen: boolean, utility: boolean, dress: boolean, program: UnitProgram, limits: Limits): PlanNode | null {
  const beds = bedroomBand(program, limits, dress)
  const block = dayBlock(program, limits, openKitchen, utility, false)
  if (!beds || !block) return null
  const entry = foyer(program, limits)
  const hall = hallDepth(limits)
  if (beds.minW + Math.max(entry.minW, hall) > program.width) return narrowPair(false, openKitchen, utility, dress, program, limits, false)
  const spine = join('h', [
    piece(1.05, entry.minD, entry.node),
    piece(0.7, hall, corridorRoom(limits)),
  ])
  const south = join('v', [
    piece(0.9, Math.max(entry.minW, hall), spine),
    piece(2.3, block.minW, block.node),
  ])
  return join('h', [
    piece(1.12, Math.max(entry.minD + hall, block.minD), south),
    piece(1.22, beds.minD, beds.node),
  ])
}

function backWing(openKitchen: boolean, utility: boolean, dress: boolean, program: UnitProgram, limits: Limits): PlanNode | null {
  const beds = bedroomBand(program, limits, dress)
  const block = dayBlock(program, limits, openKitchen, utility, false)
  if (!beds || !block) return null
  const entry = foyer(program, limits)
  const hall = hallDepth(limits)
  if (beds.minW + Math.max(entry.minW, hall) > program.width) return narrowPair(false, openKitchen, utility, dress, program, limits, true)
  const southMin = Math.max(entry.minD + hall, beds.minD)
  const northMin = Math.max(block.minD, Math.ceil(program.width / 2.8))
  if (southMin + northMin > program.depth) return narrowPair(false, openKitchen, utility, dress, program, limits, true)
  const spine = join('h', [
    piece(1.05, entry.minD, entry.node),
    piece(0.75, hall, corridorRoom(limits)),
  ])
  const south = join('v', [
    piece(0.85, Math.max(entry.minW, hall), spine),
    piece(1.7, beds.minW, beds.node),
  ])
  return join('h', [
    piece(1, southMin, south),
    piece(1.45, northMin, block.node),
  ])
}

function flank(dayOnWest: boolean, openKitchen: boolean, utility: boolean, dress: boolean, program: UnitProgram, limits: Limits): PlanNode | null {
  const beds = bedroomBand(program, limits, dress)
  const block = dayBlock(program, limits, openKitchen, utility, !dayOnWest, true)
  if (!beds || !block) return null
  const entry = foyer(program, limits, dayOnWest)
  const hall = hallDepth(limits)
  const privateMinW = Math.max(beds.minW, entry.minW, hall)
  if (privateMinW + block.minW > program.width) return narrowPair(dayOnWest, openKitchen, utility, dress, program, limits, false)
  const privateCol = join('h', [
    piece(0.9, entry.minD, entry.node),
    piece(0.5, hall, corridorRoom(limits)),
    piece(1.55, beds.minD, beds.node),
  ])
  const columns = [
    piece(1.25, block.minW, block.node),
    piece(1.4, privateMinW, privateCol),
  ]
  if (!dayOnWest) columns.reverse()
  return join('v', columns)
}

function band(dayOnSouth: boolean, openKitchen: boolean, utility: boolean, dress: boolean, program: UnitProgram, limits: Limits): PlanNode | null {
  return dayOnSouth
    ? frontWing(openKitchen, utility, dress, program, limits)
    : backWing(openKitchen, utility, dress, program, limits)
}

function studio(program: UnitProgram, limits: Limits, openKitchen: boolean): PlanNode {
  if (!program.living) {
    return {
      kind: 'h',
      parts: [
        { weight: 1, min: limits.entranceD, node: room('entrance', 'entrance', '현관', limits.entranceW, limits.entranceD) },
        { weight: 1.4, min: limits.kitchenD, node: room('kitchen', 'kitchen', '주방', limits.kitchenW, limits.kitchenD) },
      ],
    }
  }
  if (openKitchen) {
    return {
      kind: 'h',
      parts: [
        { weight: 0.75, min: limits.entranceD, node: room('entrance', 'entrance', '현관', limits.entranceW, limits.entranceD) },
        { weight: 2, min: limits.livingD, node: room('living', 'living', '거실·주방', limits.livingW, limits.livingD) },
      ],
    }
  }
  return {
    kind: 'h',
    parts: [
      {
        weight: 0.9,
        min: Math.max(limits.entranceD, limits.kitchenD),
        node: { kind: 'v', parts: [entrancePart(limits), { weight: 1.3, min: limits.kitchenW, node: room('kitchen', 'kitchen', '주방', limits.kitchenW, limits.kitchenD) }] },
      },
      { weight: 1.5, min: limits.livingD, node: room('living', 'living', '거실', limits.livingW, limits.livingD) },
    ],
  }
}

function side(dayOnWest: boolean, openKitchen: boolean, utility: boolean, dress: boolean, program: UnitProgram, limits: Limits): PlanNode | null {
  return flank(dayOnWest, openKitchen, utility, dress, program, limits)
}

function schemesFor(program: UnitProgram, limits: Limits): Scheme[] {
  const area = program.width * program.depth
  const utility = area >= 80 * 10000
  const dress = area >= 95 * 10000 && program.bedrooms >= 1
  const open = program.living && program.openKitchen
  if (program.bedrooms + program.bathrooms === 0) {
    return open
      ? [{
          id: 'open-studio',
          label: '거실·주방 일체형',
          note: '현관 안쪽을 거실과 주방이 함께 쓰는 한 공간으로 둡니다.',
          node: studio(program, limits, true),
        }]
      : [{
          id: 'studio',
          label: '거실이 안쪽',
          note: '현관과 주방을 입구에 두고 안쪽을 거실로 넓게 씁니다.',
          node: studio(program, limits, false),
        }]
  }
  const specs: { id: string; label: string; note: string; node: PlanNode | null }[] = [
    {
      id: 'day-front',
      label: '거실이 현관 쪽',
      note: open
        ? '좁은 현관에서 거실·주방으로 바로 들어가고, 복도를 따라 방으로 이어집니다.'
        : '좁은 현관에서 거실로 바로 들어가고, 주방은 거실 앞에 둡니다. 방은 복도로 이어집니다.',
      node: band(true, open, false, false, program, limits),
    },
    {
      id: 'day-back',
      label: '거실이 안쪽',
      note: open
        ? '현관을 조금 깊게 두고, 거실·주방은 옆면 전체를 씁니다. 방은 복도 끝에 둡니다.'
        : '현관을 조금 깊게 두고 거실은 안쪽까지 엽니다. 주방은 거실 앞, 방은 복도 끝에 둡니다.',
      node: band(false, open, false, false, program, limits),
    },
    {
      id: 'side-west',
      label: '거실이 왼쪽',
      note: open
        ? '왼쪽 거실 옆 현관으로 들어가 복도를 따라 오른쪽 방과 화장실로 이어집니다.'
        : '왼쪽 현관에서 거실과 주방으로 들어가고, 오른쪽 복도에서 방으로 이어집니다.',
      node: side(true, open, false, false, program, limits),
    },
    {
      id: 'side-east',
      label: '거실이 오른쪽',
      note: open
        ? '오른쪽 거실 옆 현관으로 들어가 복도를 따라 왼쪽 방과 화장실로 이어집니다.'
        : '오른쪽 현관에서 거실과 주방으로 들어가고, 왼쪽 복도에서 방으로 이어집니다.',
      node: side(false, open, false, false, program, limits),
    },
  ]
  if (utility) {
    specs.push({
      id: 'with-utility',
      label: '다용도실이 있는 거실',
      note: open
        ? '거실·주방 앞에 다용도실을 두고, 방과 화장실은 현관 옆 복도로 이어집니다.'
        : '주방 옆에 다용도실을 두고, 방과 화장실은 현관 옆 복도로 이어집니다.',
      node: band(true, open, true, false, program, limits),
    })
  }
  if (dress) {
    specs.push({
      id: 'with-dress',
      label: '드레스룸이 있는 큰방',
      note: open
        ? '큰방에 드레스룸을 붙이고, 현관은 거실·주방으로 바로 열립니다.'
        : '큰방에 드레스룸을 붙이고, 현관은 거실로 바로 열립니다.',
      node: band(true, open, false, true, program, limits),
    })
  }
  return specs.flatMap((spec) => (spec.node ? [{ id: spec.id, label: spec.label, note: spec.note, node: spec.node }] : []))
}

function mapWall(wall: Wall, entrance: Wall): Wall {
  if (entrance === 'south') return wall
  if (entrance === 'north') {
    if (wall === 'south') return 'north'
    if (wall === 'north') return 'south'
    return wall
  }
  if (entrance === 'east') {
    const mapped: Record<Wall, Wall> = { south: 'east', north: 'west', east: 'north', west: 'south' }
    return mapped[wall]
  }
  const mapped: Record<Wall, Wall> = { south: 'west', north: 'east', east: 'south', west: 'north' }
  return mapped[wall]
}

function wallSpan(room: { w: number; d: number }, wall: Wall): number {
  return wall === 'north' || wall === 'south' ? room.w : room.d
}

function turnOpening<T extends UnitOpening>(opening: T, entrance: Wall, span: number): T {
  const wall = mapWall(opening.wall, entrance)
  if (entrance !== 'west') return { ...opening, wall }
  return { ...opening, wall, offset: Math.max(0, span - opening.offset - opening.width) }
}

function rotateRoom(room: UnitRoom, entrance: Wall, width: number, depth: number): UnitRoom {
  const door = room.door ? turnOpening(room.door, entrance, wallSpan(room, room.door.wall)) : null
  const window = room.window ? turnOpening(room.window, entrance, wallSpan(room, room.window.wall)) : null
  if (entrance === 'south') return { ...room, door, window }
  if (entrance === 'north') return { ...room, y: depth - room.y - room.d, door, window }
  if (entrance === 'east') return { ...room, x: width - room.y - room.d, y: room.x, w: room.d, d: room.w, door, window }
  return { ...room, x: room.y, y: depth - room.x - room.w, w: room.d, d: room.w, door, window }
}

function realizeScheme(scheme: Scheme, width: number, depth: number): UnitPlan | null {
  const placed: UnitRoom[] = []
  if (!realize(scheme.node, 0, 0, width, depth, placed)) return null
  const rooms = finishRooms(placed, width, depth)
  if (!rooms) return null
  return { id: scheme.id, label: scheme.label, note: scheme.note, rooms }
}

export function generateUnitPlans(program: UnitProgram): UnitResult {
  const { width, depth, entrance } = program
  if (![width, depth].every((value) => Number.isFinite(value) && value >= 400 && value <= 4000)) {
    return { plans: [], message: '외곽의 가로와 세로는 4000mm 이상 40000mm 이하여야 합니다.' }
  }
  const horizontal = entrance === 'south' || entrance === 'north'
  const genW = horizontal ? width : depth
  const genD = horizontal ? depth : width
  const local = { ...program, width: genW, depth: genD, entrance: 'south' as const }
  const limits = limitsFor(genW * genD)
  const plans = schemesFor(local, limits).flatMap((scheme) => {
    const built = realizeScheme(scheme, genW, genD)
    if (!built) return []
    return [{ ...built, rooms: built.rooms.map((room) => rotateRoom(room, entrance, width, depth)) }]
  })
  if (plans.length === 0) {
    return {
      plans: [],
      message: '이 외곽에는 입력한 방과 화장실을 조건에 맞게 나누기 어렵습니다. 가로·세로를 키우거나 개수를 줄여 보세요.',
    }
  }
  return { plans, message: '' }
}

const JOIN_NAME: Record<UnitRoomKind, string> = {
  entrance: '현관',
  corridor: '복도',
  bedroom: '방',
  bathroom: '화장실',
  living: '거실',
  kitchen: '주방',
  utility: '다용도실',
  dress: '드레스룸',
}

export function joinMinSpan(kind: UnitRoomKind): number {
  if (kind === 'corridor') return 100
  if (kind === 'bathroom') return 120
  if (kind === 'bedroom') return 180
  if (kind === 'living') return 240
  if (kind === 'kitchen') return 160
  if (kind === 'entrance') return 140
  return 120
}

function rectanglesOverlap(a: UnitRoom, b: UnitRoom): boolean {
  return a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.d - 0.5 && b.y < a.y + a.d - 0.5
}

export function shiftToOrigin(rooms: UnitRoom[]): UnitRoom[] {
  const minX = Math.min(...rooms.map((room) => room.x))
  const minY = Math.min(...rooms.map((room) => room.y))
  if (Math.abs(minX) < 0.01 && Math.abs(minY) < 0.01) return rooms
  return rooms.map((room) => ({ ...room, x: Math.round(room.x - minX), y: Math.round(room.y - minY) }))
}

function nextJoinId(rooms: UnitRoom[], kind: UnitRoomKind): string {
  const base = kind === 'bedroom' ? 'bed' : kind
  let index = rooms.filter((room) => room.kind === kind).length + 1
  let id = index === 1 ? base : `${base}-${index}`
  while (rooms.some((room) => room.id === id)) {
    index += 1
    id = `${base}-${index}`
  }
  return id
}

function nextJoinName(rooms: UnitRoom[], kind: UnitRoomKind): string {
  const count = rooms.filter((room) => room.kind === kind).length
  const label = JOIN_NAME[kind]
  return count === 0 ? label : `${label} ${count + 1}`
}

function uniqueJoinName(rooms: UnitRoom[], name: string): string {
  if (!rooms.some((room) => room.name === name)) return name
  let index = 2
  while (rooms.some((room) => room.name === `${name} ${index}`)) index += 1
  return `${name} ${index}`
}

export function planBounds(rooms: UnitRoom[]): { width: number; depth: number } {
  if (rooms.length === 0) return { width: 0, depth: 0 }
  return {
    width: Math.max(...rooms.map((room) => room.x + room.w)),
    depth: Math.max(...rooms.map((room) => room.y + room.d)),
  }
}

export function blankJoinPlan(): UnitPlan {
  return {
    id: 'blank-join',
    label: '직접 잇기',
    note: '큰 방, 화장실, 현관, 거실·주방을 변에 붙여 나갑니다.',
    rooms: [
      {
        id: 'entrance',
        kind: 'entrance',
        name: '현관',
        x: 0,
        y: 0,
        w: 320,
        d: 180,
        door: { wall: 'south', offset: 110, width: 100 },
        window: null,
      },
    ],
  }
}

function pieceBox(host: UnitRoom, wall: Wall, offset: number, along: number, depth: number) {
  if (wall === 'north') return { x: host.x + offset, y: host.y + host.d, w: along, d: depth }
  if (wall === 'south') return { x: host.x + offset, y: host.y - depth, w: along, d: depth }
  if (wall === 'east') return { x: host.x + host.w, y: host.y + offset, w: depth, d: along }
  return { x: host.x - depth, y: host.y + offset, w: depth, d: along }
}

function placedJoin(
  rooms: UnitRoom[],
  host: UnitRoom,
  wall: Wall,
  offset: number,
  along: number,
  depth: number,
  kind: UnitRoomKind,
  id: string,
  name: string,
): UnitRoom | null {
  const need = linkDoorWidth(kind, host.kind)
  const box = pieceBox(host, wall, offset, along, depth)
  const draft: UnitRoom = {
    id,
    kind,
    name,
    x: Math.round(box.x),
    y: Math.round(box.y),
    w: Math.round(box.w),
    d: Math.round(box.d),
    door: null,
    window: null,
  }
  if (draft.w < 1 || draft.d < 1 || rooms.some((room) => rectanglesOverlap(draft, room))) return null
  const edge = touches(draft, host, need)
  if (!edge || edge.end - edge.start < need) return null
  if (kind === 'entrance') {
    const outer = oppositeWall(edge.wall)
    const span = outer === 'north' || outer === 'south' ? draft.w : draft.d
    const width = Math.min(100, span)
    if (width < 90) return null
    draft.door = { wall: outer, offset: Math.round((span - width) / 2), width }
  } else {
    draft.door = {
      wall: edge.wall,
      offset: Math.round(edge.start + (edge.end - edge.start - need) / 2),
      width: need,
    }
  }
  return draft
}

function fitOpeningOnRoom<T extends UnitOpening>(room: UnitRoom, opening: T, minWidth: number): T | null {
  const span = opening.wall === 'north' || opening.wall === 'south' ? room.w : room.d
  const width = Math.min(opening.width, span)
  if (width < minWidth) return null
  return { ...opening, width, offset: Math.max(0, Math.min(opening.offset, span - width)) }
}

export function roomFits(rooms: UnitRoom[], id: string, x: number, y: number): boolean {
  const current = rooms.find((room) => room.id === id)
  if (!current || !Number.isFinite(x) || !Number.isFinite(y)) return false
  const draft = { ...current, x, y }
  return !rooms.some((room) => room.id !== id && rectanglesOverlap(draft, room))
}

export function settleRoom(rooms: UnitRoom[], id: string, x: number, y: number): { x: number; y: number } | null {
  const room = rooms.find((item) => item.id === id)
  if (!room || !Number.isFinite(x) || !Number.isFinite(y)) return null
  const rawX = Math.round(x)
  const rawY = Math.round(y)
  if (roomFits(rooms, id, rawX, rawY)) return { x: rawX, y: rawY }
  const others = rooms.filter((item) => item.id !== id)
  if (others.length === 0) return { x: rawX, y: rawY }
  const minX = Math.min(...others.map((item) => item.x))
  const minY = Math.min(...others.map((item) => item.y))
  const maxX = Math.max(...others.map((item) => item.x + item.w))
  const maxY = Math.max(...others.map((item) => item.y + item.d))
  const centerX = rawX + room.w / 2
  const centerY = rawY + room.d / 2
  const options = [
    { x: minX - room.w, y: rawY, cost: Math.abs(centerX - minX) },
    { x: maxX, y: rawY, cost: Math.abs(centerX - maxX) },
    { x: rawX, y: minY - room.d, cost: Math.abs(centerY - minY) },
    { x: rawX, y: maxY, cost: Math.abs(centerY - maxY) },
  ]
  options.sort((a, b) => a.cost - b.cost)
  return options.find((option) => roomFits(rooms, id, option.x, option.y)) ?? null
}

export function moveRoom(rooms: UnitRoom[], id: string, x: number, y: number): UnitRoom[] | null {
  const current = rooms.find((room) => room.id === id)
  if (!current) return null
  const nextX = Math.round(x)
  const nextY = Math.round(y)
  if (!roomFits(rooms, id, nextX, nextY)) return null
  if (nextX === current.x && nextY === current.y) return rooms
  return shiftToOrigin(rooms.map((room) => (room.id === id ? { ...room, x: nextX, y: nextY } : room)))
}

export function roomBoxFits(rooms: UnitRoom[], id: string, x: number, y: number, width: number, depth: number): boolean {
  const current = rooms.find((room) => room.id === id)
  if (!current || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width) || !Number.isFinite(depth)) return false
  if (width < 1 || depth < 1) return false
  const draft = { ...current, x, y, w: width, d: depth }
  return !rooms.some((room) => room.id !== id && rectanglesOverlap(draft, room))
}

export function resizeRoomBox(rooms: UnitRoom[], id: string, x: number, y: number, width: number, depth: number): UnitRoom[] | null {
  const current = rooms.find((room) => room.id === id)
  if (!current) return null
  const min = joinMinSpan(current.kind)
  const nextX = Math.round(x)
  const nextY = Math.round(y)
  const nextWidth = Math.round(width)
  const nextDepth = Math.round(depth)
  if (nextWidth < min || nextDepth < min || !roomBoxFits(rooms, id, nextX, nextY, nextWidth, nextDepth)) return null
  const draft: UnitRoom = { ...current, x: nextX, y: nextY, w: nextWidth, d: nextDepth }
  if (draft.door) {
    const door = fitOpeningOnRoom(draft, draft.door, current.kind === 'entrance' ? 90 : doorWidth(current.kind))
    if (!door) return null
    draft.door = door
  }
  if (draft.extraDoors?.length) {
    const extra = draft.extraDoors
      .map((opening) => fitOpeningOnRoom(draft, opening, 70))
      .filter((opening): opening is UnitOpening => opening !== null)
    draft.extraDoors = extra.length > 0 ? extra : undefined
  }
  if (draft.window) {
    const window = fitOpeningOnRoom(draft, draft.window, 60)
    draft.window = window
  }
  if (nextX === current.x && nextY === current.y && nextWidth === current.w && nextDepth === current.d) return rooms
  return shiftToOrigin(rooms.map((room) => (room.id === id ? draft : room)))
}

export function resizeJoinedRoom(rooms: UnitRoom[], id: string, width: number, depth: number): UnitRoom[] | null {
  const current = rooms.find((room) => room.id === id)
  if (!current) return null
  return resizeRoomBox(rooms, id, current.x, current.y, width, depth)
}

function openingOnPiece<T extends UnitOpening>(
  source: UnitRoom,
  opening: T | null,
  piece: { x: number; y: number; w: number; d: number },
  minWidth: number,
): T | null {
  if (!opening) return null
  const alongX = opening.wall === 'north' || opening.wall === 'south'
  const onEdge = opening.wall === 'south'
    ? piece.y === source.y
    : opening.wall === 'north'
      ? piece.y + piece.d === source.y + source.d
      : opening.wall === 'west'
        ? piece.x === source.x
        : piece.x + piece.w === source.x + source.w
  if (!onEdge) return null
  const start = (alongX ? source.x : source.y) + opening.offset
  const end = start + opening.width
  const pieceStart = alongX ? piece.x : piece.y
  const pieceSpan = alongX ? piece.w : piece.d
  const clipStart = Math.max(start, pieceStart)
  const clipEnd = Math.min(end, pieceStart + pieceSpan)
  const width = Math.round(clipEnd - clipStart)
  if (width < minWidth) return null
  return { ...opening, width, offset: Math.round(clipStart - pieceStart) }
}

export function splitLivingKitchen(rooms: UnitRoom[], id: string): { rooms: UnitRoom[]; kitchenId: string } | null {
  const current = rooms.find((room) => room.id === id)
  if (!current || current.kind !== 'living' || !current.name.includes('주방')) return null
  const livingMin = joinMinSpan('living')
  const kitchenMin = joinMinSpan('kitchen')
  const verticalOk = current.w >= livingMin + kitchenMin
  const horizontalOk = current.d >= livingMin + kitchenMin
  if (!verticalOk && !horizontalOk) return null
  const vertical = verticalOk && (current.w >= current.d || !horizontalOk)
  const span = vertical ? current.w : current.d
  const kitchenSpan = Math.round(Math.min(Math.max(kitchenMin, span * 0.36), span - livingMin))
  const livingSpan = span - kitchenSpan
  const doorAt = current.door
    ? (current.door.wall === 'north' || current.door.wall === 'south'
      ? current.x + current.door.offset + current.door.width / 2
      : current.y + current.door.offset + current.door.width / 2)
    : null
  const doorAlongSplit = doorAt !== null && ((vertical && (current.door?.wall === 'north' || current.door?.wall === 'south')) || (!vertical && (current.door?.wall === 'east' || current.door?.wall === 'west')))
  const origin = vertical ? current.x : current.y
  let kitchenHigh = true
  if (doorAlongSplit && doorAt !== null && doorAt >= origin + livingSpan) kitchenHigh = false
  const kitchenBox = vertical
    ? {
      x: current.x + (kitchenHigh ? livingSpan : 0),
      y: current.y,
      w: kitchenSpan,
      d: current.d,
    }
    : {
      x: current.x,
      y: current.y + (kitchenHigh ? livingSpan : 0),
      w: current.w,
      d: kitchenSpan,
    }
  const livingBox = vertical
    ? {
      x: current.x + (kitchenHigh ? 0 : kitchenSpan),
      y: current.y,
      w: livingSpan,
      d: current.d,
    }
    : {
      x: current.x,
      y: current.y + (kitchenHigh ? 0 : kitchenSpan),
      w: current.w,
      d: livingSpan,
    }
  const others = rooms.filter((room) => room.id !== id)
  const kitchenId = nextJoinId(others, 'kitchen')
  const linkWall: Wall = vertical ? (kitchenHigh ? 'west' : 'east') : (kitchenHigh ? 'south' : 'north')
  const shared = vertical ? current.d : current.w
  const linkWidth = Math.min(doorWidth('kitchen'), shared)
  const link = { wall: linkWall, offset: Math.round((shared - linkWidth) / 2), width: linkWidth }
  const keptLivingDoor = openingOnPiece(current, current.door, livingBox, 75)
  const keptKitchenDoor = openingOnPiece(current, current.door, kitchenBox, 75)
  const livingLink = { wall: oppositeWall(linkWall), offset: link.offset, width: link.width }
  const livingDoor = keptLivingDoor ?? livingLink
  const kitchenDoor = keptLivingDoor ? link : (keptKitchenDoor ?? link)
  const living: UnitRoom = {
    ...current,
    name: uniqueJoinName(others, '거실'),
    ...livingBox,
    door: livingDoor,
    window: openingOnPiece(current, current.window, livingBox, 60),
  }
  const kitchen: UnitRoom = {
    id: kitchenId,
    kind: 'kitchen',
    name: uniqueJoinName([...others, living], '주방'),
    ...kitchenBox,
    door: kitchenDoor,
    window: openingOnPiece(current, current.window, kitchenBox, 60),
  }
  return { kitchenId, rooms: shiftToOrigin(rooms.map((room) => (room.id === id ? living : room)).concat(kitchen)) }
}

export function attachToWall(
  rooms: UnitRoom[],
  hostId: string,
  wall: Wall,
  offset: number,
  along: number,
  depth: number,
  kind: UnitRoomKind,
  label?: string,
): { id: string; rooms: UnitRoom[] } | null {
  const host = rooms.find((room) => room.id === hostId)
  if (!host || !Number.isFinite(offset) || !Number.isFinite(along) || !Number.isFinite(depth)) return null
  const need = linkDoorWidth(kind, host.kind)
  const span = wall === 'north' || wall === 'south' ? host.w : host.d
  const alongMin = kind === 'entrance' ? Math.max(need, 100) : need
  if (along < alongMin || depth < joinMinSpan(kind) || span < need) return null
  const id = nextJoinId(rooms, kind)
  const name = label ? uniqueJoinName(rooms, label) : nextJoinName(rooms, kind)
  const preferred = Math.round(offset)
  const exact = placedJoin(rooms, host, wall, preferred, along, depth, kind, id, name)
  if (exact) return { id, rooms: shiftToOrigin([...rooms, exact]) }
  const minOffset = Math.ceil(need - along)
  const maxOffset = Math.floor(span - need)
  let best: UnitRoom | null = null
  let bestDist = Infinity
  for (let cursor = minOffset; cursor <= maxOffset; cursor += 5) {
    const placed = placedJoin(rooms, host, wall, cursor, along, depth, kind, id, name)
    if (!placed) continue
    const dist = Math.abs(cursor - preferred)
    if (dist < bestDist) {
      best = placed
      bestDist = dist
    }
  }
  if (!best) return null
  return { id, rooms: shiftToOrigin([...rooms, best]) }
}

function edgeOpening(kind: 'door' | 'window', opening: UnitOpening, roomW: number, roomD: number, sill = 0, height = 200) {
  let edge = 0
  let offset = opening.offset
  if (opening.wall === 'east') edge = 1
  if (opening.wall === 'north') {
    edge = 2
    offset = Math.max(0, roomW - opening.offset - opening.width)
  }
  if (opening.wall === 'west') {
    edge = 3
    offset = Math.max(0, roomD - opening.offset - opening.width)
  }
  return {
    id: uid(kind),
    kind,
    edge,
    offset,
    width: opening.width,
    sill,
    height,
  }
}

export function sceneFromEnvelope(width: number, depth: number, entrance: Wall): Scene {
  const doorSpan = entrance === 'north' || entrance === 'south' ? width : depth
  const doorWidth = Math.min(100, Math.max(70, doorSpan - 20))
  const door = { wall: entrance, width: doorWidth, offset: Math.round((doorSpan - doorWidth) / 2) }
  const windowWall: Wall = entrance === 'south' ? 'north' : entrance === 'north' ? 'south' : entrance === 'east' ? 'west' : 'east'
  const windowSpan = windowWall === 'north' || windowWall === 'south' ? width : depth
  const windowWidth = Math.min(160, Math.max(80, windowSpan - 80))
  const window = {
    wall: windowWall,
    width: windowWidth,
    offset: Math.round((windowSpan - windowWidth) / 2),
    sill: 90,
    height: 120,
  }
  return {
    room: { height: 250, outline: rectangleOutline(width, depth) },
    openings: [
      edgeOpening('door', door, width, depth, 0, 200),
      edgeOpening('window', window, width, depth, window.sill, window.height),
    ],
    furniture: [],
  }
}

function pieceFits(room: UnitRoom, width: number, depth: number): boolean {
  const limitW = room.w - 36
  const limitD = room.d - 36
  return (width <= limitW && depth <= limitD) || (width <= limitD && depth <= limitW)
}

function furniturePiece(room: UnitRoom, type: FurnitureType): Furniture | null {
  const stock = DEFAULT_SIZE[type]
  let width = stock.width
  let depth = stock.depth
  if (!pieceFits(room, width, depth)) {
    const limitW = room.w - 36
    const limitD = room.d - 36
    if (limitW < 36 || limitD < 36) return null
    const scale = Math.max(Math.min(limitW / width, limitD / depth), Math.min(limitW / depth, limitD / width))
    if (scale < 0.62) return null
    width = Math.max(36, Math.round(width * Math.min(scale, 1)))
    depth = Math.max(30, Math.round(depth * Math.min(scale, 1)))
    if (!pieceFits(room, width, depth)) return null
  }
  return { id: uid(type), type, width, depth, height: stock.height }
}

function furnitureTypes(room: UnitRoom): FurnitureType[] {
  const area = room.w * room.d
  if (room.kind === 'bedroom') return area >= 140000 ? ['bed', 'nightstand', 'wardrobe', 'desk', 'chair'] : ['bed', 'nightstand', 'wardrobe']
  if (room.kind === 'living') return room.name.includes('주방') ? ['sofa', 'table', 'chair'] : ['sofa', 'table']
  if (room.kind === 'kitchen') return ['table', 'chair']
  if (room.kind === 'bathroom') return ['toilet', 'sink', 'shower', 'bathtub']
  if (room.kind === 'entrance') return ['shoeCabinet']
  if (room.kind === 'dress') return ['wardrobe', 'dresser']
  if (room.kind === 'utility') return ['wardrobe']
  return []
}

export function sceneFromUnitRoom(room: UnitRoom): Scene {
  const openings = []
  for (const door of roomDoors(room)) openings.push(edgeOpening('door', door, room.w, room.d, 0, 200))
  if (room.window) openings.push(edgeOpening('window', room.window, room.w, room.d, room.window.sill, room.window.height))
  const furniture = furnitureTypes(room).flatMap((type) => {
    const piece = furniturePiece(room, type)
    return piece ? [piece] : []
  })
  return {
    room: { height: 250, outline: rectangleOutline(room.w, room.d) },
    openings,
    furniture,
  }
}

export function doorSwingPoints(
  room: { x: number; y: number; w: number; d: number },
  opening: UnitOpening,
): { hinge: { x: number; y: number }; closed: { x: number; y: number }; open: { x: number; y: number } } {
  const horizontal = opening.wall === 'north' || opening.wall === 'south'
  const y = opening.wall === 'north' ? room.y + room.d : opening.wall === 'south' ? room.y : room.y + opening.offset
  const x = opening.wall === 'east' ? room.x + room.w : opening.wall === 'west' ? room.x : room.x + opening.offset
  const end = { x: horizontal ? x + opening.width : x, y: horizontal ? y : y + opening.width }
  const start = { x, y }
  const hinge = opening.hinge === 'end' ? end : start
  const closed = opening.hinge === 'end' ? start : end
  const inward = opening.wall === 'south' ? { x: 0, y: 1 } : opening.wall === 'north' ? { x: 0, y: -1 } : opening.wall === 'west' ? { x: 1, y: 0 } : { x: -1, y: 0 }
  const sign = opening.swing === 'out' ? -1 : 1
  return {
    hinge,
    closed,
    open: { x: hinge.x + inward.x * opening.width * sign, y: hinge.y + inward.y * opening.width * sign },
  }
}

const TOUCH = 2

function edgeLine(room: UnitRoom, wall: Wall): OpenSpan {
  if (wall === 'south') return { axis: 'x', at: room.y, from: room.x, to: room.x + room.w }
  if (wall === 'north') return { axis: 'x', at: room.y + room.d, from: room.x, to: room.x + room.w }
  if (wall === 'west') return { axis: 'y', at: room.x, from: room.y, to: room.y + room.d }
  return { axis: 'y', at: room.x + room.w, from: room.y, to: room.y + room.d }
}

export function sharedSpan(a: UnitRoom, b: UnitRoom): OpenSpan | null {
  const walls: Wall[] = ['south', 'north', 'east', 'west']
  for (const wall of walls) {
    const edge = edgeLine(a, wall)
    for (const other of walls) {
      const line = edgeLine(b, other)
      if (edge.axis !== line.axis || Math.abs(edge.at - line.at) > TOUCH) continue
      const from = Math.max(edge.from, line.from)
      const to = Math.min(edge.to, line.to)
      if (to - from < 20) continue
      return { axis: edge.axis, at: (edge.at + line.at) / 2, from, to }
    }
  }
  return null
}

export function neighborOnSegment(
  rooms: UnitRoom[],
  room: UnitRoom,
  segment: { x1: number; y1: number; x2: number; y2: number },
): UnitRoom | null {
  const horizontal = Math.abs(segment.y1 - segment.y2) <= TOUCH
  const at = horizontal ? (segment.y1 + segment.y2) / 2 : (segment.x1 + segment.x2) / 2
  const from = horizontal ? Math.min(segment.x1, segment.x2) : Math.min(segment.y1, segment.y2)
  const to = horizontal ? Math.max(segment.x1, segment.x2) : Math.max(segment.y1, segment.y2)
  const axis = horizontal ? 'x' : 'y'
  for (const other of rooms) {
    if (other.id === room.id) continue
    const span = sharedSpan(room, other)
    if (!span || span.axis !== axis || Math.abs(span.at - at) > TOUCH) continue
    if (Math.min(to, span.to) - Math.max(from, span.from) > 10) return other
  }
  return null
}

export function passageSpans(rooms: UnitRoom[], passages: UnitPassage[]): OpenSpan[] {
  const spans: OpenSpan[] = []
  for (const passage of passages) {
    const a = rooms.find((room) => room.id === passage.a)
    const b = rooms.find((room) => room.id === passage.b)
    if (!a || !b) continue
    const span = sharedSpan(a, b)
    if (span) spans.push(span)
  }
  return spans
}

function openingHits(room: UnitRoom, opening: UnitOpening | null, span: OpenSpan): boolean {
  if (!opening) return false
  const edge = edgeLine(room, opening.wall)
  if (edge.axis !== span.axis || Math.abs(edge.at - span.at) > TOUCH) return false
  const from = edge.from + opening.offset
  const to = from + opening.width
  return Math.min(to, span.to) - Math.max(from, span.from) > 10
}

export function neighborsAcrossDoor(rooms: UnitRoom[], room: UnitRoom): UnitRoom[] {
  const door = room.door
  if (!door) return []
  const edge = edgeLine(room, door.wall)
  const from = edge.from + door.offset
  const to = from + door.width
  return rooms.filter((other) => {
    if (other.id === room.id) return false
    const span = sharedSpan(room, other)
    if (!span || span.axis !== edge.axis || Math.abs(span.at - edge.at) > TOUCH) return false
    return Math.min(to, span.to) - Math.max(from, span.from) > 10
  })
}

function withoutOpening(room: UnitRoom, span: OpenSpan, dropDoor: boolean): UnitRoom {
  const door = dropDoor || openingHits(room, room.door, span) ? null : room.door
  const extraDoors = (room.extraDoors ?? []).filter((opening) => !openingHits(room, opening, span))
  const window = openingHits(room, room.window, span) ? null : room.window
  const sameExtra = extraDoors.length === (room.extraDoors ?? []).length
  if (door === room.door && window === room.window && sameExtra) return room
  return { ...room, door, window, extraDoors: extraDoors.length > 0 ? extraDoors : undefined }
}

export function roomDoors(room: UnitRoom): UnitOpening[] {
  return [room.door, ...(room.extraDoors ?? [])].filter((opening): opening is UnitOpening => opening !== null)
}

export function wallLinks(rooms: UnitRoom[], passages: UnitPassage[], room: UnitRoom): { id: string; name: string; open: boolean }[] {
  return rooms.flatMap((other) => {
    if (other.id === room.id || !sharedSpan(room, other)) return []
    const open = passages.some((item) => (item.a === room.id && item.b === other.id) || (item.a === other.id && item.b === room.id))
    return [{ id: other.id, name: other.name, open }]
  })
}

function solidPieces(edge: OpenSpan, spans: OpenSpan[]): [number, number][] {
  const cuts = spans
    .filter((span) => span.axis === edge.axis && Math.abs(span.at - edge.at) <= TOUCH)
    .map((span) => ({ from: Math.max(edge.from, span.from), to: Math.min(edge.to, span.to) }))
    .filter((span) => span.to - span.from > 1)
    .sort((left, right) => left.from - right.from)
  let cursor = edge.from
  const pieces: [number, number][] = []
  for (const cut of cuts) {
    if (cut.from > cursor + 1) pieces.push([cursor, cut.from])
    cursor = Math.max(cursor, cut.to)
  }
  if (edge.to > cursor + 1) pieces.push([cursor, edge.to])
  return pieces
}

function coversPiece(room: UnitRoom, opening: UnitOpening, wall: Wall, from: number, to: number): boolean {
  if (opening.wall !== wall) return false
  const edge = edgeLine(room, wall)
  const start = edge.from + opening.offset
  const end = start + opening.width
  return Math.min(end, to) - Math.max(start, from) > 10
}

function placeDoor(rooms: UnitRoom[], room: UnitRoom, opening: UnitOpening): UnitRoom[] {
  return rooms.map((item) => {
    if (item.id !== room.id) return item
    if (!item.door) return { ...item, door: opening }
    return { ...item, extraDoors: [...(item.extraDoors ?? []), opening] }
  })
}

function freeWallPieces(room: UnitRoom, passages: OpenSpan[], wall: Wall): [number, number][] {
  const edge = edgeLine(room, wall)
  const clearance = 8
  const blocked: OpenSpan[] = [...passages]
  for (const opening of [...roomDoors(room), ...(room.window ? [room.window] : [])]) {
    if (opening.wall !== wall) continue
    blocked.push({
      axis: edge.axis,
      at: edge.at,
      from: edge.from + opening.offset - clearance,
      to: edge.from + opening.offset + opening.width + clearance,
    })
  }
  return solidPieces(edge, blocked)
}

export function addRoomDoorAt(
  rooms: UnitRoom[],
  passages: UnitPassage[],
  roomId: string,
  wall: Wall,
  at: number,
): UnitRoom[] | null {
  const room = rooms.find((item) => item.id === roomId)
  if (!room) return null
  const edge = edgeLine(room, wall)
  const piece = freeWallPieces(room, passageSpans(rooms, passages), wall).find(([from, to]) => at >= from - 2 && at <= to + 2)
  if (!piece) return null
  const [from, to] = piece
  const length = to - from
  if (length < 86) return null
  const width = Math.min(doorWidth(room.kind), Math.floor(length - 16))
  if (width < 70) return null
  const minStart = from + 8
  const maxStart = to - 8 - width
  if (maxStart < minStart) return null
  const start = Math.round(Math.max(minStart, Math.min(maxStart, at - width / 2)))
  return placeDoor(rooms, room, { wall, offset: Math.round(start - edge.from), width })
}

export function addRoomDoor(rooms: UnitRoom[], passages: UnitPassage[], roomId: string): UnitRoom[] | null {
  const room = rooms.find((item) => item.id === roomId)
  if (!room) return null
  const spans = passageSpans(rooms, passages)
  const existing = roomDoors(room)
  const walls: Wall[] = ['south', 'north', 'east', 'west']
  let best: { wall: Wall; offset: number; width: number; score: number } | null = null
  for (const wall of walls) {
    const edge = edgeLine(room, wall)
    for (const [from, to] of solidPieces(edge, spans)) {
      const length = to - from
      if (length < 86) continue
      if (existing.some((opening) => coversPiece(room, opening, wall, from, to))) continue
      const width = Math.min(doorWidth(room.kind), Math.floor(length - 16))
      if (width < 70) continue
      const offset = Math.round(from - edge.from + (length - width) / 2)
      const shared = rooms.some((other) => {
        if (other.id === room.id) return false
        const span = sharedSpan(room, other)
        return span !== null && span.axis === edge.axis && Math.abs(span.at - edge.at) <= TOUCH && Math.min(to, span.to) - Math.max(from, span.from) > 20
      })
      const score = length + (shared ? 1000 : 0)
      if (!best || score > best.score) best = { wall, offset, width, score }
    }
  }
  if (!best) return null
  return placeDoor(rooms, room, { wall: best.wall, offset: best.offset, width: best.width })
}

export function removeRoomDoorAt(rooms: UnitRoom[], roomId: string, index: number): UnitRoom[] | null {
  const room = rooms.find((item) => item.id === roomId)
  if (!room) return null
  const doors = roomDoors(room)
  if (index < 0 || index >= doors.length) return null
  const rest = doors.filter((_, doorIndex) => doorIndex !== index)
  return rooms.map((item) => (item.id === room.id ? { ...item, door: rest[0] ?? null, extraDoors: rest.length > 1 ? rest.slice(1) : undefined } : item))
}

export function removeRoomDoor(rooms: UnitRoom[], roomId: string): UnitRoom[] | null {
  const room = rooms.find((item) => item.id === roomId)
  if (!room) return null
  return removeRoomDoorAt(rooms, roomId, roomDoors(room).length - 1)
}

const SPACE_SIZE: Record<UnitRoomKind, { w: number; d: number }> = {
  bedroom: { w: 300, d: 360 },
  bathroom: { w: 180, d: 220 },
  living: { w: 400, d: 340 },
  kitchen: { w: 240, d: 260 },
  entrance: { w: 180, d: 150 },
  corridor: { w: 120, d: 280 },
  utility: { w: 160, d: 180 },
  dress: { w: 180, d: 200 },
}

function boxHits(rooms: UnitRoom[], x: number, y: number, w: number, d: number): boolean {
  const draft: UnitRoom = { id: '', kind: 'bedroom', name: '', x, y, w, d, door: null, window: null }
  return rooms.some((room) => rectanglesOverlap(draft, room))
}

function nearestFree(rooms: UnitRoom[], cx: number, cy: number, w: number, d: number): { x: number; y: number; dist: number } | null {
  const anchors = [
    { x: cx - w / 2, y: cy - d / 2 },
    { x: cx, y: cy - d / 2 },
    { x: cx - w, y: cy - d / 2 },
    { x: cx - w / 2, y: cy },
    { x: cx - w / 2, y: cy - d },
  ]
  const dirs: Array<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]
  let best: { x: number; y: number; dist: number } | null = null
  for (const anchor of anchors) {
    for (const step of [0, 30, 60, 100, 160, 220]) {
      const offsets = step === 0 ? [[0, 0] as [number, number]] : dirs
      for (const [dx, dy] of offsets) {
        const x = Math.round(anchor.x + dx * step)
        const y = Math.round(anchor.y + dy * step)
        if (boxHits(rooms, x, y, w, d)) continue
        const dist = Math.hypot(x + w / 2 - cx, y + d / 2 - cy)
        if (!best || dist < best.dist) best = { x, y, dist }
        if (best.dist < 8) return best
      }
    }
  }
  return best && best.dist <= 220 ? best : null
}

function doorForNewRoom(rooms: UnitRoom[], room: UnitRoom): UnitOpening {
  let best: { wall: Wall; start: number; end: number } | null = null
  for (const other of rooms) {
    const edge = touches(room, other, 70)
    if (!edge) continue
    if (!best || edge.end - edge.start > best.end - best.start) best = { wall: edge.wall, start: edge.start, end: edge.end }
  }
  if (best) {
    const span = best.end - best.start
    const width = Math.min(doorWidth(room.kind), Math.floor(span - 8))
    if (width >= 70) return { wall: best.wall, offset: Math.round(best.start + (span - width) / 2), width }
  }
  const width = Math.min(doorWidth(room.kind), Math.max(70, room.w - 20))
  return { wall: 'south', offset: Math.max(0, Math.round((room.w - width) / 2)), width: Math.min(width, room.w) }
}

export function addUnitSpace(rooms: UnitRoom[], kind: UnitRoomKind, x: number, y: number): { rooms: UnitRoom[]; id: string } | null {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  if (rooms.some((room) => x > room.x + 1 && x < room.x + room.w - 1 && y > room.y + 1 && y < room.y + room.d - 1)) return null
  const stock = SPACE_SIZE[kind]
  const min = joinMinSpan(kind)
  const sizes: { w: number; d: number }[] = []
  let width = stock.w
  let depth = stock.d
  while (width >= min && depth >= min) {
    sizes.push({ w: width, d: depth })
    if (width === min && depth === min) break
    width = Math.max(min, width - 40)
    depth = Math.max(min, depth - 40)
  }
  let spot: { x: number; y: number; w: number; d: number } | null = null
  for (const size of sizes) {
    const found = nearestFree(rooms, x, y, size.w, size.d)
    if (!found) continue
    spot = { x: found.x, y: found.y, w: size.w, d: size.d }
    break
  }
  if (!spot) return null
  const id = nextJoinId(rooms, kind)
  const draft: UnitRoom = {
    id,
    kind,
    name: nextJoinName(rooms, kind),
    x: spot.x,
    y: spot.y,
    w: spot.w,
    d: spot.d,
    door: null,
    window: null,
  }
  draft.door = doorForNewRoom(rooms, draft)
  const windowWalls: Wall[] = ['north', 'south', 'east', 'west']
  const spanOf = (wall: Wall) => (wall === 'north' || wall === 'south' ? draft.w : draft.d)
  const windowWall = windowWalls.filter((wall) => wall !== draft.door?.wall).sort((a, b) => spanOf(b) - spanOf(a))[0]
  if (windowWall) {
    const span = windowWall === 'north' || windowWall === 'south' ? draft.w : draft.d
    const windowWidth = Math.min(140, span - 36)
    if (windowWidth >= 80) draft.window = { wall: windowWall, offset: Math.round((span - windowWidth) / 2), width: windowWidth, sill: 90, height: 110 }
  }
  return { id, rooms: shiftToOrigin([...rooms, draft]) }
}

export function openSharedWall(
  rooms: UnitRoom[],
  passages: UnitPassage[],
  roomId: string,
  neighborId: string,
): { rooms: UnitRoom[]; passages: UnitPassage[] } | null {
  const room = rooms.find((item) => item.id === roomId)
  const other = rooms.find((item) => item.id === neighborId)
  if (!room || !other) return null
  const span = sharedSpan(room, other)
  if (!span) return null
  if (passages.some((item) => (item.a === roomId && item.b === neighborId) || (item.a === neighborId && item.b === roomId))) return null
  return {
    passages: [...passages, { a: roomId, b: neighborId }],
    rooms: rooms.map((item) => (item.id === roomId || item.id === neighborId ? withoutOpening(item, span, false) : item)),
  }
}

export function closeSharedWall(
  rooms: UnitRoom[],
  passages: UnitPassage[],
  roomId: string,
  neighborId: string,
): { rooms: UnitRoom[]; passages: UnitPassage[] } | null {
  const next = passages.filter((item) => !((item.a === roomId && item.b === neighborId) || (item.a === neighborId && item.b === roomId)))
  if (next.length === passages.length) return null
  return { rooms, passages: next }
}

export function openDoorway(
  rooms: UnitRoom[],
  passages: UnitPassage[],
  roomId: string,
): { rooms: UnitRoom[]; passages: UnitPassage[] } | null {
  const room = rooms.find((item) => item.id === roomId)
  if (!room) return null
  const neighbors = neighborsAcrossDoor(rooms, room)
  if (neighbors.length === 0) return null
  const nextPassages = [...passages]
  for (const other of neighbors) {
    const exists = nextPassages.some((item) => (item.a === room.id && item.b === other.id) || (item.a === other.id && item.b === room.id))
    if (!exists) nextPassages.push({ a: room.id, b: other.id })
  }
  const nextRooms = rooms.map((item) => {
    if (item.id === room.id) {
      return neighbors.reduce((current, other) => withoutOpening(current, sharedSpan(room, other)!, true), item)
    }
    if (!neighbors.some((other) => other.id === item.id)) return item
    return withoutOpening(item, sharedSpan(room, item)!, false)
  })
  return { rooms: nextRooms, passages: nextPassages }
}

export function removeUnitRoom(rooms: UnitRoom[], passages: UnitPassage[], roomId: string): { rooms: UnitRoom[]; passages: UnitPassage[] } {
  return {
    rooms: shiftToOrigin(rooms.filter((room) => room.id !== roomId)),
    passages: passages.filter((item) => item.a !== roomId && item.b !== roomId),
  }
}

export function wallSegments(room: UnitRoom, spans: OpenSpan[]): { wall: Wall; x1: number; y1: number; x2: number; y2: number }[] {
  const walls: Wall[] = ['south', 'north', 'east', 'west']
  const lines: { wall: Wall; x1: number; y1: number; x2: number; y2: number }[] = []
  for (const wall of walls) {
    const edge = edgeLine(room, wall)
    const cuts = spans
      .filter((span) => span.axis === edge.axis && Math.abs(span.at - edge.at) <= TOUCH)
      .map((span) => ({ from: Math.max(edge.from, span.from), to: Math.min(edge.to, span.to) }))
      .filter((span) => span.to - span.from > 1)
      .sort((left, right) => left.from - right.from)
    let cursor = edge.from
    const pieces: [number, number][] = []
    for (const cut of cuts) {
      if (cut.from > cursor + 1) pieces.push([cursor, cut.from])
      cursor = Math.max(cursor, cut.to)
    }
    if (edge.to > cursor + 1) pieces.push([cursor, edge.to])
    for (const [from, to] of pieces) {
      if (edge.axis === 'x') lines.push({ wall, x1: from, y1: edge.at, x2: to, y2: edge.at })
      else lines.push({ wall, x1: edge.at, y1: from, x2: edge.at, y2: to })
    }
  }
  return lines
}
