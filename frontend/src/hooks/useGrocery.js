import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import * as api from '../api'
import { showToast } from '../utils'

const DEFAULT_STATE = {
  recipes: [],
  manualItems: [],
  pantry: {},
  checked: [],
  locked: {},
}

const UNIT_BASES = {
  tsp: { base: 'ml', factor: 4.929 },
  teaspoon: { base: 'ml', factor: 4.929 },
  teaspoons: { base: 'ml', factor: 4.929 },
  tbsp: { base: 'ml', factor: 14.787 },
  tablespoon: { base: 'ml', factor: 14.787 },
  tablespoons: { base: 'ml', factor: 14.787 },
  cup: { base: 'ml', factor: 236.588 },
  cups: { base: 'ml', factor: 236.588 },
  oz: { base: 'g', factor: 28.3495 },
  ounce: { base: 'g', factor: 28.3495 },
  ounces: { base: 'g', factor: 28.3495 },
  lb: { base: 'g', factor: 453.592 },
  lbs: { base: 'g', factor: 453.592 },
  pound: { base: 'g', factor: 453.592 },
  pounds: { base: 'g', factor: 453.592 },
  ml: { base: 'ml', factor: 1 },
  l: { base: 'ml', factor: 1000 },
  liter: { base: 'ml', factor: 1000 },
  liters: { base: 'ml', factor: 1000 },
  g: { base: 'g', factor: 1 },
  kg: { base: 'g', factor: 1000 },
}

const CAT_META = {
  produce: { icon: '🥬', label: 'Produce', order: 1 },
  dairy: { icon: '🧈', label: 'Dairy & Eggs', order: 2 },
  meat: { icon: '🥩', label: 'Meat & Seafood', order: 3 },
  bakery: { icon: '🍞', label: 'Bakery', order: 4 },
  pantry: { icon: '🫙', label: 'Pantry', order: 5 },
  spices: { icon: '🧂', label: 'Spices & Seasoning', order: 6 },
  frozen: { icon: '🧊', label: 'Frozen', order: 7 },
  other: { icon: '📦', label: 'Other', order: 8 },
}

export { CAT_META }

function parseAmount(str) {
  if (!str) return { qty: 0, unit: '' }
  const s = str.trim().toLowerCase()
  const m = s.match(/^([\d./½¼¾⅓⅔⅛]+)\s*(.*)$/)
  if (!m) return { qty: 0, unit: s }
  let qty = 0
  const numStr = m[1]
  if (numStr.includes('/')) {
    const [n, d] = numStr.split('/')
    qty = parseFloat(n) / parseFloat(d)
  } else {
    const fractions = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 0.333, '⅔': 0.667, '⅛': 0.125 }
    qty = fractions[numStr] || parseFloat(numStr) || 0
  }
  return { qty, unit: m[2] || 'count' }
}

