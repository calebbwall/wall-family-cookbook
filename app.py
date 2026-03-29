"""
Wall Family Cookbook — Flask Server
Python/Flask port of server.js
"""

import os
import re
import hmac
import hashlib
import uuid
import json
import base64
import time
from pathlib import Path
from contextlib import contextmanager
from functools import wraps

import psycopg2
import psycopg2.pool
import psycopg2.extras
import requests as http_requests
from flask import (
    Flask, request, redirect, make_response,
    jsonify, Response
)

# ── App & paths ────────────────────────────────────────────────────────────────

BASE_DIR    = Path(__file__).parent
HTML_PATH   = BASE_DIR / 'public' / 'index.html'
UPLOADS_DIR = BASE_DIR / 'public' / 'uploads'
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

app = Flask(__name__, static_folder='public', static_url_path='')
app.config['MAX_CONTENT_LENGTH'] = 5 * 1024 * 1024  # 5 MB

# Cache-busting version stamp — changes every deploy so browsers fetch fresh assets
_JS_VER  = int((BASE_DIR / 'public' / 'app.js').stat().st_mtime)
_CSS_VER = int((BASE_DIR / 'public' / 'style.css').stat().st_mtime)

# ── Config ─────────────────────────────────────────────────────────────────────

PORT         = int(os.environ.get('PORT', 5000))
PASSPHRASE   = os.environ.get('PASSPHRASE', 'Joe+Linda')
DATABASE_URL = os.environ.get('DATABASE_URL')
GEMINI_KEY   = os.environ.get('GEMINI_API_KEY')

COOKIE_NAME    = 'wfc_auth'
COOKIE_MAX_AGE = 30 * 24 * 60 * 60  # 30 days

SECTION_MAP = {
    'appetizer': 'APPETIZERS',
    'entree':    'ENTREES',
    'lunch':     'ENTREES',
    'side':      'SIDES',
    'snack':     'SNACKS',
    'breakfast': 'BREAKFAST',
    'dessert':   'DESSERTS',
}

SECTION_TO_CATEGORY = {
    'APPETIZERS': 'appetizer',
    'ENTREES':    'entree',
    'SIDES':      'side',
    'SNACKS':     'snack',
    'BREAKFAST':  'breakfast',
    'DESSERTS':   'dessert',
}

# ── Extraction cache (in-memory, resets on restart) ────────────────────────────
_extraction_cache: dict = {}  # {sha256_hex: (timestamp, result_dict)}
_CACHE_TTL = 3600  # 1 hour

def _cache_get(key: str):
    entry = _extraction_cache.get(key)
    if entry and (time.time() - entry[0]) < _CACHE_TTL:
        return entry[1]
    return None

def _cache_set(key: str, value: dict):
    _extraction_cache[key] = (time.time(), value)
    if len(_extraction_cache) > 500:
        cutoff = time.time() - _CACHE_TTL
        for k in list(_extraction_cache.keys()):
            if _extraction_cache[k][0] < cutoff:
                del _extraction_cache[k]

# Load HTML template once at startup
template_html = HTML_PATH.read_text(encoding='utf-8')

# ── Database ───────────────────────────────────────────────────────────────────

db_pool = psycopg2.pool.ThreadedConnectionPool(1, 10, dsn=DATABASE_URL)

@contextmanager
def db_cursor():
    conn = db_pool.getconn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            yield cur
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        db_pool.putconn(conn)


