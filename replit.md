# Wall Family Cookbook

## Project Overview
A family recipe website with AI-powered features for adding, editing, and chatting about recipes. Protected by a passphrase landing page ("Joe+Linda").

## Architecture
- **Type**: Node.js/Express backend serving a single-page HTML frontend
- **Entry point**: `server.js`
- **Frontend**: `index.html` (embedded CSS/JS, Google Fonts: Playfair Display, Lato)
- **AI**: Google Gemini 2.0 Flash via `@google/generative-ai`
- **Storage**: Recipes stored directly in `index.html`, synced to GitHub repo on changes
- **Auth**: Cookie-based passphrase gate (password: "Joe+Linda")

## Key Features
- Password-protected landing page
- Recipe flip cards with front (preview) and back (full recipe)
- AI-powered recipe adding (paste text or URL, AI formats into card HTML)
- AI-powered recipe editing (describe changes, AI regenerates card)
- AI recipe chat assistant (ask about recipes, substitutions, techniques)
- GitHub sync (pulls latest on startup, pushes on recipe changes)

## Dependencies
- `express` - Web server
- `@google/generative-ai` - Gemini AI SDK

## Required Secrets
- `GEMINI_API_KEY` - Google Gemini API key
- `GITHUB_TOKEN` - GitHub personal access token (for syncing recipes)
- `GITHUB_OWNER` - GitHub repo owner (default: calebbwall)
- `GITHUB_REPO` - GitHub repo name (default: wall-family-cookbook)

## Running the App
```
node server.js
```
Runs on port 5000 (webview).

## Deployment
- **Target**: Autoscale
- **Run command**: `node server.js`
