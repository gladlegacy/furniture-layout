import { beside, blocksWindow, doorQuads, furnitureAnchor, furnitureQuad, isValid, makePlaced, resizePlaced, turnPlaced } from './geometry.ts'
import { nextWindowSize } from './pictureWindow.ts'
import { buildLayouts, sceneForChoice } from './roomLayouts.ts'
import { generateAll, solve, validate } from './generate.ts'
import { measureRoom } from './dimensions.ts'
import { addRoomDoor, addRoomDoorAt, addUnitSpace, attachToWall, blankJoinPlan, closeSharedWall, doorSwingPoints, generateUnitPlans, moveRoom, neighborOnSegment, neighborsAcrossDoor, openDoorway, openSharedWall, passageSpans, removeRoomDoor, removeRoomDoorAt, resizeJoinedRoom, resizeRoomBox, roomDoors, roomFits, sceneFromUnitRoom, settleRoom, splitLivingKitchen, wallLinks, type UnitRoom } from './unitPlan.ts'
import { largestEmpty } from './openArea.ts'
import { rectangleOutline, slideOpening } from './polygon.ts'
import { createSample } from '../sample.ts'
import { backEdge } from './geometry.ts'
import type { Scene } from '../types.ts'
import { quadsOverlap } from './polygon.ts'

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

const box = { height: 250, outline: rectangleOutline(400, 350) }
const empty = largestEmpty(box, [])
assert(empty.area === 140000, `빈 방 면적 ${empty.area}`)

const corner = largestEmpty(box, [{ x: 0, y: 0, w: 160, d: 200 }])
assert(corner.area === 84000, `구석 침대 빈 면적 ${corner.area}`)

const sample = createSample()
const started = performance.now()
const results = generateAll(sample)
const elapsed = Math.round(performance.now() - started)
console.log(`sample ${elapsed}ms`)

for (const result of results) {
  console.log(result.goal, result.ok, (result.openAreaCm2 / 10000).toFixed(2), result.message)
  assert(result.ok, `${result.goal} 실패: ${result.message}`)
  assert(result.placed.length === sample.furniture.length, `${result.goal} 가구 수 ${result.placed.length}`)
  for (let i = 0; i < result.placed.length; i++) {
    for (let j = i + 1; j < result.placed.length; j++) {
      assert(!quadsOverlap(furnitureQuad(result.placed[i]!), furnitureQuad(result.placed[j]!)), `${result.goal} 겹침`)
    }
  }
  const doors = doorQuads(sample.room, sample.openings)
  for (const item of result.placed) {
    for (const door of doors) assert(!quadsOverlap(furnitureQuad(item), door), `${result.goal} 문 여유 침범 ${item.type}`)
    const windows = sample.openings.filter((opening) => opening.kind === 'window')
    assert(!blocksWindow(item, sample.room, windows), `${result.goal} 창문 가림 ${item.type}`)
  }
}

const open = results.find((result) => result.goal === 'open')!
for (const result of results) {
  assert(open.openAreaCm2 + 1 >= result.openAreaCm2, `가장 넓은 공간 ${open.openAreaCm2} < ${result.goal} ${result.openAreaCm2}`)
}

const sleep = results.find((result) => result.goal === 'sleep')!
const bed = sleep.placed.find((item) => item.type === 'bed')!
assert(backEdge(bed, sample.room) !== null, '수면 침대 머리맡')

const study = results.find((result) => result.goal === 'study')!
const desk = study.placed.find((item) => item.type === 'desk')!
const chair = study.placed.find((item) => item.type === 'chair')!
assert(beside(desk, chair, 30), '공부 의자')

const tall: Scene = createSample()
tall.furniture = tall.furniture.map((item) => (item.type === 'wardrobe' ? { ...item, height: 300 } : item))
const tallResults = generateAll(tall)
assert(tallResults.every((result) => !result.ok && result.message.includes('층고')), tallResults[0]?.message ?? '층고 검사 실패')

