/**
 * Wall Family Cookbook — API Layer
 * All fetch() calls in one place. Every function handles 401 (session expired)
 * by reloading the page so the user sees the gate/login page.
 */

async function apiFetch(url, options = {}) {
  const res = await fetch(url, options)
  if (res.status === 401) {
    window.location.reload()
    throw new Error('Session expired')
  }
  return res
}

async function apiJson(url, options = {}) {
  const res = await apiFetch(url, options)
  return res.json()
}

// ── Recipes ────────────────────────────────────────────────────

export async function fetchRecipes() {
  const data = await apiJson('/api/recipes')
  return data.recipes || []
}

export async function addRecipe(payload) {
  return apiJson('/api/add-recipe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export async function editRecipe(payload) {
  return apiJson('/api/edit-recipe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export async function deleteRecipe(cardId) {
  return apiJson('/api/delete-recipe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ card_id: cardId }),
  })
}

export async function saveCardHtml(payload) {
  return apiJson('/api/save-card-html', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export async function getCardHtml(cardId) {
  const res = await apiFetch(`/api/get-card-html?card_id=${encodeURIComponent(cardId)}`)
  return res.json()
}

// ── Extract & Upload ───────────────────────────────────────────

export async function extractRecipe(payload) {
  return apiJson('/api/extract-recipe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export async function uploadMedia(formData) {
  const res = await apiFetch('/api/upload-media', {
    method: 'POST',
    body: formData,
  })
  return res.json()
}

export async function fetchInstagram(url) {
  return apiJson('/api/fetch-instagram', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  })
}

// ── Chat ───────────────────────────────────────────────────────

export async function sendChatMessage(payload) {
  return apiJson('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

// ── Grocery ────────────────────────────────────────────────────

export async function getGroceryState() {
  const data = await apiJson('/api/grocery')
  return data.state || {}
}

export async function saveGroceryState(state) {
  return apiJson('/api/grocery', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state }),
  })
}

export async function getRecipesJson() {
  const data = await apiJson('/api/recipes-json')
  return data.recipes || []
}

export async function mergeIngredients(ingredients) {
  return apiJson('/api/grocery/merge-ingredients', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ingredients }),
  })
}

// ── Auth & Export ──────────────────────────────────────────────

export async function logout() {
  return apiJson('/api/logout', { method: 'POST' })
}

export async function exportRecipes() {
  const res = await apiFetch('/api/export')
  return res.json()
}
