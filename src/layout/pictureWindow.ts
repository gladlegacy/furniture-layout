import type { Scene } from '../types.ts'
import { getEdge } from './polygon.ts'

type Span = { offset: number; width: number; sill: number; height: number }
type Block = { offset: number; width: number }
type Gap = { from: number; to: number }

const EDGE = 12
const CLEAR = 8

export function toggleSceneWindow(scene: Scene, id: string): Scene {
  return {
    ...scene,
    openings: scene.openings.map((opening) => {
      if (opening.id !== id || opening.kind !== 'window') return opening
      const edge = getEdge(scene.room.outline, opening.edge)
      if (!edge) return opening
      const blocked = scene.openings.filter((item) => item.edge === opening.edge && item.id !== opening.id)
      return { ...opening, ...nextWindowSize(opening, edge.length, scene.room.height, blocked) }
    }),
  }
}

export function nextWindowSize(current: Span, length: number, ceiling: number, blocked: Block[]): Span {
  const gap = chooseGap(length, blocked, current.offset + current.width / 2)
  if (!gap) {
    if (isPicture(current, ceiling, null)) return ordinary(current, length, ceiling)
    return { ...fit(current.offset, current.width, length), sill: 0, height: ceiling }
  }
  const span = gap.to - gap.from
  if (isPicture(current, ceiling, gap)) return ordinary({ ...current, offset: gap.from, width: span }, span + gap.from, ceiling)
  return { offset: Math.round(gap.from), width: Math.round(span), sill: 0, height: ceiling }
}

export function isPictureWindow(current: Span, length: number, ceiling: number, blocked: Block[]): boolean {
  return isPicture(current, ceiling, chooseGap(length, blocked, current.offset + current.width / 2))
}

function isPicture(current: Span, ceiling: number, gap: Gap | null): boolean {
  if (current.sill > 2 || current.height < ceiling - 2) return false
  if (!gap) return true
  return Math.abs(current.offset - gap.from) <= 2 && Math.abs(current.width - (gap.to - gap.from)) <= 2
}

function ordinary(current: Span, limit: number, ceiling: number): Span {
  const width = Math.min(140, Math.max(80, current.width - 24))
  const room = Math.max(width, limit)
  const offset = Math.max(0, Math.min(current.offset + (current.width - width) / 2, room - width))
  const height = Math.min(110, Math.max(40, ceiling - 90))
  return { offset: Math.round(offset), width: Math.round(width), sill: 90, height }
}

function fit(offset: number, width: number, length: number): { offset: number; width: number } {
  const nextWidth = Math.max(60, Math.min(width, length))
  return { offset: Math.round(Math.max(0, Math.min(offset, length - nextWidth))), width: Math.round(nextWidth) }
}

function chooseGap(length: number, blocked: Block[], center: number): Gap | null {
  const gaps = freeGaps(length, blocked)
  return gaps.find((gap) => center >= gap.from - 1 && center <= gap.to + 1) ?? gaps.sort((left, right) => right.to - right.from - (left.to - left.from))[0] ?? null
}

function freeGaps(length: number, blocked: Block[]): Gap[] {
  const cuts = blocked
    .map((item) => ({ from: Math.max(0, item.offset - CLEAR), to: Math.min(length, item.offset + item.width + CLEAR) }))
    .filter((item) => item.to - item.from > 1)
    .sort((left, right) => left.from - right.from)
  const merged: Gap[] = []
  for (const cut of cuts) {
    const last = merged[merged.length - 1]
    if (last && cut.from <= last.to) last.to = Math.max(last.to, cut.to)
    else merged.push({ ...cut })
  }
  const end = Math.max(EDGE, length - EDGE)
  const gaps: Gap[] = []
  let cursor = EDGE
  for (const cut of merged) {
    if (cut.from > cursor + 1) gaps.push({ from: cursor, to: Math.min(cut.from, end) })
    cursor = Math.max(cursor, cut.to)
  }
  if (end > cursor + 1) gaps.push({ from: cursor, to: end })
  return gaps.filter((gap) => gap.to - gap.from >= 60)
}
