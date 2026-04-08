import { useState, useRef, useEffect, useMemo } from 'react'
import { useRecipes, CATEGORIES } from '../hooks/useRecipes'

export default function Nav({ onAddRecipe, onGrocery, groceryCount }) {
  const { recipes, searchQuery, setSearchQuery, sortMode, setSortMode, authorFilter, setAuthorFilter } = useRecipes()
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false)
  const [activeSection, setActiveSection] = useState('')
  const searchRef = useRef(null)

  // Scroll-spy: track which section is in view
  useEffect(() => {
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.isIntersecting) setActiveSection(entry.target.id)
      }
    }, { rootMargin: '-20% 0px -70% 0px' })

    CATEGORIES.forEach(cat => {
      const el = document.getElementById(cat.key)
      if (el) observer.observe(el)
    })
    return () => observer.disconnect()
  }, [])

  // Unique authors for filter dropdown
  const uniqueAuthors = useMemo(() => {
    const authors = new Set()
    for (const r of recipes) {
      const author = r.recipeJson?.author || r.author
      if (author) authors.add(author)
    }
    return [...authors].sort()
  }, [recipes])

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
          {uniqueAuthors.length > 1 && (
            <select
              className="sort-select"
              value={authorFilter}
              onChange={e => setAuthorFilter(e.target.value)}
              title="Filter by author"
            >
              <option value="">All authors</option>
              {uniqueAuthors.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          )}
          <button className="nav-grocery-btn" onClick={onGrocery}>
            🛒 Groceries
            {groceryCount > 0 && (
              <span className="grocery-badge">{groceryCount}</span>
            )}
          </button>
          <button className="nav-add-btn" onClick={onAddRecipe}>+ Add Recipe</button>
        </div>
      </nav>

      {/* Mobile search + filter bar */}
      <div className="mobile-search-bar">
        <input
          type="search"
          placeholder="Search recipes…"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          style={{ flex: 1, fontSize: '0.85rem', padding: '0.4rem 0.6rem', border: '1px solid var(--tan-dark)', borderRadius: 6, background: 'rgba(255,255,255,0.08)', color: 'var(--tan)' }}
        />
        <select value={sortMode} onChange={e => setSortMode(e.target.value)}
          style={{ fontSize: '0.78rem', padding: '0.4rem', border: '1px solid var(--tan-dark)', borderRadius: 6, background: 'rgba(255,255,255,0.08)', color: 'var(--tan)' }}>
          <option value="newest">Newest</option>
          <option value="oldest">Oldest</option>
          <option value="az">A→Z</option>
          <option value="za">Z→A</option>
        </select>
        {uniqueAuthors.length > 1 && (
          <select value={authorFilter} onChange={e => setAuthorFilter(e.target.value)}
            style={{ fontSize: '0.78rem', padding: '0.4rem', border: '1px solid var(--tan-dark)', borderRadius: 6, background: 'rgba(255,255,255,0.08)', color: 'var(--tan)' }}>
            <option value="">All</option>
            {uniqueAuthors.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        )}
      </div>

      {/* Mobile-only scrollable category bar */}
      <nav className="mobile-nav-bar" aria-label="Jump to section">
        {CATEGORIES.map(cat => (
          <a key={cat.key} href={`#${cat.key}`}
            className={activeSection === cat.key ? 'active' : ''}
            onClick={e => {
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