const huge: Scene = createSample()
huge.furniture = huge.furniture.map((item) => (item.type === 'bed' ? { ...item, width: 500, depth: 500 } : item))
const hugeResults = generateAll(huge)
assert(hugeResults.every((result) => !result.ok && result.message.includes('방보다')), hugeResults[0]?.message ?? '크기 검사 실패')

const living = createSample()
living.furniture = [
  ...living.furniture,
  { id: 'sofa-1', type: 'sofa', width: 180, depth: 80, height: 78 },
  { id: 'table-1', type: 'table', width: 80, depth: 45, height: 40 },
  { id: 'night-1', type: 'nightstand', width: 40, depth: 40, height: 48 },
]
const livingResults = generateAll(living)
const livingGoal = livingResults.find((result) => result.goal === 'living')!
console.log('living', livingGoal.ok, livingGoal.message)
assert(livingGoal.ok, livingGoal.message)
const sofa = livingGoal.placed.find((item) => item.type === 'sofa')!
const table = livingGoal.placed.find((item) => item.type === 'table')!
assert(backEdge(sofa, living.room) !== null, '소파 등')
assert(beside(sofa, table, 40), '테이블 앞')
const night = livingResults.find((result) => result.goal === 'sleep')!
const sleepBed = night.placed.find((item) => item.type === 'bed')!
const stand = night.placed.find((item) => item.type === 'nightstand')!
assert(beside(sleepBed, stand, 16), '협탁')

const bowtie = validate({
  room: {
    height: 250,
    outline: [
      { x: 0, y: 0 },
      { x: 300, y: 200 },
      { x: 0, y: 200 },
      { x: 300, y: 0 },
    ],
  },
  openings: [],
  furniture: [],
})
assert(Boolean(bowtie?.includes('교차')), bowtie ?? '교차 검사 실패')

const lRoom = {
  height: 250,
  outline: [
    { x: 0, y: 0 },
    { x: 300, y: 0 },
    { x: 300, y: 150 },
    { x: 150, y: 150 },
    { x: 150, y: 300 },
    { x: 0, y: 300 },
  ],
}
const outside = makePlaced({ id: 'out', type: 'nightstand', width: 80, depth: 80, height: 40 }, 200, 200, 0)
const inside = makePlaced({ id: 'in', type: 'nightstand', width: 80, depth: 80, height: 40 }, 10, 10, 0)
assert(!isValid(outside, lRoom, [], [], []), '윤곽 밖 가구')
assert(isValid(inside, lRoom, [], [], []), '윤곽 안 가구')

