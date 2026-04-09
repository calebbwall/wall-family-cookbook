import { useState, useEffect, useCallback, useRef } from 'react'

function parseServingsNum(str) {
  if (!str) return 1
  const m = String(str).match(/(\d+)/)
  return m ? parseInt(m[1], 10) : 1
}

function scaleAmount(amount, ratio) {
  if (!amount || ratio === 1) return amount
  const m = String(amount).match(/^([\d.\/½¼¾⅓⅔⅛]+)\s*(.*)$/)
  if (!m) return amount
  let qty = 0
  const numStr = m[1]
  const fractions = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 0.333, '⅔': 0.667, '⅛': 0.125 }
  if (numStr.includes('/')) {
    const [n, d] = numStr.split('/')
    qty = parseFloat(n) / parseFloat(d)
  } else {
    qty = fractions[numStr] || parseFloat(numStr) || 0
  }
  const scaled = qty * ratio
  const nice = scaled % 1 === 0 ? String(scaled) : scaled.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
  return nice + (m[2] ? ' ' + m[2] : '')
}

function formatTime(secs) {
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

export default function CookMode({ recipe, onClose, onAskAI }) {
  const rj = recipe?.recipeJson
  if (!rj) return null

  const baseServings = parseServingsNum(rj.servings)
  const [servings, setServings] = useState(baseServings)
  const [completedSteps, setCompletedSteps] = useState(new Set())
  const [checkedIngs, setCheckedIngs] = useState(new Set())
  const [timers, setTimers] = useState({}) // { stepIdx: { remaining, running } }
  const [zoomStep, setZoomStep] = useState(null)
  const timerIntervals = useRef({})
  const ratio = servings / baseServings

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      Object.values(timerIntervals.current).forEach(clearInterval)
    }
  }, [])

  const toggleStep = useCallback((idx) => {
    setCompletedSteps(prev => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })
  }, [])

  const toggleIng = useCallback((idx) => {
    setCheckedIngs(prev => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })
  }, [])

  const startTimer = useCallback((stepIdx, secs) => {
    if (timerIntervals.current[stepIdx]) clearInterval(timerIntervals.current[stepIdx])
    setTimers(prev => ({ ...prev, [stepIdx]: { remaining: secs, running: true } }))
    timerIntervals.current[stepIdx] = setInterval(() => {
      setTimers(prev => {
        const t = prev[stepIdx]
        if (!t || !t.running) return prev
        const remaining = t.remaining - 1
        if (remaining <= 0) {
          clearInterval(timerIntervals.current[stepIdx])
          // Play a beep
          try { new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQ==').play() } catch {}
          return { ...prev, [stepIdx]: { remaining: 0, running: false } }
        }
        return { ...prev, [stepIdx]: { remaining, running: true } }
      })
    }, 1000)
  }, [])

  const pauseTimer = useCallback((stepIdx) => {
    if (timerIntervals.current[stepIdx]) clearInterval(timerIntervals.current[stepIdx])
    setTimers(prev => ({ ...prev, [stepIdx]: { ...prev[stepIdx], running: false } }))
  }, [])

  const resetTimer = useCallback((stepIdx, secs) => {
    if (timerIntervals.current[stepIdx]) clearInterval(timerIntervals.current[stepIdx])
    setTimers(prev => ({ ...prev, [stepIdx]: { remaining: secs, running: false } }))
  }, [])

  const totalSteps = (rj.steps || []).length
  const allStepsDone = completedSteps.size === totalSteps && totalSteps > 0

  return (
    <div className="cook-mode-react">
      {/* Header */}
      <div className="cook-mode-header">
        <span className="cook-mode-title">🍳 {rj.title}</span>
        <div className="cook-mode-actions">
          <button className="cook-mode-header-btn" onClick={onAskAI}>💬 Ask AI</button>
          <button className="cook-mode-header-btn" onClick={onClose}>✕ Exit</button>
        </div>
      </div>

      <div className="cook-mode-body">
        {/* Servings scaler */}
        <div className="cook-mode-servings-box">
          <span className="cook-mode-servings-label-text">Servings:</span>
          <button className="cook-mode-servings-adjust" onClick={() => setServings(s => Math.max(1, s - 1))}>−</button>
          <span style={{ fontSize: '1.2rem', fontWeight: 700, minWidth: 30, textAlign: 'center' }}>{servings}</span>
          <button className="cook-mode-servings-adjust" onClick={() => setServings(s => s + 1)}>+</button>
          {ratio !== 1 && (
            <span style={{ fontSize: '0.78rem', color: 'var(--muted)', fontStyle: 'italic' }}>
              (scaled {ratio.toFixed(1)}×)
            </span>
          )}
        </div>

        {/* Stats */}
        {(rj.prep_time || rj.cook_time || rj.temperature) && (
          <div className="back-stats" style={{ marginBottom: '1.5rem' }}>
            {rj.prep_time && <div className="back-stat" style={{ background: 'var(--white)', color: 'var(--text)' }}><span className="back-stat-label" style={{ color: 'var(--muted)' }}>Prep</span><span className="back-stat-val" style={{ color: 'var(--dark)' }}>{rj.prep_time}</span></div>}
            {rj.cook_time && <div className="back-stat" style={{ background: 'var(--white)', color: 'var(--text)' }}><span className="back-stat-label" style={{ color: 'var(--muted)' }}>Cook</span><span className="back-stat-val" style={{ color: 'var(--dark)' }}>{rj.cook_time}</span></div>}
            {rj.temperature && <div className="back-stat" style={{ background: 'var(--white)', color: 'var(--text)' }}><span className="back-stat-label" style={{ color: 'var(--muted)' }}>Temp</span><span className="back-stat-val" style={{ color: 'var(--dark)' }}>{rj.temperature}</span></div>}
          </div>
        )}

        {/* Ingredients */}
        {rj.ingredients?.length > 0 && (
          <div style={{ marginBottom: '1.5rem' }}>
            <h3 className="cook-mode-section-heading">Ingredients</h3>
            {rj.ingredients.map((ing, i) => (
              <div key={i} className={`cook-mode-ing-row${checkedIngs.has(i) ? ' checked' : ''}`} onClick={() => toggleIng(i)}>
                <input type="checkbox" checked={checkedIngs.has(i)} onChange={() => toggleIng(i)} onClick={e => e.stopPropagation()} className="ing-check" />
                <span style={{ flex: 1 }}>{ing.name}</span>
                <span style={{ fontWeight: 700, fontSize: '0.85rem' }}>{scaleAmount(ing.amount, ratio)}</span>
              </div>
            ))}
          </div>
        )}

        {/* Steps */}
        {rj.steps?.length > 0 && (
          <div>
            <h3 className="cook-mode-section-heading">Method</h3>
            {rj.steps.map((step, i) => (
              <div key={i} className={`cook-mode-step-card${completedSteps.has(i) ? ' completed' : ''}`}>
                <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }} onClick={() => toggleStep(i)}>
                  <span className={`cook-mode-step-num${completedSteps.has(i) ? ' completed' : ''}`}>
                    {completedSteps.has(i) ? '✓' : i + 1}
                  </span>
                  <div className={`cook-mode-step-detail${completedSteps.has(i) ? ' completed' : ''}`}>
                    {step.title && <strong style={{ display: 'block', marginBottom: '0.2rem' }}>{step.title}</strong>}
                    <p style={{ fontSize: '0.88rem', lineHeight: 1.6, margin: 0 }}>{step.detail}</p>
                  </div>
                  <button onClick={e => { e.stopPropagation(); setZoomStep(i) }} style={{ flexShrink: 0, background: 'none', border: 'none', fontSize: '1.1rem', cursor: 'pointer', color: 'var(--muted)' }} title="Zoom">⤢</button>
                </div>
                {/* Timer */}
                {step.timer_secs > 0 && (
                  <div className="cook-mode-timer-row">
                    <span className={`cook-mode-timer-display${timers[i]?.remaining <= 10 ? ' warning' : ''}`}>
                      {formatTime(timers[i]?.remaining ?? step.timer_secs)}
                    </span>
                    {!timers[i]?.running ? (
                      <button className="cook-mode-timer-btn start" onClick={() => startTimer(i, timers[i]?.remaining ?? step.timer_secs)}>▶ Start</button>
                    ) : (
                      <button className="cook-mode-timer-btn pause" onClick={() => pauseTimer(i)}>⏸ Pause</button>
                    )}
                    <button className="cook-mode-timer-btn reset" onClick={() => resetTimer(i, step.timer_secs)}>↺ Reset</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {allStepsDone && (
          <div className="cook-mode-celebration">
            <div style={{ fontSize: '3rem', marginBottom: '0.5rem' }}>🎉</div>
            <p style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--dark)' }}>All steps complete!</p>
            <p style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>Enjoy your meal!</p>
          </div>
        )}

        {/* Calibration Notes */}
        {rj.calibration_notes?.length > 0 && (
          <div style={{ marginTop: '1.5rem' }}>
            <h3 className="cook-mode-section-heading">Calibration Notes</h3>
            <div className="b-notes-grid">
              {rj.calibration_notes.map((note, i) => (
                <div key={i} className="b-note" style={{ background: 'var(--red-faint)' }}>
                  <div className="b-note-goal" style={{ color: 'var(--red)' }}>{note.goal}</div>
                  <div className="b-note-tip" style={{ color: 'var(--text)' }}>{note.tip}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Step Zoom Overlay */}
      {zoomStep !== null && rj.steps?.[zoomStep] && (
        <div className="cook-mode-zoom">
          <button className="cook-mode-zoom-close" onClick={() => setZoomStep(null)}>✕</button>
          <div style={{ fontSize: '0.82rem', color: 'var(--tan-dark)', marginBottom: '1rem', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            Step {zoomStep + 1} of {totalSteps}
          </div>
          <div style={{ width: 80, height: 80, background: 'var(--red)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '2rem', fontWeight: 700, marginBottom: '1.5rem', color: 'var(--white)' }}>
            {zoomStep + 1}
          </div>
          {rj.steps[zoomStep].title && (
            <h3 style={{ fontSize: '1.3rem', fontWeight: 700, marginBottom: '0.8rem', textAlign: 'center' }}>{rj.steps[zoomStep].title}</h3>
          )}
          <p style={{ fontSize: '1.1rem', lineHeight: 1.8, maxWidth: 600, textAlign: 'center', color: 'rgba(232,221,208,0.85)' }}>
            {rj.steps[zoomStep].detail}
          </p>
          {rj.steps[zoomStep].timer_secs > 0 && (
            <div style={{ marginTop: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <span style={{ fontFamily: 'monospace', fontSize: '2rem', fontWeight: 700 }}>
                {formatTime(timers[zoomStep]?.remaining ?? rj.steps[zoomStep].timer_secs)}
              </span>
              {!timers[zoomStep]?.running ? (
                <button className="cook-mode-timer-btn start" style={{ padding: '0.5rem 1rem', borderRadius: 6 }} onClick={() => startTimer(zoomStep, timers[zoomStep]?.remaining ?? rj.steps[zoomStep].timer_secs)}>▶ Start</button>
              ) : (
                <button className="cook-mode-timer-btn pause" style={{ padding: '0.5rem 1rem', borderRadius: 6 }} onClick={() => pauseTimer(zoomStep)}>⏸ Pause</button>
              )}
              <button className="cook-mode-timer-btn reset" style={{ padding: '0.5rem 1rem', borderRadius: 6 }} onClick={() => resetTimer(zoomStep, rj.steps[zoomStep].timer_secs)}>↺ Reset</button>
            </div>
          )}
          <div className="cook-mode-zoom-nav">
            <button onClick={() => setZoomStep(s => Math.max(0, s - 1))} disabled={zoomStep === 0}>← Prev</button>
            <button onClick={() => setZoomStep(s => Math.min(totalSteps - 1, s + 1))} disabled={zoomStep === totalSteps - 1}>Next →</button>
          </div>
        </div>
      )}
    </div>
  )
}