def ensure_table():
    with db_cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS recipes (
                id          SERIAL PRIMARY KEY,
                category    TEXT NOT NULL,
                author_name TEXT NOT NULL,
                card_html   TEXT NOT NULL,
                card_id     TEXT UNIQUE NOT NULL,
                created_at  TIMESTAMP DEFAULT NOW()
            )
        """)
        # Add structured data columns if not present (safe to run repeatedly)
        cur.execute("ALTER TABLE recipes ADD COLUMN IF NOT EXISTS recipe_json TEXT")
        cur.execute("ALTER TABLE recipes ADD COLUMN IF NOT EXISTS source_type TEXT DEFAULT 'manual'")


def migrate_from_old_table():
    try:
        with db_cursor() as cur:
            cur.execute('SELECT content FROM cookbook_html WHERE id = 1')
            row = cur.fetchone()
        if not row:
            return 0

        html       = row['content']
        end_marker = '</div><!-- /flip-card -->'
        count      = 0

        for section_key, category in SECTION_TO_CATEGORY.items():
            start_idx = html.find(f'<!-- {section_key}_START -->')
            end_idx   = html.find(f'<!-- {section_key}_END -->')
            if start_idx == -1 or end_idx == -1:
                continue

            section_html = html[start_idx:end_idx]
            for m in re.finditer(r'<div class="flip-card" id="(card-[^"]+)"', section_html):
                card_id       = m.group(1)
                card_start    = m.start()
                card_end_pos  = section_html.find(end_marker, card_start)
                if card_end_pos == -1:
                    continue
                card_html_str = section_html[card_start:card_end_pos + len(end_marker)]
                author_m      = re.search(r'class="front-author">[^<]*<span>([^<]+)', card_html_str)
                author_name   = author_m.group(1) if author_m else 'Family'
                with db_cursor() as cur:
                    cur.execute(
                        """INSERT INTO recipes (category, author_name, card_html, card_id)
                           VALUES (%s, %s, %s, %s) ON CONFLICT (card_id) DO NOTHING""",
                        (category, author_name, card_html_str, card_id)
                    )
                count += 1

        print(f'[migration] Migrated {count} recipe(s) from old cookbook_html table')
        return count
    except Exception as e:
        print(f'[migration] No old table to migrate from: {e}')
        return 0

# ── Page builder ───────────────────────────────────────────────────────────────

def build_page():
    with db_cursor() as cur:
        cur.execute('SELECT * FROM recipes ORDER BY created_at ASC')
        rows = cur.fetchall()

    total   = len(rows)
    t_label = '1 recipe' if total == 1 else f'{total} recipes'
    html    = (template_html
               .replace('<title>Wall Family Cookbook</title>',
                        f'<title>Wall Family Cookbook ({t_label})</title>')
               .replace('href="/style.css"', f'href="/style.css?v={_CSS_VER}"')
               .replace('src="/app.js"',     f'src="/app.js?v={_JS_VER}"'))

    for section_key in SECTION_TO_CATEGORY:
        section_cards = [r for r in rows if SECTION_MAP.get(r['category']) == section_key]
        count         = len(section_cards)
        count_label   = '1 recipe' if count == 1 else f'{count} recipes'
        section_id    = section_key.lower()

        injection = ''
        if section_cards:
            cards_html = '\n    '.join(r['card_html'] for r in section_cards)
            injection  = f'\n  <div class="card-grid">\n    {cards_html}\n  </div>\n  '

        html = re.sub(
            rf'(<!-- {section_key}_START -->)[\s\S]*?(<!-- {section_key}_END -->)',
            lambda m, inj=injection, sk=section_key: m.group(1) + inj + f'<!-- {sk}_END -->',
            html
        )

        html = re.sub(
            rf'(<span class="section-count" id="count-{section_id}">)[^<]*(</span>)',
            rf'\g<1>{count_label}\g<2>',
            html
        )

        if count > 0:
            html = html.replace(
                f'<div class="empty-state" id="empty-{section_id}">',
                f'<div class="empty-state" id="empty-{section_id}" style="display:none">'
            )

    return html

# ── Auth ───────────────────────────────────────────────────────────────────────

def make_auth_token(passphrase):
    return hmac.new(b'wfc-2024-salt', passphrase.encode('utf-8'), hashlib.sha256).hexdigest()

VALID_TOKEN = make_auth_token(PASSPHRASE)

def require_auth(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = request.cookies.get(COOKIE_NAME, '')
        if token == VALID_TOKEN:
            return f(*args, **kwargs)
        # API routes must return JSON so fetch() callers can parse the error.
        # Non-API routes (page loads) get the HTML gate page.
        if request.path.startswith('/api/'):
            return jsonify(error='Session expired — please refresh the page and log in again.'), 401
        return Response(build_gate_page(), mimetype='text/html')
    return decorated


def build_gate_page(error_msg=''):
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Wall Family Cookbook</title>
  <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;0,900;1,400&family=Lato:wght@300;400;700&display=swap" rel="stylesheet"/>
  <style>
    :root {{
      --red:#8B1A1A; --red-light:#A52828;
      --cream:#FAF6F0; --tan:#E8DDD0; --tan-dark:#C9B99A;
      --brown:#5C3A1E; --dark:#2A1A0E; --muted:#8A7060; --white:#FFFFFF;
    }}
    *, *::before, *::after {{ box-sizing: border-box; margin: 0; padding: 0; }}
    body {{
      font-family: 'Lato', sans-serif;
      background: var(--dark);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1rem;
    }}
    .gate-card {{
      background: var(--cream);
      border-radius: 18px;
      padding: 3.2rem 2.8rem;
      max-width: 420px;
      width: 100%;
      text-align: center;
      box-shadow: 0 28px 72px rgba(0,0,0,0.55);
    }}
    .gate-emoji {{ font-size: 3.2rem; margin-bottom: 1.3rem; }}
    .gate-title {{
      font-family: 'Playfair Display', serif;
      font-size: 2.1rem;
      font-weight: 900;
      color: var(--dark);
      margin-bottom: 0.35rem;
    }}
    .gate-sub {{
      font-size: 0.87rem;
      color: var(--muted);
      font-style: italic;
      margin-bottom: 2.2rem;
    }}
    .gate-input {{
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
    }}
    .gate-input:focus {{ border-color: var(--red); }}
    .gate-btn {{
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
    }}
    .gate-btn:hover {{ background: var(--red-light); }}
    .gate-error {{
      margin-top: 0.9rem;
      font-size: 0.83rem;
      color: var(--red);
      font-style: italic;
      min-height: 1.3em;
    }}
    .gate-rule {{
      width: 48px; height: 3px;
      background: var(--red);
      margin: 1.4rem auto 1.8rem;
    }}
  </style>
</head>
<body>
  <div class="gate-card">
    <div class="gate-emoji">&#128214;</div>
    <h1 class="gate-title">Wall Family Cookbook</h1>
    <div class="gate-rule"></div>
    <p class="gate-sub">Family recipes, just for us.</p>
    <form method="POST" action="/api/login">
      <input class="gate-input" type="password" name="passphrase"
             placeholder="Enter passphrase" autofocus autocomplete="current-password"/>
      <button class="gate-btn" type="submit">Enter the Cookbook</button>
      <p class="gate-error">{error_msg}</p>
    </form>
  </div>
</body>
</html>"""

# ── URL fetcher ────────────────────────────────────────────────────────────────

def fetch_url_content(url):
    headers = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
    }
    resp = http_requests.get(url, headers=headers, timeout=15, allow_redirects=True)
    if not resp.ok:
        raise ValueError(f'That website blocked the request ({resp.status_code}). Copy the recipe text from the page and paste it here instead.')

    page_html = resp.text
    text = ''

    json_ld_blocks = re.findall(r'<script[^>]*type="application/ld\+json"[^>]*>([\s\S]*?)</script>', page_html, re.IGNORECASE)
    for block in json_ld_blocks:
        try:
            parsed = json.loads(block.strip())
            items  = parsed if isinstance(parsed, list) else parsed.get('@graph', [parsed])
            for item in items:
                item_type = item.get('@type', '')
                is_recipe = item_type == 'Recipe' or (isinstance(item_type, list) and 'Recipe' in item_type)
                if is_recipe:
                    parts = [item.get('name', '')]
                    if item.get('description'):
                        parts.append(item['description'])
                    if isinstance(item.get('recipeIngredient'), list):
                        parts += ['Ingredients:'] + item['recipeIngredient']
                    if isinstance(item.get('recipeInstructions'), list):
                        parts.append('Instructions:')
                        for step in item['recipeInstructions']:
                            parts.append(step if isinstance(step, str) else step.get('text') or step.get('name') or '')
                    if item.get('recipeYield'):
                        y = item['recipeYield']
                        parts.append('Yield: ' + (', '.join(y) if isinstance(y, list) else str(y)))
                    if item.get('prepTime'):
                        parts.append('Prep: ' + item['prepTime'])
                    if item.get('cookTime'):
                        parts.append('Cook: ' + item['cookTime'])
                    text = '\n'.join(p for p in parts if p)
                    break
        except Exception:
            pass
        if text:
            break

    if not text or len(text) < 80:
        text = re.sub(r'<script[\s\S]*?</script>', '', page_html, flags=re.IGNORECASE)
        text = re.sub(r'<style[\s\S]*?</style>', '', text, flags=re.IGNORECASE)
        text = re.sub(r'<[^>]+>', ' ', text)
        text = text.replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>').replace('&nbsp;', ' ')
        text = re.sub(r'\s+', ' ', text).strip()

    text = text[:12000]
    if len(text) < 80:
        raise ValueError("That URL doesn't have readable recipe text — try pasting the recipe directly")
    return text

# ── Card ID generator ──────────────────────────────────────────────────────────

def slugify(text):
    return 'card-' + re.sub(r'-+$|^-+', '', re.sub(r'[^a-z0-9]+', '-', text.lower()))[:28]


def generate_unique_id(base_name):
    base_id   = slugify(base_name)
    candidate = base_id
    n = 2
    while True:
        with db_cursor() as cur:
            cur.execute('SELECT 1 FROM recipes WHERE card_id = %s', (candidate,))
            if cur.fetchone() is None:
                return candidate
        candidate = f'{base_id}-{n}'
        n += 1

