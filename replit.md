# Wall Family Cookbook

## Project Overview
A single-page static HTML website featuring the Wall Family Cookbook. The entire site is contained in a single `index.html` file with embedded CSS and JavaScript.

## Architecture
- **Type**: Static HTML site (no build system, no backend, no dependencies)
- **Entry point**: `index.html`
- **Styling**: Inline CSS with Google Fonts (Playfair Display, Lato)

## Running the App
The site is served via Python's built-in HTTP server:
```
python3 -m http.server 5000
```
This runs on port 5000 (webview).

## Deployment
- **Target**: Static
- **Public directory**: `.` (root)
