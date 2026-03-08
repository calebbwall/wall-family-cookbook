/**
 * Wall Family Cookbook — Express Server
 *
 * SETUP (Replit Secrets tab — never put these in code):
 *   GEMINI_API_KEY  → Get from https://aistudio.google.com (free tier available)
 *   GITHUB_TOKEN    → See instructions below
 *   GITHUB_OWNER    → calebbwall
 *   GITHUB_REPO     → wall-family-cookbook
 *
 * GITHUB TOKEN SETUP:
 *   1. Go to github.com → Settings → Developer settings →
 *      Personal access tokens → Fine-grained tokens
 *   2. Click "Generate new token"
 *   3. Name: "Wall Family Cookbook"
 *   4. Expiration: 1 year
 *   5. Repository access → Only select repositories → wall-family-cookbook
 *   6. Repository permissions → Contents → Read and write
 *   7. Click "Generate token" — copy it immediately (shown only once)
 *   8. Paste into Replit Secrets as GITHUB_TOKEN
 */

import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { GoogleGenerativeAI } from '@google/generative-ai';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HTML_PATH  = path.join(__dirname, 'index.html');
const PORT       = process.env.PORT || 5000;

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function ensureDbTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cookbook_html (
      id INTEGER PRIMARY KEY DEFAULT 1,
      content TEXT NOT NULL,
      updated_at TIMESTAMP DEFAULT NOW(),
      CONSTRAINT single_row CHECK (id = 1)
    )
  `);
}

async function loadHtmlFromDb() {
  try {
    await ensureDbTable();
    const result = await pool.query('SELECT content FROM cookbook_html WHERE id = 1');
    if (result.rows.length > 0) {
      await fs.writeFile(HTML_PATH, result.rows[0].content, 'utf-8');
      console.log('[startup] Loaded index.html from database');
      return true;
    }
  } catch (err) {
    console.warn('[startup] Database load failed:', err.message);
  }
  return false;
}

async function saveHtmlToDb(htmlContent) {
  try {
    await pool.query(
      `INSERT INTO cookbook_html (id, content, updated_at) VALUES (1, $1, NOW())
       ON CONFLICT (id) DO UPDATE SET content = $1, updated_at = NOW()`,
      [htmlContent]
    );
  } catch (err) {
    console.error('[db] Failed to save HTML to database:', err.message);
  }
}

const SECTION_MAP = {
  appetizer: 'APPETIZERS',
  entree:    'ENTREES',
  lunch:     'ENTREES',
  side:      'SIDES',
  snack:     'SNACKS',
  breakfast: 'BREAKFAST',
  dessert:   'DESSERTS',
};

// ── Auth ──────────────────────────────────────────────────────────────────────

const PASSPHRASE     = 'Joe+Linda';
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

// ── Startup: sync index.html from GitHub ─────────────────────────────────────

async function syncFromGitHub() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.log('[startup] No GITHUB_TOKEN set — skipping GitHub sync, serving local file');
    return;
  }
  try {
    const res = await fetch(GITHUB_API, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (!res.ok) throw new Error(`GitHub GET ${res.status}`);
    const { content } = await res.json();
    const html = Buffer.from(content, 'base64').toString('utf-8');
    await fs.writeFile(HTML_PATH, html, 'utf-8');
    console.log('[startup] index.html synced from GitHub');
  } catch (err) {
    console.warn('[startup] GitHub sync failed, using local file:', err.message);
  }
}

// ── GitHub push ───────────────────────────────────────────────────────────────

async function pushToGitHub(htmlContent, commitMessage) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN is not set in Replit Secrets');

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  };

  const getRes = await fetch(GITHUB_API, { headers });
  if (!getRes.ok) {
    if (getRes.status === 409) throw new Error('Someone else just updated the cookbook — please try again in a moment');
    throw new Error(`GitHub read failed (${getRes.status})`);
  }
  const { sha } = await getRes.json();

  const encoded = Buffer.from(htmlContent, 'utf-8').toString('base64');
  const putRes  = await fetch(GITHUB_API, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ message: commitMessage || 'Update cookbook', content: encoded, sha }),
  });

  if (!putRes.ok) {
    const err = await putRes.json().catch(() => ({}));
    if (putRes.status === 409) throw new Error('Someone else just updated the cookbook — please try again in a moment');
    throw new Error(err.message || `GitHub push failed (${putRes.status})`);
  }
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
      } catch { /* not valid JSON, skip */ }
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

  if (text.length < 80) {
    throw new Error("That URL doesn't have readable recipe text — try pasting the recipe directly");
  }
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

function generateUniqueId(existingHtml, baseName) {
  let id = slugify(baseName);
  let n  = 2;
  while (existingHtml.includes(`id="${id}"`)) {
    id = slugify(baseName) + '-' + n++;
  }
  return id;
}

// ── Card HTML template (shared by add and edit prompts) ───────────────────────

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
  // Extract author from text if possible (look for "Added by NAME" pattern)
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
  if (useSearch) {
    modelConfig.tools = [{ googleSearch: {} }];
  }
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

  // Ensure closing marker is present
  if (!cardHtml.trimEnd().endsWith('</div><!-- /flip-card -->')) {
    cardHtml = cardHtml.trimEnd() + '\n</div><!-- /flip-card -->';
  }

  // Safety: strip any script tags
  cardHtml = cardHtml.replace(/<script[\s\S]*?<\/script>/gi, '');
  return cardHtml;
}

// ── HTML injection (add new card) ─────────────────────────────────────────────

function injectCard(html, category, cardHtml) {
  const sectionKey  = SECTION_MAP[category];
  const startMarker = `<!-- ${sectionKey}_START -->`;
  const endMarker   = `<!-- ${sectionKey}_END -->`;

  const startIdx = html.indexOf(startMarker);
  const endIdx   = html.indexOf(endMarker);
  if (startIdx === -1 || endIdx === -1) {
    throw new Error(`Section markers missing for: ${sectionKey}`);
  }

  const before   = html.slice(0, startIdx + startMarker.length);
  const existing = html.slice(startIdx + startMarker.length, endIdx);
  const after    = html.slice(endIdx);

  let newContent;
  if (existing.includes('card-grid')) {
    newContent = existing.replace(/(\s*)<\/div>(\s*)$/, `\n    ${cardHtml}\n  </div>\n  `);
  } else {
    newContent = `\n  <div class="card-grid">\n    ${cardHtml}\n  </div>\n  `;
  }

  let updated = before + newContent + after;

  const currentCount = (existing.match(/class="flip-card"/g) || []).length;
  const newCount     = currentCount + 1;
  const countLabel   = newCount === 1 ? '1 recipe' : `${newCount} recipes`;
  updated = updated.replace(
    new RegExp(`(<span class="section-count" id="count-${sectionKey.toLowerCase()}">)[^<]*(</span>)`),
    `$1${countLabel}$2`
  );

  if (currentCount === 0) {
    updated = updated.replace(
      `<div class="empty-state" id="empty-${sectionKey.toLowerCase()}">`,
      `<div class="empty-state" id="empty-${sectionKey.toLowerCase()}" style="display:none">`
    );
  }

  return updated;
}

// ── Card extraction and replacement (edit) ────────────────────────────────────

function extractCardHtml(html, cardId) {
  const startMarker = `<div class="flip-card" id="${cardId}"`;
  const endMarker   = `</div><!-- /flip-card -->`;

  const startIdx = html.indexOf(startMarker);
  if (startIdx === -1) throw new Error(`Card not found: ${cardId}`);

  const endIdx = html.indexOf(endMarker, startIdx);
  if (endIdx === -1) throw new Error(`Card closing marker not found for: ${cardId}`);

  const endPos = endIdx + endMarker.length;
  return {
    cardHtml: html.slice(startIdx, endPos),
    startIdx,
    endPos,
  };
}

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

function replaceCard(html, cardId, newCardHtml) {
  const { startIdx, endPos } = extractCardHtml(html, cardId);
  return html.slice(0, startIdx) + newCardHtml + html.slice(endPos);
}

// ── Recipe catalog builder (for chat) ────────────────────────────────────────

function buildRecipeCatalog(html) {
  const lines = [];
  const sections = ['APPETIZERS','ENTREES','SIDES','SNACKS','BREAKFAST','DESSERTS'];

  for (const section of sections) {
    const startIdx = html.indexOf(`<!-- ${section}_START -->`);
    const endIdx   = html.indexOf(`<!-- ${section}_END -->`);
    if (startIdx === -1 || endIdx === -1) continue;

    const sectionHtml = html.slice(startIdx, endIdx);
    if (!sectionHtml.includes('flip-card')) continue;

    lines.push(`[${section}]`);

    const cardPattern = /class="flip-card"[\s\S]*?<\/div><!-- \/flip-card -->/g;
    let match;
    while ((match = cardPattern.exec(sectionHtml)) !== null) {
      const c       = match[0];
      const title   = (c.match(/class="front-title">([^<]+)</) || [])[1] || '?';
      const author  = (c.match(/class="front-author">[^<]*<span>([^<]+)</) || [])[1] || '?';
      const sub     = (c.match(/class="front-sub">([^<]+)</) || [])[1] || '';
      const chips   = [...c.matchAll(/class="chip">([^<]+)</g)].map(m => m[1]).join(', ');
      lines.push(`- ${title} (by ${author}): ${chips}${sub ? ' — ' + sub : ''}`);
    }
  }

  return lines.length > 0 ? lines.join('\n') : 'No recipes have been added yet.';
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

// ── Protected page routes (must come before express.static) ───────────────────

app.get(['/', '/index.html'], requireAuth, (req, res) => {
  res.sendFile(HTML_PATH);
});

// ── Static assets (unprotected — only JS/CSS would be here; all assets are inline) ──

app.use(express.static(__dirname));

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
        // Server fetch failed — will pass URL directly to Gemini instead
      }
    }

    const currentHtml = await fs.readFile(HTML_PATH, 'utf-8');
    const firstLine   = isUrl ? recipeText.split('\n')[0].slice(0, 80) : recipeText.split('\n')[0].slice(0, 80);
    const cardId      = generateUniqueId(currentHtml, firstLine);

    let prompt, cardHtml;
    if (isUrl && /^https?:\/\/.+/i.test(recipeText)) {
      prompt = buildUrlPrompt(recipeText, category, authorName.trim(), cardId);
      cardHtml = await generateCardHtml(prompt, true);
    } else {
      prompt = buildPrompt(recipeText, category, authorName.trim(), cardId);
      cardHtml = await generateCardHtml(prompt);
    }

    const updatedHtml = injectCard(currentHtml, category, cardHtml);

    await fs.writeFile(HTML_PATH, updatedHtml, 'utf-8');
    await saveHtmlToDb(updatedHtml);

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

    const currentHtml = await fs.readFile(HTML_PATH, 'utf-8');
    const { cardHtml } = extractCardHtml(currentHtml, cardId);
    const cardText     = stripCardToText(cardHtml);

    const prompt      = buildEditPrompt(cardText, editInstructions.trim(), cardId);
    const newCardHtml = await generateCardHtml(prompt);

    const updatedHtml = replaceCard(currentHtml, cardId, newCardHtml);

    const titleMatch  = newCardHtml.match(/class="front-title">([^<]+)</);
    const recipeName  = titleMatch ? titleMatch[1] : cardId;

    await fs.writeFile(HTML_PATH, updatedHtml, 'utf-8');
    await saveHtmlToDb(updatedHtml);

    res.json({ success: true, cardId });

  } catch (err) {
    console.error('[edit-recipe]', err);
    res.status(500).json({ error: err.message || 'Something went wrong — please try again' });
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

    const currentHtml   = await fs.readFile(HTML_PATH, 'utf-8');
    const recipeCatalog = buildRecipeCatalog(currentHtml);

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
      .filter(m => m && (m.role === 'user' || m.role === 'model') && typeof m.parts === 'string')
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
  const loaded = await loadHtmlFromDb();
  if (!loaded) {
    const localHtml = await fs.readFile(HTML_PATH, 'utf-8');
    await saveHtmlToDb(localHtml);
    console.log('[startup] Seeded database from local index.html');
  }
  app.listen(PORT, '0.0.0.0', () => console.log(`Wall Family Cookbook running on http://0.0.0.0:${PORT}`));
})();