# ── Card HTML template ─────────────────────────────────────────────────────────

def card_template(card_id, author_name):
    return f"""<div class="flip-card" id="{card_id}" onclick="toggleFlip(this)">
  <div class="flip-card-inner">

    <div class="flip-front">
      <div class="front-img">
        <span class="front-emoji">[ONE EMOJI REPRESENTING THE DISH]</span>
        <button class="front-edit-btn" onclick="event.stopPropagation(); openEditModal('{card_id}')" title="Edit recipe">&#9999;&#65039;</button>
        <span class="front-badge">[Dish Type &middot; Category]</span>
        <span class="front-hint">&#8635; Tap to see recipe</span>
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
        <p class="front-author">Added by <span>{author_name}</span></p>
      </div>
    </div>

    <div class="flip-back">
      <div class="back-header">
        <div class="back-title">[Recipe Title]</div>
        <button class="back-flip-btn"
                onclick="event.stopPropagation(); toggleFlip(document.getElementById('{card_id}'))"
                title="Flip back">&#8634;</button>
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
        [FOR EACH INGREDIENT &mdash; repeat this pattern:]
        <div class="b-ing-row"><span class="b-ing-name">[Ingredient name]</span><span class="b-ing-amt">[Amount]</span></div>

        <p class="b-heading">Method</p>
        [FOR EACH STEP &mdash; repeat this pattern:]
        <div class="b-step">
          <span class="b-step-num">[Step #]</span>
          <p class="b-step-text"><span class="b-step-title">[1&ndash;2 word step title].</span> [Step detail]</p>
        </div>

        <p class="b-heading">Calibration Notes</p>
        <div class="b-notes-grid">
          [2&ndash;4 calibration notes &mdash; repeat this pattern:]
          <div class="b-note">
            <p class="b-note-goal">[Goal e.g. Crispier / Richer / Spicier]</p>
            <p class="b-note-tip">[Short actionable tip]</p>
          </div>
        </div>

        <p class="b-heading">Storage</p>
        [1&ndash;3 storage options &mdash; repeat this pattern:]
        <div class="b-storage-row">
          <span class="b-storage-method">[Storage method]</span>
          <span class="b-storage-dur">[Duration]</span>
        </div>

        <p class="b-heading">Chef's Note</p>
        <p class="b-chefs-note">[One insightful sentence: a pro tip, flavor secret, or key technique]</p>

      </div>
    </div>

  </div>
</div><!-- /flip-card -->"""

# ── Gemini prompt builders ─────────────────────────────────────────────────────

def build_prompt(recipe_text, category, author_name, card_id):
    return f"""You are a recipe formatter for a family cookbook website. Convert the recipe below into a single HTML block.

CRITICAL OUTPUT RULES:
- Output ONLY the raw HTML starting with <div class="flip-card" — nothing else before or after
- No markdown, no backticks, no explanation, no preamble
- Use ONLY the exact CSS class names listed in the template
- Escape HTML entities: use &amp; for &, &lt; for <, &gt; for >
- If any info is missing, make a reasonable inference — never output "N/A" or "Unknown"
- The card ID is: {card_id}
- The final line must be exactly: </div><!-- /flip-card -->

RECIPE INFO:
Category: {category}
Added by: {author_name}
---
{recipe_text}
---

OUTPUT THIS EXACT HTML STRUCTURE (replace all [PLACEHOLDER] text):

{card_template(card_id, author_name)}"""


def build_url_prompt(url, category, author_name, card_id):
    return f"""You are a recipe formatter for a family cookbook website. Visit this URL and extract the recipe, then convert it into a single HTML block.

URL: {url}

Go to that URL, read the recipe on the page, and format it as a flip card.

CRITICAL OUTPUT RULES:
- Output ONLY the raw HTML starting with <div class="flip-card" — nothing else before or after
- No markdown, no backticks, no explanation, no preamble
- Use ONLY the exact CSS class names listed in the template
- Escape HTML entities: use &amp; for &, &lt; for <, &gt; for >
- If any info is missing, make a reasonable inference — never output "N/A" or "Unknown"
- The card ID is: {card_id}
- The final line must be exactly: </div><!-- /flip-card -->

RECIPE INFO:
Category: {category}
Added by: {author_name}

OUTPUT THIS EXACT HTML STRUCTURE (replace all [PLACEHOLDER] text):

{card_template(card_id, author_name)}"""


def build_edit_prompt(existing_card_text, edit_instructions, card_id):
    author_m    = re.search(r'Added by\s+(\w+)', existing_card_text, re.IGNORECASE)
    author_name = author_m.group(1) if author_m else 'Family'

    return f"""You are editing a recipe card for a family cookbook website.

EXISTING RECIPE (extracted from the current card):
---
{existing_card_text}
---

USER'S EDIT REQUEST:
"{edit_instructions}"

Apply the edit request and output a COMPLETE, regenerated recipe card. Preserve all information not mentioned in the edit request.

CRITICAL OUTPUT RULES:
- Output ONLY the raw HTML starting with <div class="flip-card" — nothing else before or after
- No markdown, no backticks, no explanation
- Use ONLY the exact CSS class names in the template
- Escape HTML entities: use &amp; for &, &lt; for <, &gt; for >
- Preserve the card ID exactly: {card_id}
- The final line must be exactly: </div><!-- /flip-card -->

OUTPUT THIS EXACT HTML STRUCTURE (replace all [PLACEHOLDER] text):

{card_template(card_id, author_name)}"""

# ── Gemini REST helper ─────────────────────────────────────────────────────────

_GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'
_GEMINI_MODEL = 'gemini-2.5-flash'   # stable GA model

def _gemini_post(contents, gen_config=None, system_instruction=None,
                 tools=None, model=None):
    """POST to the Gemini generateContent REST endpoint. Returns the raw dict."""
    if not GEMINI_KEY:
        raise RuntimeError('GEMINI_API_KEY is not set in Replit Secrets')
    url = f'{_GEMINI_BASE}/{model or _GEMINI_MODEL}:generateContent?key={GEMINI_KEY}'
    payload = {'contents': contents}
    if gen_config:
        payload['generationConfig'] = gen_config
    if system_instruction:
        payload['system_instruction'] = {'parts': [{'text': system_instruction}]}
    if tools:
        payload['tools'] = tools
    resp = http_requests.post(url, json=payload, timeout=60)
    if not resp.ok:
        raise RuntimeError(f'Gemini API error {resp.status_code}: {resp.text[:400]}')
    return resp.json()


def _gemini_text(contents, gen_config=None, system_instruction=None,
                 tools=None, model=None):
    """Calls _gemini_post and returns the first candidate's text."""
    data = _gemini_post(contents, gen_config=gen_config,
                        system_instruction=system_instruction,
                        tools=tools, model=model)
    try:
        return data['candidates'][0]['content']['parts'][0]['text']
    except (KeyError, IndexError, TypeError) as exc:
        raise RuntimeError(f'Unexpected Gemini response shape: {data}') from exc


