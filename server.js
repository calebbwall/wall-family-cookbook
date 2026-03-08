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
import { fileURLToPath } from 'url';
import { GoogleGenerativeAI } from '@google/generative-ai';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HTML_PATH  = path.join(__dirname, 'index.html');
const PORT       = process.env.PORT || 3000;

const GITHUB_OWNER = process.env.GITHUB_OWNER || 'calebbwall';
const GITHUB_REPO  = process.env.GITHUB_REPO  || 'wall-family-cookbook';
const GITHUB_FILE  = 'index.html';
const GITHUB_API   = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${GITHUB_FILE}`;

const SECTION_MAP = {
  appetizer: 'APPETIZERS',
  entree:    'ENTREES',
  lunch:     'ENTREES',
  side:      'SIDES',
  snack:     'SNACKS',
  breakfast: 'BREAKFAST',
  dessert:   'DESSERTS',
};

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

async function pushToGitHub(htmlContent, recipeName) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN is not set in Replit Secrets');

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  };

  // Get current SHA (required for update)
  const getRes = await fetch(GITHUB_API, { headers });
  if (!getRes.ok) {
    if (getRes.status === 409) throw new Error('Someone else just added a recipe — please try again in a moment');
    throw new Error(`GitHub read failed (${getRes.status})`);
  }
  const { sha } = await getRes.json();

  const encoded = Buffer.from(htmlContent, 'utf-8').toString('base64');
  const putRes  = await fetch(GITHUB_API, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      message: `Add recipe: ${recipeName}`,
      content: encoded,
      sha,
    }),
  });

  if (!putRes.ok) {
    const err = await putRes.json().catch(() => ({}));
    if (putRes.status === 409) throw new Error('Someone else just added a recipe — please try again in a moment');
    throw new Error(err.message || `GitHub push failed (${putRes.status})`);
  }
}

// ── URL fetcher ───────────────────────────────────────────────────────────────

async function fetchUrlContent(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; WallFamilyCookbook/1.0)' },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`URL fetch failed (${res.status}) — try pasting the recipe text directly`);

  const html = await res.text();
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 10000);

  if (text.length < 80) {
    throw new Error("That URL doesn't have readable recipe text — please paste the recipe directly");
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

// ── Gemini prompt builder ─────────────────────────────────────────────────────

function buildPrompt(recipeText, category, authorName, cardId) {
  return `You are a recipe formatter for a family cookbook website. Convert the recipe below into a single HTML block.

CRITICAL OUTPUT RULES:
- Output ONLY the raw HTML starting with <div class="flip-card" — nothing else before or after
- No markdown, no backticks, no explanation, no preamble
- Use ONLY the exact CSS class names listed in the template
- Escape HTML entities: use &amp; for &, &lt; for <, &gt; for >
- If any info is missing, make a reasonable inference — never output "N/A" or "Unknown"
- The card ID is: ${cardId}

RECIPE INFO:
Category: ${category}
Added by: ${authorName}
---
${recipeText}
---

OUTPUT THIS EXACT HTML STRUCTURE (replace all [PLACEHOLDER] text):

<div class="flip-card" id="${cardId}" onclick="toggleFlip(this)">
  <div class="flip-card-inner">

    <div class="flip-front">
      <div class="front-img">
        [ONE EMOJI REPRESENTING THE DISH]
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
        <p class="b-chefs-note">[One insightful sentence: a pro tip, flavor secret, or key technique that elevates this dish]</p>

      </div>
    </div>

  </div>
