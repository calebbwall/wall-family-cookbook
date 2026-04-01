import { useState, useRef, useEffect } from 'react'
import { useRecipes, CATEGORIES } from '../hooks/useRecipes'

export default function Nav({ onAddRecipe, onGrocery, groceryCount }) {
  const { searchQuery, setSearchQuery, sortMode, setSortMode } = useRecipes()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const searchRef = useRef(null)

  return (
    <>
      {/* Main nav */}
      <nav>
        <a href="#top" className="nav-brand" onClick={e => { e.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }) }}>
          Wall Family Cookbook
        </a>

        <ul className="nav-links">
          {CATEGORIES.map(cat => (
            <li key={cat.key}>
              <a href={`#${cat.key}`} onClick={e => {
                e.preventDefault()
                document.getElementById(cat.key)?.scrollIntoView({ behavior: 'smooth' })
              }}>{cat.label}</a>
            </li>
          ))}
        </ul>

        <div className="nav-right">
          <input
            className="nav-search"
            type="search"
            placeholder="Search recipes…"
            aria-label="Search recipes"
            autoComplete="off"
            ref={searchRef}
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
          <select
            className="sort-select"
            value={sortMode}
            onChange={e => setSortMode(e.target.value)}
            title="Sort recipes"
          >
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
            <option value="az">A → Z</option>
            <option value="za">Z → A</option>
          </select>
          <button className="nav-grocery-btn" onClick={onGrocery}>
            🛒 Groceries
            {groceryCount > 0 && (
              <span className="grocery-badge">{groceryCount}</span>
            )}
          </button>
          <button className="nav-add-btn" onClick={onAddRecipe}>+ Add Recipe</button>
        </div>
      </nav>

      {/* Mobile-only scrollable category bar */}
      <nav className="mobile-nav-bar" aria-label="Jump to section">
        {CATEGORIES.map(cat => (
          <a key={cat.key} href={`#${cat.key}`} onClick={e => {
            e.preventDefault()
            document.getElementById(cat.key)?.scrollIntoView({ behavior: 'smooth' })
          }}>{cat.icon} {cat.label}</a>
        ))}
      </nav>

      {/* Mobile-only bottom grocery bar */}
      <div className="mobile-grocery-bar">
        <button onClick={onGrocery}>
          🛒 Groceries
          {groceryCount > 0 && (
            <span className="grocery-badge-mobile">{groceryCount}</span>
          )}
        </button>
      </div>
    </>
  )
}
