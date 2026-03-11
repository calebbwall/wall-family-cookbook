/**
 * Wall Family Cookbook — Express Server
 *
 * Architecture:
 *   - Serves public/ as static files (style.css, app.js)
 *   - Dynamically builds pages by injecting recipe cards into public/index.html template
 *   - Stores recipes in PostgreSQL (card_html column = full flip-card HTML blob)
 *   - Uses Google Gemini AI to format recipe text/URLs into card HTML
 *
 * SETUP (Replit Secrets tab — never put these in code):
 *   GEMINI_API_KEY  → Get from https://aistudio.google.com (free tier available)
 *   DATABASE_URL    → Auto-provisioned by Replit PostgreSQL
 *   PASSPHRASE      → Family passphrase to access the site (default: Joe+Linda)
 *
 * File structure:
 *   server.js         ← this file (Express server, ~900 lines)
 *   public/index.html ← HTML template with <!-- SECTION_START/END --> markers
 *   public/style.css  ← all CSS (extracted for clean separation)
 *   public/app.js     ← all client-side JS (extracted for clean separation)
 */

import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { GoogleGenerativeAI } from '@google/generative-ai';
import pg from 'pg';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const HTML_PATH  = path.join(__dirname, 'public', 'index.html');
const PORT       = process.env.PORT || 5000;

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

// Template HTML — loaded once at startup, never modified on disk
let templateHtml = null;

const SECTION_MAP = {
  appetizer: 'APPETIZERS',
  entree:    'ENTREES',
  lunch:     'ENTREES',
  side:      'SIDES',
  snack:     'SNACKS',
  breakfast: 'BREAKFAST',
  dessert:   'DESSERTS',
};

// Canonical category per section (used for migration)
const SECTION_TO_CATEGORY = {
  APPETIZERS: 'appetizer',
  ENTREES:    'entree',
  SIDES:      'side',
  SNACKS:     'snack',
  BREAKFAST:  'breakfast',
  DESSERTS:   'dessert',
};

// ── Database ──────────────────────────────────────────────────────────────────

