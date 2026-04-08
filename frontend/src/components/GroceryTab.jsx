import { useState, useEffect, useCallback, useMemo } from 'react'
import { CAT_META } from '../hooks/useGrocery'
import { showToast, formatQty } from '../utils'

const PICKER_CAT_LABELS = {
  appetizer: 'Appetizers', entree: 'Entrees', side: 'Sides',
  snack: 'Snacks', breakfast: 'Breakfast', dessert: 'Desserts',
}

export default function GroceryTab({ grocery, onClose }) {
  const {
    groceryState, allRecipes, computed, mergedItems, mergeStatus,
    runMerge, addRecipes, removeRecipe, changeServings, toggleCheck,
    addManualItem, removeManualItem, addToPantry, clearPantry, clearAll,
    lockItem, unlockItem, editManualItem,
    recipeCount, loading, error, reload,
  } = grocery

  const [pickerOpen, setPickerOpen] = useState(false)
  const [manualOpen, setManualOpen] = useState(false)
  const [editingItem, setEditingItem] = useState(null)

  useEffect(() => {
    if (Object.keys(computed).length > 0) runMerge()
  }, [computed, runMerge])

  const displayItems = mergedItems && mergeStatus === 'done' ? buildMergedGroups(mergedItems) : computed

  const handleExport = useCallback(() => {
    let text = '🛒 Grocery List\n\n'
    for (const [cat, items] of Object.entries(displayItems)) {
      const meta = CAT_META[cat] || CAT_META.other
      text += `${meta.icon} ${meta.label}\n`
      for (const item of items) {
        const checked = (groceryState.checked || []).includes(item.key)
        text += `  ${checked ? '✅' : '☐'} ${formatQty(item.quantity)} ${item.unit || ''} ${item.name}\n`
      }
      text += '\n'
    }
    navigator.clipboard.writeText(text).then(() => showToast('Copied to clipboard!'))
  }, [displayItems, groceryState.checked])

  const handlePickerApply = useCallback(async (selected) => {
    const added = await addRecipes(selected)
    if (added > 0) {
      // Track recent recipes
      try {
        const recent = JSON.parse(localStorage.getItem('wfc_recent_grocery') || '[]')
        const newRecent = [...new Set([...selected.map(s => s.cardId), ...recent])].slice(0, 10)
        localStorage.setItem('wfc_recent_grocery', JSON.stringify(newRecent))
      } catch {}
      showToast(`Added ${added} recipe${added > 1 ? 's' : ''}!`)
    }
    setPickerOpen(false)
  }, [addRecipes])

  return (
    <div className="grocery-tab">
      {/* Header */}
      <div className="grocery-header">
        <div className="grocery-header-top">
          <h2 className="grocery-title">
            🛒 Grocery List
            {mergeStatus === 'done' && <span style={{ fontSize: '0.75rem', marginLeft: '0.75rem', color: 'var(--green, #2a7d2a)', fontWeight: 600 }}>✓ AI-merged</span>}
            {mergeStatus === 'loading' && <span style={{ fontSize: '0.75rem', marginLeft: '0.75rem', color: 'var(--muted)', fontWeight: 600 }}>⏳ Merging…</span>}
          </h2>
          <button className="grocery-back-btn" onClick={onClose}>← Recipes</button>
        </div>
        <div className="grocery-header-actions">
          <button className="grocery-btn" onClick={() => setPickerOpen(true)}>+ Add Recipes</button>
          <button className="grocery-btn grocery-btn-outline" onClick={() => setManualOpen(true)}>+ Manual Item</button>
          <button className="grocery-btn grocery-btn-outline" onClick={handleExport}>📋 Copy List</button>
          <button className="grocery-btn grocery-btn-danger" onClick={() => { if (window.confirm('Clear entire grocery list? This cannot be undone.')) clearAll() }}>Clear All</button>
        </div>
      </div>

      {/* Active recipes strip */}
      <div id="grocery-recipes" style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
        {(groceryState.recipes || []).map(sr => (
          <div key={sr.cardId} className="grocery-recipe-chip">
            <span>{sr.title}</span>
            <span className="grocery-recipe-chip-servings">
              <button onClick={() => changeServings(sr.cardId, -1)}>−</button>
              <span>{sr.servings}</span>
              <button onClick={() => changeServings(sr.cardId, 1)}>+</button>
            </span>
            <button className="grocery-recipe-chip-remove" onClick={() => removeRecipe(sr.cardId)} title="Remove">×</button>
          </div>
        ))}
      </div>

      {loading && <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--muted)' }}>Loading grocery data…</div>}
      {error && (
        <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--red)' }}>
          <p>{error}</p>
          <button className="grocery-btn" onClick={reload} style={{ marginTop: '0.5rem' }}>Retry</button>
        </div>
      )}

      {/* Grocery list — checked items sorted to bottom */}
      <div id="grocery-list">
        {!loading && !error && Object.keys(displayItems).length === 0 ? (
          <div className="grocery-empty" style={{ textAlign: 'center', padding: '3rem', color: 'var(--muted)' }}>
            <div style={{ fontSize: '3rem', marginBottom: '0.5rem', opacity: 0.3 }}>🛒</div>
            <p style={{ fontFamily: 'Playfair Display, serif', fontSize: '1.2rem', marginBottom: '0.3rem' }}>Your grocery list is empty</p>
            <p style={{ fontSize: '0.85rem' }}>Add recipes to build your shopping list</p>
          </div>
        ) : (
          Object.entries(displayItems).map(([cat, items]) => {
            const meta = CAT_META[cat] || CAT_META.other
            const sorted = [...items].sort((a, b) => {
              const aChk = (groceryState.checked || []).includes(a.key) ? 1 : 0
              const bChk = (groceryState.checked || []).includes(b.key) ? 1 : 0
              return aChk - bChk || a.name.localeCompare(b.name)
            })
            return (
              <details key={cat} className="grocery-category" open>
                <summary>
                  <span className="grocery-cat-icon">{meta.icon}</span>
                  <span>{meta.label}</span>
                  <span className="grocery-cat-count">{items.length} item{items.length !== 1 ? 's' : ''}</span>
                </summary>
                <div className="grocery-items">
                  {sorted.map(item => {
                    const isChecked = (groceryState.checked || []).includes(item.key)
                    return (
                      <div key={item.key} className={`grocery-item${isChecked ? ' grocery-item-checked' : ''}${item.locked ? ' grocery-item-locked' : ''}${item.pantryReduced ? ' grocery-item-pantry' : ''}`}>
                        <input type="checkbox" className="grocery-check" checked={isChecked} onChange={e => toggleCheck(item.key, e.target.checked)} />
                        <span className="grocery-item-qty">{formatQty(item.quantity)}</span>
                        <span className="grocery-item-unit">{item.unit !== 'count' ? item.unit : ''}</span>
                        <span className="grocery-item-name" onClick={() => setEditingItem(item)} style={{ cursor: 'pointer' }}>
                          {item.name}
                          {item.locked && ' 🔒'}
                          {item.pantryReduced && ' 🏠'}
                        </span>
                        <span className="grocery-item-sources" title={item.sources?.join(', ') || ''}>
                          {(item.sources?.length || 0) > 1 ? `${item.sources.length} recipes` : (item.isManual ? 'Manual' : (item.sources?.[0] || ''))}
                        </span>
                        <div className="grocery-item-actions">
                          <button className="grocery-item-action-btn" onClick={() => setEditingItem(item)} title="Edit">✏️</button>
                          <button className="grocery-item-action-btn" onClick={() => addToPantry(item.normName, item.quantity, item.unit)} title="I have this">🏠</button>
                          {item.isManual && <button className="grocery-item-action-btn" onClick={() => removeManualItem(item.key)} title="Remove">🗑</button>}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </details>
            )
          })
        )}
      </div>

      <PantrySection pantry={groceryState.pantry || {}} onClear={clearPantry} />

      {pickerOpen && (
        <RecipePickerModal
          allRecipes={allRecipes}
          existingRecipes={groceryState.recipes || []}
          onApply={handlePickerApply}
          onClose={() => setPickerOpen(false)}
        />
      )}

      {manualOpen && (
        <ManualItemModal
          onAdd={async (item) => { await addManualItem(item); showToast('Item added!'); setManualOpen(false) }}
          onClose={() => setManualOpen(false)}
        />
      )}

      {editingItem && (
        <EditItemModal
          item={editingItem}
          onSave={async (updates) => {
            if (editingItem.isManual) {
              const id = editingItem.key.replace('manual-', '')
              await editManualItem(id, updates)
            } else {
              await lockItem(editingItem.key, updates.quantity, updates.unit)
            }
            showToast('Item updated')
            setEditingItem(null)
          }}
          onUnlock={async () => { await unlockItem(editingItem.key); showToast('Reset to recipe amount'); setEditingItem(null) }}
          onClose={() => setEditingItem(null)}
        />
      )}
    </div>
  )
}

function buildMergedGroups(mergedItems) {
  const grouped = {}
  for (const item of mergedItems) {
    const cat = item.category || 'other'
    if (!grouped[cat]) grouped[cat] = []
    grouped[cat].push({
      key: (item.name || '').toLowerCase().replace(/\s+/g, '-') + '|' + (item.unit || ''),
      name: item.name, normName: (item.name || '').toLowerCase(),
      quantity: item.quantity, unit: item.unit, category: cat,
      sources: item.sources || [], locked: false, pantryReduced: false, isManual: false,
    })
  }
  const sortedCats = Object.keys(grouped).sort((a, b) => ((CAT_META[a]?.order ?? 99) - (CAT_META[b]?.order ?? 99)))
  const result = {}
  for (const cat of sortedCats) result[cat] = grouped[cat].sort((a, b) => a.name.localeCompare(b.name))
  return result
}

function PantrySection({ pantry, onClear }) {
  const keys = Object.keys(pantry)
  if (keys.length === 0) return null
  return (
    <div style={{ marginTop: '2rem', padding: '1rem', background: 'var(--white)', borderRadius: 10, border: '1px solid var(--tan)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
        <h3 style={{ fontFamily: 'Playfair Display, serif', fontSize: '1.1rem', color: 'var(--dark)' }}>🏠 Pantry</h3>
        <button onClick={onClear} style={{ background: 'none', border: '1px solid var(--tan-dark)', padding: '0.3rem 0.7rem', borderRadius: 4, cursor: 'pointer', fontSize: '0.78rem', color: 'var(--muted)' }}>Clear Pantry</button>
      </div>
      {keys.map(key => (
        <div key={key} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.3rem 0', borderBottom: '1px solid var(--tan)', fontSize: '0.85rem' }}>
          <span>{key}</span>
          <span style={{ color: 'var(--muted)' }}>{pantry[key].quantity} {pantry[key].unit}</span>
        </div>
      ))}
    </div>
  )
}

function RecipePickerModal({ allRecipes, existingRecipes, onApply, onClose }) {
  const [selected, setSelected] = useState({})
  const [search, setSearch] = useState('')
  const [catFilter, setCatFilter] = useState('')
  const [authorFilter, setAuthorFilter] = useState('')
  const existingIds = new Set(existingRecipes.map(r => r.cardId))

  const categories = useMemo(() => [...new Set(allRecipes.map(r => r.category).filter(Boolean))].sort(), [allRecipes])
  const authors = useMemo(() => [...new Set(allRecipes.map(r => r.author).filter(Boolean))].sort(), [allRecipes])
  const recentIds = useMemo(() => { try { return JSON.parse(localStorage.getItem('wfc_recent_grocery') || '[]') } catch { return [] } }, [])

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return allRecipes.filter(r => {
      if (catFilter && r.category !== catFilter) return false
      if (authorFilter && r.author !== authorFilter) return false
      if (q && !(r.title || '').toLowerCase().includes(q) && !(r.author || '').toLowerCase().includes(q)) return false
      return true
    })
  }, [allRecipes, search, catFilter, authorFilter])

  const recentRecipes = useMemo(() => {
    if (recentIds.length === 0) return []
    return recentIds.map(id => allRecipes.find(r => r.cardId === id)).filter(Boolean).filter(r => !existingIds.has(r.cardId)).slice(0, 5)
  }, [recentIds, allRecipes, existingIds])

  const toggle = (cardId) => setSelected(prev => {
    const next = { ...prev }; if (next[cardId]) delete next[cardId]; else next[cardId] = true; return next
  })

  const handleApply = () => {
    const toAdd = allRecipes.filter(r => selected[r.cardId]).map(r => ({
      cardId: r.cardId, title: r.title, servings: parseInt(r.servings) || 1, baseServings: parseInt(r.servings) || 1,
    }))
    onApply(toAdd)
  }

  const selectAllVisible = () => {
    const next = { ...selected }
    for (const r of filtered) { if (!existingIds.has(r.cardId)) next[r.cardId] = true }
    setSelected(next)
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 550, background: 'rgba(42,26,14,0.72)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      <div className="modal-box" onClick={e => e.stopPropagation()} style={{ maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
        <button className="modal-close" onClick={onClose}>✕</button>
        <h2 className="modal-title" style={{ marginBottom: '0.5rem' }}>Add Recipes to Grocery List</h2>

        {/* Search */}
        <input type="text" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search recipes…" style={{ marginBottom: '0.5rem' }} />

        {/* Category filter pills */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem', marginBottom: '0.5rem' }}>
          <button onClick={() => setCatFilter('')}
            className={`recipe-picker-filter-btn${!catFilter ? ' active' : ''}`}>All</button>
          {categories.map(c => (
            <button key={c} onClick={() => setCatFilter(catFilter === c ? '' : c)}
              className={`recipe-picker-filter-btn${catFilter === c ? ' active' : ''}`}>
              {PICKER_CAT_LABELS[c] || c}
            </button>
          ))}
        </div>

        {/* Author filter */}
        {authors.length > 1 && (
          <select value={authorFilter} onChange={e => setAuthorFilter(e.target.value)}
            style={{ marginBottom: '0.75rem', fontSize: '0.82rem', padding: '0.35rem 0.5rem', borderRadius: 8, border: '1px solid var(--tan-dark)' }}>
            <option value="">All authors</option>
            {authors.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        )}

        {/* Recipe list (scrollable) */}
        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
          {/* Recently used */}
          {recentRecipes.length > 0 && !search && !catFilter && !authorFilter && (
            <div style={{ marginBottom: '0.75rem', padding: '0.5rem', background: 'var(--red-faint, #fdf0f0)', borderRadius: 8 }}>
              <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--red)', marginBottom: '0.35rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Recently Used</div>
              {recentRecipes.map(r => (
                <div key={r.cardId} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.3rem 0' }}>
                  <input type="checkbox" checked={!!selected[r.cardId]} onChange={() => toggle(r.cardId)} style={{ accentColor: 'var(--red)' }} />
                  <span style={{ flex: 1, fontSize: '0.85rem' }}>{r.title}</span>
                  {r.author && <span style={{ fontSize: '0.7rem', color: 'var(--muted)', fontStyle: 'italic' }}>by {r.author}</span>}
                </div>
              ))}
            </div>
          )}

          {filtered.map(r => {
            const already = existingIds.has(r.cardId)
            return (
              <div key={r.cardId} style={{ display: 'flex', alignItems: 'center', gap: '0.7rem', padding: '0.6rem 0', borderBottom: '1px solid var(--tan)' }}>
                <input type="checkbox" checked={already || !!selected[r.cardId]} disabled={already}
                  onChange={() => toggle(r.cardId)} style={{ accentColor: 'var(--red)' }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: already ? 400 : 600, opacity: already ? 0.5 : 1, fontSize: '0.92rem' }}>{r.title}</div>
                  {r.author && <div style={{ fontSize: '0.72rem', color: 'var(--muted)', fontStyle: 'italic' }}>by {r.author}</div>}
                </div>
                {already && <span style={{ fontSize: '0.72rem', color: 'var(--muted)', whiteSpace: 'nowrap' }}>Added</span>}
              </div>
            )
          })}

          {filtered.length === 0 && <p style={{ textAlign: 'center', color: 'var(--muted)', padding: '2rem 0' }}>No recipes match your filters</p>}
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid var(--tan)' }}>
          <button className="modal-submit" onClick={handleApply} disabled={Object.keys(selected).length === 0} style={{ flex: 1 }}>
            Add {Object.keys(selected).length || ''} Selected
          </button>
          <button onClick={selectAllVisible} style={{ background: 'none', border: '1px solid var(--tan-dark)', borderRadius: 8, padding: '0.5rem 0.75rem', cursor: 'pointer', fontSize: '0.78rem', color: 'var(--muted)' }}>
            Select All
          </button>
        </div>
      </div>
    </div>
  )
}

function EditItemModal({ item, onSave, onUnlock, onClose }) {
  const [qty, setQty] = useState(String(item.quantity))
  const [unit, setUnit] = useState(item.unit || 'count')
  const [name, setName] = useState(item.name)

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 560, background: 'rgba(42,26,14,0.72)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      <div className="modal-box" onClick={e => e.stopPropagation()} style={{ maxWidth: 380 }}>
        <button className="modal-close" onClick={onClose}>✕</button>
        <h2 className="modal-title" style={{ fontSize: '1.3rem' }}>Edit Item</h2>

        <label className="modal-label">Item</label>
        {item.isManual ? (
          <input type="text" value={name} onChange={e => setName(e.target.value)} />
        ) : (
          <div style={{ padding: '0.5rem', background: 'var(--cream, #faf6f0)', borderRadius: 6, fontSize: '0.9rem', color: 'var(--dark)', marginBottom: '0.5rem' }}>{item.name}</div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
          <div>
            <label className="modal-label">Quantity</label>
            <input type="text" value={qty} onChange={e => setQty(e.target.value)} />
          </div>
          <div>
            <label className="modal-label">Unit</label>
            <select value={unit} onChange={e => setUnit(e.target.value)}>
              <option value="count">Count</option>
              <option value="tsp">tsp</option>
              <option value="tbsp">tbsp</option>
              <option value="cup">cups</option>
              <option value="oz">oz</option>
              <option value="lb">lbs</option>
              <option value="g">g</option>
              <option value="ml">ml</option>
              <option value="can">cans</option>
              <option value="bag">bags</option>
              <option value="bottle">bottles</option>
              <option value="box">boxes</option>
              <option value="bunch">bunch</option>
              <option value="clove">cloves</option>
            </select>
          </div>
        </div>

        <button className="modal-submit" onClick={() => onSave({ quantity: parseFloat(qty) || 0, unit, name })} style={{ marginTop: '0.75rem' }}>
          Save Changes
        </button>

        {item.locked && !item.isManual && (
          <button onClick={onUnlock} style={{ display: 'block', width: '100%', marginTop: '0.5rem', background: 'none', border: '1px solid var(--tan-dark)', borderRadius: 8, padding: '0.5rem', cursor: 'pointer', fontSize: '0.82rem', color: 'var(--muted)' }}>
            Reset to recipe amount
          </button>
        )}
      </div>
    </div>
  )
}

function ManualItemModal({ onAdd, onClose }) {
  const [name, setName] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [unit, setUnit] = useState('count')
  const [category, setCategory] = useState('other')

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 550, background: 'rgba(42,26,14,0.72)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      <div className="modal-box" onClick={e => e.stopPropagation()} style={{ maxWidth: 420 }}>
        <button className="modal-close" onClick={onClose}>✕</button>
        <h2 className="modal-title">Add Manual Item</h2>

        <label className="modal-label">Item Name</label>
        <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Paper towels" />

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
          <div>
            <label className="modal-label">Quantity</label>
            <input type="text" value={quantity} onChange={e => setQuantity(e.target.value)} />
          </div>
          <div>
            <label className="modal-label">Unit</label>
            <select value={unit} onChange={e => setUnit(e.target.value)}>
              <option value="count">Count</option>
              <option value="lbs">lbs</option>
              <option value="oz">oz</option>
              <option value="cups">cups</option>
              <option value="bags">bags</option>
              <option value="bottles">bottles</option>
              <option value="cans">cans</option>
              <option value="boxes">boxes</option>
            </select>
          </div>
        </div>

        <label className="modal-label">Category</label>
        <select value={category} onChange={e => setCategory(e.target.value)}>
          {Object.entries(CAT_META).map(([k, v]) => (
            <option key={k} value={k}>{v.icon} {v.label}</option>
          ))}
        </select>

        <button className="modal-submit" onClick={() => onAdd({ name, quantity: parseFloat(quantity) || 1, unit, category })} disabled={!name.trim()}>
          Add Item
        </button>
      </div>
    </div>
  )
}
