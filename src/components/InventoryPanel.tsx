import { useRef, useState } from 'react'
import type { InventoryEntry } from '../inventory.ts'
import { Fold } from './Fold.tsx'

export function InventoryPanel({
  entries,
  layouts = [],
  onSelectLayout,
  onSave,
  onLoad,
  onDelete,
  onRename,
}: {
  entries: InventoryEntry[]
  layouts?: { id: string; label: string; detail: string; note: string; selected: boolean }[]
  onSelectLayout?: (id: string) => void
  onSave: (name: string) => void
  onLoad: (entry: InventoryEntry) => void
  onDelete: (id: string) => void
  onRename: (id: string, name: string) => void
}) {
  const [name, setName] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const skip = useRef(false)
  const editingId = useRef<string | null>(null)
  const draftName = useRef('')
  const commit = (entry: InventoryEntry) => {
    if (skip.current) {
      skip.current = false
      editingId.current = null
      setEditing(null)
      return
    }
    if (editingId.current !== entry.id) return
    onRename(entry.id, draftName.current.trim() || entry.name)
    editingId.current = null
    setEditing(null)
  }
  return (
    <div className="inventory">
      <Fold title="인벤토리">
        {layouts.length > 0 && (
          <div className="layout-picks" role="tablist" aria-label="배치안">
            {layouts.map((layout) => (
              <button
                key={layout.id}
                type="button"
                role="tab"
                aria-selected={layout.selected}
                className={layout.selected ? 'on' : undefined}
                onClick={() => onSelectLayout?.(layout.id)}
              >
                <strong>{layout.label}</strong>
                <span>{layout.detail}</span>
                {layout.note && <p>{layout.note}</p>}
              </button>
            ))}
          </div>
        )}
        <div className="add-furniture">
          <input
            value={name}
            placeholder="이름"
            aria-label="인벤토리 이름"
            onChange={(event) => setName(event.target.value)}
          />
          <button
            type="button"
            onClick={() => {
              onSave(name.trim())
              setName('')
            }}
          >
            저장
          </button>
        </div>
        {entries.length === 0 && <p className="hint">평면도를 저장하면 여기에 쌓입니다. 이름은 칸에서 바꿀 수 있습니다.</p>}
        {entries.map((entry) => (
          <article key={entry.id} className="block">
            <header>
              <input
                className="inventory-name"
                aria-label={`${entry.name} 이름`}
                value={editing === entry.id ? draft : entry.name}
                onFocus={() => {
                  editingId.current = entry.id
                  draftName.current = entry.name
                  setEditing(entry.id)
                  setDraft(entry.name)
                }}
                onChange={(event) => {
                  draftName.current = event.target.value
                  setDraft(event.target.value)
                }}
                onBlur={() => commit(entry)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.currentTarget.blur()
                  if (event.key === 'Escape') {
                    skip.current = true
                    setEditing(null)
                    event.currentTarget.blur()
                  }
                }}
              />
              <button type="button" className="text-button" onClick={() => onDelete(entry.id)}>삭제</button>
            </header>
            <p className="hint">{new Date(entry.createdAt).toLocaleString('ko-KR')}</p>
            <button type="button" onClick={() => onLoad(entry)}>불러오기</button>
          </article>
        ))}
      </Fold>
    </div>
  )
}
