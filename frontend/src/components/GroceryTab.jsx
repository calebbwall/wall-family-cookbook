import { useState, useEffect, useCallback } from 'react'
import { CAT_META } from '../hooks/useGrocery'
import { showToast, formatQty } from '../utils'

export default function GroceryTab({ grocery, onClose }) {
  const {
    groceryState, allRecipes, computed, mergedItems, mergeStatus,
    runMerge, addRecipes, removeRecipe, changeServings, toggleCheck,
    addManualItem, removeManualItem, addToPantry, clearPantry, clearAll,
    recipeCount,
  } = grocery

  const [pickerOpen, setPickerOpen] = useState(false)
  const [manualOpen, setManualOpen] = useState(false)

  // Run AI merge when computed list changes
  useEffect(() => {
    if (Object.keys(computed).length > 0) {
      runMerge()
    }
  }, [computed, runMerge])

  // Decide which items to render: merged or unmerged
  const displayItems = mergedItems && mergeStatus === 'done' ? buildMergedGroups(mergedItems) : computed

  const handleExport = useCallback(() => {
    let text = '🛒 Grocery List\n\n'
    for (const [cat, items] of Object.entries(displayItems)) {
      const meta = CAT_META[cat] || CAT_META.other
      text += `${meta.icon} ${meta.label}\n`
      for (const item of items) {
        const checked = (groceryState.checked || []).includes(item.key)
        const qty = formatQty(item.quantity)
        text += `  ${checked ? '✅' : '☐'} ${qty} ${item.unit || ''} ${item.name}\n`
      }
      text += '\n'
    }
    navigator.clipboard.writeText(text).then(() => showToast('Copied to clipboard!'))
  }, [displayItems, groceryState.checked])

  return (
    <div className="grocery-tab">
      {/* Header */}
      <div className="grocery-header">
        <div className="grocery-header-top">
          <h2 className="grocery-title">
            🛒 Grocery List
            {mergeStatus === 'done' && <span style={{ fontSize: '0.75rem', marginLeft: '0.75rem', color: 'var(--green, #2a7d2a)', fontWeight: 600 }}>✓ AI-merged</span>}
            {mergeStatus === 'loading' && <span style={{ fontSize: '0.75rem', marginLeft: '0.75rem', color: 'var(--muted)', fontWeight: 600 }}>⏳ Merging…</span>}
            {mergeStatus === 'error' && <span style={{ fontSize: '0.75rem', marginLeft: '0.75rem', color: 'var(--muted)', fontWeight: 600 }}>Smart merge unavailable</span>}
          </h2>
          <button className="grocery-close-btn" onClick={onClose}>✕</button>
        </div>
        <div className="grocery-header-actions">
          <button className="grocery-btn" onClick={() => setPickerOpen(true)}>+ Add Recipes</button>
          <button className="grocery-btn grocery-btn-outline" onClick={() => setManualOpen(true)}>+ Manual Item</button>
          <button className="grocery-btn grocery-btn-outline" onClick={handleExport}>📋 Copy List</button>
          <button className="grocery-btn grocery-btn-danger" onClick={clearAll}>🗑 Clear All</button>
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

      {/* Grocery list */}
      <div id="grocery-list">
        {Object.keys(displayItems).length === 0 ? (
          <div className="grocery-empty" style={{ textAlign: 'center', padding: '3rem', color: 'var(--muted)' }}>
            <div style={{ fontSize: '3rem', marginBottom: '0.5rem', opacity: 0.3 }}>🛒</div>
            <p style={{ fontFamily: 'Playfair Display, serif', fontSize: '1.2rem', marginBottom: '0.3rem' }}>Your grocery list is empty</p>
            <p style={{ fontSize: '0.85rem' }}>Add recipes to build your shopping list</p>
          </div>
        ) : (
          Object.entries(displayItems).map(([cat, items]) => {
            const meta = CAT_META[cat] || CAT_META.other
            return (
              <details key={cat} className="grocery-category" open>
                <summary>
                  <span className="grocery-cat-icon">{meta.icon}</span>
                  <span>{meta.label}</span>
                  <span className="grocery-cat-count">{items.length} item{items.length !== 1 ? 's' : ''}</span>
                </summary>
                <div className="grocery-items">
                  {items.map(item => {
                    const isChecked = (groceryState.checked || []).includes(item.key)
                    return (
                      <div key={item.key} className={`grocery-item${isChecked ? ' grocery-item-checked' : ''}${item.locked ? ' grocery-item-locked' : ''}${item.pantryReduced ? ' grocery-item-pantry' : ''}`}>
                        <input type="checkbox" className="grocery-check" checked={isChecked} onChange={e => toggleCheck(item.key, e.target.checked)} />
                        <span className="grocery-item-qty">{formatQty(item.quantity)}</span>
                        <span className="grocery-item-unit">{item.unit !== 'count' ? item.unit : ''}</span>
                        <span className="grocery-item-name">
                          {item.name}
                          {item.locked && ' 🔒'}
                          {item.pantryReduced && ' 🏠'}
                        </span>
                        <span className="grocery-item-sources" title={item.sources?.join(', ') || ''}>
                          {(item.sources?.length || 0) > 1 ? `${item.sources.length} recipes` : (item.isManual ? 'Manual' : (item.sources?.[0] || ''))}
                        </span>
                        <div className="grocery-item-actions">
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

      {/* Pantry section */}
      <PantrySection pantry={groceryState.pantry || {}} onClear={clearPantry} />

      {/* Recipe Picker Modal */}
      {pickerOpen && (
        <RecipePickerModal
          allRecipes={allRecipes}
          existingRecipes={groceryState.recipes || []}
          onApply={async (selected) => {
            const added = await addRecipes(selected)
            if (added > 0) showToast(`Added ${added} recipe${added > 1 ? 's' : ''}!`)
            setPickerOpen(false)
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}

      {/* Manual Item Modal */}
      {manualOpen && (
        <ManualItemModal
          onAdd={async (item) => {
            await addManualItem(item)
            showToast('Item added!')
            setManualOpen(false)
          }}
          onClose={() => setManualOpen(false)}
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
      name: item.name,
      normName: (item.name || '').toLowerCase(),
      quantity: item.quantity,
      unit: item.unit,
      category: cat,
      sources: item.sources || [],
      locked: false,
      pantryReduced: false,
      isManual: false,
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
  const existingIds = new Set(existingRecipes.map(r => r.cardId))

  const toggle = (cardId) => {
    setSelected(prev => {
      const next = { ...prev }
      if (next[cardId]) delete next[cardId]
      else next[cardId] = true
      return next
    })
  }

  const handleApply = () => {
    const toAdd = []
    for (const r of allRecipes) {
      if (selected[r.cardId]) {
        const servings = parseInt(r.servings) || 1
        toAdd.push({ cardId: r.cardId, title: r.title, servings, baseServings: servings })
      }
    }
    onApply(toAdd)
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 550, background: 'rgba(42,26,14,0.72)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      <div className="modal-box" onClick={e => e.stopPropagation()} style={{ maxHeight: '80vh', overflow: 'auto' }}>
        <button className="modal-close" onClick={onClose}>✕</button>
        <h2 className="modal-title">Add Recipes to Grocery List</h2>
        <p className="modal-sub">Select recipes to add their ingredients to your shopping list.</p>

        {allRecipes.map(r => {
          const already = existingIds.has(r.cardId)
          return (
            <div key={r.cardId} style={{ display: 'flex', alignItems: 'center', gap: '0.7rem', padding: '0.6rem 0', borderBottom: '1px solid var(--tan)' }}>
              <input
                type="checkbox"
                checked={already || !!selected[r.cardId]}
                disabled={already}
                onChange={() => toggle(r.cardId)}
                style={{ accentColor: 'var(--red)' }}
              />
              <span style={{ flex: 1, fontWeight: already ? 400 : 600, opacity: already ? 0.5 : 1 }}>
                {r.title}
              </span>
              {already && <span style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>Already added</span>}
            </div>
          )
        })}

        <button className="modal-submit" onClick={handleApply} disabled={Object.keys(selected).length === 0}>
          Add Selected Recipes
        </button>
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
