import { useEffect, useMemo, useState } from 'react'
import { Editor } from './components/Editor.tsx'
import { StartScreen } from './components/StartScreen.tsx'
import { FloorPlan2D, type ShapeTool } from './components/FloorPlan2D.tsx'
import { useHistory } from './components/useHistory.ts'
import { RoomScene3D } from './components/RoomScene3D.tsx'
import { UnitWorkspace } from './components/UnitWorkspace.tsx'
import { addInventory, loadInventory, renameInventory, writeInventory, type InventoryEntry } from './inventory.ts'
import { validate } from './layout/generate.ts'
import { turnPlaced } from './layout/geometry.ts'
import { largestEmpty } from './layout/openArea.ts'
import { toggleSceneWindow } from './layout/pictureWindow.ts'
import { buildLayouts, choiceNote, type RoomFocus, type RoomFurnishing, type ShownLayout } from './layout/roomLayouts.ts'
import { deleteOutlineVertex, insertOutlinePoint, moveOutlineVertex } from './layout/shapeEdit.ts'
import { copyScene, createSample } from './sample.ts'
import type { Scene } from './types.ts'
import { GOAL_LABEL, uid } from './types.ts'

function sceneKey(scene: Scene): string {
  return JSON.stringify(scene)
}

const M2_PER_PYEONG = 3.305785

function formatArea(areaCm2: number): string {
  const squareMeters = areaCm2 / 10000
  const pyeong = squareMeters / M2_PER_PYEONG
  return `${squareMeters.toFixed(1)}㎡ · ${pyeong.toFixed(1)}평`
}

type WorkMode = 'furniture' | 'unit'

type PlanSnap = {
  draft: Scene
  scene: Scene
  pinned: ShownLayout[] | null
  layoutId: string
  focus: RoomFocus
}

