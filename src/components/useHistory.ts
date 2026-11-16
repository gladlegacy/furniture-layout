import { useCallback, useRef, useState } from 'react'

const LIMIT = 40
const BURST = 200

export function useHistory<T>() {
  const present = useRef<T | null>(null)
  const undoStack = useRef<T[]>([])
  const redoStack = useRef<T[]>([])
  const last = useRef(0)
  const [, setRev] = useState(0)
  const bump = () => setRev((value) => value + 1)
  const mark = useCallback(() => {
    const current = present.current
    if (current == null) return
    const now = Date.now()
    if (now - last.current < BURST && undoStack.current.length > 0) {
      last.current = now
      return
    }
    undoStack.current.push(structuredClone(current))
    if (undoStack.current.length > LIMIT) undoStack.current.shift()
    redoStack.current = []
    last.current = now
    bump()
  }, [])
  const undo = useCallback((): T | null => {
    const current = present.current
    const prev = undoStack.current.pop()
    if (!prev || current == null) return null
    redoStack.current.push(structuredClone(current))
    last.current = 0
    bump()
    return prev
  }, [])
  const redo = useCallback((): T | null => {
    const current = present.current
    const next = redoStack.current.pop()
    if (!next || current == null) return null
    undoStack.current.push(structuredClone(current))
    last.current = 0
    bump()
    return next
  }, [])
  const clear = useCallback(() => {
    if (undoStack.current.length === 0 && redoStack.current.length === 0) return
    undoStack.current = []
    redoStack.current = []
    last.current = 0
    bump()
  }, [])

  return {
    track(value: T) {
      present.current = value
    },
    mark,
    undo,
    redo,
    clear,
    canUndo: undoStack.current.length > 0,
    canRedo: redoStack.current.length > 0,
  }
}
