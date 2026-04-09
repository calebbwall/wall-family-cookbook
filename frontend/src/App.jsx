import { useState, useCallback } from 'react'
import { RecipesProvider, useRecipes, CATEGORIES } from './hooks/useRecipes'
import { useGrocery } from './hooks/useGrocery'
import { useChat } from './hooks/useChat'
import Nav from './components/Nav'
import Hero from './components/Hero'
import RecipeSection from './components/RecipeSection'
import AddRecipeModal from './components/AddRecipeModal'
import EditRecipeModal from './components/EditRecipeModal'
import CookMode from './components/CookMode'
import ChatPanel from './components/ChatPanel'
import GroceryTab from './components/GroceryTab'
import * as api from './api'
import { showToast } from './utils'

function AppContent() {
  const [groceryOpen, setGroceryOpen] = useState(false)
  const [cookModeRecipe, setCookModeRecipe] = useState(null)
  const [chatOpen, setChatOpen] = useState(false)
  const [editTarget, setEditTarget] = useState(null)
  const [addModalOpen, setAddModalOpen] = useState(false)

  const grocery = useGrocery()
  const chatHook = useChat()
  const { loading, error } = useRecipes()

  const handleCook = useCallback((recipe) => {
    setCookModeRecipe(recipe)
    // Set chat context for this recipe
    if (recipe?.recipeJson) {
      const rj = recipe.recipeJson
      chatHook.setRecipeContext(
        `Recipe: ${rj.title}. Ingredients: ${(rj.ingredients || []).map(i => `${i.amount} ${i.name}`).join(', ')}. Steps: ${(rj.steps || []).map((s, i) => `${i + 1}. ${s.detail}`).join(' ')}`
      )
    }
  }, [chatHook])

  const handleAddToGrocery = useCallback(async (recipe) => {
    const rj = recipe.recipeJson
    const title = rj?.title || 'Recipe'
    const servings = parseInt(rj?.servings) || 1
    const added = await grocery.addRecipes([{
      cardId: recipe.cardId,
      title,
      servings,
      baseServings: servings,
    }])
    if (added > 0) {
      showToast(`Added "${title}" to grocery list!`)
      // Pulse the grocery badge for visual feedback
      document.querySelectorAll('.grocery-badge, .grocery-badge-mobile').forEach(el => {
        el.classList.remove('badge-pulse')
        void el.offsetWidth // force reflow
        el.classList.add('badge-pulse')
      })
    } else {
      showToast(`"${title}" is already in your grocery list`)
    }
  }, [grocery])

  const handleCloseCook = useCallback(() => {
    setCookModeRecipe(null)
    chatHook.clearRecipeContext()
  }, [chatHook])

  const handleExport = useCallback(async () => {
    try {
      const data = await api.exportRecipes()
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'recipes.json'
      a.click()
      URL.revokeObjectURL(url)
      showToast('Recipes exported!')
    } catch (e) {
      showToast('Export failed')
    }
  }, [])

  const handleLogout = useCallback(async () => {
    await api.logout()
    window.location.reload()
  }, [])

  return (
    <>
      <Nav
        onAddRecipe={() => setAddModalOpen(true)}
        onGrocery={() => setGroceryOpen(true)}
        groceryCount={grocery.recipeCount}
      />

      {groceryOpen ? (
        <GroceryTab
          grocery={grocery}
          onClose={() => setGroceryOpen(false)}
        />
      ) : (
        <>
          <Hero />
          {loading && (
            <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--muted)' }}>
              Loading recipes…
            </div>
          )}
          {error && (
            <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--red)' }}>
              Error loading recipes: {error}
            </div>
          )}
          {!loading && !error && CATEGORIES.map(cat => (
            <RecipeSection
              key={cat.key}
              category={cat.key}
              onEdit={setEditTarget}
              onCook={handleCook}
              onAddRecipe={() => setAddModalOpen(true)}
              onAddToGrocery={handleAddToGrocery}
            />
          ))}
          <footer>
            <strong>Wall Family Cookbook</strong>
            Made with <span>❤️</span> by the Wall family
            <div style={{ marginTop: '0.75rem', display: 'flex', gap: '1rem', justifyContent: 'center' }}>
              <button onClick={handleExport} style={{ background: 'none', border: '1px solid var(--tan-dark)', color: 'var(--tan-dark)', padding: '0.4rem 1rem', borderRadius: 4, cursor: 'pointer', fontSize: '0.8rem' }}>📥 Export Recipes</button>
              <button onClick={handleLogout} style={{ background: 'none', border: '1px solid var(--tan-dark)', color: 'var(--tan-dark)', padding: '0.4rem 1rem', borderRadius: 4, cursor: 'pointer', fontSize: '0.8rem' }}>🚪 Sign Out</button>
            </div>
          </footer>
        </>
      )}

      {addModalOpen && (
        <AddRecipeModal onClose={() => setAddModalOpen(false)} />
      )}
      {editTarget && (
        <EditRecipeModal
          cardId={editTarget}
          onClose={() => setEditTarget(null)}
        />
      )}
      {cookModeRecipe && (
        <CookMode
          recipe={cookModeRecipe}
          onClose={handleCloseCook}
          onAskAI={() => setChatOpen(true)}
        />
      )}

      {/* Chat FAB */}
      <button
        className="chat-fab"
        onClick={() => setChatOpen(o => !o)}
        title="Chat about recipes"
        aria-label="Open recipe assistant"
      >💬</button>

      <ChatPanel
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        chatHook={chatHook}
        recipeContext={cookModeRecipe}
      />
    </>
  )
}

export default function App() {
  return (
    <RecipesProvider>
      <AppContent />
    </RecipesProvider>
  )
}