const unit = generateUnitPlans({ width: 1180, depth: 775, bedrooms: 2, bathrooms: 2, living: true, openKitchen: true, entrance: 'south' })
assert(unit.plans.length >= 3, unit.message || `시안 ${unit.plans.length}`)
for (const plan of unit.plans) {
  assert(plan.note.length > 0, plan.label)
  assert(plan.rooms.filter((room) => room.kind === 'bedroom').length === 2, `${plan.label} 방`)
  assert(plan.rooms.filter((room) => room.kind === 'bathroom').length === 2, `${plan.label} 화장실`)
  assert(plan.rooms.some((room) => room.kind === 'entrance' && room.y <= 0.5 && room.door?.wall === 'south'), `${plan.label} 현관`)
  assert(plan.rooms.some((room) => room.kind === 'living'), `${plan.label} 거실`)
  assert(plan.rooms.some((room) => room.kind === 'corridor'), `${plan.label} 복도`)
  const day = plan.rooms.find((room) => room.kind === 'kitchen') ?? plan.rooms.find((room) => room.name.includes('주방'))
  assert(day !== undefined, `${plan.label} 주방`)
  const living = plan.rooms.find((room) => room.kind === 'living')!
  const master = plan.rooms.find((room) => room.id === 'master')!
  for (const room of plan.rooms.filter((item) => item.kind === 'bedroom')) {
    assert(room.window !== null, `${plan.label} ${room.name} 창`)
    assert(room.w * room.d <= living.w * living.d, `${plan.label} 거실이 더 큼`)
    assert(room.w * room.d <= master.w * master.d, `${plan.label} 큰방`)
  }
  assert(living.window !== null, `${plan.label} 거실 창`)
  const covered = plan.rooms.reduce((sum, room) => sum + room.w * room.d, 0)
  assert(covered === 1180 * 775, `${plan.label} 면적 ${covered}`)
  for (let i = 0; i < plan.rooms.length; i++) {
    for (let j = i + 1; j < plan.rooms.length; j++) {
      const a = plan.rooms[i]!
      const b = plan.rooms[j]!
      const hit = a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.d - 0.5 && b.y < a.y + a.d - 0.5
      assert(!hit, `${plan.label} 겹침`)
    }
  }
}
const turned = generateUnitPlans({ width: 1180, depth: 775, bedrooms: 2, bathrooms: 2, living: true, openKitchen: true, entrance: 'east' })
const turnedEntrance = turned.plans[0]?.rooms.find((room) => room.kind === 'entrance')
assert(turnedEntrance !== undefined && turnedEntrance.x + turnedEntrance.w === 1180, '현관이 동쪽에 붙음')
assert(turnedEntrance?.door?.wall === 'east', '현관 문이 동쪽')
const scaled = generateUnitPlans({ width: 1200, depth: 900, bedrooms: 3, bathrooms: 1, living: true, openKitchen: true, entrance: 'south' })
assert(scaled.plans.length >= 2, scaled.message || '늘린 시안')
const scaledArea = scaled.plans[0]?.rooms.reduce((sum, room) => sum + room.w * room.d, 0) ?? 0
assert(scaledArea === 1200 * 900, `비율 면적 ${scaledArea}`)
assert(scaled.plans.every((plan) => plan.rooms.filter((room) => room.kind === 'bedroom').length === 3), '방 3개')
const tight = generateUnitPlans({ width: 400, depth: 400, bedrooms: 3, bathrooms: 2, living: true, openKitchen: true, entrance: 'south' })
assert(tight.plans.length === 0 && tight.message.length > 0, '좁은 외곽')
assert(unit.plans.length >= 4 && unit.plans.every((plan) => plan.rooms.some((room) => room.name === '거실·주방') && plan.rooms.every((room) => room.kind !== 'kitchen')), '모든 시안이 일체형')
const separated = generateUnitPlans({ width: 1180, depth: 775, bedrooms: 2, bathrooms: 2, living: true, openKitchen: false, entrance: 'south' })
assert(separated.plans.length >= 3 && separated.plans.every((plan) => plan.rooms.some((room) => room.kind === 'kitchen') && plan.rooms.every((room) => room.name !== '거실·주방')), '일체형 제외')
assert(unit.plans.map((plan) => plan.id).join() === separated.plans.map((plan) => plan.id).join(), '같은 배치 종류')
console.log('unit', unit.plans.map((plan) => plan.label).join(', '))

const triangle = measureRoom([
  { x: 0, y: 0 },
  { x: 400, y: 0 },
  { x: 0, y: 300 },
])
assert(triangle.triangle !== null, '삼각형')
assert(Math.abs(triangle.triangle!.base - 400) < 1, `밑변 ${triangle.triangle?.base}`)
assert(Math.abs(triangle.triangle!.height - 300) < 1, `높이 ${triangle.triangle?.height}`)
assert(triangle.edges.some((edge) => edge.diagonal && Math.abs(edge.run - 400) < 1 && Math.abs(edge.rise - 300) < 1), '대각 성분')
const bend = triangle.corners.find((corner) => corner.index === 1)
assert(bend !== undefined && Math.abs(bend.angle - 36.87) < 0.2, `꺽인 각도 ${bend?.angle}`)
assert(bend !== undefined && Math.abs(bend.lengthToPoint - 400) < 1, `점까지 ${bend?.lengthToPoint}`)
assert(!triangle.rectangle, '삼각형은 직사각형이 아님')
const spun = turnPlaced(makePlaced({ id: 'bed', type: 'bed', width: 160, depth: 200, height: 50 }, 10, 20, 0))
assert(spun.rotation === 90 && spun.w === 200 && spun.d === 160 && spun.x === -10 && spun.y === 40, `가구 회전 ${spun.rotation} ${spun.x},${spun.y} ${spun.w}×${spun.d}`)
const slid = slideOpening(rectangleOutline(400, 350), 90, { x: 220, y: 8 }, 40)
assert(slid?.edge === 0 && slid.offset === 180, `문 이동 ${slid?.edge} ${slid?.offset}`)
const sampleDims = measureRoom(rectangleOutline(400, 350))
assert(sampleDims.rectangle, '예시 방은 직사각형')
assert(sampleDims.triangle === null, '직사각형 높이')

