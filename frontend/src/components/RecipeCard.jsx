import { useState, useCallback } from 'react'

function escHtml(str) {
  const div = document.createElement('div')
  div.textContent = str || ''
  return div.innerHTML
}

export default function RecipeCard({ recipe, onEdit, onCook }) {
  const [flipped, setFlipped] = useState(false)
  const rj = recipe.recipeJson

  const handleFlip = useCallback(() => setFlipped(f => !f), [])

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      setFlipped(f => !f)
    }
    if (e.key === 'Escape' && flipped) {
      setFlipped(false)
    }
  }, [flipped])

  // Legacy card_html fallback
  if (!rj && recipe.cardHtml) {
    return (
      <div
        className={`flip-card${flipped ? ' flipped' : ''}`}
        tabIndex={0}
        onClick={handleFlip}
        onKeyDown={handleKeyDown}
        dangerouslySetInnerHTML={{ __html: recipe.cardHtml }}
      />
    )
  }

  if (!rj) return null

  const hasPhoto = rj.media_url || rj.mediaUrl
  const photoUrl = rj.media_url || rj.mediaUrl
  const instagramUrl = rj.instagram_url || rj.instagramUrl

  return (
    <div
      className={`flip-card${flipped ? ' flipped' : ''}`}
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      <div className="flip-card-inner">
        {/* ── Front ── */}
        <div className="flip-front" onClick={handleFlip}>
          <div className="front-img">
            {hasPhoto && <img className="front-photo" src={photoUrl} alt="" loading="lazy" />}
            <span className="front-emoji">{rj.emoji || '🍽️'}</span>
            {instagramUrl && (
              <a className="front-instagram" href={instagramUrl} target="_blank" rel="noopener noreferrer"
                onClick={e => e.stopPropagation()}>📸 Instagram</a>
            )}
            {rj.badge && <span className="front-badge">{rj.badge}</span>}
            <span className="front-hint">TAP TO FLIP</span>
          </div>
          <button className="front-edit-btn" onClick={e => { e.stopPropagation(); onEdit(recipe.cardId) }} title="Edit recipe">✏️</button>
          <div className="front-body">
            <div>
              <h3 className="front-title">{rj.title}</h3>
              {rj.subtitle && <p className="front-sub">{rj.subtitle}</p>}
              <div className="front-chips">
                {rj.prep_time && <span className="chip">Prep {rj.prep_time}</span>}
                {rj.cook_time && <span className="chip">Cook {rj.cook_time}</span>}
                {rj.servings && <span className="chip">{rj.servings}</span>}
                {rj.temperature && <span className="chip">{rj.temperature}</span>}
              </div>
            </div>
            {recipe.author && (
              <div className="front-author">Added by <span>{recipe.author}</span></div>
            )}
          </div>
        </div>

        {/* ── Back ── */}
        <div className="flip-back">
          <div className="back-header">
            <span className="back-title">{rj.emoji || '🍽️'} {rj.title}</span>
            <div className="back-header-actions">
              <button className="cook-now-btn" onClick={e => { e.stopPropagation(); onCook(recipe) }}>
                🍳 Cook Now
              </button>
              <button className="back-flip-btn" onClick={e => { e.stopPropagation(); setFlipped(false) }}>↩</button>
            </div>
          </div>
          <div className="back-scroll">
            {/* Stats */}
            {(rj.prep_time || rj.cook_time || rj.temperature) && (
              <div className="back-stats">
                {rj.prep_time && <div className="back-stat"><span className="back-stat-label">Prep</span><span className="back-stat-val">{rj.prep_time}</span></div>}
                {rj.cook_time && <div className="back-stat"><span className="back-stat-label">Cook</span><span className="back-stat-val">{rj.cook_time}</span></div>}
                {rj.temperature && <div className="back-stat"><span className="back-stat-label">Temp</span><span className="back-stat-val">{rj.temperature}</span></div>}
              </div>
            )}

            {/* Ingredients */}
            {rj.ingredients?.length > 0 && (
              <>
                <div className="b-heading">Ingredients</div>
                {rj.ingredients.map((ing, i) => (
                  <div key={i} className="b-ing-row">
                    <span className="b-ing-name">{ing.name}</span>
                    <span className="b-ing-amt">{ing.amount}</span>
                  </div>
                ))}
              </>
            )}

            {/* Steps */}
            {rj.steps?.length > 0 && (
              <>
                <div className="b-heading">Method</div>
                {rj.steps.map((step, i) => (
                  <div key={i} className="b-step">
                    <span className="b-step-num">{i + 1}</span>
                    <p className="b-step-text">
                      {step.title && <strong className="b-step-title">{step.title} — </strong>}
                      {step.detail}
                    </p>
                  </div>
                ))}
              </>
            )}

            {/* Calibration Notes */}
            {rj.calibration_notes?.length > 0 && (
              <>
                <div className="b-heading">Calibration Notes</div>
                <div className="b-notes-grid">
                  {rj.calibration_notes.map((note, i) => (
                    <div key={i} className="b-note">
                      <div className="b-note-goal">{note.goal}</div>
                      <div className="b-note-tip">{note.tip}</div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Storage */}
            {rj.storage?.length > 0 && (
              <>
                <div className="b-heading">Storage</div>
                {rj.storage.map((s, i) => (
                  <div key={i} className="b-storage-row">
                    <span className="b-storage-method">{s.method}</span>
                    <span className="b-storage-dur">{s.duration}</span>
                  </div>
                ))}
              </>
            )}

            {/* Chef's Note */}
            {rj.chefs_note && (
              <>
                <div className="b-heading">Chef's Note</div>
                <div className="b-chefs-note">{rj.chefs_note}</div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
