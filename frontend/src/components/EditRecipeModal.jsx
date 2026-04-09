import { useState, useEffect, useCallback } from 'react'
import { useRecipes } from '../hooks/useRecipes'
import * as api from '../api'
import { showToast } from '../utils'

export default function EditRecipeModal({ cardId, onClose }) {
  const { editRecipe, deleteRecipe, reload } = useRecipes()
  const [tab, setTab] = useState('ai') // ai | direct | history | delete
  const [loading, setLoading] = useState(true)
  const [cardHtml, setCardHtml] = useState('')
  const [recipeJson, setRecipeJson] = useState(null)
  const [title, setTitle] = useState('')

  // AI edit
  const [aiInstructions, setAiInstructions] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiStatus, setAiStatus] = useState('')

  // Direct edit
  const [directFields, setDirectFields] = useState(null)

  // History
  const [versions, setVersions] = useState([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [restoringId, setRestoringId] = useState(null)

  // Delete
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    async function load() {
      try {
        const data = await api.getCardHtml(cardId)
        setCardHtml(data.card_html || '')
        if (data.recipe_json) {
          const rj = typeof data.recipe_json === 'string' ? JSON.parse(data.recipe_json) : data.recipe_json
          setRecipeJson(rj)
          setTitle(rj.title || 'Recipe')
          setDirectFields({ ...rj })
        } else {
          setTitle('Recipe')
        }
      } catch (e) {
        console.error('Failed to load recipe', e)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [cardId])

  // Load history when history tab is selected
  useEffect(() => {
    if (tab === 'history' && versions.length === 0 && !historyLoading) {
      setHistoryLoading(true)
      api.getRecipeHistory(cardId)
        .then(v => setVersions(v))
        .catch(e => console.error('Failed to load history', e))
        .finally(() => setHistoryLoading(false))
    }
  }, [tab, cardId, versions.length, historyLoading])

  const handleRestore = useCallback(async (versionId) => {
    setRestoringId(versionId)
    try {
      await api.restoreRecipeVersion(versionId)
      await reload()
      showToast('Recipe restored to previous version!')
      onClose()
    } catch (e) {
      showToast(`Error: ${e.message}`)
    } finally {
      setRestoringId(null)
    }
  }, [reload, onClose])

  const handleAiEdit = useCallback(async () => {
    if (!aiInstructions.trim()) return
    setAiLoading(true)
    setAiStatus('Updating recipe…')
    try {
      const result = await editRecipe({
        card_id: cardId,
        instructions: aiInstructions,
      })
      showToast('Recipe updated!')
      onClose()
    } catch (e) {
      setAiStatus(`Error: ${e.message}`)
    } finally {
      setAiLoading(false)
    }
  }, [cardId, aiInstructions, editRecipe, onClose])

  const handleDirectSave = useCallback(async () => {
    if (!directFields) return
    setAiLoading(true)
    setAiStatus('Saving…')
    try {
      await api.saveCardHtml({
        card_id: cardId,
        recipe_json: directFields,
      })
      await reload()
      showToast('Recipe updated!')
      onClose()
    } catch (e) {
      setAiStatus(`Error: ${e.message}`)
    } finally {
      setAiLoading(false)
    }
  }, [cardId, directFields, reload, onClose])

  const handleDelete = useCallback(async () => {
    if (!deleteConfirm) return
    setDeleting(true)
    try {
      await deleteRecipe(cardId)
      showToast('Recipe deleted')
      onClose()
    } catch (e) {
      showToast(`Error: ${e.message}`)
    } finally {
      setDeleting(false)
    }
  }, [cardId, deleteConfirm, deleteRecipe, onClose])

  const updateDirectField = useCallback((field, value) => {
    setDirectFields(prev => ({ ...prev, [field]: value }))
  }, [])

  const updateDirectIngredient = useCallback((idx, field, value) => {
    setDirectFields(prev => {
      const ings = [...(prev.ingredients || [])]
      ings[idx] = { ...ings[idx], [field]: value }
      return { ...prev, ingredients: ings }
    })
  }, [])

  const updateDirectStep = useCallback((idx, field, value) => {
    setDirectFields(prev => {
      const steps = [...(prev.steps || [])]
      steps[idx] = { ...steps[idx], [field]: value }
      return { ...prev, steps }
    })
  }, [])

  if (loading) return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 500, background: 'rgba(42,26,14,0.72)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="modal-box"><p style={{ textAlign: 'center', color: 'var(--muted)' }}>Loading…</p></div>
    </div>
  )

  return (
    <div className="modal-overlay" onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 500, background: 'rgba(42,26,14,0.72)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      <div className="modal-box modal-box--wide" onClick={e => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>✕</button>
        <h2 className="modal-title">Edit Recipe</h2>

        {/* Tabs */}
        <div className="composer-modes" style={{ marginBottom: '1.2rem' }}>
          {[
            { key: 'ai', label: '✨ AI Edit' },
            { key: 'direct', label: '✏️ Direct Edit' },
            { key: 'history', label: '📜 History' },
            { key: 'delete', label: '🗑️ Delete' },
          ].map(t => (
            <button key={t.key} className={`composer-mode${tab === t.key ? ' active' : ''}`} onClick={() => setTab(t.key)}>
              {t.label}
            </button>
          ))}
        </div>

        {/* AI Edit */}
        {tab === 'ai' && (
          <div>
            <p className="modal-sub">Describe what you'd like to change and AI will update the recipe.</p>
            <textarea
              value={aiInstructions}
              onChange={e => setAiInstructions(e.target.value)}
              placeholder='E.g., "Make it spicier", "Add a vegetarian option", "Fix the cooking time"…'
              style={{ minHeight: 120 }}
            />
            <button className="modal-submit" onClick={handleAiEdit} disabled={aiLoading || !aiInstructions.trim()}>
              {aiLoading ? 'Updating…' : 'Update with AI'}
            </button>
            {aiStatus && <p style={{ marginTop: '0.9rem', fontSize: '0.85rem', textAlign: 'center', fontStyle: 'italic', color: 'var(--muted)' }}>{aiStatus}</p>}
          </div>
        )}

        {/* Direct Edit */}
        {tab === 'direct' && directFields && (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr', gap: '0.75rem' }}>
              <div>
                <label className="modal-label">Emoji</label>
                <input type="text" value={directFields.emoji || ''} onChange={e => updateDirectField('emoji', e.target.value)} />
              </div>
              <div>
                <label className="modal-label">Title</label>
                <input type="text" value={directFields.title || ''} onChange={e => updateDirectField('title', e.target.value)} />
              </div>
            </div>

            <label className="modal-label">Subtitle</label>
            <input type="text" value={directFields.subtitle || ''} onChange={e => updateDirectField('subtitle', e.target.value)} />

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '0.5rem' }}>
              <div><label className="modal-label">Servings</label><input type="text" value={directFields.servings || ''} onChange={e => updateDirectField('servings', e.target.value)} /></div>
              <div><label className="modal-label">Prep</label><input type="text" value={directFields.prep_time || ''} onChange={e => updateDirectField('prep_time', e.target.value)} /></div>
              <div><label className="modal-label">Cook</label><input type="text" value={directFields.cook_time || ''} onChange={e => updateDirectField('cook_time', e.target.value)} /></div>
              <div><label className="modal-label">Temp</label><input type="text" value={directFields.temperature || ''} onChange={e => updateDirectField('temperature', e.target.value)} /></div>
            </div>

            <label className="modal-label">Ingredients</label>
            {(directFields.ingredients || []).map((ing, i) => (
              <div key={i} style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.4rem', alignItems: 'center' }}>
                <input type="text" value={ing.name || ''} onChange={e => updateDirectIngredient(i, 'name', e.target.value)} placeholder="Ingredient" style={{ flex: 2 }} />
                <input type="text" value={ing.amount || ''} onChange={e => updateDirectIngredient(i, 'amount', e.target.value)} placeholder="Amount" style={{ flex: 1 }} />
                <button type="button" onClick={() => setDirectFields(prev => ({ ...prev, ingredients: prev.ingredients.filter((_, j) => j !== i) }))} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: '1rem', cursor: 'pointer', padding: '0.2rem 0.4rem', flexShrink: 0 }} title="Remove">✕</button>
              </div>
            ))}
            <button type="button" onClick={() => setDirectFields(prev => ({ ...prev, ingredients: [...(prev.ingredients || []), { name: '', amount: '' }] }))} style={{ background: 'none', border: '1.5px dashed var(--tan-dark)', borderRadius: 6, padding: '0.35rem 0.85rem', color: 'var(--brown)', fontSize: '0.82rem', cursor: 'pointer', marginTop: '0.3rem' }}>+ Add Ingredient</button>

            <label className="modal-label" style={{ marginTop: '0.8rem' }}>Steps</label>
            {(directFields.steps || []).map((s, i) => (
              <div key={i} style={{ marginBottom: '0.5rem', position: 'relative' }}>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.3rem' }}>
                  <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--red)', minWidth: '1.5rem' }}>{i + 1}.</span>
                  <input type="text" value={s.title || ''} onChange={e => updateDirectStep(i, 'title', e.target.value)} placeholder="Step title" style={{ flex: 1 }} />
                  <button type="button" onClick={() => setDirectFields(prev => ({ ...prev, steps: prev.steps.filter((_, j) => j !== i) }))} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: '1rem', cursor: 'pointer', padding: '0.2rem 0.4rem', flexShrink: 0 }} title="Remove">✕</button>
                </div>
                <textarea value={s.detail || ''} onChange={e => updateDirectStep(i, 'detail', e.target.value)} placeholder="Step detail" style={{ minHeight: 50 }} />
              </div>
            ))}
            <button type="button" onClick={() => setDirectFields(prev => ({ ...prev, steps: [...(prev.steps || []), { title: '', detail: '' }] }))} style={{ background: 'none', border: '1.5px dashed var(--tan-dark)', borderRadius: 6, padding: '0.35rem 0.85rem', color: 'var(--brown)', fontSize: '0.82rem', cursor: 'pointer', marginTop: '0.3rem' }}>+ Add Step</button>

            <label className="modal-label">Chef's Note</label>
            <textarea value={directFields.chefs_note || ''} onChange={e => updateDirectField('chefs_note', e.target.value)} style={{ minHeight: 50 }} />

            <button className="modal-submit" onClick={handleDirectSave} disabled={aiLoading}>
              {aiLoading ? 'Saving…' : 'Save Changes'}
            </button>
            {aiStatus && <p style={{ marginTop: '0.9rem', fontSize: '0.85rem', textAlign: 'center', fontStyle: 'italic', color: 'var(--muted)' }}>{aiStatus}</p>}
          </div>
        )}

        {tab === 'direct' && !directFields && (
          <p className="modal-sub">This recipe doesn't have structured data yet. Use AI Edit to modify it.</p>
        )}

        {/* History */}
        {tab === 'history' && (
          <div>
            {historyLoading && <p style={{ textAlign: 'center', color: 'var(--muted)' }}>Loading history…</p>}
            {!historyLoading && versions.length === 0 && (
              <p className="modal-sub">No edit history yet. History is saved each time you edit a recipe.</p>
            )}
            {versions.map(v => {
              const rj = v.recipeJson
              const date = v.createdAt ? new Date(v.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''
              return (
                <div key={v.id} style={{ padding: '0.8rem', marginBottom: '0.6rem', background: 'var(--offwhite)', borderRadius: 8, border: '1px solid var(--tan)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>{rj?.title || 'Recipe'}</div>
                      <div style={{ fontSize: '0.78rem', color: 'var(--muted)', marginTop: '0.2rem' }}>{date}</div>
                      {v.editedBy && <div style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>by {v.editedBy}</div>}
                      {v.editNote && <div style={{ fontSize: '0.8rem', marginTop: '0.3rem', fontStyle: 'italic' }}>"{v.editNote}"</div>}
                    </div>
                    <button
                      className="grocery-btn"
                      style={{ fontSize: '0.75rem', flexShrink: 0 }}
                      onClick={() => handleRestore(v.id)}
                      disabled={restoringId === v.id}
                    >
                      {restoringId === v.id ? 'Restoring…' : 'Restore'}
                    </button>
                  </div>
                  {rj?.ingredients && (
                    <details style={{ marginTop: '0.5rem', fontSize: '0.8rem' }}>
                      <summary style={{ cursor: 'pointer', color: 'var(--muted)' }}>View ingredients ({rj.ingredients.length})</summary>
                      <ul style={{ margin: '0.3rem 0 0 1rem', padding: 0 }}>
                        {rj.ingredients.map((ing, i) => (
                          <li key={i}>{ing.amount} {ing.name}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* Delete */}
        {tab === 'delete' && (
          <div>
            <p style={{ fontSize: '0.9rem', marginBottom: '1rem' }}>
              Are you sure you want to delete <strong>{title}</strong>? This cannot be undone.
            </p>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.88rem' }}>
              <input type="checkbox" checked={deleteConfirm} onChange={e => setDeleteConfirm(e.target.checked)} />
              Yes, permanently delete this recipe
            </label>
            <button
              className="modal-submit"
              style={{ background: deleteConfirm ? '#c0392b' : 'var(--muted)' }}
              onClick={handleDelete}
              disabled={!deleteConfirm || deleting}
            >
              {deleting ? 'Deleting…' : 'Delete Recipe'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
