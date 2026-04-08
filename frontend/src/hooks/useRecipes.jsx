import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import * as api from '../api'

const CATEGORIES = [
  { key: 'appetizer', label: 'Appetizers', icon: '🥗', section: 'APPETIZERS' },
  { key: 'entree', label: 'Entrées', icon: '🍽️', section: 'ENTREES' },
  { key: 'side', label: 'Sides', icon: '🥦', section: 'SIDES' },
  { key: 'snack', label: 'Snacks', icon: '🍿', section: 'SNACKS' },
  { key: 'breakfast', label: 'Breakfast', icon: '🍳', section: 'BREAKFAST' },
  { key: 'dessert', label: 'Desserts', icon: '🍪', section: 'DESSERTS' },
]

export { CATEGORIES }

const RecipesContext = createContext(null)

export function RecipesProvider({ children }) {
  const [recipes, setRecipes] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [sortMode, setSortMode] = useState('newest')
  const [authorFilter, setAuthorFilter] = useState('')

  const loadRecipes = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const data = await api.fetchRecipes()
      setRecipes(data)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadRecipes() }, [loadRecipes])

  const addRecipe = useCallback(async (payload) => {
    const result = await api.addRecipe(payload)
    if (result.error) throw new Error(result.error)
    // Reload to get the full recipe data from server
    await loadRecipes()
    return result
  }, [loadRecipes])

  const editRecipeAction = useCallback(async (payload) => {
    const result = await api.editRecipe(payload)
    if (result.error) throw new Error(result.error)
    await loadRecipes()
    return result
  }, [loadRecipes])

  const deleteRecipeAction = useCallback(async (cardId) => {
    const result = await api.deleteRecipe(cardId)
    if (result.error) throw new Error(result.error)
    setRecipes(prev => prev.filter(r => r.cardId !== cardId))
    return result
  }, [])

  const saveDirectEdit = useCallback(async (payload) => {
    const result = await api.saveCardHtml(payload)
    if (result.error) throw new Error(result.error)
    await loadRecipes()
    return result
  }, [loadRecipes])

  // Group recipes by category with search/sort applied
  const getGrouped = useCallback(() => {
    let filtered = recipes
    if (authorFilter) {
      filtered = filtered.filter(r => (r.author || '') === authorFilter)
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      filtered = filtered.filter(r => {
        const title = (r.recipeJson?.title || '').toLowerCase()
        const author = (r.author || '').toLowerCase()
        return title.includes(q) || author.includes(q)
      })
    }

    // Sort
    let sorted = [...filtered]
    switch (sortMode) {
      case 'oldest':
        sorted.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''))
        break
      case 'newest':
        sorted.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
        break
      case 'az':
        sorted.sort((a, b) => (a.recipeJson?.title || '').localeCompare(b.recipeJson?.title || ''))
        break
      case 'za':
        sorted.sort((a, b) => (b.recipeJson?.title || '').localeCompare(a.recipeJson?.title || ''))
        break
    }

    const grouped = {}
    for (const cat of CATEGORIES) {
      grouped[cat.key] = sorted.filter(r => r.category === cat.key)
    }
    return grouped
  }, [recipes, searchQuery, sortMode, authorFilter])

  const value = {
    recipes,
    loading,
    error,
    searchQuery,
    setSearchQuery,
    sortMode,
    setSortMode,
    authorFilter,
    setAuthorFilter,
    addRecipe,
    editRecipe: editRecipeAction,
    deleteRecipe: deleteRecipeAction,
    saveDirectEdit,
    getGrouped,
    reload: loadRecipes,
  }

  return (
    <RecipesContext.Provider value={value}>
      {children}
    </RecipesContext.Provider>
  )
}

export function useRecipes() {
  const ctx = useContext(RecipesContext)
  if (!ctx) throw new Error('useRecipes must be used within RecipesProvider')
  return ctx
}
