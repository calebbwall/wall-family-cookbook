# Wall Family Cookbook

## Project Overview
A family recipe website with AI-powered features for adding, editing, and chatting about recipes. Protected by a passphrase landing page ("Joe+Linda").

## Architecture
- **Type**: Node.js/Express backend serving a single-page HTML frontend
- **Entry point**: `server.js`
- **Frontend**: `index.html` (embedded CSS/JS, Google Fonts: Playfair Display, Lato)
- **AI**: Google Gemini 2.5 Flash via `@google/generative-ai`
- **Storage**: Recipes stored in `index.html`; persisted to PostgreSQL database so they survive deploys
- **Auth**: Cookie-based passphrase gate (password: "Joe+Linda")

## Key Features
- Password-protected landing page
- Recipe flip cards with front (preview) and back (full recipe)
- AI-powered recipe adding (paste text or URL, AI formats into card HTML)
- URL recipe importing via Gemini Google Search grounding (bypasses blocked sites)
- AI-powered recipe editing (describe changes, AI regenerates card)
- AI recipe chat assistant (ask about recipes, substitutions, techniques)
- Database persistence (recipes survive restarts and redeploys)

## Dependencies
- `express` - Web server
- `@google/generative-ai` - Gemini AI SDK
- `pg` - PostgreSQL client for recipe persistence

## Required Secrets
- `GEMINI_API_KEY` - Google Gemini API key
- `DATABASE_URL` - PostgreSQL connection string (auto-provisioned by Replit)

## Database
- Table `cookbook_html`: single-row table storing the full `index.html` content
- On startup: loads HTML from database (or seeds from local file if empty)
- On recipe add/edit: saves updated HTML to both file and database

## Running the App
```
node server.js
```
Runs on port 5000 (webview).

## Deployment
- **Target**: Autoscale
- **Run command**: `node server.js`
