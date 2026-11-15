import type { Furniture, Scene, Wall } from '../types.ts'
import { DEFAULT_SIZE, uid } from '../types.ts'
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
  window: (UnitOpening & { sill: number; height: number }) | null
}

export type UnitPlan = {
  id: string
  label: string
  note: string
  rooms: UnitRoom[]
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
  const door = Math.min(width, span - 16)
  if (door < 70) return null
  return { wall, offset: Math.round(start + (span - door) / 2), width: Math.round(door) }
}

function doorTargets(current: UnitRoom): string[] {
  if (current.kind === 'entrance') return []
  if (current.id === 'ensuite' || current.id === 'dress') return ['master', 'corridor', 'living']
  if (current.kind === 'kitchen') return ['living', 'corridor', 'entrance']
  if (current.kind === 'utility') return ['kitchen', 'living', 'corridor']
  if (current.kind === 'living') return ['entrance', 'corridor', 'kitchen']
  if (current.kind === 'corridor') return ['entrance', 'living']
  return ['corridor', 'living', 'entrance']
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

function assignDoor(current: UnitRoom, rooms: UnitRoom[]): UnitOpening | null {
  if (current.kind === 'entrance') return centeredOpening('south', 0, current.w, 100)
  for (const id of doorTargets(current)) {
    const host = rooms.find((room) => room.id === id)
    if (!host) continue
    const need = doorWidth(current.kind)
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
  const hosts = [corridor, living, entrance].filter((room): room is UnitRoom => Boolean(room))
  for (const current of rooms) {
    if (current.kind === 'entrance' || current.kind === 'corridor') continue
    if (current.id === 'ensuite' || current.id === 'dress') {
      const master = byId('master')
      if (!master || !touches(current, master)) return false
      continue
    }
    if (current.kind === 'utility') {
      const kitchen = rooms.find((room) => room.kind === 'kitchen')
      const beside = kitchen ?? living
      if (!beside || !touches(current, beside)) return false
      continue
    }
    if (current.kind === 'kitchen') {
      if (hosts.some((host) => host.id !== current.id && touches(current, host)) || (living && touches(current, living))) continue
      return false
    }
    if (!hosts.some((host) => touches(current, host))) return false
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

function dayBlock(program: UnitProgram, limits: Limits, openKitchen: boolean, utility: boolean, serviceOnWest: boolean, includeKitchen = true): { node: PlanNode; minW: number; minD: number } | null {
  const living = program.living
    ? room('living', 'living', openKitchen ? '거실·주방' : '거실', limits.livingW, limits.livingD)
    : null
  const extras: RoomNode[] = []
  if (includeKitchen && !openKitchen) extras.push(room('kitchen', 'kitchen', '주방', limits.kitchenW, limits.kitchenD))
  if (utility) extras.push(room('utility', 'utility', '다용도실', limits.utilityW, limits.utilityD))
  if (!living && extras.length === 0) return null
  if (extras.length === 0 && living) return { node: living, minW: limits.livingW, minD: limits.livingD }
  const side = join('h', extras.map((extra) => piece(1, extra.minD, extra)))
  const sideMinW = Math.max(...extras.map((extra) => extra.minW))
  const sideMinD = extras.reduce((sum, extra) => sum + extra.minD, 0)
  if (!living) return { node: side, minW: sideMinW, minD: sideMinD }
  const service = piece(0.72, sideMinW, side)
  const day = piece(2.4, limits.livingW, living)
  return {
    node: join('v', serviceOnWest ? [service, day] : [day, service]),
    minW: sideMinW + limits.livingW,
    minD: Math.max(sideMinD, limits.livingD),
  }
}

function bedRow(program: UnitProgram, limits: Limits, dress: boolean, includeBaths = true, masterFirst = true): { node: PlanNode; minW: number; minD: number } | null {
  if (program.bedrooms < 1) return null
  const parts: SplitNode['parts'] = []
  if (includeBaths) for (const bath of sharedBathRooms(program, limits)) parts.push(piece(0.55, limits.bathW, bath))
  if (dress) parts.push(piece(0.65, limits.dressW, room('dress', 'dress', '드레스룸', limits.dressW, limits.dressD)))
  parts.push(piece(1.7, limits.masterW, room('master', 'bedroom', bedName(0, program.bedrooms), limits.masterW, limits.masterD)))
  if (hasEnsuite(program)) parts.push(piece(0.62, limits.bathW, ensuiteRoom(limits)))
  for (let index = 1; index < program.bedrooms; index++) {
    parts.push(piece(1.05, limits.bedW, room(`bed-${index + 1}`, 'bedroom', bedName(index, program.bedrooms), limits.bedW, limits.bedD)))
  }
  if (!masterFirst) parts.reverse()
  return {
    node: join('v', parts),
    minW: parts.reduce((sum, part) => sum + part.min, 0),
    minD: Math.max(limits.masterD, dress ? limits.dressD : 0, program.bathrooms > 0 ? limits.bathD : 0, program.bedrooms > 1 ? limits.bedD : 0),
  }
}

function entrySpine(limits: Limits): { node: PlanNode; minW: number; minD: number } {
  return {
    node: join('h', [
      piece(1.05, limits.entranceD, entranceRoom(limits)),
      piece(0.85, limits.corridor, corridorRoom(limits)),
    ]),
    minW: Math.max(limits.entranceW, limits.corridor),
    minD: limits.entranceD + limits.corridor,
  }
}

function withServices(beds: { node: PlanNode; minW: number; minD: number }, program: UnitProgram, limits: Limits, openKitchen: boolean, utility: boolean) {
  const extras: RoomNode[] = []
  if (program.living && !openKitchen) extras.push(room('kitchen', 'kitchen', '주방', limits.kitchenW, limits.kitchenD))
  if (utility) extras.push(room('utility', 'utility', '다용도실', limits.utilityW, limits.utilityD))
  if (extras.length === 0) return
  beds.node = join('v', [
    piece(1.7, beds.minW, beds.node),
    ...extras.map((extra) => piece(0.5, extra.minW, extra)),
  ])
  beds.minW += extras.reduce((sum, extra) => sum + extra.minW, 0)
  beds.minD = Math.max(beds.minD, ...extras.map((extra) => extra.minD))
}

function frontWing(openKitchen: boolean, utility: boolean, dress: boolean, program: UnitProgram, limits: Limits): PlanNode | null {
  const beds = bedRow(program, limits, dress)
  const block = dayBlock(program, limits, openKitchen, program.living ? false : utility, false, !program.living)
  if (!beds || !block) return null
  if (program.living) withServices(beds, program, limits, openKitchen, utility)
  const spine = entrySpine(limits)
  const south: SplitNode['parts'] = [
    piece(0.62, spine.minW, spine.node),
    piece(2.5, block.minW, block.node),
  ]
  return join('h', [
    piece(2.2, Math.max(spine.minD, block.minD), join('v', south)),
    piece(0.42, beds.minD, beds.node),
  ])
}

function backWing(openKitchen: boolean, utility: boolean, dress: boolean, program: UnitProgram, limits: Limits): PlanNode | null {
  const beds = bedRow(program, limits, dress)
  const block = dayBlock(program, limits, openKitchen, program.living ? false : utility, false, !program.living)
  if (!beds || !block) return null
  if (program.living) withServices(beds, program, limits, openKitchen, utility)
  const spine = entrySpine(limits)
  return join('h', [
    piece(0.48, Math.max(beds.minD, spine.minD), join('v', [piece(1.55, beds.minW, beds.node), piece(0.62, spine.minW, spine.node)])),
    piece(2.1, block.minD, block.node),
  ])
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

function schemesFor(program: UnitProgram, limits: Limits): Scheme[] {
  const area = program.width * program.depth
  const utility = area >= 80 * 10000
  const dress = area >= 80 * 10000 && program.bedrooms >= 1
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
      label: '낮이 현관 쪽',
      note: open
        ? '현관과 복도를 한쪽에 붙이고, 그 옆에 거실·주방을 둡니다. 방과 화장실은 복도 위쪽에 이어집니다.'
        : '현관과 복도를 한쪽에 붙이고 그 옆에 거실을 둡니다. 주방은 방 줄 끝에서 거실과 맞닿습니다.',
      node: band(true, open, false, false, program, limits),
    },
    {
      id: 'day-back',
      label: '낮이 안쪽',
      note: open
        ? '현관, 복도, 방을 입구 쪽에 이어 붙이고, 안쪽 전체를 거실·주방으로 엽니다.'
        : '현관과 방, 주방을 입구 쪽에 이어 붙이고, 안쪽 전체를 거실로 엽니다.',
      node: band(false, open, false, false, program, limits),
    },
  ]
  if (utility) {
    specs.push({
      id: 'with-utility',
      label: '다용도실이 있는 낮',
      note: open
        ? '방 줄 끝에 다용도실을 붙이고, 현관 옆은 거실·주방입니다. 화장실은 복도와 맞닿습니다.'
        : '주방 옆에 다용도실을 붙이고, 화장실은 복도와 맞닿습니다. 거실은 현관 옆에 둡니다.',
      node: band(true, open, true, false, program, limits),
    })
  }
  if (dress) {
    specs.push({
      id: 'with-dress',
      label: '드레스룸이 있는 큰방',
      note: open
        ? '큰방 옆에 드레스룸을 붙입니다. 현관과 복도 옆은 거실·주방입니다.'
        : '큰방 옆에 드레스룸을 붙입니다. 현관과 복도 옆은 거실이고, 주방은 방 줄 끝에 있습니다.',
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
    return { plans: [], message: '외곽의 가로와 세로는 400cm 이상 4000cm 이하여야 합니다.' }
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

function joinDepthMin(kind: UnitRoomKind): number {
  if (kind === 'corridor') return 100
  if (kind === 'bathroom') return 120
  if (kind === 'bedroom') return 180
  if (kind === 'living') return 240
  if (kind === 'kitchen') return 160
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
    note: '현관에 복도와 방을 붙여 나갑니다. 맞닿는 변은 문 폭 이상이어야 합니다.',
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

export function attachToWall(
  rooms: UnitRoom[],
  hostId: string,
  wall: Wall,
  offset: number,
  along: number,
  depth: number,
  kind: UnitRoomKind,
): { id: string; rooms: UnitRoom[] } | null {
  const host = rooms.find((room) => room.id === hostId)
  if (!host || !Number.isFinite(offset) || !Number.isFinite(along) || !Number.isFinite(depth)) return null
  const need = linkDoorWidth(kind, host.kind)
  if (along < need || depth < joinDepthMin(kind)) return null
  const box =
    wall === 'north'
      ? { x: host.x + offset, y: host.y + host.d, w: along, d: depth }
      : wall === 'south'
        ? { x: host.x + offset, y: host.y - depth, w: along, d: depth }
        : wall === 'east'
          ? { x: host.x + host.w, y: host.y + offset, w: depth, d: along }
          : { x: host.x - depth, y: host.y + offset, w: depth, d: along }
  const id = nextJoinId(rooms, kind)
  const draft: UnitRoom = {
    id,
    kind,
    name: nextJoinName(rooms, kind),
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
  const width = Math.min(need, edge.end - edge.start)
  draft.door = {
    wall: edge.wall,
    offset: Math.round(edge.start + (edge.end - edge.start - width) / 2),
    width: Math.round(width),
  }
  return { id, rooms: shiftToOrigin([...rooms, draft]) }
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

export function sceneFromUnitRoom(room: UnitRoom): Scene {
  const openings = []
  if (room.door) openings.push(edgeOpening('door', room.door, room.w, room.d, 0, 200))
  if (room.window) openings.push(edgeOpening('window', room.window, room.w, room.d, room.window.sill, room.window.height))
  const furniture: Furniture[] = []
  if (room.kind === 'bedroom') furniture.push({ id: uid('bed'), type: 'bed', ...DEFAULT_SIZE.bed })
  if (room.kind === 'living') furniture.push({ id: uid('sofa'), type: 'sofa', ...DEFAULT_SIZE.sofa })
  return {
    room: { height: 250, outline: rectangleOutline(room.w, room.d) },
    openings,
    furniture,
  }
}