# ── Gemini card generator ──────────────────────────────────────────────────────

def generate_card_html(prompt, use_search=False):
    contents  = [{'role': 'user', 'parts': [{'text': prompt}]}]
    gen_cfg   = {'temperature': 0.4, 'maxOutputTokens': 8000}
    tools     = [{'google_search': {}}] if use_search else None
    card_html = ''

    for attempt in range(1, 3):
        text = _gemini_text(contents, gen_config=gen_cfg, tools=tools).strip()
        text = re.sub(r'^```html\s*', '', text, flags=re.IGNORECASE)
        text = re.sub(r'\s*```$', '', text)

        if 'flip-card' in text and 'flip-back' in text:
            card_html = text
            break
        if attempt == 2:
            raise RuntimeError('AI returned malformed output — please try again')

    if not card_html.rstrip().endswith('</div><!-- /flip-card -->'):
        card_html = card_html.rstrip() + '\n</div><!-- /flip-card -->'

    card_html = re.sub(r'<script[\s\S]*?</script>', '', card_html, flags=re.IGNORECASE)
    return card_html

# ── Card text extractor ────────────────────────────────────────────────────────

def strip_card_to_text(card_html):
    text = re.sub(r'<script[\s\S]*?</script>', '', card_html, flags=re.IGNORECASE)
    text = re.sub(r'<style[\s\S]*?</style>', '', text, flags=re.IGNORECASE)
    text = re.sub(r'<!--[\s\S]*?-->', '', text)
    text = re.sub(r'<[^>]+>', ' ', text)
    text = text.replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>').replace('&nbsp;', ' ')
    text = re.sub(r'\s{2,}', ' ', text)
    return text.strip()

# ── Structured extraction prompts ─────────────────────────────────────────────

_JSON_SCHEMA = """{
  "title": "recipe name",
  "subtitle": "brief descriptor or source",
  "category": "one of: appetizer, entree, side, snack, breakfast, dessert",
  "emoji": "one emoji representing the dish",
  "badge": "short badge e.g. Pizza · Italian",
  "servings": "e.g. 4 servings",
  "prep_time": "e.g. 15 min",
  "cook_time": "e.g. 30 min",
  "temperature": "e.g. 375°F — empty string if not applicable",
  "ingredients": [{"name": "ingredient", "amount": "quantity"}],
  "steps": [{"title": "1-2 word step name e.g. Mix", "detail": "full step detail"}],
  "calibration_notes": [{"goal": "e.g. Crispier", "tip": "short actionable tip"}],
  "storage": [{"method": "e.g. Refrigerator", "duration": "e.g. 3 days"}],
  "chefs_note": "one key pro tip or technique secret",
  "confidence": 0.95,
  "warnings": ["list any uncertain or missing fields"]
}"""

EXTRACTION_PROMPT = (
    "Extract this recipe and return ONLY a JSON object with these exact fields. "
    "No markdown, no explanation, just JSON.\n\n"
    + _JSON_SCHEMA
    + "\n\nRules:\n"
    "- Use sensible inferences; never write N/A or Unknown\n"
    "- confidence: 1.0=complete recipe, 0.5=partial, 0.2=very incomplete\n"
    "- Add warnings for missing ingredients, unclear steps, etc.\n"
    "- Category hint: {category_hint}\n\n"
    "Recipe content:\n---\n{content}\n---"
)

PHOTO_EXTRACTION_PROMPT = (
    "Look at this food photo and extract any visible recipe information. "
    "Return ONLY a JSON object with these exact fields. No markdown, just JSON.\n\n"
    + _JSON_SCHEMA
    + "\n\nIf the image is blurry or doesn't clearly show a recipe, "
    "set confidence below 0.3 and add a warning.\n"
    "Category hint: {category_hint}"
)


def extract_recipe_with_gemini(content: str = '', category_hint: str = '',
                                image_data: str = '', image_mime: str = 'image/jpeg') -> dict:
    """Call Gemini once to extract a recipe as structured JSON. Returns parsed dict."""
    gen_cfg = {'temperature': 0.2, 'maxOutputTokens': 4000,
               'responseMimeType': 'application/json'}

    if image_data:
        prompt = PHOTO_EXTRACTION_PROMPT.replace(
            '{category_hint}', category_hint or 'determine from image'
        )
        contents = [{'role': 'user', 'parts': [
            {'text': prompt},
            {'inline_data': {'mime_type': image_mime, 'data': image_data}},
        ]}]
    else:
        hint   = category_hint or 'determine from content'
        prompt = (EXTRACTION_PROMPT
                  .replace('{category_hint}', hint)
                  .replace('{content}', content[:8000]))
        contents = [{'role': 'user', 'parts': [{'text': prompt}]}]

    raw = _gemini_text(contents, gen_config=gen_cfg).strip()
    raw = re.sub(r'^```(?:json)?\s*', '', raw, flags=re.IGNORECASE)
    raw = re.sub(r'\s*```$', '', raw)

    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        m = re.search(r'\{[\s\S]+\}', raw)
        if m:
            return json.loads(m.group(0))
        raise RuntimeError('AI returned invalid JSON — please try again')


