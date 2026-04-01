import { useRecipes, CATEGORIES } from '../hooks/useRecipes'
import RecipeCard from './RecipeCard'

const EMPTY_MESSAGES = {
  appetizer: { emoji: '🥗', title: 'No appetizers yet', sub: 'Be the first to add one!' },
  entree: { emoji: '🍽️', title: 'No entrées yet', sub: 'Add a main course!' },
  side: { emoji: '🥦', title: 'No sides yet', sub: 'Add a side dish!' },
  snack: { emoji: '🍿', title: 'No snacks yet', sub: 'Share your favorite snack!' },
  breakfast: { emoji: '🍳', title: 'No breakfast recipes yet', sub: 'Start the morning right!' },
  dessert: { emoji: '🍪', title: 'No desserts yet', sub: 'Got a sweet tooth? Add one!' },
}

export default function RecipeSection({ category, onEdit, onCook, onAddRecipe }) {
  const { getGrouped } = useRecipes()
  const grouped = getGrouped()
  const recipes = grouped[category] || []
  const cat = CATEGORIES.find(c => c.key === category)
  if (!cat) return null

  const empty = EMPTY_MESSAGES[category] || { emoji: '📝', title: 'No recipes yet', sub: 'Add one!' }

  return (
    <>
      <section className="section" id={category}>
        <div className="section-header">
          <span className="section-icon">{cat.icon}</span>
          <h2 className="section-title">{cat.label}</h2>
          <span className="section-count">{recipes.length} recipe{recipes.length !== 1 ? 's' : ''}</span>
        </div>

        {recipes.length === 0 ? (
          <div className="empty-state">
            <div className="empty-emoji">{empty.emoji}</div>
            <div className="empty-title">{empty.title}</div>
            <div className="empty-sub">{empty.sub}</div>
            <button className="empty-cta-btn" onClick={onAddRecipe}>+ Add Recipe</button>
          </div>
        ) : (
          <div className="card-grid">
            {recipes.map(recipe => (
              <RecipeCard
                key={recipe.cardId}
                recipe={recipe}
                onEdit={onEdit}
                onCook={onCook}
              />
            ))}
          </div>
        )}
      </section>
      <div className="section-divider"></div>
    </>
  )
}
