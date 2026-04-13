import { useState, useCallback, useRef, useEffect } from 'react'
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

// ── Focus trap utility ──────────────────────────────────────────
function useFocusTrap(active) {
  const ref = useRef(null)

  useEffect(() => {
    if (!active || !ref.current) return
    const el = ref.current
    const focusable = () => el.querySelectorAll(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
    const prevFocused = document.activeElement

    // Focus first element
    requestAnimationFrame(() => {
      const items = focusable()
      if (items.length) items[0].focus()
    })

    function handleKeyDown(e) {
      if (e.key !== 'Tab') return
      const items = focusable()
      if (!items.length) return
      const first = items[0]
      const last = items[items.length - 1]
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus() }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus() }
      }
    }

    el.addEventListener('keydown', handleKeyDown)
    return () => {
      el.removeEventListener('keydown', handleKeyDown)
      if (prevFocused && prevFocused.focus) prevFocused.focus()
    }
  }, [active])

  return ref
}

// ── Hash routing helpers ────────────────────────────────────────
function getHashRoute() {
  const hash = window.location.hash.slice(1) // remove #
  if (hash === 'grocery') return { view: 'grocery' }
  if (hash.startsWith('edit/')) return { view: 'edit', cardId: hash.slice(5) }
  return { view: 'recipes' }
}

function setHash(hash) {
  if (window.location.hash === '#' + hash || (!hash && !window.location.hash)) return
  window.history.pushState(null, '', hash ? '#' + hash : window.location.pathname)
}

function AppContent() {
  const [groceryOpen, setGroceryOpen] = useState(() => getHashRoute().view === 'grocery')
  const [cookModeRecipe, setCookModeRecipe] = useState(null)
  const [chatOpen, setChatOpen] = useState(false)
  const [editTarget, setEditTarget] = useState(() => {
    const route = getHashRoute()
    return route.view === 'edit' ? route.cardId : null
  })
  const [addModalOpen, setAddModalOpen] = useState(false)
  const scrollPosRef = useRef(0)

  const grocery = useGrocery()
  const chatHook = useChat()
  const { loading, error } = useRecipes()

  // Focus trap refs for modals
  const addModalTrapRef = useFocusTrap(addModalOpen)
  const editModalTrapRef = useFocusTrap(!!editTarget)

  // ── Sync hash with state ────────────────────────────────────
  useEffect(() => {
    if (groceryOpen) setHash('grocery')
    else if (editTarget) setHash('edit/' + editTarget)
    else setHash('')
  }, [groceryOpen, editTarget])

  // ── Listen for browser back/forward ─────────────────────────
  useEffect(() => {
    function onPopState() {
      const route = getHashRoute()
      if (route.view === 'grocery') {
        setGroceryOpen(true)
      } else if (route.view === 'edit') {
        setGroceryOpen(false)
        setEditTarget(route.cardId)
      } else {
        setGroceryOpen(false)
        setEditTarget(null)
        requestAnimationFrame(() => window.scrollTo(0, scrollPosRef.current))
      }
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const openGrocery = useCallback(() => {
    scrollPosRef.current = window.scrollY
    setGroceryOpen(true)
  }, [])

  const closeGrocery = useCallback(() => {
    setGroceryOpen(false)
    requestAnimationFrame(() => window.scrollTo(0, scrollPosRef.current))
  }, [])

  const handleCook = useCallback((recipe) => {
    setCookModeRecipe(recipe)
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
      document.querySelectorAll('.grocery-badge, .grocery-badge-mobile').forEach(el => {
        el.classList.remove('badge-pulse')
        void el.offsetWidth
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

  const openEdit = useCallback((cardId) => {
    setEditTarget(cardId)
  }, [])

  const closeEdit = useCallback(() => {
    setEditTarget(null)
  }, [])

  const recipesContent = (
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
          onEdit={openEdit}
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
  )

  return (
    <>
      {/* Skip to content link */}
      <a href="#main-content" className="skip-to-content">Skip to recipes</a>

      <Nav
        onAddRecipe={() => setAddModalOpen(true)}
        onGrocery={openGrocery}
        groceryCount={grocery.recipeCount}
      />

      <div className={`app-layout${groceryOpen ? ' app-layout-split' : ''}`}>
        <main id="main-content" className="app-main">
          {groceryOpen ? (
            <>
              {/* On narrow screens, grocery replaces recipes */}
              <div className="app-grocery-only">
                <GroceryTab grocery={grocery} onClose={closeGrocery} />
              </div>
              {/* On wide screens, recipes still show */}
              <div className="app-recipes-with-sidebar">
                {recipesContent}
              </div>
            </>
          ) : (
            recipesContent
          )}
        </main>
        {groceryOpen && (
          <aside className="app-grocery-sidebar">
            <GroceryTab grocery={grocery} onClose={closeGrocery} />
          </aside>
        )}
      </div>

      {addModalOpen && (
        <div ref={addModalTrapRef}>
          <AddRecipeModal onClose={() => setAddModalOpen(false)} />
        </div>
      )}
      {editTarget && (
        <div ref={editModalTrapRef}>
          <EditRecipeModal
            cardId={editTarget}
            onClose={closeEdit}
          />
        </div>
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