def build_card_html_from_json(recipe_json: dict, card_id: str,
                               author_name: str, media_url: str = '') -> str:
    """Convert structured recipe JSON → flip-card HTML with no AI call."""
    r = recipe_json

    def esc(s):
        return (str(s)
                .replace('&', '&amp;').replace('<', '&lt;')
                .replace('>', '&gt;').replace('"', '&quot;'))

    title      = esc(r.get('title', 'Recipe'))
    subtitle   = esc(r.get('subtitle', ''))
    emoji      = esc(r.get('emoji', '🍽️'))
    badge      = esc(r.get('badge', ''))
    servings   = esc(r.get('servings', ''))
    temp       = esc(r.get('temperature', ''))
    prep       = esc(r.get('prep_time', ''))
    cook       = esc(r.get('cook_time', ''))
    chefs_note = esc(r.get('chefs_note', ''))
    author_esc = esc(author_name)

    chip1 = servings
    chip2 = temp or prep
    chip3 = cook
    chip4 = esc(r['calibration_notes'][0].get('goal', '')) if r.get('calibration_notes') else ''

    stat2_label = 'Temp' if temp else 'Prep'
    stat2_val   = temp or prep

    # Ingredients
    ings_html = ''
    for ing in r.get('ingredients', []):
        n = esc(ing.get('name', ''))
        a = esc(ing.get('amount', ''))
        ings_html += f'\n        <div class="b-ing-row"><span class="b-ing-name">{n}</span><span class="b-ing-amt">{a}</span></div>'

    # Steps
    steps_html = ''
    for i, step in enumerate(r.get('steps', []), 1):
        t = esc(step.get('title', ''))
        d = esc(step.get('detail', ''))
        steps_html += (f'\n        <div class="b-step">'
                       f'<span class="b-step-num">{i}</span>'
                       f'<p class="b-step-text"><span class="b-step-title">{t}.</span> {d}</p>'
                       f'</div>')

    # Calibration notes
    notes_html = ''
    for note in r.get('calibration_notes', []):
        g = esc(note.get('goal', ''))
        t = esc(note.get('tip', ''))
        notes_html += f'<div class="b-note"><p class="b-note-goal">{g}</p><p class="b-note-tip">{t}</p></div>'

    # Storage
    storage_html = ''
    for store in r.get('storage', []):
        m_val = esc(store.get('method', ''))
        d_val = esc(store.get('duration', ''))
        storage_html += (f'\n        <div class="b-storage-row">'
                         f'<span class="b-storage-method">{m_val}</span>'
                         f'<span class="b-storage-dur">{d_val}</span></div>')

    # Media
    media_html = ''
    if media_url:
        safe = media_url.replace('"', '%22').replace('<', '%3C').replace('>', '%3E')
        if re.search(r'instagram\.com/(p|reel|tv)/', media_url, re.IGNORECASE):
            media_html = (f'<a class="front-instagram" href="{safe}" target="_blank" '
                          f'rel="noopener noreferrer" onclick="event.stopPropagation()">&#128247; Instagram</a>')
        else:
            media_html = (f'<img class="front-photo" src="{safe}" alt="Recipe photo" '
                          f'loading="lazy" onerror="this.remove()">')

    return f"""<div class="flip-card" id="{card_id}" onclick="toggleFlip(this)">
  <div class="flip-card-inner">

    <div class="flip-front">
      <div class="front-img">
        {media_html}<span class="front-emoji">{emoji}</span>
        <button class="front-edit-btn" onclick="event.stopPropagation(); openEditModal('{card_id}')" title="Edit recipe">&#9999;&#65039;</button>
        <span class="front-badge">{badge}</span>
        <span class="front-hint">&#8635; Tap to see recipe</span>
      </div>
      <div class="front-body">
        <div>
          <h3 class="front-title">{title}</h3>
          <p class="front-sub">{subtitle}</p>
          <div class="front-chips">
            <span class="chip">{chip1}</span>
            <span class="chip">{chip2}</span>
            <span class="chip">{chip3}</span>
            <span class="chip">{chip4}</span>
          </div>
        </div>
        <p class="front-author">Added by <span>{author_esc}</span></p>
      </div>
    </div>

    <div class="flip-back">
      <div class="back-header">
        <div class="back-title">{title}</div>
        <div class="back-header-actions">
          <button class="cook-now-btn"
                  onclick="event.stopPropagation(); openCookMode('{title}', '{card_id}')"
                  title="Get AI help with this recipe">🍳 Cook Now</button>
          <button class="back-flip-btn"
                  onclick="event.stopPropagation(); toggleFlip(document.getElementById('{card_id}'))"
                  title="Flip back">&#8634;</button>
        </div>
      </div>
      <div class="back-scroll">

        <div class="back-stats">
          <div class="back-stat">
            <span class="back-stat-label">Yield</span>
            <span class="back-stat-val">{servings}</span>
          </div>
          <div class="back-stat">
            <span class="back-stat-label">{stat2_label}</span>
            <span class="back-stat-val">{stat2_val}</span>
          </div>
          <div class="back-stat">
            <span class="back-stat-label">Time</span>
            <span class="back-stat-val">{cook}</span>
          </div>
        </div>

        <p class="b-heading">Ingredients</p>{ings_html}

        <p class="b-heading">Method</p>{steps_html}

        <p class="b-heading">Calibration Notes</p>
        <div class="b-notes-grid">{notes_html}</div>

        <p class="b-heading">Storage</p>{storage_html}

        <p class="b-heading">Chef's Note</p>
        <p class="b-chefs-note">{chefs_note}</p>

      </div>
    </div>

  </div>
</div><!-- /flip-card -->"""


# ── Media injector ─────────────────────────────────────────────────────────────

def inject_media(card_html, media_url):
    if not media_url:
        return card_html
    try:
        from urllib.parse import urlparse
        urlparse(media_url)
    except Exception:
        return card_html

    safe         = media_url.replace('"', '%22').replace('<', '%3C').replace('>', '%3E')
    is_instagram = bool(re.search(r'instagram\.com/(p|reel|tv)/', media_url, re.IGNORECASE))

    if is_instagram:
        overlay = f'<a class="front-instagram" href="{safe}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()">&#128247; Instagram</a>'
        return card_html.replace('<div class="front-img">', f'<div class="front-img">{overlay}', 1)
    else:
        img = f'<img class="front-photo" src="{safe}" alt="Recipe photo" loading="lazy" onerror="this.remove()">'
        return card_html.replace('<div class="front-img">', f'<div class="front-img">{img}', 1)

# ── Recipe catalog builder ─────────────────────────────────────────────────────

def build_recipe_catalog(rows):
    if not rows:
        return 'No recipes have been added yet.'

    sections = {}
    for row in rows:
        key = SECTION_MAP.get(row['category'], 'OTHER')
        sections.setdefault(key, []).append(row)

    lines = []
    for section_key, recipes in sections.items():
        lines.append(f'[{section_key}]')
        for recipe in recipes:
            c     = recipe['card_html']
            title = re.search(r'class="front-title">([^<]+)<', c)
            title = title.group(1).strip() if title else '?'
            sub   = re.search(r'class="front-sub">([^<]+)<', c)
            sub   = sub.group(1).strip() if sub else ''
            chips = ', '.join(m.group(1) for m in re.finditer(r'class="chip">([^<]+)<', c))
            temp  = re.search(r'class="b-temp[^"]*">([^<]+)<', c)
            time_ = re.search(r'class="b-time[^"]*">([^<]+)<', c)
            # Extract ingredients: qty + name (simple single-line pattern, safe on large HTML)
            ings  = []
            for qty_m, name_m in zip(
                    re.finditer(r'class="b-ing-qty[^"]*">([^<]+)<', c),
                    re.finditer(r'class="b-ing-name[^"]*">([^<]+)<', c)):
                ings.append(f'{qty_m.group(1).strip()} {name_m.group(1).strip()}')
            # Extract steps (single-line text nodes only)
            steps = [m.group(1).strip() for m in
                     re.finditer(r'class="b-step[^"]*">([^<]+)<', c) if m.group(1).strip()]

            line  = f'- {title} (by {recipe["author_name"]})'
            if chips: line += f': {chips}'
            if sub:   line += f' — {sub}'
            if temp or time_:
                params = []
                if temp:  params.append(temp.group(1).strip())
                if time_: params.append(time_.group(1).strip())
                line += f' [{", ".join(params)}]'
            lines.append(line)
            for ing in ings:
                lines.append(f'    Ingredient: {ing}')
            for i, step in enumerate(steps, 1):
                lines.append(f'    Step {i}: {step}')

    return '\n'.join(lines)