async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS recipes (
      id          SERIAL PRIMARY KEY,
      category    TEXT NOT NULL,
      author_name TEXT NOT NULL,
      card_html   TEXT NOT NULL,
      card_id     TEXT UNIQUE NOT NULL,
      created_at  TIMESTAMP DEFAULT NOW()
    )
  `);
}

/**
 * One-time migration: pull recipe cards out of the old cookbook_html table
 * (where the whole index.html was stored as a blob) and insert them as
 * individual rows in the new recipes table.
 */
async function migrateFromOldTable() {
  try {
    const result = await pool.query('SELECT content FROM cookbook_html WHERE id = 1');
    if (result.rows.length === 0) return 0;

    const html      = result.rows[0].content;
    const endMarker = '</div><!-- /flip-card -->';
    let count       = 0;

    for (const [sectionKey, category] of Object.entries(SECTION_TO_CATEGORY)) {
      const startIdx = html.indexOf(`<!-- ${sectionKey}_START -->`);
      const endIdx   = html.indexOf(`<!-- ${sectionKey}_END -->`);
      if (startIdx === -1 || endIdx === -1) continue;

      const sectionHtml = html.slice(startIdx, endIdx);
      const cardPattern = /<div class="flip-card" id="(card-[^"]+)"/g;
      let match;

      while ((match = cardPattern.exec(sectionHtml)) !== null) {
        const cardId      = match[1];
        const cardStartPos = match.index;
        const cardEndPos  = sectionHtml.indexOf(endMarker, cardStartPos);
        if (cardEndPos === -1) continue;

        const cardHtml   = sectionHtml.slice(cardStartPos, cardEndPos + endMarker.length);
        const authorM    = cardHtml.match(/class="front-author">[^<]*<span>([^<]+)</);
        const authorName = authorM ? authorM[1] : 'Family';

        await pool.query(
          `INSERT INTO recipes (category, author_name, card_html, card_id)
           VALUES ($1, $2, $3, $4) ON CONFLICT (card_id) DO NOTHING`,
          [category, authorName, cardHtml, cardId]
        );
        count++;
      }
    }

    console.log(`[migration] Migrated ${count} recipe(s) from old cookbook_html table`);
    return count;
  } catch (err) {
    console.warn('[migration] No old table to migrate from:', err.message);
    return 0;
  }
}

// ── Page builder ──────────────────────────────────────────────────────────────

async function buildPage() {
  const { rows } = await pool.query('SELECT * FROM recipes ORDER BY created_at ASC');
  let html = templateHtml;

  for (const [sectionKey, _category] of Object.entries(SECTION_TO_CATEGORY)) {
    const sectionCards = rows.filter(r => SECTION_MAP[r.category] === sectionKey);
    const count        = sectionCards.length;
    const countLabel   = count === 1 ? '1 recipe' : `${count} recipes`;
    const sectionId    = sectionKey.toLowerCase();

    // Inject cards between START/END markers
    let injection = '';
    if (sectionCards.length > 0) {
      const cardsHtml = sectionCards.map(r => r.card_html).join('\n    ');
      injection = `\n  <div class="card-grid">\n    ${cardsHtml}\n  </div>\n  `;
    }

    html = html.replace(
      new RegExp(`(<!-- ${sectionKey}_START -->)[\\s\\S]*?(<!-- ${sectionKey}_END -->)`),
      `$1${injection}$2`
    );

    // Update recipe count in section header
    html = html.replace(
      new RegExp(`(<span class="section-count" id="count-${sectionId}">)[^<]*(</span>)`),
      `$1${countLabel}$2`
    );

    // Show/hide empty state
    if (count > 0) {
      html = html.replace(
        `<div class="empty-state" id="empty-${sectionId}">`,
        `<div class="empty-state" id="empty-${sectionId}" style="display:none">`
      );
    }
  }

  return html;
}

// ── Auth ──────────────────────────────────────────────────────────────────────

const PASSPHRASE     = process.env.PASSPHRASE || 'Joe+Linda';
const COOKIE_NAME    = 'wfc_auth';
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60; // 30 days in seconds

function makeAuthToken(passphrase) {
  return crypto.createHmac('sha256', 'wfc-2024-salt').update(passphrase).digest('hex');
}

const VALID_TOKEN = makeAuthToken(PASSPHRASE);

function parseCookies(cookieHeader) {
  if (!cookieHeader) return {};
  return Object.fromEntries(
    cookieHeader.split(';')
      .map(c => c.trim().split('='))
      .filter(([k]) => k)
      .map(([k, ...v]) => [k.trim(), decodeURIComponent(v.join('=').trim())])
  );
}

function requireAuth(req, res, next) {
  const cookies = parseCookies(req.headers.cookie);
  if (cookies[COOKIE_NAME] === VALID_TOKEN) return next();
  res.status(200).send(buildGatePage());
}

function buildGatePage(errorMsg = '') {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Wall Family Cookbook</title>
  <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;0,900;1,400&family=Lato:wght@300;400;700&display=swap" rel="stylesheet"/>
  <style>
    :root {
      --red:#8B1A1A; --red-light:#A52828;
      --cream:#FAF6F0; --tan:#E8DDD0; --tan-dark:#C9B99A;
      --brown:#5C3A1E; --dark:#2A1A0E; --muted:#8A7060; --white:#FFFFFF;
    }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Lato', sans-serif;
      background: var(--dark);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1rem;
    }
    .gate-card {
      background: var(--cream);
      border-radius: 18px;
      padding: 3.2rem 2.8rem;
      max-width: 420px;
      width: 100%;
      text-align: center;
      box-shadow: 0 28px 72px rgba(0,0,0,0.55);
    }
    .gate-emoji { font-size: 3.2rem; margin-bottom: 1.3rem; }
    .gate-title {
      font-family: 'Playfair Display', serif;
      font-size: 2.1rem;
      font-weight: 900;
      color: var(--dark);
      margin-bottom: 0.35rem;
    }
    .gate-sub {
      font-size: 0.87rem;
      color: var(--muted);
      font-style: italic;
      margin-bottom: 2.2rem;
    }
    .gate-input {
      width: 100%;
      border: 1.5px solid var(--tan-dark);
      border-radius: 8px;
      padding: 0.85rem 1rem;
      font-size: 1rem;
      font-family: 'Lato', sans-serif;
      background: var(--white);
      color: var(--dark);
      text-align: center;
      letter-spacing: 0.06em;
      outline: none;
      transition: border-color 0.15s;
    }
    .gate-input:focus { border-color: var(--red); }
    .gate-btn {
      display: block;
      width: 100%;
      margin-top: 1rem;
      background: var(--red);
      color: var(--white);
      border: none;
      padding: 0.95rem;
      border-radius: 8px;
      font-size: 0.9rem;
      font-weight: 700;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      cursor: pointer;
      transition: background 0.2s;
    }
    .gate-btn:hover { background: var(--red-light); }
    .gate-error {
      margin-top: 0.9rem;
      font-size: 0.83rem;
      color: var(--red);
      font-style: italic;
      min-height: 1.3em;
    }
    .gate-rule {
      width: 48px; height: 3px;
      background: var(--red);
      margin: 1.4rem auto 1.8rem;
    }
  </style>
</head>
<body>
  <div class="gate-card">
    <div class="gate-emoji">📖</div>
    <h1 class="gate-title">Wall Family Cookbook</h1>
    <div class="gate-rule"></div>
    <p class="gate-sub">Family recipes, just for us.</p>
    <form method="POST" action="/api/login">
      <input class="gate-input" type="password" name="passphrase"
             placeholder="Enter passphrase" autofocus autocomplete="current-password"/>
      <button class="gate-btn" type="submit">Enter the Cookbook</button>
      <p class="gate-error">${errorMsg}</p>
    </form>
  </div>
</body>
</html>`;
}

