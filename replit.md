# Wall Family Cookbook

## Project Overview
A family recipe website with AI-powered features for adding, editing, and chatting about recipes. Protected by a passphrase landing page ("Joe+Linda").

## Architecture
- **Type**: Python/Flask backend serving a single-page HTML frontend
- **Entry point**: `app.py`
- **Frontend**: `public/index.html` (embedded CSS/JS, Google Fonts: Playfair Display, Lato)
- **AI**: Google Gemini 2.5 Flash via `google-generativeai`
- **Storage**: Recipes stored individually in PostgreSQL `recipes` table
- **Auth**: Cookie-based passphrase gate (password: "Joe+Linda")

## Key Features
- Password-protected landing page
- Recipe flip cards with front (preview) and back (full recipe)
- AI-powered recipe adding (paste text or URL, AI formats into card HTML)
- URL recipe importing via Gemini Google Search grounding (bypasses blocked sites)
- AI-powered recipe editing (describe changes, AI regenerates card)
- Direct HTML editing of recipe cards
- Recipe deletion with confirmation
- AI recipe chat assistant (ask about recipes, substitutions, techniques)
- Image/media upload support for recipe cards
- Database persistence (recipes survive restarts and redeploys)

## Dependencies (requirements.txt)
- `Flask` - Web server
- `google-generativeai` - Gemini AI SDK
- `psycopg2-binary` - PostgreSQL client
- `requests` - HTTP client for URL fetching
- `gunicorn` - Production WSGI server
- `Werkzeug` - WSGI utilities

## Required Secrets
- `GEMINI_API_KEY` - Google Gemini API key
- `DATABASE_URL` - PostgreSQL connection string (auto-provisioned by Replit)

## Database
- Table `recipes`: stores individual recipe cards (id, category, author_name, card_html, card_id, created_at, recipe_json, source_type)
- `recipe_json` column: structured JSON extracted by Gemini (enables Cook Now, cook mode, ingredient list, etc.)
- Table `cookbook_html` (legacy): old single-row HTML storage, migrated from on first run
- Pages are built dynamically by injecting recipe cards from DB into the HTML template
- At startup, `backfill_recipe_json()` automatically fills in missing `recipe_json` for legacy cards using Gemini

## Running the App
```
python app.py
```
Runs on port 5000 (webview).

## Deployment
- **Target**: Autoscale
- **Run command**: `python app.py`