# ── Routes ─────────────────────────────────────────────────────────────────────

@app.post('/api/login')
def login():
    passphrase = request.form.get('passphrase', '')
    if make_auth_token(passphrase) == VALID_TOKEN:
        resp = make_response(redirect('/', 302))
        resp.set_cookie(
            COOKIE_NAME, VALID_TOKEN,
            max_age=COOKIE_MAX_AGE,
            httponly=True,
            samesite='None',
            secure=True,
            path='/'
        )
        return resp
    return make_response(build_gate_page('Incorrect passphrase — try again.'), 401)


@app.post('/api/logout')
def logout():
    resp = make_response(redirect('/', 302))
    resp.delete_cookie(COOKIE_NAME, path='/', samesite='None', secure=True)
    return resp


@app.get('/api/health')
def health():
    return jsonify(status='ok')


@app.get('/')
@app.get('/index.html')
@require_auth
def index():
    try:
        return Response(build_page(), mimetype='text/html')
    except Exception as e:
        app.logger.error(f'[page] {e}')
        return 'Error loading cookbook — please refresh', 500


@app.post('/api/upload-media')
@require_auth
def upload_media():
    f = request.files.get('photo')
    if not f or not f.mimetype.startswith('image/'):
        return jsonify(error='No valid image file provided (max 5 MB, images only)'), 400
    ext      = os.path.splitext(f.filename)[1].lower()
    ext      = re.sub(r'[^.a-z0-9]', '', ext) or '.jpg'
    filename = str(uuid.uuid4()) + ext
    f.save(UPLOADS_DIR / filename)
    return jsonify(url=f'/uploads/{filename}')


@app.post('/api/extract-recipe')
@require_auth
def extract_recipe_endpoint():
    """Extract recipe from text, URL, or image. Returns structured JSON for review."""
    try:
        source_type  = 'text'
        content_hash = ''
        recipe_data  = None

        if request.content_type and 'multipart' in request.content_type:
            # Photo upload
            category_hint = request.form.get('category', '')
            source_type   = 'photo'
            photo = request.files.get('photo')
            if not photo or not photo.mimetype.startswith('image/'):
                return jsonify(error='No valid image file provided (images only, max 5 MB)'), 400

            raw_bytes    = photo.read()
            content_hash = hashlib.sha256(raw_bytes).hexdigest()
            cached = _cache_get(content_hash)
            if cached:
                return jsonify(**cached)

            image_b64   = base64.standard_b64encode(raw_bytes).decode()
            recipe_data = extract_recipe_with_gemini(
                category_hint=category_hint,
                image_data=image_b64,
                image_mime=photo.mimetype,
            )
        else:
            body          = request.get_json(force=True, silent=True) or {}
            content       = body.get('content', '').strip()
            category_hint = body.get('category', '')
            source_type   = body.get('sourceType', 'text')

            if not content:
                return jsonify(error='No content provided'), 400
            if len(content) > 20000:
                return jsonify(error='Content too long (max 20,000 characters)'), 400

            content_hash = hashlib.sha256(content.encode()).hexdigest()
            cached = _cache_get(content_hash)
            if cached:
                return jsonify(**cached)

            if re.match(r'^https?://', content, re.IGNORECASE):
                source_type = 'url'
                try:
                    fetched     = fetch_url_content(content)
                    recipe_data = extract_recipe_with_gemini(fetched, category_hint=category_hint)
                except Exception:
                    recipe_data = extract_recipe_with_gemini(content, category_hint=category_hint)
            else:
                recipe_data = extract_recipe_with_gemini(content, category_hint=category_hint)

        if category_hint and not recipe_data.get('category'):
            recipe_data['category'] = category_hint

        result = {'recipeJson': recipe_data, 'sourceType': source_type, 'cacheKey': content_hash}
        _cache_set(content_hash, result)
        return jsonify(**result)

    except Exception as e:
        app.logger.error(f'[extract-recipe] {e}')
        return jsonify(error=str(e) or 'Extraction failed — please try again'), 500


@app.post('/api/fetch-instagram')
@require_auth
def fetch_instagram():
    """Attempt to fetch an Instagram post's metadata server-side. Degrades gracefully."""
    try:
        data = request.get_json(force=True, silent=True) or {}
        url  = data.get('url', '').strip()

        if not re.match(r'^https?://(?:www\.)?instagram\.com/(p|reel|tv)/', url, re.IGNORECASE):
            return jsonify(error='Not a valid Instagram URL'), 400

        headers = {
            'User-Agent': ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
                           'AppleWebKit/537.36 (KHTML, like Gecko) '
                           'Chrome/120.0.0.0 Safari/537.36'),
            'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
        }
        try:
            resp = http_requests.get(url, headers=headers, timeout=10, allow_redirects=True)
            if not resp.ok:
                raise ValueError(f'HTTP {resp.status_code}')

            page = resp.text

            def og(prop):
                m = (re.search(rf'<meta[^>]+property="og:{prop}"[^>]+content="([^"]*)"', page, re.IGNORECASE)
                     or re.search(rf'<meta[^>]+content="([^"]*)"[^>]+property="og:{prop}"', page, re.IGNORECASE))
                if not m:
                    return ''
                v = m.group(1)
                for old, new in [('&amp;', '&'), ('&lt;', '<'), ('&gt;', '>'),
                                  ('&quot;', '"'), ('&#39;', "'")]:
                    v = v.replace(old, new)
                return v

            og_title = og('title')
            og_desc  = og('description')
            og_image = og('image')

            if og_title or og_desc:
                return jsonify(
                    success=True,
                    title=og_title,
                    caption=og_desc,
                    image=og_image,
                    extractedText=(og_title + '\n' + og_desc).strip(),
                )
            return jsonify(
                success=False,
                warning='Instagram did not share post content — upload a photo or paste the text instead.',
            )
        except Exception as fetch_err:
            return jsonify(
                success=False,
                warning=f'Could not access Instagram ({fetch_err}) — upload a photo or paste the text instead.',
            )
    except Exception as e:
        app.logger.error(f'[fetch-instagram] {e}')
        return jsonify(error=str(e)), 500