// ── URL fetcher ───────────────────────────────────────────────────────────────

async function fetchUrlContent(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    signal: AbortSignal.timeout(15000),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`That website blocked the request (${res.status}). Copy the recipe text from the page and paste it here instead.`);

  const html = await res.text();
  let text = '';

  const jsonLdMatch = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi);
  if (jsonLdMatch) {
    for (const block of jsonLdMatch) {
      const inner = block.replace(/<script[^>]*>/i, '').replace(/<\/script>/i, '').trim();
      try {
        const parsed = JSON.parse(inner);
        const items = Array.isArray(parsed) ? parsed : parsed['@graph'] || [parsed];
        for (const item of items) {
          if (item['@type'] === 'Recipe' || (Array.isArray(item['@type']) && item['@type'].includes('Recipe'))) {
            const parts = [item.name || ''];
            if (item.description) parts.push(item.description);
            if (Array.isArray(item.recipeIngredient)) parts.push('Ingredients:', ...item.recipeIngredient);
            if (Array.isArray(item.recipeInstructions)) {
              parts.push('Instructions:');
              for (const step of item.recipeInstructions) {
                parts.push(typeof step === 'string' ? step : step.text || step.name || '');
              }
            }
            if (item.recipeYield) parts.push('Yield: ' + (Array.isArray(item.recipeYield) ? item.recipeYield.join(', ') : item.recipeYield));
            if (item.prepTime) parts.push('Prep: ' + item.prepTime);
            if (item.cookTime) parts.push('Cook: ' + item.cookTime);
            text = parts.filter(Boolean).join('\n');
            break;
          }
        }
      } catch { /* skip invalid JSON-LD */ }
      if (text) break;
    }
  }

  if (!text || text.length < 80) {
    text = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  text = text.slice(0, 12000);
  if (text.length < 80) throw new Error("That URL doesn't have readable recipe text — try pasting the recipe directly");
  return text;
}