function normalizeIngName(name) {
  return (name || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim()
}

function categorizeIngredient(name) {
  const n = name.toLowerCase()
  if (/butter|milk|cream|cheese|yogurt|sour cream|egg|eggs/.test(n)) return 'dairy'
  if (/chicken|beef|pork|fish|shrimp|bacon|sausage|turkey|lamb|salmon/.test(n)) return 'meat'
  if (/onion|garlic|tomato|pepper|lettuce|spinach|potato|carrot|celery|lemon|lime|avocado|mushroom|zucchini|broccoli|corn|bean|pea|herb|basil|cilantro|parsley|ginger|jalapeño|scallion/.test(n)) return 'produce'
  if (/bread|tortilla|bun|roll|pita|naan|croissant/.test(n)) return 'bakery'
  if (/salt|pepper|cumin|paprika|cinnamon|oregano|thyme|rosemary|chili|cayenne|nutmeg|turmeric|vanilla/.test(n)) return 'spices'
  if (/frozen|ice cream/.test(n)) return 'frozen'
  return 'pantry'
}

function toBaseUnit(qty, unit) {
  const entry = UNIT_BASES[unit.toLowerCase()]
  if (entry) return { qty: qty * entry.factor, baseUnit: entry.base }
  return { qty, baseUnit: unit || 'count' }
}

function fromBaseUnit(qty, baseUnit) {
  if (baseUnit === 'ml') {
    if (qty >= 236) return { qty: qty / 236.588, unit: 'cups' }
    if (qty >= 14.7) return { qty: qty / 14.787, unit: 'tbsp' }
    return { qty: qty / 4.929, unit: 'tsp' }
  }
  if (baseUnit === 'g') {
    if (qty >= 453) return { qty: qty / 453.592, unit: 'lbs' }
    if (qty >= 28) return { qty: qty / 28.3495, unit: 'oz' }
    return { qty, unit: 'g' }
  }
  return { qty, unit: baseUnit }
}

function parseServingsNum(str) {
  if (!str) return 0
  const m = String(str).match(/(\d+)/)
  return m ? parseInt(m[1], 10) : 0
}

export function computeGroceryList(state, allRecipes) {
  const recipeMap = {}
  for (const r of allRecipes) recipeMap[r.cardId] = r

  const merged = {}
  for (const sr of (state.recipes || [])) {
    const recipe = recipeMap[sr.cardId]
    if (!recipe) continue
    const baseServ = sr.baseServings || parseServingsNum(recipe.servings) || 1
    const curServ = sr.servings || baseServ
    const ratio = curServ / baseServ
    for (const ing of (recipe.ingredients || [])) {
      const parsed = parseAmount(ing.amount || '')
      const normName = normalizeIngName(ing.name || '')
      if (!normName) continue
      const scaledQty = parsed.qty * ratio
      const { qty: baseQty, baseUnit } = toBaseUnit(scaledQty, parsed.unit)
      const key = normName + '|' + baseUnit
      if (!merged[key]) {
        merged[key] = {
          normName, originalName: ing.name || normName,
          baseUnit, baseQty: 0, sources: [],
          category: categorizeIngredient(ing.name || normName),
        }
      }
      merged[key].baseQty += baseQty
      if (!merged[key].sources.includes(sr.title || recipe.title))
        merged[key].sources.push(sr.title || recipe.title)
    }
  }

  const items = []
  for (const [key, item] of Object.entries(merged)) {
    if (state.locked && state.locked[key]) {
      const lock = state.locked[key]
      items.push({ key, name: item.originalName, normName: item.normName, quantity: lock.quantity, unit: lock.unit, category: item.category, sources: item.sources, locked: true, pantryReduced: false })
      continue
    }
    let { qty, unit } = fromBaseUnit(item.baseQty, item.baseUnit)
    let pantryReduced = false
    if (state.pantry && state.pantry[item.normName]) {
      const p = state.pantry[item.normName]
      const pBase = toBaseUnit(p.quantity || 0, p.unit || unit)
      const curBase = toBaseUnit(qty, unit)
      if (pBase.qty > 0) {
        const remaining = Math.max(0, curBase.qty - pBase.qty)
        const result = fromBaseUnit(remaining, item.baseUnit)
        qty = result.qty
        unit = result.unit
        pantryReduced = true
      }
    }
    if (['count', 'piece', 'pieces', 'whole', 'large', 'medium', 'small'].includes(unit)) qty = Math.ceil(qty)
    if (qty <= 0) continue
    items.push({ key, name: item.originalName, normName: item.normName, quantity: qty, unit, category: item.category, sources: item.sources, locked: false, pantryReduced })
  }

  for (const mi of (state.manualItems || [])) {
    items.push({ key: 'manual-' + mi.id, name: mi.name, normName: normalizeIngName(mi.name), quantity: mi.quantity || 1, unit: mi.unit || 'count', category: mi.category || 'other', sources: ['Manual'], locked: false, pantryReduced: false, isManual: true })
  }

  const grouped = {}
  for (const it of items) {
    if (!grouped[it.category]) grouped[it.category] = []
    grouped[it.category].push(it)
  }
  const sortedCats = Object.keys(grouped).sort((a, b) => ((CAT_META[a]?.order ?? 99) - (CAT_META[b]?.order ?? 99)))
  const result = {}
  for (const cat of sortedCats) result[cat] = grouped[cat].sort((a, b) => a.name.localeCompare(b.name))
  return result
}

export function useGrocery() {
  const [groceryState, setGroceryState] = useState(DEFAULT_STATE)
  const [allRecipes, setAllRecipes] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [mergeStatus, setMergeStatus] = useState(null) // 'loading' | 'done' | 'error' | null
  const [mergedItems, setMergedItems] = useState(null)
  const mergedCacheKeyRef = useRef(null)
  const dirty = useRef(false)

  const loadState = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [state, recipes] = await Promise.all([
        api.getGroceryState(),
        api.getRecipesJson(),
      ])
      setGroceryState(s => ({ ...DEFAULT_STATE, ...state }))
      setAllRecipes(recipes)
    } catch (e) {
      console.error('[grocery] load error:', e)
      setError(e.message || 'Failed to load grocery data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadState() }, [loadState])

  const save = useCallback(async (newState) => {
    setGroceryState(newState)
    dirty.current = true
    try {
      await api.saveGroceryState(newState)
    } catch (e) {
      console.error('[grocery] save error:', e)
      showToast('Failed to save grocery changes — please try again')
    }
  }, [])

  const addRecipes = useCallback(async (selectedRecipes) => {
    const newState = { ...groceryState, recipes: [...groceryState.recipes] }
    let added = 0
    for (const sr of selectedRecipes) {
      if (!newState.recipes.some(r => r.cardId === sr.cardId)) {
        newState.recipes.push(sr)
        added++
      }
    }
    if (added > 0) {
      mergedCacheKeyRef.current = null
      setMergedItems(null)
      setMergeStatus(null)
      await save(newState)
      try {
        const recipes = await api.getRecipesJson()
        setAllRecipes(recipes)
      } catch (e) {
        console.error('[grocery] failed to reload recipes:', e)
      }
    }
    return added
  }, [groceryState, save])

  const removeRecipe = useCallback(async (cardId) => {
    const newState = { ...groceryState, recipes: groceryState.recipes.filter(r => r.cardId !== cardId) }
    mergedCacheKeyRef.current = null
    setMergedItems(null)
    setMergeStatus(null)
    await save(newState)
  }, [groceryState, save])

  const changeServings = useCallback(async (cardId, delta) => {
    const newState = { ...groceryState, recipes: groceryState.recipes.map(r => r.cardId === cardId ? { ...r, servings: Math.max(1, (r.servings || 1) + delta) } : r) }
    mergedCacheKeyRef.current = null
    setMergedItems(null)
    setMergeStatus(null)
    await save(newState)
  }, [groceryState, save])

  const toggleCheck = useCallback(async (key, checked) => {
    const newChecked = checked ? [...(groceryState.checked || []), key] : (groceryState.checked || []).filter(k => k !== key)
    await save({ ...groceryState, checked: newChecked })
  }, [groceryState, save])

  const addManualItem = useCallback(async (item) => {
    const mi = { ...item, id: Date.now().toString(36) }
    await save({ ...groceryState, manualItems: [...(groceryState.manualItems || []), mi] })
  }, [groceryState, save])

  const removeManualItem = useCallback(async (key) => {
    const id = key.replace('manual-', '')
    await save({ ...groceryState, manualItems: (groceryState.manualItems || []).filter(m => m.id !== id) })
  }, [groceryState, save])

  const addToPantry = useCallback(async (normName, quantity, unit) => {
    const newPantry = { ...groceryState.pantry, [normName]: { quantity, unit } }
    await save({ ...groceryState, pantry: newPantry })
  }, [groceryState, save])

  const clearPantry = useCallback(async () => {
    await save({ ...groceryState, pantry: {} })
  }, [groceryState, save])

  const clearAll = useCallback(async () => {
    mergedCacheKeyRef.current = null
    setMergedItems(null)
    setMergeStatus(null)
    await save(DEFAULT_STATE)
  }, [save])

  const computed = useMemo(
    () => computeGroceryList(groceryState, allRecipes),
    [groceryState, allRecipes]
  )

  // Keep a ref so runMerge can read computed without it being a dependency
  const computedRef = useRef(computed)
  computedRef.current = computed

  // AI merge
  const runMerge = useCallback(async () => {
    const cacheKey = JSON.stringify(groceryState.recipes)
    if (mergedCacheKeyRef.current === cacheKey) return

    const currentComputed = computedRef.current
    const flatItems = []
    for (const items of Object.values(currentComputed)) {
      for (const item of items) {
        flatItems.push({ name: item.name, quantity: item.quantity, unit: item.unit, category: item.category, sources: item.sources })
      }
    }
    if (flatItems.length === 0) return

    setMergeStatus('loading')
    try {
      const data = await api.mergeIngredients(flatItems)
      if (data.warning) {
        mergedCacheKeyRef.current = cacheKey
        setMergeStatus('error')
      } else {
        mergedCacheKeyRef.current = cacheKey
        setMergedItems(data.merged)
        setMergeStatus('done')
      }
    } catch {
      mergedCacheKeyRef.current = cacheKey
      setMergeStatus('error')
    }
  }, [groceryState.recipes])

  return {
    groceryState,
    allRecipes,
    loading,
    error,
    computed,
    mergedItems,
    mergeStatus,
    runMerge,
    addRecipes,
    removeRecipe,
    changeServings,
    toggleCheck,
    addManualItem,
    removeManualItem,
    addToPantry,
    clearPantry,
    clearAll,
    reload: loadState,
    recipeCount: groceryState.recipes.length,
  }
}
