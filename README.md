# Wall Family Cookbook 🍽️

A private recipe website for the Wall family. Browse recipes, add your own, and keep the family's cooking traditions in one place.

---

## For Family Members

### Browsing Recipes

Open the site and enter the family passphrase. You'll see recipes organized into six sections: **Appetizers**, **Entrées**, **Sides**, **Snacks**, **Breakfast**, and **Desserts**.

Click any recipe card to flip it over and see the full ingredients and steps.

### Adding a Recipe

1. Click the red **"+ Add a Recipe"** button in the top-right corner
2. Choose a category from the dropdown
3. Type your name in the **Your Name** field
4. In the large text box, either:
   - **Paste the recipe** — copy the text from anywhere and paste it in
   - **Paste a link** — copy a URL from AllRecipes, NYT Cooking, or any recipe website
5. Click **Add to Cookbook**

The AI will read your recipe and format it into a card automatically. It takes about 10–15 seconds. Your recipe will appear on the page when it's ready.

### Editing a Recipe

Click the small **pencil icon** (✏️) on any recipe card to open the editor. You can describe what you want to change in plain language — for example: *"Change the baking temperature to 375°F"* or *"Add a note about using salted butter."*

### Tips

- You can paste a recipe from a screenshot by typing it out — the AI is good at figuring out the format
- If a website blocks the link import, just copy and paste the recipe text directly
- Recipe cards flip back when you click them again or press **Escape**

---

## For Developers

### What This Is

A Node.js/Express app with a single-page vanilla JavaScript frontend. No build step. Recipes are stored in PostgreSQL. AI formatting is powered by Google Gemini 2.5 Flash.

### Running Locally

```bash
git clone https://github.com/calebbwall/wall-family-cookbook
cd wall-family-cookbook
npm install
```

Create a `.env` file (this file is gitignored):

```
PASSPHRASE=Joe+Linda
GEMINI_API_KEY=your-google-ai-studio-key
DATABASE_URL=your-postgresql-connection-string
```

Then start the server:

```bash
node server.js
# or
npm start
```

Open `http://localhost:5000`.

### Running on Replit

1. Import the GitHub repo into a new Replit project
2. Open the **Database** panel and add a PostgreSQL database — Replit will set `DATABASE_URL` automatically
3. Open the **Secrets** panel (🔒) and add:
   - `GEMINI_API_KEY` — get a free key from [Google AI Studio](https://aistudio.google.com)
   - `PASSPHRASE` — the family passphrase
4. Click **Run** — the server starts on port 5000, mapped to port 80 externally

### Environment Variables

| Variable | Required | Description |
|---|---|---|
| `PASSPHRASE` | Yes* | Family passphrase to access the site. Defaults to `'Joe+Linda'` if not set. |
| `GEMINI_API_KEY` | Yes | Google Gemini API key. Required for adding/editing recipes. |
| `DATABASE_URL` | Yes | PostgreSQL connection string. Auto-set by Replit's database panel. |

*The fallback default is fine for local development. Set a real secret in production.

### Architecture

```
server.js       Express backend — auth, API routes, AI calls, DB queries, page assembly
index.html      Entire frontend — HTML structure, embedded CSS (~900 lines), vanilla JS (~450 lines)
package.json    Dependencies: express, @google/generative-ai, pg
ROADMAP.md      Full development roadmap and improvement plan
```

### Development Workflow

Changes flow: **GitHub → Replit**

1. Edit files locally (or via Claude Code)
2. Commit and push to `master` (or a `claude/*` branch — auto-merge is configured)
3. On Replit, pull the latest changes or use the built-in Git panel
4. The server restarts automatically on Replit after a pull

### Key API Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/login` | Authenticate with passphrase, sets auth cookie |
| `POST` | `/api/logout` | Clear session |
| `GET` | `/api/health` | Health check (unauthenticated) |
| `POST` | `/api/add-recipe` | Add a recipe via text or URL (AI-powered) |
| `POST` | `/api/edit-recipe` | Edit an existing recipe (AI-powered) |
| `POST` | `/api/save-card-html` | Save recipe HTML directly (bypasses AI) |
| `POST` | `/api/delete-recipe` | Delete a recipe by card ID |
| `POST` | `/api/chat` | AI cooking assistant chat |

### Reporting Issues

Open an issue on GitHub: [github.com/calebbwall/wall-family-cookbook/issues](https://github.com/calebbwall/wall-family-cookbook/issues)