// ── Card ID generator ─────────────────────────────────────────────────────────

function slugify(text) {
  return 'card-' + text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 28);
}

async function generateUniqueId(baseName) {
  let id = slugify(baseName);
  let n  = 2;
  while (true) {
    const { rows } = await pool.query('SELECT 1 FROM recipes WHERE card_id = $1', [id]);
    if (rows.length === 0) break;
    id = slugify(baseName) + '-' + n++;
  }
  return id;
}

// ── Card HTML template ────────────────────────────────────────────────────────

const CARD_TEMPLATE = (cardId, authorName) => `<div class="flip-card" id="${cardId}" onclick="toggleFlip(this)">
  <div class="flip-card-inner">

    <div class="flip-front">
      <div class="front-img">
        [ONE EMOJI REPRESENTING THE DISH]
        <button class="front-edit-btn" onclick="event.stopPropagation(); openEditModal('${cardId}')" title="Edit recipe">✏️</button>
        <span class="front-badge">[Dish Type · Category]</span>
        <span class="front-hint">↻ Tap to see recipe</span>
      </div>
      <div class="front-body">
        <div>
          <h3 class="front-title">[Recipe Title]</h3>
          <p class="front-sub">[Short subtitle: source, style, or key descriptor]</p>
          <div class="front-chips">
            <span class="chip">[Yield or Serves]</span>
            <span class="chip">[Temp if applicable, else Prep Time]</span>
            <span class="chip">[Total Time]</span>
            <span class="chip">[Texture or Key Quality]</span>
          </div>
        </div>
        <p class="front-author">Added by <span>${authorName}</span></p>
      </div>
    </div>

    <div class="flip-back">
      <div class="back-header">
        <div class="back-title">[Recipe Title]</div>
        <button class="back-flip-btn"
                onclick="event.stopPropagation(); toggleFlip(document.getElementById('${cardId}'))"
                title="Flip back">↺</button>
      </div>
      <div class="back-scroll">

        <div class="back-stats">
          <div class="back-stat">
            <span class="back-stat-label">[Stat 1 Label e.g. Yield]</span>
            <span class="back-stat-val">[Stat 1 Value]</span>
          </div>
          <div class="back-stat">
            <span class="back-stat-label">[Stat 2 Label e.g. Temp or Pan]</span>
            <span class="back-stat-val">[Stat 2 Value]</span>
          </div>
          <div class="back-stat">
            <span class="back-stat-label">[Stat 3 Label e.g. Time or Texture]</span>
            <span class="back-stat-val">[Stat 3 Value]</span>
          </div>
        </div>

        <p class="b-heading">Ingredients</p>
        [FOR EACH INGREDIENT — repeat this pattern:]
        <div class="b-ing-row"><span class="b-ing-name">[Ingredient name]</span><span class="b-ing-amt">[Amount]</span></div>

        <p class="b-heading">Method</p>
        [FOR EACH STEP — repeat this pattern:]
        <div class="b-step">
          <span class="b-step-num">[Step #]</span>
          <p class="b-step-text"><span class="b-step-title">[1–2 word step title].</span> [Step detail]</p>
        </div>

        <p class="b-heading">Calibration Notes</p>
        <div class="b-notes-grid">
          [2–4 calibration notes — repeat this pattern:]
          <div class="b-note">
            <p class="b-note-goal">[Goal e.g. Crispier / Richer / Spicier]</p>
            <p class="b-note-tip">[Short actionable tip]</p>
          </div>
        </div>

        <p class="b-heading">Storage</p>
        [1–3 storage options — repeat this pattern:]
        <div class="b-storage-row">
          <span class="b-storage-method">[Storage method]</span>
          <span class="b-storage-dur">[Duration]</span>
        </div>

        <p class="b-heading">Chef's Note</p>
        <p class="b-chefs-note">[One insightful sentence: a pro tip, flavor secret, or key technique]</p>

      </div>
    </div>

  </div>
</div><!-- /flip-card -->`;