@app.post('/api/add-recipe')
@require_auth
def add_recipe():
    try:
        data        = request.get_json(force=True, silent=True) or {}
        category    = data.get('category', '')
        author_name = data.get('authorName', '')
        media_url   = data.get('mediaUrl', '')
        recipe_json = data.get('recipeJson')   # new structured path
        source_type = data.get('sourceType', 'manual')

        if category not in SECTION_MAP:
            return jsonify(error='Invalid category selected'), 400
        if not author_name or not (1 <= len(author_name.strip()) <= 40):
            return jsonify(error='Please enter your name (max 40 characters)'), 400

        author_name = author_name.strip()

        # ── New path: build card from pre-reviewed JSON (no AI call) ──────────
        if recipe_json and isinstance(recipe_json, dict):
            title_hint = recipe_json.get('title', '') or author_name
            card_id    = generate_unique_id(title_hint)
            final_media = (media_url.strip()
                           if media_url and re.match(r'^https?://', media_url, re.IGNORECASE)
                           else '')
            card_html = build_card_html_from_json(recipe_json, card_id, author_name, final_media)
            card_html = re.sub(r'<script[\s\S]*?</script>', '', card_html, flags=re.IGNORECASE)

            with db_cursor() as cur:
                cur.execute(
                    """INSERT INTO recipes (category, author_name, card_html, card_id,
                                            recipe_json, source_type)
                       VALUES (%s, %s, %s, %s, %s, %s)""",
                    (category, author_name, card_html, card_id,
                     json.dumps(recipe_json), source_type)
                )
            return jsonify(success=True, cardId=card_id)

        # ── Legacy path: raw text/URL → Gemini HTML generation ───────────────
        recipe_input = data.get('recipeInput', '')
        MEDIA_URL_RE = re.compile(
            r'https?://\S*instagram\.com/(?:p|reel|tv)/[^\s"<>]+'
            r'|https?://\S+\.(?:jpg|jpeg|png|gif|webp|avif)(?:\?[^\s"<>]*)?',
            re.IGNORECASE
        )
        recipe_text    = (recipe_input or '').strip()
        detected_media = ''
        m = MEDIA_URL_RE.search(recipe_text)
        if m:
            detected_media = m.group(0)
            recipe_text    = recipe_text.replace(detected_media, '').strip()

        is_link = bool(re.match(r'^https?://.+', recipe_text, re.IGNORECASE))
        if not recipe_text or (not is_link and len(recipe_text) < 20):
            if detected_media:
                return jsonify(error="Got your link — paste the recipe text alongside it and we'll attach the photo."), 400
            return jsonify(error='Recipe is too short — please paste more detail'), 400

        is_url = bool(re.match(r'^https?://.+', recipe_text, re.IGNORECASE))
        if is_url:
            try:
                recipe_text = fetch_url_content(recipe_text)
            except Exception:
                pass

        first_line = recipe_text.split('\n')[0][:80]
        card_id    = generate_unique_id(first_line)

        if is_url and bool(re.match(r'^https?://.+', recipe_text, re.IGNORECASE)):
            prompt    = build_url_prompt(recipe_text, category, author_name, card_id)
            card_html = generate_card_html(prompt, use_search=True)
        else:
            prompt    = build_prompt(recipe_text, category, author_name, card_id)
            card_html = generate_card_html(prompt)

        final_media = detected_media or (media_url.strip() if re.match(r'^https?://', media_url or '', re.IGNORECASE) else '')
        if final_media:
            card_html = inject_media(card_html, final_media)

        with db_cursor() as cur:
            cur.execute(
                """INSERT INTO recipes (category, author_name, card_html, card_id, source_type)
                   VALUES (%s, %s, %s, %s, %s)""",
                (category, author_name, card_html, card_id, source_type)
            )

        return jsonify(success=True, cardId=card_id)

    except Exception as e:
        app.logger.error(f'[add-recipe] {e}')
        return jsonify(error=str(e) or 'Something went wrong — please try again'), 500


@app.post('/api/edit-recipe')
@require_auth
def edit_recipe():
    try:
        data              = request.get_json(force=True, silent=True) or {}
        card_id           = data.get('cardId', '')
        edit_instructions = data.get('editInstructions', '')

        if not card_id or not re.match(r'^card-[a-z0-9-]+$', card_id):
            return jsonify(error='Invalid card ID'), 400
        if not edit_instructions or len(edit_instructions.strip()) < 5:
            return jsonify(error='Please describe what you want to change (at least 5 characters)'), 400
        if len(edit_instructions.strip()) > 500:
            return jsonify(error='Edit description too long (max 500 characters)'), 400

        with db_cursor() as cur:
            cur.execute('SELECT * FROM recipes WHERE card_id = %s', (card_id,))
            row = cur.fetchone()
        if not row:
            return jsonify(error='Recipe not found'), 404

        card_text    = strip_card_to_text(row['card_html'])
        prompt       = build_edit_prompt(card_text, edit_instructions.strip(), card_id)
        new_card_html = generate_card_html(prompt)

        with db_cursor() as cur:
            cur.execute('UPDATE recipes SET card_html = %s WHERE card_id = %s', (new_card_html, card_id))

        return jsonify(success=True, cardId=card_id)

    except Exception as e:
        app.logger.error(f'[edit-recipe] {e}')
        return jsonify(error=str(e) or 'Something went wrong — please try again'), 500


@app.get('/api/get-card-html')
@require_auth
def get_card_html():
    try:
        card_id = request.args.get('cardId', '')
        if not card_id or not re.match(r'^card-[a-z0-9-]+$', card_id):
            return jsonify(error='Invalid card ID'), 400
        with db_cursor() as cur:
            cur.execute('SELECT card_html FROM recipes WHERE card_id = %s', (card_id,))
            row = cur.fetchone()
        if not row:
            return jsonify(error='Recipe not found'), 404
        return jsonify(cardHtml=row['card_html'])
    except Exception as e:
        return jsonify(error=str(e)), 500


@app.post('/api/save-card-html')
@require_auth
def save_card_html():
    try:
        data      = request.get_json(force=True, silent=True) or {}
        card_id   = data.get('cardId', '')
        card_html = data.get('cardHtml', '')

        if not card_id or not re.match(r'^card-[a-z0-9-]+$', card_id):
            return jsonify(error='Invalid card ID'), 400
        if not card_html or len(card_html.strip()) < 50:
            return jsonify(error='Card HTML is too short'), 400
        if 'flip-card' not in card_html or 'flip-front' not in card_html:
            return jsonify(error='Invalid card HTML structure'), 400

        sanitized = card_html.strip()
        if re.search(r'<script[\s\S]*?</script>|<iframe|<object|<embed|<link\s|<meta\s|javascript:', sanitized, re.IGNORECASE):
            return jsonify(error='HTML contains forbidden elements (scripts, iframes, etc). Please remove them.'), 400

        with db_cursor() as cur:
            cur.execute('UPDATE recipes SET card_html = %s WHERE card_id = %s', (sanitized, card_id))
            if cur.rowcount == 0:
                return jsonify(error='Recipe not found'), 404

        return jsonify(success=True, cardId=card_id)

    except Exception as e:
        app.logger.error(f'[save-card-html] {e}')
        return jsonify(error=str(e) or 'Something went wrong'), 500