const blank = blankJoinPlan()
assert(blank.rooms.length === 1 && blank.rooms[0]?.kind === 'entrance', '현관만 있는 시작')
const hall = attachToWall(blank.rooms, 'entrance', 'north', 40, 240, 130, 'corridor')
assert(hall !== null, '복도를 현관에 붙임')
const hallAgain = attachToWall(hall!.rooms, hall!.id, 'east', 10, 120, 200, 'corridor')
assert(hallAgain !== null && hallAgain.rooms.filter((room) => room.kind === 'corridor').length === 2, '복도를 이어서 두 개')
const roomAdded = attachToWall(hallAgain!.rooms, hall!.id, 'north', 20, 200, 280, 'bedroom')
assert(roomAdded !== null && roomAdded.rooms.some((room) => room.kind === 'bedroom'), '방을 복도에 붙임')
assert((roomAdded!.rooms.find((room) => room.kind === 'bedroom')?.door?.width ?? 0) >= 90, '방 문은 90cm 이상')
assert(attachToWall(roomAdded!.rooms, 'entrance', 'north', 0, 400, 400, 'living') === null, '겹치는 변에는 붙이지 않음')
assert(attachToWall(blank.rooms, 'entrance', 'north', 0, 70, 200, 'bedroom') === null, '문보다 짧은 변에는 붙이지 않음')
const named = attachToWall(blank.rooms, 'entrance', 'north', 0, 360, 420, 'bedroom', '큰 방')
assert(named?.rooms.some((room) => room.name === '큰 방') === true, '큰 방을 붙임')
const dayRoom = attachToWall(named!.rooms, named!.id, 'east', 0, 420, 400, 'living', '거실·주방')
assert(dayRoom?.rooms.some((room) => room.name === '거실·주방') === true, '거실·주방을 붙임')
const day = dayRoom!.rooms.find((room) => room.name === '거실·주방')!
const splitDay = splitLivingKitchen(dayRoom!.rooms, day.id)
assert(splitDay !== null, '거실·주방을 나눔')
assert(splitDay!.rooms.some((room) => room.kind === 'living' && room.name === '거실'), '나눈 뒤 거실')
assert(splitDay!.rooms.some((room) => room.kind === 'kitchen' && room.name === '주방'), '나눈 뒤 주방')
const splitLiving = splitDay!.rooms.find((room) => room.kind === 'living')!
const splitKitchen = splitDay!.rooms.find((room) => room.kind === 'kitchen')!
assert(splitLiving.w * splitLiving.d + splitKitchen.w * splitKitchen.d === day.w * day.d, '나눈 면적이 같음')
assert(splitLivingKitchen([{ ...day, w: 300, d: 300 }], day.id) === null, '작은 거실·주방은 나누지 않음')
const bath = attachToWall(named!.rooms, 'entrance', 'east', 0, 180, 220, 'bathroom', '화장실')
assert(bath?.rooms.some((room) => room.name === '화장실') === true, '화장실을 붙임')
const porch = attachToWall(hall!.rooms, hall!.id, 'east', 0, 140, 160, 'entrance')
assert(porch !== null && porch.rooms.filter((room) => room.kind === 'entrance').length === 2, '현관을 복도에 붙임')
const addedPorch = porch!.rooms.find((room) => room.kind === 'entrance' && room.id !== 'entrance')
assert(addedPorch?.door?.wall === 'east', '붙인 현관 문은 바깥쪽')
const grown = resizeJoinedRoom(hall!.rooms, hall!.id, 300, 150)
assert(grown?.find((room) => room.id === hall!.id)?.w === 300, '붙인 칸 크기 변경')
const corridor = hall!.rooms.find((room) => room.id === hall!.id)!
const wider = resizeRoomBox(hall!.rooms, corridor.id, corridor.x - 40, corridor.y, corridor.w + 40, corridor.d)
assert(wider?.find((room) => room.id === corridor.id)?.w === corridor.w + 40, '서쪽 변을 끌어 가로를 늘림')
assert(resizeRoomBox(hall!.rooms, corridor.id, 0, 0, corridor.w, corridor.d) === null, '다른 칸 위로 늘리지 않음')
assert(resizeJoinedRoom(hall!.rooms, hall!.id, 80, 150) === null, '너무 작은 칸은 바꾸지 않음')
const shifted = roomAdded!.rooms
assert(Math.min(...shifted.map((room) => room.x)) === 0 && Math.min(...shifted.map((room) => room.y)) === 0, '붙인 뒤 원점으로 맞춤')
const relocated = moveRoom(hall!.rooms, hall!.id, 900, 20)
assert(relocated !== null && relocated.some((room) => room.id === hall!.id && room.x > 400), '칸을 빈 곳으로 옮김')
assert(moveRoom(hall!.rooms, hall!.id, 0, 0) === null, '겹치는 자리로는 옮기지 않음')
const parked = settleRoom(hall!.rooms, hall!.id, 10, 10)
assert(parked !== null && roomFits(hall!.rooms, hall!.id, parked.x, parked.y), '겹치면 빈 변으로 붙임')