// ── Gemini prompt builders ────────────────────────────────────────────────────

function buildPrompt(recipeText, category, authorName, cardId) {
  return `You are a recipe formatter for a family cookbook website. Convert the recipe below into a single HTML block.

CRITICAL OUTPUT RULES:
- Output ONLY the raw HTML starting with <div class="flip-card" — nothing else before or after
- No markdown, no backticks, no explanation, no preamble
- Use ONLY the exact CSS class names listed in the template
- Escape HTML entities: use &amp; for &, &lt; for <, &gt; for >
- If any info is missing, make a reasonable inference — never output "N/A" or "Unknown"
- The card ID is: ${cardId}
- The final line must be exactly: </div><!-- /flip-card -->

RECIPE INFO:
Category: ${category}
Added by: ${authorName}
---
${recipeText}
---

OUTPUT THIS EXACT HTML STRUCTURE (replace all [PLACEHOLDER] text):

${CARD_TEMPLATE(cardId, authorName)}`;
}

function buildUrlPrompt(url, category, authorName, cardId) {
  return `You are a recipe formatter for a family cookbook website. Visit this URL and extract the recipe, then convert it into a single HTML block.

URL: ${url}

Go to that URL, read the recipe on the page, and format it as a flip card.

CRITICAL OUTPUT RULES:
- Output ONLY the raw HTML starting with <div class="flip-card" — nothing else before or after
- No markdown, no backticks, no explanation, no preamble
- Use ONLY the exact CSS class names listed in the template
- Escape HTML entities: use &amp; for &, &lt; for <, &gt; for >
- If any info is missing, make a reasonable inference — never output "N/A" or "Unknown"
- The card ID is: ${cardId}
- The final line must be exactly: </div><!-- /flip-card -->

RECIPE INFO:
Category: ${category}
Added by: ${authorName}

OUTPUT THIS EXACT HTML STRUCTURE (replace all [PLACEHOLDER] text):

${CARD_TEMPLATE(cardId, authorName)}`;
}

function buildEditPrompt(existingCardText, editInstructions, cardId) {
  const authorMatch = existingCardText.match(/Added by\s+(\w+)/i);
  const authorName  = authorMatch ? authorMatch[1] : 'Family';

  return `You are editing a recipe card for a family cookbook website.

EXISTING RECIPE (extracted from the current card):
---
${existingCardText}
---

USER'S EDIT REQUEST:
"${editInstructions}"

Apply the edit request and output a COMPLETE, regenerated recipe card. Preserve all information not mentioned in the edit request.

CRITICAL OUTPUT RULES:
- Output ONLY the raw HTML starting with <div class="flip-card" — nothing else before or after
- No markdown, no backticks, no explanation
- Use ONLY the exact CSS class names in the template
- Escape HTML entities: use &amp; for &, &lt; for <, &gt; for >
- Preserve the card ID exactly: ${cardId}
- The final line must be exactly: </div><!-- /flip-card -->

OUTPUT THIS EXACT HTML STRUCTURE (replace all [PLACEHOLDER] text):

${CARD_TEMPLATE(cardId, authorName)}`;
}

// ── Gemini call ───────────────────────────────────────────────────────────────

async function generateCardHtml(prompt, useSearch = false) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set in Replit Secrets');

  const genAI = new GoogleGenerativeAI(apiKey);
  const modelConfig = {
    model: 'gemini-2.5-flash',
    generationConfig: { temperature: 0.4, maxOutputTokens: 8000, thinkingConfig: { thinkingBudget: 0 } },
  };
  if (useSearch) modelConfig.tools = [{ googleSearch: {} }];

  const model = genAI.getGenerativeModel(modelConfig);

  let cardHtml = '';
  for (let attempt = 1; attempt <= 2; attempt++) {
    const result = await model.generateContent(prompt);
    const text   = result.response.text().trim()
      .replace(/^```html\s*/i, '').replace(/\s*```$/, '');

    if (text.includes('flip-card') && text.includes('flip-back')) {
      cardHtml = text;
      break;
    }
    if (attempt === 2) throw new Error('AI returned malformed output — please try again');
  }

  if (!cardHtml.trimEnd().endsWith('</div><!-- /flip-card -->')) {
    cardHtml = cardHtml.trimEnd() + '\n</div><!-- /flip-card -->';
  }

  // Safety: strip any script tags the AI may have generated
  cardHtml = cardHtml.replace(/<script[\s\S]*?<\/script>/gi, '');
  return cardHtml;
}