export default function App() {
  const [mode, setMode] = useState<WorkMode | null>(null)
  const [draft, setDraft] = useState(createSample)
  const [scene, setScene] = useState(createSample)
  const [focus, setFocus] = useState<RoomFocus>('general')
  const [furnishKey, setFurnishKey] = useState<string | null>(null)
  const [furnishings, setFurnishings] = useState<Record<string, RoomFurnishing>>({})
  const [layoutId, setLayoutId] = useState('sleep')
  const [resetKey, setResetKey] = useState(0)
  const [tool, setTool] = useState<ShapeTool | null>(null)
  const [pinned, setPinned] = useState<ShownLayout[] | null>(null)
  const [entries, setEntries] = useState<InventoryEntry[]>(() => loadInventory())
  const history = useHistory<PlanSnap>()
  history.track({ draft, scene, pinned, layoutId, focus })
  const layouts = useMemo(() => buildLayouts(scene, focus), [scene, focus])
  const shown = pinned ?? layouts
  const activeLayout = shown.find((item) => item.id === layoutId) ?? shown[0] ?? null
  const problem = validate(draft)
  const dirty = sceneKey(draft) !== sceneKey(scene)
  const sameOutline = JSON.stringify(draft.room.outline) === JSON.stringify(scene.room.outline)

  const persist = (next: InventoryEntry[]) => {
    setEntries(next)
    writeInventory(next)
  }

  const openRoom = (next: Scene, nextFocus: RoomFocus = 'general', key: string | null = null) => {
    const saved = key ? furnishings[key] : undefined
    const base = saved ? { ...copyScene(saved.scene), room: next.room, openings: next.openings } : next
    setMode('furniture')
    setDraft(copyScene(base))
    setScene(copyScene(base))
    setPinned(saved?.pinned ? structuredClone(saved.pinned) : null)
    setFocus(saved?.focus ?? nextFocus)
    setLayoutId(saved?.layoutId ?? buildLayouts(base, saved?.focus ?? nextFocus)[0]?.id ?? 'open')
    setFurnishKey(key)
    setTool(null)
    history.clear()
  }

  useEffect(() => {
    if (!furnishKey || mode !== 'furniture') return
    const source = pinned ?? layouts
    const current = source.find((item) => item.id === layoutId) ?? source[0]
    setFurnishings((prev) => ({
      ...prev,
      [furnishKey]: {
        scene: copyScene(scene),
        focus,
        layoutId: current?.id ?? layoutId,
        pinned: structuredClone(source),
        placed: structuredClone(current?.result.placed ?? []),
      },
    }))
  }, [furnishKey, mode, scene, focus, layoutId, pinned, layouts])

  const restorePlan = (snap: PlanSnap) => {
    setDraft(snap.draft)
    setScene(snap.scene)
    setPinned(snap.pinned)
    setLayoutId(snap.layoutId)
    setFocus(snap.focus)
  }

  const undoPlan = () => {
    const snap = history.undo()
    if (snap) restorePlan(snap)
  }

  const redoPlan = () => {
    const snap = history.redo()
    if (snap) restorePlan(snap)
  }

  useEffect(() => {
    if (mode !== 'furniture') return
    const onKey = (event: KeyboardEvent) => {
      const target = event.target
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return
      if (!event.ctrlKey && !event.metaKey) return
      if (event.key.toLowerCase() === 'z' && !event.shiftKey) {
        event.preventDefault()
        undoPlan()
      } else if (event.key.toLowerCase() === 'y' || (event.key.toLowerCase() === 'z' && event.shiftKey)) {
        event.preventDefault()
        redoPlan()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [history, mode])

  const patchLayout = (id: string, placed: ShownLayout['result']['placed']) => {
    history.mark()
    setPinned(shown.map((item) => {
      if (item.id !== id) return item
      const open = largestEmpty(scene.room, placed)
      return { ...item, result: { ...item.result, placed, openAreaCm2: open.area, openRect: open.rect } }
    }))
  }

  return (
    <div className="app">
      <header className="site-nav">
        {mode && (
          <button type="button" className="home-back" onClick={() => setMode(null)}>시작 화면</button>
        )}
        <div className="brand">
          <svg className="brand-mark" viewBox="0 0 28 28" aria-hidden="true">
            <rect x="1.5" y="1.5" width="25" height="25" rx="6" fill="none" stroke="#3a4452" strokeWidth="1.4" />
            <path d="M8 20.5V8.5H20.5" fill="none" stroke="#3a4452" strokeWidth="1.4" />
            <circle cx="8" cy="20.5" r="1.7" fill="#5c7cfa" />
          </svg>
          <span className="brand-name">가구배치</span>
        </div>
        {mode && (
          <nav className="site-links" aria-label="작업 모드">
            <button type="button" className={mode === 'furniture' ? 'on' : undefined} onClick={() => setMode('furniture')}>가구 배치</button>
            <button type="button" className={mode === 'unit' ? 'on' : undefined} onClick={() => setMode('unit')}>평면 시안</button>
          </nav>
        )}
      </header>
      {mode === null ? (
        <StartScreen onChoose={setMode} />
      ) : (
        <>
      <p className="page-lead">
        {mode === 'furniture'
          ? '배치안을 만든 뒤 평면도에서 가구와 문, 창문을 끌어 옮기고, 가구의 90° 단추로 방향을 바꿀 수 있습니다.'
          : '배치 시안에서 칸을 클릭하면 그 방을 고릅니다. 칸은 끌어 옮기고, 변과 모서리로 가로·세로를 바꿉니다.'}
      </p>
      <div style={{ display: mode === 'furniture' ? undefined : 'none' }}>
        <div className="workspace split">
          <Editor
            scene={draft}
            problem={problem}
            dirty={dirty}
            tool={tool}
            onTool={setTool}
            onChange={setDraft}
            onGenerate={() => {
              history.mark()
              setScene(copyScene(draft))
              setPinned(null)
            }}
            onReset={() => {
              history.mark()
              const sample = createSample()
              setDraft(sample)
              setScene(copyScene(sample))
              setFocus('general')
              setLayoutId('sleep')
              setPinned(null)
              setFurnishKey(null)
              setTool(null)
            }}
            entries={entries}
            layouts={shown.map((item) => ({
              id: item.id,
              label: item.label,
              detail: item.result.ok ? formatArea(item.result.openAreaCm2) : '배치 불가',
              note: choiceNote(item.choice, item.result.placed.map((piece) => piece.type), item.result.message),
              selected: item.id === activeLayout?.id,
            }))}
            onSelectLayout={setLayoutId}
            onSaveInventory={(name) => {
              const count = entries.filter((entry) => entry.kind === 'furniture').length + 1
              persist(addInventory(entries, {
                id: uid('layout'),
                name: name || `가구 배치 ${count}`,
                createdAt: Date.now(),
                kind: 'furniture',
                scene: copyScene(scene),
                goal: activeLayout?.result.goal ?? 'open',
                results: shown.map((item) => item.result),
                focus,
                layoutId: activeLayout?.id ?? layoutId,
                picks: shown.map((item) => ({
                  id: item.id,
                  label: item.label,
                  goal: item.choice.goal,
                  types: item.choice.types,
                  result: item.result,
                })),
              }))
            }}
            onLoadInventory={(entry) => {
              if (entry.kind !== 'furniture') return
              setFurnishKey(null)
              setDraft(copyScene(entry.scene))
              setScene(copyScene(entry.scene))
              setTool(null)
              if (entry.picks && entry.picks.length > 0) {
                setFocus(entry.focus ?? 'general')
                setLayoutId(entry.layoutId ?? entry.picks[0]!.id)
                setPinned(entry.picks.map((pick) => ({
                  id: pick.id,
                  label: pick.label,
                  choice: { id: pick.id, label: pick.label, goal: pick.goal, types: pick.types },
                  result: pick.result,
                })))
                return
              }
              setFocus('general')
              setLayoutId(entry.goal)
              setPinned(entry.results.map((result) => ({
                id: result.goal,
                label: GOAL_LABEL[result.goal],
                choice: { id: result.goal, label: GOAL_LABEL[result.goal], goal: result.goal, types: null },
                result,
              })))
            }}
            onRenameInventory={(id, name) => persist(renameInventory(entries, id, name))}
            onDeleteInventory={(id) => persist(entries.filter((entry) => entry.id !== id))}
          />
          <main className="stage">
            <div className="views">
              <RoomScene3D
                room={scene.room}
                openings={scene.openings}
                placed={activeLayout?.result.ok ? activeLayout.result.placed : []}
                resetKey={resetKey}
                onReset={() => setResetKey((value) => value + 1)}
              />
              <FloorPlan2D
                room={draft.room}
                openings={draft.openings}
                layout={sameOutline ? activeLayout?.result ?? null : null}
                tool={tool}
                onUndo={undoPlan}
                onRedo={redoPlan}
                canUndo={history.canUndo}
                canRedo={history.canRedo}
                onInsert={(point) => {
                  history.mark()
                  setDraft(insertOutlinePoint(draft, point))
                }}
                onMoveVertex={(index, point) => {
                  history.mark()
                  setDraft((current) => moveOutlineVertex(current, index, point))
                }}
                onDeleteVertex={(index) => {
                  history.mark()
                  setDraft(deleteOutlineVertex(draft, index))
                }}
                onMoveFurniture={(id, x, y) => {
                  const current = activeLayout?.result.placed ?? []
                  patchLayout(activeLayout?.id ?? layoutId, current.map((item) => (item.id === id ? { ...item, x, y } : item)))
                }}
                onResizeFurniture={(id, next) => {
                  const current = activeLayout?.result.placed ?? []
                  patchLayout(activeLayout?.id ?? layoutId, current.map((item) => (item.id === id ? { ...item, ...next } : item)))
                }}
                onRotateFurniture={(id) => {
                  const current = activeLayout?.result.placed ?? []
                  patchLayout(activeLayout?.id ?? layoutId, current.map((item) => (item.id === id ? turnPlaced(item) : item)))
                }}
                onPictureWindow={(id) => {
                  history.mark()
                  const apply = (current: Scene) => toggleSceneWindow(current, id)
                  setDraft(apply)
                  setScene(apply)
                }}
                onMoveOpening={(id, edge, offset) => {
                  history.mark()
                  const apply = (current: Scene) => (
                    current.openings.some((opening) => opening.id === id)
                      ? { ...current, openings: current.openings.map((opening) => (opening.id === id ? { ...opening, edge, offset } : opening)) }
                      : current
                  )
                  setDraft(apply)
                  setScene(apply)
                }}
              />
            </div>
          </main>
        </div>
      </div>
      <div style={{ display: mode === 'unit' ? undefined : 'none' }}>
        <UnitWorkspace entries={entries} onEntries={persist} onOpenRoom={openRoom} furnishings={furnishings} live={mode === 'unit'} />
      </div>
        </>
      )}
      <footer className="site-footer">
        <p>서울과학기술대학교 건축학부 건축공학전공</p>
        <p>박효준 김현호 강다원</p>
        <p>
          문의 이메일 <a href="mailto:rfk9851@gmail.com">rfk9851@gmail.com</a>
        </p>
      </footer>
    </div>
  )
}
