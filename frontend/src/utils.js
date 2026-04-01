export function showToast(message, duration = 2500) {
  const el = document.createElement('div')
  el.className = 'wfc-toast'
  el.textContent = message
  document.body.appendChild(el)
  requestAnimationFrame(() => {
    el.classList.add('show')
  })
  setTimeout(() => {
    el.classList.remove('show')
    setTimeout(() => el.remove(), 300)
  }, duration)
}

export function escHtml(str) {
  const div = document.createElement('div')
  div.textContent = str || ''
  return div.innerHTML
}

export function formatQty(qty) {
  if (!qty || qty <= 0) return ''
  if (Math.abs(qty - Math.round(qty)) < 0.01) return String(Math.round(qty))
  if (Math.abs(qty - 0.25) < 0.05) return '¼'
  if (Math.abs(qty - 0.33) < 0.05) return '⅓'
  if (Math.abs(qty - 0.5) < 0.05) return '½'
  if (Math.abs(qty - 0.67) < 0.05) return '⅔'
  if (Math.abs(qty - 0.75) < 0.05) return '¾'
  const whole = Math.floor(qty)
  const frac = qty - whole
  if (whole > 0 && frac > 0.1) {
    const fracStr = formatQty(frac)
    return fracStr ? `${whole} ${fracStr}` : qty.toFixed(1)
  }
  return qty.toFixed(1)
}