</div>`;
}

// ── Gemini call ───────────────────────────────────────────────────────────────

async function generateCardHtml(prompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set in Replit Secrets');

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.0-flash',
    generationConfig: { temperature: 0.4, maxOutputTokens: 3000 },
  });

  let cardHtml = '';
  for (let attempt = 1; attempt <= 2; attempt++) {
    const result = await model.generateContent(prompt);
    const text   = result.response.text().trim()
      // Strip accidental markdown fences
      .replace(/^```html\s*/i, '').replace(/\s*```$/, '');

    if (text.includes('flip-card') && text.includes('flip-back')) {
      cardHtml = text;
      break;
    }
    if (attempt === 2) throw new Error('AI returned malformed output — please try again');
  }

  // Safety: strip any script tags Gemini might hallucinate
  cardHtml = cardHtml.replace(/<script[\s\S]*?<\/script>/gi, '');
  return cardHtml;
}

// ── HTML injection ────────────────────────────────────────────────────────────

function injectCard(html, category, cardHtml) {
  const sectionKey  = SECTION_MAP[category];
  const startMarker = `<!-- ${sectionKey}_START -->`;
  const endMarker   = `<!-- ${sectionKey}_END -->`;

  const startIdx = html.indexOf(startMarker);
  const endIdx   = html.indexOf(endMarker);
  if (startIdx === -1 || endIdx === -1) {
    throw new Error(`Section markers missing for: ${sectionKey} — contact Caleb`);
  }

  const before          = html.slice(0, startIdx + startMarker.length);
  const existing        = html.slice(startIdx + startMarker.length, endIdx);
  const after           = html.slice(endIdx);

  let newContent;
  if (existing.includes('card-grid')) {
    // Append inside existing grid
    newContent = existing.replace(/(\s*)<\/div>(\s*)$/, `\n    ${cardHtml}\n  </div>\n  `);
  } else {
    // First card: create the grid wrapper
    newContent = `\n  <div class="card-grid">\n    ${cardHtml}\n  </div>\n  `;
  }

  let updated = before + newContent + after;

  // Update section count
  const currentCount = (existing.match(/class="flip-card"/g) || []).length;
  const newCount     = currentCount + 1;
  const countLabel   = newCount === 1 ? '1 recipe' : `${newCount} recipes`;
  updated = updated.replace(
    new RegExp(`(<span class="section-count" id="count-${sectionKey.toLowerCase()}">)[^<]*(</span>)`),
    `$1${countLabel}$2`
  );

  // Hide empty-state if it's the first card
  if (currentCount === 0) {
    updated = updated.replace(
      `<div class="empty-state" id="empty-${sectionKey.toLowerCase()}">`,
      `<div class="empty-state" id="empty-${sectionKey.toLowerCase()}" style="display:none">`
    );
  }

  return updated;
}

// ── Express app ───────────────────────────────────────────────────────────────

const app = express();
app.use(express.json({ limit: '100kb' }));
app.use(express.static(__dirname));

app.post('/api/add-recipe', async (req, res) => {
  try {
    const { category, authorName, recipeInput } = req.body || {};

    // Validate
    if (!SECTION_MAP[category]) {
      return res.status(400).json({ error: 'Invalid category selected' });
    }
    if (!authorName || authorName.trim().length < 1 || authorName.trim().length > 40) {
      return res.status(400).json({ error: 'Please enter your name (max 40 characters)' });
    }
    if (!recipeInput || recipeInput.trim().length < 20) {
      return res.status(400).json({ error: 'Recipe is too short — please paste more detail' });
    }

    // Fetch URL content if input is a link
    let recipeText = recipeInput.trim();
    if (/^https?:\/\/.+/i.test(recipeText)) {
      recipeText = await fetchUrlContent(recipeText);
    }

    // Read current HTML
    const currentHtml = await fs.readFile(HTML_PATH, 'utf-8');

    // Extract a best-guess recipe name from the first ~100 chars for the card ID
    const firstLine  = recipeText.split('\n')[0].slice(0, 80);
    const cardId     = generateUniqueId(currentHtml, firstLine);

    // Generate card HTML via Gemini
    const prompt  = buildPrompt(recipeText, category, authorName.trim(), cardId);
    const cardHtml = await generateCardHtml(prompt);

    // Inject into HTML string
    const updatedHtml = injectCard(currentHtml, category, cardHtml);

    // Push to GitHub first (source of truth)
    await pushToGitHub(updatedHtml, firstLine);

    // Then write to local disk
    await fs.writeFile(HTML_PATH, updatedHtml, 'utf-8');

    res.json({ success: true, cardId });

  } catch (err) {
    console.error('[add-recipe]', err);
    res.status(500).json({ error: err.message || 'Something went wrong — please try again' });
  }
});

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

// ── Start ─────────────────────────────────────────────────────────────────────

await syncFromGitHub();
app.listen(PORT, () => console.log(`Wall Family Cookbook running on port ${PORT}`));