@app.get('/api/export')
@require_auth
def export_recipes():
    try:
        with db_cursor() as cur:
            cur.execute('SELECT * FROM recipes ORDER BY created_at ASC')
            rows = cur.fetchall()

        export = []
        for r in rows:
            entry = {
                'id':          r['card_id'],
                'category':    r['category'],
                'author':      r.get('author_name') or '',
                'created_at':  r['created_at'].isoformat() if r.get('created_at') else None,
            }
            if r.get('recipe_json'):
                entry.update(r['recipe_json'])
            else:
                entry['card_html'] = r['card_html']
            export.append(entry)

        resp = Response(
            json.dumps(export, indent=2, default=str),
            mimetype='application/json'
        )
        resp.headers['Content-Disposition'] = 'attachment; filename="recipes.json"'
        return resp

    except Exception as e:
        app.logger.error(f'[export] {e}')
        return jsonify(error=str(e) or 'Something went wrong'), 500


@app.post('/api/delete-recipe')
@require_auth
def delete_recipe():
    try:
        data    = request.get_json(force=True, silent=True) or {}
        card_id = data.get('cardId', '')
        if not card_id or not re.match(r'^card-[a-z0-9-]+$', card_id):
            return jsonify(error='Invalid card ID'), 400

        with db_cursor() as cur:
            cur.execute('DELETE FROM recipes WHERE card_id = %s', (card_id,))
            if cur.rowcount == 0:
                return jsonify(error='Recipe not found'), 404

        return jsonify(success=True)

    except Exception as e:
        app.logger.error(f'[delete-recipe] {e}')
        return jsonify(error=str(e) or 'Something went wrong'), 500


@app.post('/api/chat')
@require_auth
def chat():
    try:
        data       = request.get_json(force=True, silent=True) or {}
        message    = data.get('message', '')
        history    = data.get('history', [])
        recipe_ctx = data.get('recipeContext', '')  # optional focused recipe context

        if not message or not message.strip():
            return jsonify(error='Message is required'), 400
        if len(message.strip()) > 500:
            return jsonify(error='Message too long (max 500 characters)'), 400

        if not GEMINI_KEY:
            raise RuntimeError('GEMINI_API_KEY is not set in Replit Secrets')

        with db_cursor() as cur:
            cur.execute('SELECT * FROM recipes ORDER BY created_at ASC')
            rows = cur.fetchall()

        recipe_catalog = build_recipe_catalog(rows)

        if recipe_ctx:
            focus_block = (f'\n\nFOCUSED RECIPE (user is currently cooking this):\n'
                           f'---\n{recipe_ctx[:3000]}\n---\n'
                           f'Prioritise answering questions about this specific recipe. '
                           f'Suggest substitutions, scaling, or technique tweaks as needed.')
        else:
            focus_block = ''

        system_prompt = (
            "You are a unified culinary expert AI for the Wall Family Cookbook — "
            "a private family recipe collection — acting with three professional personas:\n"
            "1. Food Scientist – precise with chemical reactions in cooking, food safety, "
            "texture, hydration, fermentation, enzyme activity, and ingredient interactions.\n"
            "2. Professional Baker – expert in dough chemistry, leavening, gluten structure, "
            "proofing schedules, baking temperatures, pastry techniques, and troubleshooting.\n"
            "3. Professional Chef – expert in classical and modern cooking techniques, flavor "
            "balance, seasoning, plating, ingredient substitution, cross-cultural cuisines, "
            "menu design, and kitchen efficiency.\n\n"
            "DOMAIN KNOWLEDGE RULES\n"
            "- Always provide explanations grounded in culinary science and professional practice "
            "(why a technique works, how ingredients interact).\n"
            "- Where appropriate, include safety considerations (critical temperatures, allergen "
            "notes, spoilage risk).\n"
            "- Describe technique precision (timings, temperatures, hydration ratios, "
            "resting/proofing phases).\n\n"
            "RECIPE INTERPRETATION\n"
            "- When given raw text or ingredients, return a structured recipe card with: title, "
            "yield/servings, ingredients with metric and US customary measures, step-by-step "
            "instructions with technical cues, timing and temperature guidance, and pro tips.\n\n"
            "TROUBLESHOOTING\n"
            "- Diagnose issues (e.g., 'why didn't my bread rise?') with root causes from science "
            "and technique. Provide actionable corrections with clear reasoning.\n\n"
            "SUBSTITUTIONS & ADJUSTMENTS\n"
            "- For dietary constraints (gluten-free, vegan, low sodium), propose "
            "professional-grade substitutions and explain how they affect texture and flavor.\n\n"
            "TONE & FORMAT\n"
            "- Be precise and technical but warm and accessible for a family audience.\n"
            "- Use bulleted steps and quantitative parameters where possible.\n"
            "- Use metric measurements first with US equivalents after.\n"
            "- Be conversational and concise — 2 to 4 sentences for simple questions, "
            "more detail for technical or troubleshooting queries.\n\n"
            f"WALL FAMILY COOKBOOK CONTENTS:\n{recipe_catalog}{focus_block}\n\n"
            "Focus your answers on the recipes in this cookbook. If asked about something "
            "not in the cookbook, say so warmly and offer related guidance from what is available."
        )

        # Build structured content list (conversation history + current message)
        contents = []
        for m in (history or [])[-6:]:
            role = m.get('role') if m else None
            parts_text = m.get('parts', '') if m else ''
            if role in ('user', 'model') and parts_text:
                contents.append({
                    'role': role,
                    'parts': [{'text': str(parts_text)[:800]}],
                })
        contents.append({'role': 'user', 'parts': [{'text': message.strip()}]})

        gen_cfg = {'temperature': 0.7, 'maxOutputTokens': 1024}

        reply_text = _gemini_text(contents, gen_config=gen_cfg,
                                  system_instruction=system_prompt).strip()
        return jsonify(reply=reply_text)

    except RuntimeError as e:
        # RuntimeError from _gemini_text includes the API error body
        app.logger.error(f'[chat] {e}')
        return jsonify(error=str(e)), 502

    except Exception as e:
        import traceback
        app.logger.error(f'[chat] {type(e).__name__}: {e}\n{traceback.format_exc()}')
        return jsonify(error='Something went wrong — please try again.'), 500

# ── Startup ────────────────────────────────────────────────────────────────────

if __name__ == '__main__':
    print('[startup] HTML template loaded')

    ensure_table()

    with db_cursor() as cur:
        cur.execute('SELECT COUNT(*) AS count FROM recipes')
        recipe_count = cur.fetchone()['count']

    if recipe_count == 0:
        print('[startup] Recipes table empty — checking for old data to migrate...')
        migrated = migrate_from_old_table()
        if migrated == 0:
            print('[startup] No previous data found — starting with an empty cookbook')
    else:
        print(f'[startup] Loaded {recipe_count} recipe(s) from database')

    print(f'Wall Family Cookbook running on http://0.0.0.0:{PORT}')
    app.run(host='0.0.0.0', port=PORT, debug=False)
