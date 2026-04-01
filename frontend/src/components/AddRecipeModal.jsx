import { useState, useRef, useCallback } from 'react'
import { useRecipes } from '../hooks/useRecipes'
import * as api from '../api'
import { showToast } from '../utils'

const CATEGORY_OPTIONS = [
  { value: '', label: 'Auto-detect' },
  { value: 'appetizer', label: 'Appetizer' },
  { value: 'entree', label: 'Entrée' },
  { value: 'side', label: 'Side' },
  { value: 'snack', label: 'Snack' },
  { value: 'breakfast', label: 'Breakfast' },
  { value: 'dessert', label: 'Dessert' },
]

export default function AddRecipeModal({ onClose }) {
  const { addRecipe } = useRecipes()
  const [step, setStep] = useState('compose') // compose | review
  const [mode, setMode] = useState('text') // text | photo | instagram
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('')

  // Compose state
  const [recipeText, setRecipeText] = useState('')
  const [category, setCategory] = useState('')
  const [author, setAuthor] = useState(() => localStorage.getItem('wfc_author') || '')
  const [photoData, setPhotoData] = useState(null)
  const [photoMime, setPhotoMime] = useState('image/jpeg')
  const [instagramUrl, setInstagramUrl] = useState('')

  // Review state
  const [reviewData, setReviewData] = useState(null)
  const [saving, setSaving] = useState(false)
  const fileRef = useRef(null)

  const handleExtract = useCallback(async () => {
    setLoading(true)
    setStatus('Extracting recipe with AI…')
    try {
      let payload = { category: category || undefined, author: author || undefined }

      if (mode === 'text') {
        payload.content = recipeText
      } else if (mode === 'photo') {
        if (!photoData) { setStatus('Please select a photo first'); setLoading(false); return }
        payload.image_data = photoData
        payload.image_mime = photoMime
      } else if (mode === 'instagram') {
        if (!instagramUrl) { setStatus('Please enter an Instagram URL'); setLoading(false); return }
        setStatus('Fetching Instagram post…')
        const igData = await api.fetchInstagram(instagramUrl)
        if (igData.error) throw new Error(igData.error)
        payload.content = igData.content || igData.caption || ''
        if (igData.image_data) {
          payload.image_data = igData.image_data
          payload.image_mime = igData.image_mime || 'image/jpeg'
        }
        payload.instagram_url = instagramUrl
      }

      setStatus('Analyzing recipe…')
      const result = await api.extractRecipe(payload)
      if (result.error) throw new Error(result.error)
      setReviewData(result.recipe || result)
      setStep('review')
      setStatus('')
    } catch (e) {
      setStatus(`Error: ${e.message}`)
    } finally {
      setLoading(false)
    }
  }, [mode, recipeText, category, author, photoData, photoMime, instagramUrl])

  const handlePhotoSelect = useCallback((file) => {
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const base64 = reader.result.split(',')[1]
      setPhotoData(base64)
      setPhotoMime(file.type || 'image/jpeg')
    }
    reader.readAsDataURL(file)
  }, [])

  const handleDrop = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
    const file = e.dataTransfer?.files?.[0]
    if (file) handlePhotoSelect(file)
  }, [handlePhotoSelect])

  const handleSave = useCallback(async () => {
    setSaving(true)
    setStatus('Saving recipe…')
    try {
      localStorage.setItem('wfc_author', author)
      const payload = {
        recipe_json: reviewData,
        category: reviewData.category || category || 'entree',
        author: author || 'Anonymous',
      }
      await addRecipe(payload)
      showToast('Recipe added!')
      onClose()
    } catch (e) {
      setStatus(`Error: ${e.message}`)
    } finally {
      setSaving(false)
    }
  }, [reviewData, category, author, addRecipe, onClose])

  const updateReviewField = useCallback((field, value) => {
    setReviewData(prev => ({ ...prev, [field]: value }))
  }, [])

  const updateIngredient = useCallback((idx, field, value) => {
    setReviewData(prev => {
      const ings = [...(prev.ingredients || [])]
      ings[idx] = { ...ings[idx], [field]: value }
      return { ...prev, ingredients: ings }
    })
  }, [])

  const addIngredient = useCallback(() => {
    setReviewData(prev => ({
      ...prev,
      ingredients: [...(prev.ingredients || []), { name: '', amount: '' }]
    }))
  }, [])

  const removeIngredient = useCallback((idx) => {
    setReviewData(prev => ({
      ...prev,
      ingredients: prev.ingredients.filter((_, i) => i !== idx)
    }))
  }, [])

  const updateStep = useCallback((idx, field, value) => {
    setReviewData(prev => {
      const steps = [...(prev.steps || [])]
      steps[idx] = { ...steps[idx], [field]: value }
      return { ...prev, steps }
    })
  }, [])

  const addStep = useCallback(() => {
    setReviewData(prev => ({
      ...prev,
      steps: [...(prev.steps || []), { title: '', detail: '', timer_secs: 0 }]
    }))
  }, [])

  const removeStep = useCallback((idx) => {
    setReviewData(prev => ({
      ...prev,
      steps: prev.steps.filter((_, i) => i !== idx)
    }))
  }, [])

  return (
    <div className="modal-overlay" onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 500, background: 'rgba(42,26,14,0.72)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      <div className="modal-box modal-box--wide" onClick={e => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>✕</button>
        <h2 className="modal-title">Add Recipe</h2>

        {step === 'compose' && (
          <>
            {/* Composer mode tabs */}
            <div className="composer-modes">
              {[
                { key: 'text', label: '📝 Paste Text / URL' },
                { key: 'photo', label: '📸 Upload Photo' },
                { key: 'instagram', label: '📷 Instagram' },
              ].map(m => (
                <button
                  key={m.key}
                  className={`composer-mode${mode === m.key ? ' active' : ''}`}
                  onClick={() => setMode(m.key)}
                >
                  {m.label}
                </button>
              ))}
            </div>

            {/* Text pane */}
            {mode === 'text' && (
              <div>
                <label className="modal-label">Recipe Text or URL</label>
                <textarea
                  value={recipeText}
                  onChange={e => setRecipeText(e.target.value)}
                  placeholder="Paste a recipe, URL, or describe the dish…"
                  maxLength={20000}
                  style={{ minHeight: 140 }}
                />
              </div>
            )}

            {/* Photo pane */}
            {mode === 'photo' && (
              <div>
                <div
                  className="photo-drop-zone"
                  onDrop={handleDrop}
                  onDragOver={e => e.preventDefault()}
                  onClick={() => fileRef.current?.click()}
                >
                  <div className="photo-drop-inner">
                    <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📸</div>
                    <p>{photoData ? 'Photo selected ✓' : 'Drop a photo here or tap to select'}</p>
                  </div>
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  style={{ display: 'none' }}
                  onChange={e => handlePhotoSelect(e.target.files[0])}
                />
              </div>
            )}

            {/* Instagram pane */}
            {mode === 'instagram' && (
              <div>
                <label className="modal-label">Instagram Post URL</label>
                <input
                  type="url"
                  value={instagramUrl}
                  onChange={e => setInstagramUrl(e.target.value)}
                  placeholder="https://www.instagram.com/p/..."
                />
              </div>
            )}

            {/* Meta fields */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginTop: '1rem' }}>
              <div>
                <label className="modal-label">Category</label>
                <select value={category} onChange={e => setCategory(e.target.value)}>
                  {CATEGORY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label className="modal-label">Your Name</label>
                <input type="text" value={author} onChange={e => setAuthor(e.target.value)} placeholder="Chef's name" />
              </div>
            </div>

            <button
              className="modal-submit"
              onClick={handleExtract}
              disabled={loading || (mode === 'text' && !recipeText.trim())}
            >
              {loading ? 'Extracting…' : 'Extract Recipe →'}
            </button>

            {status && <p style={{ marginTop: '0.9rem', fontSize: '0.85rem', textAlign: 'center', fontStyle: 'italic', color: 'var(--muted)' }}>{status}</p>}
          </>
        )}

        {step === 'review' && reviewData && (
          <>
            <p className="modal-sub">Review and edit the extracted recipe before saving.</p>

            {reviewData.confidence != null && (
              <div style={{ marginBottom: '1rem', padding: '0.5rem 0.75rem', borderRadius: 6, background: reviewData.confidence >= 0.8 ? '#e8f5e9' : reviewData.confidence >= 0.5 ? '#fff8e1' : '#fce4ec', fontSize: '0.82rem' }}>
                Confidence: {Math.round(reviewData.confidence * 100)}%
                {reviewData.warnings?.length > 0 && (
                  <span style={{ marginLeft: 8, color: 'var(--muted)' }}>⚠ {reviewData.warnings.join(', ')}</span>
                )}
              </div>
            )}

            <div className="review-form">
              <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr', gap: '0.75rem' }}>
                <div>
                  <label className="modal-label">Emoji</label>
                  <input type="text" value={reviewData.emoji || ''} onChange={e => updateReviewField('emoji', e.target.value)} />
                </div>
                <div>
                  <label className="modal-label">Badge</label>
                  <input type="text" value={reviewData.badge || ''} onChange={e => updateReviewField('badge', e.target.value)} />
                </div>
              </div>

              <label className="modal-label">Title</label>
              <input type="text" value={reviewData.title || ''} onChange={e => updateReviewField('title', e.target.value)} />

              <label className="modal-label">Subtitle</label>
              <input type="text" value={reviewData.subtitle || ''} onChange={e => updateReviewField('subtitle', e.target.value)} />

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '0.5rem' }}>
                <div><label className="modal-label">Servings</label><input type="text" value={reviewData.servings || ''} onChange={e => updateReviewField('servings', e.target.value)} /></div>
                <div><label className="modal-label">Prep</label><input type="text" value={reviewData.prep_time || ''} onChange={e => updateReviewField('prep_time', e.target.value)} /></div>
                <div><label className="modal-label">Cook</label><input type="text" value={reviewData.cook_time || ''} onChange={e => updateReviewField('cook_time', e.target.value)} /></div>
                <div><label className="modal-label">Temp</label><input type="text" value={reviewData.temperature || ''} onChange={e => updateReviewField('temperature', e.target.value)} /></div>
              </div>

              {/* Ingredients */}
              <label className="modal-label">Ingredients</label>
              {(reviewData.ingredients || []).map((ing, i) => (
                <div key={i} style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.4rem', alignItems: 'center' }}>
                  <input type="text" value={ing.name || ''} onChange={e => updateIngredient(i, 'name', e.target.value)} placeholder="Ingredient" style={{ flex: 2 }} />
                  <input type="text" value={ing.amount || ''} onChange={e => updateIngredient(i, 'amount', e.target.value)} placeholder="Amount" style={{ flex: 1 }} />
                  <button onClick={() => removeIngredient(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: '1.1rem' }}>✕</button>
                </div>
              ))}
              <button onClick={addIngredient} style={{ background: 'none', border: '1px dashed var(--tan-dark)', padding: '0.4rem 0.8rem', borderRadius: 4, cursor: 'pointer', fontSize: '0.8rem', color: 'var(--brown)', marginTop: '0.3rem' }}>+ Add Ingredient</button>

              {/* Steps */}
              <label className="modal-label" style={{ marginTop: '1rem' }}>Steps</label>
              {(reviewData.steps || []).map((s, i) => (
                <div key={i} style={{ marginBottom: '0.6rem', background: 'var(--white)', padding: '0.6rem', borderRadius: 6, border: '1px solid var(--tan)' }}>
                  <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.3rem', alignItems: 'center' }}>
                    <span style={{ fontWeight: 700, color: 'var(--red)', minWidth: 20 }}>{i + 1}</span>
                    <input type="text" value={s.title || ''} onChange={e => updateStep(i, 'title', e.target.value)} placeholder="Step title" style={{ flex: 1 }} />
                    <button onClick={() => removeStep(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)' }}>✕</button>
                  </div>
                  <textarea value={s.detail || ''} onChange={e => updateStep(i, 'detail', e.target.value)} placeholder="Step detail" style={{ minHeight: 60 }} />
                </div>
              ))}
              <button onClick={addStep} style={{ background: 'none', border: '1px dashed var(--tan-dark)', padding: '0.4rem 0.8rem', borderRadius: 4, cursor: 'pointer', fontSize: '0.8rem', color: 'var(--brown)' }}>+ Add Step</button>

              {/* Chef's Note */}
              <label className="modal-label" style={{ marginTop: '1rem' }}>Chef's Note</label>
              <textarea value={reviewData.chefs_note || ''} onChange={e => updateReviewField('chefs_note', e.target.value)} style={{ minHeight: 60 }} />
            </div>

            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.5rem' }}>
              <button
                style={{ flex: 1, padding: '0.7rem', border: '1.5px solid var(--tan-dark)', background: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}
                onClick={() => setStep('compose')}
              >← Back</button>
              <button
                className="modal-submit"
                style={{ flex: 2, marginTop: 0 }}
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? 'Saving…' : 'Save to Cookbook'}
              </button>
            </div>

            {status && <p style={{ marginTop: '0.9rem', fontSize: '0.85rem', textAlign: 'center', fontStyle: 'italic', color: 'var(--muted)' }}>{status}</p>}
          </>
        )}
      </div>
    </div>
  )
}