// ── Card text extractor (for edit prompt) ─────────────────────────────────────

function stripCardToText(cardHtml) {
  return cardHtml
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// ── Recipe catalog builder (for chat) ────────────────────────────────────────

function buildRecipeCatalog(rows) {
  if (rows.length === 0) return 'No recipes have been added yet.';

  const sections = {};
  for (const row of rows) {
    const sectionKey = SECTION_MAP[row.category] || 'OTHER';
    if (!sections[sectionKey]) sections[sectionKey] = [];
    sections[sectionKey].push(row);
  }

  const lines = [];
  for (const [sectionKey, recipes] of Object.entries(sections)) {
    lines.push(`[${sectionKey}]`);
    for (const recipe of recipes) {
      const c     = recipe.card_html;
      const title = (c.match(/class="front-title">([^<]+)</) || [])[1] || '?';
      const sub   = (c.match(/class="front-sub">([^<]+)</) || [])[1] || '';
      const chips = [...c.matchAll(/class="chip">([^<]+)</g)].map(m => m[1]).join(', ');
      lines.push(`- ${title} (by ${recipe.author_name}): ${chips}${sub ? ' — ' + sub : ''}`);
    }
  }

  return lines.join('\n');
}

// ── Express app ───────────────────────────────────────────────────────────────

const app = express();
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false }));

// ── Auth routes (unprotected) ─────────────────────────────────────────────────

app.post('/api/login', (req, res) => {
  const { passphrase } = req.body || {};
  if (makeAuthToken(passphrase || '') === VALID_TOKEN) {
    res.setHeader('Set-Cookie',
      `${COOKIE_NAME}=${VALID_TOKEN}; HttpOnly; SameSite=None; Secure; Max-Age=${COOKIE_MAX_AGE}; Path=/`
    );
    return res.redirect(302, '/');
  }
  res.status(401).send(buildGatePage('Incorrect passphrase — try again.'));
});

