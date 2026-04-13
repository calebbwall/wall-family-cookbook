import { useState } from 'react'
import { CATEGORIES } from '../hooks/useRecipes'

export default function Hero() {
  const [isReturning] = useState(() => {
    const visited = localStorage.getItem('wfc_visited')
    if (!visited) { localStorage.setItem('wfc_visited', '1'); return false }
    return true
  })

  return (
    <header className={`hero${isReturning ? ' hero-compact' : ''}`} id="top">
      <div className="hero-content">
        <p className="hero-eyebrow">A Family Recipe Collection</p>
        <h1 className="hero-title">
          Wall Family
          <em>Cookbook</em>
        </h1>
        <div className="hero-rule"></div>
        <p className="hero-tagline">
          Recipes passed down, cooked with love, and always improving.<br />
          Every dish tells a story worth sharing at the table.
        </p>
        <div className="hero-pills">
          {CATEGORIES.map(cat => (
            <a
              key={cat.key}
              className="pill"
              href={`#${cat.key}`}
              onClick={e => {
                e.preventDefault()
                document.getElementById(cat.key)?.scrollIntoView({ behavior: 'smooth' })
              }}
            >
              {cat.icon} {cat.label}
            </a>
          ))}
        </div>
      </div>
    </header>
  )
}