const joinedLiving: UnitRoom = { id: 'living', kind: 'living', name: '거실', x: 0, y: 0, w: 400, d: 300, door: { wall: 'east', offset: 80, width: 90 }, window: null }
const kitchen: UnitRoom = { id: 'kitchen', kind: 'kitchen', name: '주방', x: 400, y: 0, w: 250, d: 300, door: { wall: 'west', offset: 70, width: 90 }, window: { wall: 'east', offset: 40, width: 80, sill: 90, height: 110 } }
assert(neighborsAcrossDoor([joinedLiving, kitchen], joinedLiving).some((room) => room.id === 'kitchen'), '거실 문은 주방과 맞닿음')
const opened = openDoorway([joinedLiving, kitchen], [], joinedLiving.id)
assert(opened !== null && opened.passages.length === 1, '맞닿은 문을 없애면 통로가 생김')
assert(opened!.rooms.every((room) => room.door === null), '양쪽 연결 문이 사라짐')
assert(opened!.rooms.find((room) => room.id === 'kitchen')?.window !== null, '바깥 창문은 남음')
const span = passageSpans(opened!.rooms, opened!.passages)[0]
assert(span !== undefined && span.to - span.from === 300, '맞닿은 벽 전체가 열림')
const exterior: UnitRoom = { ...joinedLiving, door: { wall: 'south', offset: 40, width: 100 } }
assert(openDoorway([exterior, kitchen], [], exterior.id) === null, '밖을 향한 문은 공간을 잇지 않음')
const leaf = doorSwingPoints({ x: 0, y: 0, w: 400, d: 300 }, { wall: 'south', offset: 40, width: 90 })
assert(leaf.hinge.x === 40 && leaf.open.y === 90, '문은 시작 경첩에서 안쪽으로 열림')
const otherHinge = doorSwingPoints({ x: 0, y: 0, w: 400, d: 300 }, { wall: 'south', offset: 40, width: 90, hinge: 'end' })
assert(otherHinge.hinge.x === 130 && otherHinge.open.y === 90, '경첩을 끝으로 옮김')
const outward = doorSwingPoints({ x: 0, y: 0, w: 400, d: 300 }, { wall: 'south', offset: 40, width: 90, swing: 'out' })
assert(outward.open.y === -90, '문을 바깥으로 열음')
const addedDoor = addRoomDoor([joinedLiving, kitchen], [], joinedLiving.id)
assert(addedDoor !== null && roomDoors(addedDoor.find((room) => room.id === 'living')!).length === 2, '문을 하나 더 넣음')
const droppedDoor = removeRoomDoor(addedDoor!, 'living')
assert(droppedDoor !== null && roomDoors(droppedDoor.find((room) => room.id === 'living')!).length === 1, '추가한 문을 지움')
const atSouth = addRoomDoorAt([joinedLiving, kitchen], [], 'living', 'south', 200)
const southDoors = atSouth ? roomDoors(atSouth.find((room) => room.id === 'living')!) : []
assert(atSouth !== null && southDoors.length === 2 && southDoors.some((door) => door.wall === 'south' && Math.abs(door.offset + door.width / 2 - 200) <= 40), '우클릭한 자리에 문을 넣음')
const keptSouth = atSouth ? removeRoomDoorAt(atSouth, 'living', 0) : null
const keptDoor = keptSouth ? roomDoors(keptSouth.find((room) => room.id === 'living')!)[0] : null
assert(keptDoor?.wall === 'south', '우클릭한 첫 문만 지움')
assert(addRoomDoorAt([joinedLiving], [], 'living', 'east', 125) === null, '기존 문 위에는 문을 넣지 않음')
const addedSpace = addUnitSpace([joinedLiving, kitchen], 'bathroom', 700, 150)
const addedRoom = addedSpace?.rooms.find((room) => room.id === addedSpace.id)
const clearOfRooms = addedRoom !== undefined && addedSpace!.rooms.every((room) => room.id === addedRoom.id || room.x + room.w <= addedRoom.x + 0.5 || addedRoom.x + addedRoom.w <= room.x + 0.5 || room.y + room.d <= addedRoom.y + 0.5 || addedRoom.y + addedRoom.d <= room.y + 0.5)
assert(addedSpace !== null && addedRoom?.kind === 'bathroom' && addedRoom.name === '화장실' && clearOfRooms, '빈 자리에 화장실을 놓음')
assert(addUnitSpace([joinedLiving], 'bedroom', 200, 150) === null, '칸 안에는 공간을 새로 놓지 않음')
const closed = closeSharedWall(opened!.rooms, opened!.passages, 'living', 'kitchen')
assert(closed !== null && passageSpans(closed.rooms, closed.passages).length === 0, '없앤 벽을 다시 넣음')
const reopened = openSharedWall(closed!.rooms, closed!.passages, 'living', 'kitchen')
assert(reopened !== null && passageSpans(reopened.rooms, reopened.passages).length === 1, '맞닿은 벽을 없앰')
assert(wallLinks(reopened!.rooms, reopened!.passages, reopened!.rooms[0]!).some((link) => link.open), '열린 벽을 다시 표시')
const sized = makePlaced({ id: 'piece', type: 'bed', width: 100, depth: 40, height: 50 }, 0, 0, 0)
const stretched = resizePlaced(sized, furnitureAnchor(sized, -1, 0), 1, 0, { x: 150, y: 20 })
assert(stretched.nominalWidth === 150 && stretched.nominalDepth === 40 && stretched.x === 0 && stretched.w === 150, '가구 가로를 늘림')
const picture = nextWindowSize({ offset: 40, width: 120, sill: 90, height: 110 }, 400, 250, [])
assert(picture.sill === 0 && picture.height === 250 && picture.width >= 360, '창을 통창으로')
const plain = nextWindowSize(picture, 400, 250, [])
assert(plain.sill === 90 && plain.height === 110 && plain.width === 140, '통창을 일반 창으로')
const besideDoor = nextWindowSize({ offset: 220, width: 100, sill: 90, height: 110 }, 400, 250, [{ offset: 20, width: 90 }])
assert(besideDoor.sill === 0 && besideDoor.offset >= 110, '통창이 문을 피함')
const wallLeft: UnitRoom = { id: 'left', kind: 'bedroom', name: '방', x: 0, y: 0, w: 200, d: 200, door: null, window: null }
const wallRight: UnitRoom = { id: 'right', kind: 'living', name: '거실', x: 200, y: 0, w: 200, d: 200, door: null, window: null }
assert(neighborOnSegment([wallLeft, wallRight], wallLeft, { x1: 200, y1: 0, x2: 200, y2: 200 })?.id === 'right', '가리킨 벽의 옆 칸')
assert(neighborOnSegment([wallLeft, wallRight], wallLeft, { x1: 0, y1: 0, x2: 0, y2: 200 }) === null, '바깥 벽은 옆 칸이 없음')
const bedroom: UnitRoom = { id: 'bed', kind: 'bedroom', name: '큰방', x: 0, y: 0, w: 420, d: 360, door: { wall: 'south', offset: 40, width: 90 }, window: { wall: 'north', offset: 80, width: 140, sill: 90, height: 110 } }
const bedroomScene = sceneFromUnitRoom(bedroom)
assert(bedroomScene.furniture.some((item) => item.type === 'bed'), '큰방에 침대')
assert(bedroomScene.furniture.some((item) => item.type === 'wardrobe'), '큰방에 옷장')
assert(bedroomScene.furniture.some((item) => item.type === 'desk'), '넓은 방에 책상')
const sleepPlan = generateAll(bedroomScene).find((result) => result.goal === 'sleep')
assert(sleepPlan?.ok === true && (sleepPlan.placed.some((item) => item.type === 'bed') ?? false), '큰방 가구를 배치')
const kitchenScene = sceneFromUnitRoom({ id: 'kit', kind: 'kitchen', name: '주방', x: 0, y: 0, w: 280, d: 240, door: { wall: 'west', offset: 40, width: 80 }, window: null })
assert(kitchenScene.furniture.some((item) => item.type === 'table') && kitchenScene.furniture.some((item) => item.type === 'chair'), '주방에 식탁과 의자')
const bathScene = sceneFromUnitRoom({ id: 'bath', kind: 'bathroom', name: '화장실', x: 0, y: 0, w: 180, d: 250, door: { wall: 'south', offset: 40, width: 75 }, window: null })
assert(['toilet', 'sink', 'shower', 'bathtub'].every((type) => bathScene.furniture.some((item) => item.type === type)), '화장실 설비')
const bathLayout = generateAll(bathScene).find((result) => result.goal === 'open')
assert(bathLayout?.ok === true && bathLayout.placed.length === bathScene.furniture.length, '화장실 가구를 배치')
const bathChoices = buildLayouts(bathScene, 'bathroom')
assert(bathChoices.every((choice) => !['sleep', 'study', 'living'].includes(choice.id)), '화장실에는 수면 공부 거실이 없음')
assert(bathChoices.map((choice) => choice.label).join(',') === '기본,샤워,욕조,세면', '화장실 배치 목록')
const showerChoice = bathChoices.find((choice) => choice.label === '샤워')
const showerPlan = showerChoice ? solve(showerChoice.choice.goal, sceneForChoice(bathScene, showerChoice.choice)) : null
assert(showerPlan?.ok === true && showerPlan.placed.some((item) => item.type === 'shower') && !showerPlan.placed.some((item) => item.type === 'bathtub'), '샤워 배치에는 욕조가 없음')
const bedroomChoices = buildLayouts(bedroomScene, 'bedroom')
assert(bedroomChoices.some((choice) => choice.id === 'sleep') && bedroomChoices.some((choice) => choice.id === 'study') && !bedroomChoices.some((choice) => choice.id === 'living'), '큰방은 수면과 공부')
const entranceScene = sceneFromUnitRoom({ id: 'door', kind: 'entrance', name: '현관', x: 0, y: 0, w: 180, d: 220, door: { wall: 'south', offset: 40, width: 90 }, window: null })
assert(entranceScene.furniture.some((item) => item.type === 'shoeCabinet'), '현관에 신발장')
const entranceLayout = generateAll(entranceScene).find((result) => result.goal === 'storage')
assert(entranceLayout?.ok === true && entranceLayout.placed.some((item) => item.type === 'shoeCabinet'), '신발장을 배치')
console.log('selfCheck ok')
