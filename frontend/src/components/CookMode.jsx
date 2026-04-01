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
    <div id="cook-mode-overlay" style={{ position: 'fixed', inset: 0, zIndex: 600, background: 'var(--cream)', display: 'flex', flexDirection: 'column', overflow: 'auto' }}>
      {/* Header */}
      <div className="cook-mode-header" style={{ background: 'var(--red)', padding: '1rem 1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <span style={{ fontFamily: 'Playfair Display, serif', fontSize: '1.2rem', fontWeight: 700, color: 'var(--white)' }}>
          🍳 {rj.title}
        </span>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button onClick={onAskAI} style={{ background: 'rgba(255,255,255,0.15)', border: 'none', color: 'var(--white)', padding: '0.4rem 0.9rem', borderRadius: 20, cursor: 'pointer', fontSize: '0.8rem', fontWeight: 700 }}>
            💬 Ask AI
          </button>
          <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.15)', border: 'none', color: 'var(--white)', padding: '0.4rem 0.9rem', borderRadius: 20, cursor: 'pointer', fontSize: '0.8rem', fontWeight: 700 }}>
            ✕ Exit
          </button>
        </div>
      </div>

      <div className="cook-mode-body" style={{ flex: 1, padding: '1.5rem', maxWidth: 700, margin: '0 auto', width: '100%' }}>
        {/* Servings scaler */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem', padding: '0.75rem 1rem', background: 'var(--white)', borderRadius: 8, border: '1px solid var(--tan)' }}>
          <span style={{ fontWeight: 700, color: 'var(--brown)' }}>Servings:</span>
          <button onClick={() => setServings(s => Math.max(1, s - 1))} style={{ width: 32, height: 32, borderRadius: '50%', border: '1.5px solid var(--red)', background: 'none', color: 'var(--red)', fontSize: '1.1rem', cursor: 'pointer', fontWeight: 700 }}>−</button>
          <span style={{ fontSize: '1.2rem', fontWeight: 700, minWidth: 30, textAlign: 'center' }}>{servings}</span>
          <button onClick={() => setServings(s => s + 1)} style={{ width: 32, height: 32, borderRadius: '50%', border: '1.5px solid var(--red)', background: 'none', color: 'var(--red)', fontSize: '1.1rem', cursor: 'pointer', fontWeight: 700 }}>+</button>
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
            <h3 style={{ fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase', color: 'var(--red)', marginBottom: '0.6rem', borderBottom: '1px solid var(--tan)', paddingBottom: '0.35rem' }}>Ingredients</h3>
            {rj.ingredients.map((ing, i) => (
              <div key={i} onClick={() => toggleIng(i)} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.4rem 0', borderBottom: '1px solid var(--tan)', cursor: 'pointer', opacity: checkedIngs.has(i) ? 0.4 : 1, textDecoration: checkedIngs.has(i) ? 'line-through' : 'none' }}>
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
            <h3 style={{ fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase', color: 'var(--red)', marginBottom: '0.6rem', borderBottom: '1px solid var(--tan)', paddingBottom: '0.35rem' }}>Method</h3>
            {rj.steps.map((step, i) => (
              <div key={i} style={{ marginBottom: '1rem', padding: '0.75rem', background: completedSteps.has(i) ? '#e8f5e9' : 'var(--white)', borderRadius: 8, border: `1px solid ${completedSteps.has(i) ? '#a5d6a7' : 'var(--tan)'}`, cursor: 'pointer', transition: 'background 0.2s' }}>
                <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }} onClick={() => toggleStep(i)}>
                  <span style={{ flexShrink: 0, width: 28, height: 28, background: completedSteps.has(i) ? '#4caf50' : 'var(--red)', color: 'var(--white)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '0.75rem' }}>
                    {completedSteps.has(i) ? '✓' : i + 1}
                  </span>
                  <div style={{ flex: 1, textDecoration: completedSteps.has(i) ? 'line-through' : 'none', opacity: completedSteps.has(i) ? 0.6 : 1 }}>
                    {step.title && <strong style={{ display: 'block', marginBottom: '0.2rem' }}>{step.title}</strong>}
                    <p style={{ fontSize: '0.88rem', lineHeight: 1.6, margin: 0 }}>{step.detail}</p>
                  </div>
                  <button onClick={e => { e.stopPropagation(); setZoomStep(i) }} style={{ flexShrink: 0, background: 'none', border: 'none', fontSize: '1.1rem', cursor: 'pointer', color: 'var(--muted)' }} title="Zoom">⤢</button>
                </div>
                {/* Timer */}
                {step.timer_secs > 0 && (
                  <div style={{ marginTop: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem', paddingLeft: '2.5rem' }}>
                    <span style={{ fontFamily: 'monospace', fontSize: '1.1rem', fontWeight: 700, color: timers[i]?.remaining <= 10 ? 'var(--red)' : 'var(--dark)' }}>
                      {formatTime(timers[i]?.remaining ?? step.timer_secs)}
                    </span>
                    {!timers[i]?.running ? (
                      <button onClick={() => startTimer(i, timers[i]?.remaining ?? step.timer_secs)} style={{ background: 'var(--red)', color: 'white', border: 'none', padding: '0.3rem 0.7rem', borderRadius: 4, cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600 }}>▶ Start</button>
                    ) : (
                      <button onClick={() => pauseTimer(i)} style={{ background: 'var(--brown)', color: 'white', border: 'none', padding: '0.3rem 0.7rem', borderRadius: 4, cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600 }}>⏸ Pause</button>
                    )}
                    <button onClick={() => resetTimer(i, step.timer_secs)} style={{ background: 'none', border: '1px solid var(--tan-dark)', padding: '0.3rem 0.7rem', borderRadius: 4, cursor: 'pointer', fontSize: '0.78rem', color: 'var(--muted)' }}>↺ Reset</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {allStepsDone && (
          <div style={{ textAlign: 'center', padding: '2rem', marginTop: '1rem' }}>
            <div style={{ fontSize: '3rem', marginBottom: '0.5rem' }}>🎉</div>
            <p style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--dark)' }}>All steps complete!</p>
            <p style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>Enjoy your meal!</p>
          </div>
        )}

        {/* Calibration Notes */}
        {rj.calibration_notes?.length > 0 && (
          <div style={{ marginTop: '1.5rem' }}>
            <h3 style={{ fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase', color: 'var(--red)', marginBottom: '0.6rem' }}>Calibration Notes</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
              {rj.calibration_notes.map((note, i) => (
                <div key={i} style={{ background: 'var(--red-faint)', borderLeft: '3px solid var(--red)', padding: '0.5rem 0.7rem', borderRadius: '0 6px 6px 0' }}>
                  <div style={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--red)', marginBottom: '0.15rem' }}>{note.goal}</div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text)', lineHeight: 1.4 }}>{note.tip}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Step Zoom Overlay */}
      {zoomStep !== null && rj.steps?.[zoomStep] && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 700, background: 'var(--dark)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '2rem', color: 'var(--white)' }}>
          <button onClick={() => setZoomStep(null)} style={{ position: 'absolute', top: '1rem', right: '1rem', background: 'rgba(255,255,255,0.15)', border: 'none', color: 'white', width: 36, height: 36, borderRadius: '50%', cursor: 'pointer', fontSize: '1.1rem' }}>✕</button>
          <div style={{ fontSize: '0.82rem', color: 'var(--tan-dark)', marginBottom: '1rem', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            Step {zoomStep + 1} of {totalSteps}
          </div>
          <div style={{ width: 80, height: 80, background: 'var(--red)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '2rem', fontWeight: 700, marginBottom: '1.5rem' }}>
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
                <button onClick={() => startTimer(zoomStep, timers[zoomStep]?.remaining ?? rj.steps[zoomStep].timer_secs)} style={{ background: 'var(--red)', color: 'white', border: 'none', padding: '0.5rem 1rem', borderRadius: 6, cursor: 'pointer', fontWeight: 700 }}>▶ Start</button>
              ) : (
                <button onClick={() => pauseTimer(zoomStep)} style={{ background: 'var(--brown)', color: 'white', border: 'none', padding: '0.5rem 1rem', borderRadius: 6, cursor: 'pointer', fontWeight: 700 }}>⏸ Pause</button>
              )}
              <button onClick={() => resetTimer(zoomStep, rj.steps[zoomStep].timer_secs)} style={{ background: 'none', border: '1px solid var(--tan-dark)', color: 'var(--tan)', padding: '0.5rem 1rem', borderRadius: 6, cursor: 'pointer' }}>↺ Reset</button>
            </div>
          )}
          <div style={{ marginTop: '2rem', display: 'flex', gap: '1rem' }}>
            <button onClick={() => setZoomStep(s => Math.max(0, s - 1))} disabled={zoomStep === 0} style={{ background: 'rgba(255,255,255,0.1)', border: 'none', color: 'var(--tan)', padding: '0.6rem 1.5rem', borderRadius: 6, cursor: zoomStep === 0 ? 'default' : 'pointer', opacity: zoomStep === 0 ? 0.3 : 1, fontWeight: 600 }}>← Prev</button>
            <button onClick={() => setZoomStep(s => Math.min(totalSteps - 1, s + 1))} disabled={zoomStep === totalSteps - 1} style={{ background: 'rgba(255,255,255,0.1)', border: 'none', color: 'var(--tan)', padding: '0.6rem 1.5rem', borderRadius: 6, cursor: zoomStep === totalSteps - 1 ? 'default' : 'pointer', opacity: zoomStep === totalSteps - 1 ? 0.3 : 1, fontWeight: 600 }}>Next →</button>
          </div>
        </div>
      )}
    </div>
  )
}
