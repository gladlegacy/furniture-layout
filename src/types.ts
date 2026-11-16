export type Wall = 'north' | 'south' | 'east' | 'west'

export type Point = { x: number; y: number }

export type FurnitureType =
  | 'bed'
  | 'desk'
  | 'chair'
  | 'sofa'
  | 'table'
  | 'wardrobe'
  | 'bookshelf'
  | 'dresser'
  | 'nightstand'
  | 'shower'
  | 'bathtub'
  | 'sink'
  | 'toilet'
  | 'shoeCabinet'

export type GoalId = 'sleep' | 'study' | 'living' | 'storage' | 'open'

export type Room = {
  height: number
  outline: Point[]
}

export type Opening = {
  id: string
  kind: 'door' | 'window'
  edge: number
  offset: number
  width: number
  sill: number
  height: number
}

export type Furniture = {
  id: string
  type: FurnitureType
  width: number
  depth: number
  height: number
}

export type Scene = {
  room: Room
  openings: Opening[]
  furniture: Furniture[]
}

export type Rect = {
  x: number
  y: number
  w: number
  d: number
}

export type Placed = Rect & {
  id: string
  type: FurnitureType
  h: number
  rotation: number
  nominalWidth: number
  nominalDepth: number
}

export type LayoutResult = {
  goal: GoalId
  ok: boolean
  message: string
  placed: Placed[]
  openAreaCm2: number
  openRect: Rect | null
}

export const GOALS: GoalId[] = ['sleep', 'study', 'living', 'storage', 'open']

export const ROTATIONS = [0, 90, 180, 270] as const

export const FURNITURE_LABEL: Record<FurnitureType, string> = {
  bed: '침대',
  desk: '책상',
  chair: '의자',
  sofa: '소파',
  table: '테이블',
  wardrobe: '옷장',
  bookshelf: '책장',
  dresser: '서랍장',
  nightstand: '협탁',
  shower: '샤워기',
  bathtub: '욕조',
  sink: '세면대',
  toilet: '변기',
  shoeCabinet: '신발장',
}

export const FURNITURE_SUBJECT: Record<FurnitureType, string> = {
  bed: '침대가',
  desk: '책상이',
  chair: '의자가',
  sofa: '소파가',
  table: '테이블이',
  wardrobe: '옷장이',
  bookshelf: '책장이',
  dresser: '서랍장이',
  nightstand: '협탁이',
  shower: '샤워기가',
  bathtub: '욕조가',
  sink: '세면대가',
  toilet: '변기가',
  shoeCabinet: '신발장이',
}

export const FURNITURE_OBJECT: Record<FurnitureType, string> = {
  bed: '침대를',
  desk: '책상을',
  chair: '의자를',
  sofa: '소파를',
  table: '테이블을',
  wardrobe: '옷장을',
  bookshelf: '책장을',
  dresser: '서랍장을',
  nightstand: '협탁을',
  shower: '샤워기를',
  bathtub: '욕조를',
  sink: '세면대를',
  toilet: '변기를',
  shoeCabinet: '신발장을',
}

export const GOAL_LABEL: Record<GoalId, string> = {
  sleep: '수면',
  study: '공부',
  living: '거실',
  storage: '수납',
  open: '가장 넓은 공간',
}

export const WALL_LABEL: Record<Wall, string> = {
  north: '북쪽',
  south: '남쪽',
  east: '동쪽',
  west: '서쪽',
}

export const FURNITURE_TYPES: FurnitureType[] = [
  'bed',
  'desk',
  'chair',
  'sofa',
  'table',
  'wardrobe',
  'bookshelf',
  'dresser',
  'nightstand',
  'shower',
  'bathtub',
  'sink',
  'toilet',
  'shoeCabinet',
]

export const DEFAULT_SIZE: Record<FurnitureType, Pick<Furniture, 'width' | 'depth' | 'height'>> = {
  bed: { width: 160, depth: 200, height: 50 },
  desk: { width: 120, depth: 60, height: 74 },
  chair: { width: 50, depth: 50, height: 90 },
  sofa: { width: 200, depth: 90, height: 80 },
  table: { width: 100, depth: 60, height: 40 },
  wardrobe: { width: 100, depth: 60, height: 200 },
  bookshelf: { width: 80, depth: 35, height: 180 },
  dresser: { width: 80, depth: 45, height: 80 },
  nightstand: { width: 40, depth: 40, height: 50 },
  shower: { width: 90, depth: 90, height: 200 },
  bathtub: { width: 160, depth: 75, height: 55 },
  sink: { width: 60, depth: 45, height: 85 },
  toilet: { width: 40, depth: 70, height: 78 },
  shoeCabinet: { width: 100, depth: 35, height: 110 },
}

export const WALLS: Wall[] = ['north', 'south', 'east', 'west']

const OPPOSITE: Record<Wall, Wall> = {
  north: 'south',
  south: 'north',
  east: 'west',
  west: 'east',
}

export function oppositeWall(wall: Wall): Wall {
  return OPPOSITE[wall]
}

let seq = 0

export function uid(prefix: string): string {
  seq += 1
  return `${prefix}-${Date.now().toString(36)}-${seq}`
}