app.post('/api/logout', (req, res) => {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; SameSite=None; Secure; Max-Age=0; Path=/`);
  res.redirect(302, '/');
});

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

// ── Protected page route ──────────────────────────────────────────────────────

app.get(['/', '/index.html'], requireAuth, async (req, res) => {
  try {
    const html = await buildPage();
    res.type('html').send(html);
  } catch (err) {
    console.error('[page]', err);
    res.status(500).send('Error loading cookbook — please refresh');
  }
});

// ── Static assets (unprotected — fonts, icons, etc.) ─────────────────────────

app.use(express.static(path.join(__dirname, 'public')));

// ── Protected API routes ──────────────────────────────────────────────────────

app.post('/api/add-recipe', requireAuth, async (req, res) => {
  try {
    const { category, authorName, recipeInput } = req.body || {};

    if (!SECTION_MAP[category]) {
      return res.status(400).json({ error: 'Invalid category selected' });
    }
    if (!authorName || authorName.trim().length < 1 || authorName.trim().length > 40) {
      return res.status(400).json({ error: 'Please enter your name (max 40 characters)' });
    }
    const isLink = /^https?:\/\/.+/i.test((recipeInput || '').trim());
    if (!recipeInput || (!isLink && recipeInput.trim().length < 20)) {
      return res.status(400).json({ error: 'Recipe is too short — please paste more detail' });
    }

    let recipeText = recipeInput.trim();
    const isUrl = /^https?:\/\/.+/i.test(recipeText);

    if (isUrl) {
      try {
        recipeText = await fetchUrlContent(recipeText);
      } catch {
        // Server fetch failed — will pass URL directly to Gemini
      }
    }

    const firstLine = recipeText.split('\n')[0].slice(0, 80);
    const cardId    = await generateUniqueId(firstLine);

    let cardHtml;
    if (isUrl && /^https?:\/\/.+/i.test(recipeText)) {
      const prompt = buildUrlPrompt(recipeText, category, authorName.trim(), cardId);
      cardHtml = await generateCardHtml(prompt, true);
    } else {
      const prompt = buildPrompt(recipeText, category, authorName.trim(), cardId);
      cardHtml = await generateCardHtml(prompt);
    }

    await pool.query(
      `INSERT INTO recipes (category, author_name, card_html, card_id) VALUES ($1, $2, $3, $4)`,
      [category, authorName.trim(), cardHtml, cardId]
    );

    res.json({ success: true, cardId });

  } catch (err) {
    console.error('[add-recipe]', err);
    res.status(500).json({ error: err.message || 'Something went wrong — please try again' });
  }
});

app.post('/api/edit-recipe', requireAuth, async (req, res) => {
  try {
    const { cardId, editInstructions } = req.body || {};

    if (!cardId || typeof cardId !== 'string' || !/^card-[a-z0-9-]+$/.test(cardId)) {
      return res.status(400).json({ error: 'Invalid card ID' });
    }
    if (!editInstructions || editInstructions.trim().length < 5) {
      return res.status(400).json({ error: 'Please describe what you want to change (at least 5 characters)' });
    }
    if (editInstructions.trim().length > 500) {
      return res.status(400).json({ error: 'Edit description too long (max 500 characters)' });
    }

    const { rows } = await pool.query('SELECT * FROM recipes WHERE card_id = $1', [cardId]);
    if (rows.length === 0) return res.status(404).json({ error: 'Recipe not found' });

    const cardText    = stripCardToText(rows[0].card_html);
    const prompt      = buildEditPrompt(cardText, editInstructions.trim(), cardId);
    const newCardHtml = await generateCardHtml(prompt);

    await pool.query('UPDATE recipes SET card_html = $1 WHERE card_id = $2', [newCardHtml, cardId]);

    res.json({ success: true, cardId });

  } catch (err) {
    console.error('[edit-recipe]', err);
    res.status(500).json({ error: err.message || 'Something went wrong — please try again' });
  }
});

app.get('/api/get-card-html', requireAuth, async (req, res) => {
  try {
    const cardId = req.query.cardId;
    if (!cardId || !/^card-[a-z0-9-]+$/.test(cardId)) {
      return res.status(400).json({ error: 'Invalid card ID' });
    }
    const { rows } = await pool.query('SELECT card_html FROM recipes WHERE card_id = $1', [cardId]);
    if (rows.length === 0) return res.status(404).json({ error: 'Recipe not found' });
    res.json({ cardHtml: rows[0].card_html });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/save-card-html', requireAuth, async (req, res) => {
  try {
    const { cardId, cardHtml } = req.body || {};
    if (!cardId || !/^card-[a-z0-9-]+$/.test(cardId)) {
      return res.status(400).json({ error: 'Invalid card ID' });
    }
    if (!cardHtml || cardHtml.trim().length < 50) {
      return res.status(400).json({ error: 'Card HTML is too short' });
    }
    if (!cardHtml.includes('flip-card') || !cardHtml.includes('flip-front')) {
      return res.status(400).json({ error: 'Invalid card HTML structure' });
    }

    let sanitized = cardHtml.trim();
    const forbidden = /<script[\s\S]*?<\/script>|<iframe|<object|<embed|<link\s|<meta\s|javascript:/gi;
    if (forbidden.test(sanitized)) {
      return res.status(400).json({ error: 'HTML contains forbidden elements (scripts, iframes, etc). Please remove them.' });
    }

    const result = await pool.query(
      'UPDATE recipes SET card_html = $1 WHERE card_id = $2',
      [sanitized, cardId]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Recipe not found' });

    res.json({ success: true, cardId });
  } catch (err) {
    console.error('[save-card-html]', err);
    res.status(500).json({ error: err.message || 'Something went wrong' });
  }
});

app.post('/api/delete-recipe', requireAuth, async (req, res) => {
  try {
    const { cardId } = req.body || {};
    if (!cardId || !/^card-[a-z0-9-]+$/.test(cardId)) {
      return res.status(400).json({ error: 'Invalid card ID' });
    }

    const result = await pool.query('DELETE FROM recipes WHERE card_id = $1', [cardId]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Recipe not found' });

    res.json({ success: true });
  } catch (err) {
    console.error('[delete-recipe]', err);
    res.status(500).json({ error: err.message || 'Something went wrong' });
  }
});

app.post('/api/chat', requireAuth, async (req, res) => {
  try {
    const { message, history } = req.body || {};

    if (!message || message.trim().length === 0) {
      return res.status(400).json({ error: 'Message is required' });
    }
    if (message.trim().length > 500) {
      return res.status(400).json({ error: 'Message too long (max 500 characters)' });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY is not set in Replit Secrets');

    const { rows } = await pool.query('SELECT * FROM recipes ORDER BY created_at ASC');
    const recipeCatalog = buildRecipeCatalog(rows);

    const systemPrompt = `You are a helpful, warm cooking assistant for the Wall Family Cookbook — a private family recipe collection.

CURRENT COOKBOOK CONTENTS:
${recipeCatalog}

Your role:
- Answer questions about these specific recipes (ingredients, techniques, substitutions, timing, scaling)
- Help family members decide what to cook based on what's in the cookbook
- Suggest modifications and troubleshoot cooking problems
- Be conversational and concise — 2 to 4 sentences unless more detail is genuinely needed
- If asked about something not in the cookbook, say so warmly and offer related help from what's available
- Do not invent recipes that aren't in the cookbook`;

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      generationConfig: { temperature: 0.7, maxOutputTokens: 1000, thinkingConfig: { thinkingBudget: 0 } },
      systemInstruction: systemPrompt,
    });

    // Validate and cap history at last 4 turns (8 messages)
    const safeHistory = (Array.isArray(history) ? history : [])
      .slice(-8)
      .filter(m => m && (m.role === 'user' || m.role === 'model') && m.parts)
      .map(m => ({ role: m.role, parts: [{ text: String(m.parts).slice(0, 500) }] }));

    const chat   = model.startChat({ history: safeHistory });
    const result = await chat.sendMessage(message.trim());
    const reply  = result.response.text().trim();

    res.json({ reply });

  } catch (err) {
    console.error('[chat]', err);
    res.status(500).json({ error: 'Something went wrong — please try again' });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────

(async () => {
  try {
    // Load the static HTML template once
    templateHtml = await fs.readFile(HTML_PATH, 'utf-8');
    console.log('[startup] HTML template loaded');

    // Ensure the recipes table exists
    await ensureTable();

    // Check if we need to populate data
    const { rows: countRows } = await pool.query('SELECT COUNT(*) AS count FROM recipes');
    const recipeCount = parseInt(countRows[0].count, 10);

    if (recipeCount === 0) {
      console.log('[startup] Recipes table empty — checking for old data to migrate...');
      const migrated = await migrateFromOldTable();
      if (migrated === 0) {
        console.log('[startup] No previous data found — starting with an empty cookbook');
      }
    } else {
      console.log(`[startup] Loaded ${recipeCount} recipe(s) from database`);
    }

    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Wall Family Cookbook running on http://0.0.0.0:${PORT}`);
    });
  } catch (err) {
    console.error('[startup] Fatal error:', err);
    process.exit(1);
  }
})();
