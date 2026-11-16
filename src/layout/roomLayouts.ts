import type { Furniture, FurnitureType, GoalId, LayoutResult, Placed, Scene } from '../types.ts'
import { FURNITURE_LABEL, GOAL_LABEL, GOALS } from '../types.ts'
import { solve } from './generate.ts'
import type { UnitRoomKind } from './unitPlan.ts'

export type RoomFocus = 'general' | UnitRoomKind

export type LayoutChoice = {
  id: string
  label: string
  goal: GoalId
  types: FurnitureType[] | null
}

export type ShownLayout = {
  id: string
  label: string
  choice: LayoutChoice
  result: LayoutResult
}

export type RoomFurnishing = {
  scene: Scene
  focus: RoomFocus
  layoutId: string
  pinned: ShownLayout[] | null
  placed: Placed[]
}

const STORAGE: FurnitureType[] = ['wardrobe', 'bookshelf', 'dresser', 'shoeCabinet']

function has(furniture: Furniture[], type: FurnitureType): boolean {
  return furniture.some((item) => item.type === type)
}

function present(furniture: Furniture[], types: FurnitureType[]): FurnitureType[] {
  return types.filter((type) => has(furniture, type))
}

function dedupe(choices: LayoutChoice[]): LayoutChoice[] {
  const seen = new Set<string>()
  const out: LayoutChoice[] = []
  for (const choice of choices) {
    const key = `${choice.goal}:${choice.types === null ? '*' : [...choice.types].sort().join(',')}`
    if (seen.has(key) || (choice.types !== null && choice.types.length === 0 && choice.id !== 'entry-open' && choice.id !== 'kitchen-open')) continue
    seen.add(key)
    out.push(choice)
  }
  return out
}

function fitting(furniture: Furniture[]): LayoutChoice[] {
  const choices: LayoutChoice[] = []
  if (has(furniture, 'bed')) choices.push({ id: 'sleep', label: GOAL_LABEL.sleep, goal: 'sleep', types: null })
  if (has(furniture, 'desk')) choices.push({ id: 'study', label: GOAL_LABEL.study, goal: 'study', types: null })
  if (has(furniture, 'sofa')) choices.push({ id: 'living', label: GOAL_LABEL.living, goal: 'living', types: null })
  if (furniture.some((item) => STORAGE.includes(item.type))) choices.push({ id: 'storage', label: GOAL_LABEL.storage, goal: 'storage', types: null })
  choices.push({ id: 'open', label: GOAL_LABEL.open, goal: 'open', types: null })
  return dedupe(choices)
}

export function layoutChoices(focus: RoomFocus, furniture: Furniture[]): LayoutChoice[] {
  if (focus === 'general') return GOALS.map((id) => ({ id, label: GOAL_LABEL[id], goal: id, types: null }))
  if (focus === 'bathroom') {
    const choices = dedupe([
      { id: 'bath-all', label: '기본', goal: 'open' as const, types: present(furniture, ['toilet', 'sink', 'shower', 'bathtub']) },
      { id: 'bath-shower', label: '샤워', goal: 'open' as const, types: present(furniture, ['shower', 'sink', 'toilet']) },
      { id: 'bath-tub', label: '욕조', goal: 'open' as const, types: present(furniture, ['bathtub', 'sink', 'toilet']) },
      { id: 'bath-wash', label: '세면', goal: 'open' as const, types: present(furniture, ['sink', 'toilet']) },
    ])
    return choices.length > 0 ? choices : fitting(furniture)
  }
  if (focus === 'entrance') {
    const shoes = present(furniture, ['shoeCabinet'])
    const choices: LayoutChoice[] = []
    if (shoes.length > 0) choices.push({ id: 'entry-shoes', label: '신발장', goal: 'storage', types: shoes })
    choices.push({ id: 'entry-open', label: '통행', goal: 'open', types: [] })
    return choices
  }
  if (focus === 'kitchen') {
    const dining = present(furniture, ['table', 'chair'])
    const choices: LayoutChoice[] = []
    if (dining.length > 0) choices.push({ id: 'kitchen-table', label: '식탁', goal: 'open', types: dining })
    choices.push({ id: 'kitchen-open', label: '통행', goal: 'open', types: [] })
    return choices
  }
  if (focus === 'living') {
    const choices = fitting(furniture)
    if (has(furniture, 'sofa') && has(furniture, 'table')) {
      choices.splice(1, 0, { id: 'dining', label: '식탁', goal: 'open', types: present(furniture, ['table', 'chair']) })
    }
    return dedupe(choices)
  }
  if (focus === 'bedroom' || focus === 'dress' || focus === 'utility') return fitting(furniture)
  return fitting(furniture)
}

export function sceneForChoice(scene: Scene, choice: LayoutChoice): Scene {
  if (choice.types === null) return scene
  const allow = new Set(choice.types)
  return { ...scene, furniture: scene.furniture.filter((item) => allow.has(item.type)) }
}

export function choiceNote(choice: LayoutChoice, placed: FurnitureType[], fallback: string): string {
  if (choice.types === null) return fallback
  if (placed.length === 0) return '가구를 두지 않고 통행을 남겼습니다.'
  return placed.map((type) => FURNITURE_LABEL[type]).join(' · ')
}

export function buildLayouts(scene: Scene, focus: RoomFocus): ShownLayout[] {
  return layoutChoices(focus, scene.furniture).map((choice) => ({
    id: choice.id,
    label: choice.label,
    choice,
    result: solve(choice.goal, sceneForChoice(scene, choice)),
  }))
}
