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
from pathlib import Path
from contextlib import contextmanager
from functools import wraps

import psycopg2
import psycopg2.pool
import psycopg2.extras
import requests as http_requests
import google.generativeai as genai
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

    html = template_html

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

# ── Gemini caller ──────────────────────────────────────────────────────────────

def generate_card_html(prompt, use_search=False):
    if not GEMINI_KEY:
        raise RuntimeError('GEMINI_API_KEY is not set in Replit Secrets')

    genai.configure(api_key=GEMINI_KEY)

    model_kwargs = {
        'model_name': 'gemini-2.5-flash',
        'generation_config': genai.types.GenerationConfig(temperature=0.4, max_output_tokens=8000),
    }
    if use_search:
        model_kwargs['tools'] = [{'google_search': {}}]

    model    = genai.GenerativeModel(**model_kwargs)
    card_html = ''

    for attempt in range(1, 3):
        result = model.generate_content(prompt)
        text   = result.text.strip()
        text   = re.sub(r'^```html\s*', '', text, flags=re.IGNORECASE)
        text   = re.sub(r'\s*```$', '', text)

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
            title = (re.search(r'class="front-title">([^<]+)<', c) or ['', '?'])[1] if re.search(r'class="front-title">([^<]+)<', c) else '?'
            sub   = (re.search(r'class="front-sub">([^<]+)<', c) or ['', ''])[1] if re.search(r'class="front-sub">([^<]+)<', c) else ''
            chips = ', '.join(m.group(1) for m in re.finditer(r'class="chip">([^<]+)<', c))
            lines.append(f'- {title} (by {recipe["author_name"]}): {chips}' + (f' — {sub}' if sub else ''))

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


@app.post('/api/add-recipe')
@require_auth
def add_recipe():
    try:
        data        = request.get_json(force=True, silent=True) or {}
        category    = data.get('category', '')
        author_name = data.get('authorName', '')
        recipe_input= data.get('recipeInput', '')
        media_url   = data.get('mediaUrl', '')

        if category not in SECTION_MAP:
            return jsonify(error='Invalid category selected'), 400
        if not author_name or not (1 <= len(author_name.strip()) <= 40):
            return jsonify(error='Please enter your name (max 40 characters)'), 400

        MEDIA_URL_RE   = re.compile(
            r'https?://\S*instagram\.com/(?:p|reel|tv)/[^\s"<>]+'
            r'|https?://\S+\.(?:jpg|jpeg|png|gif|webp|avif)(?:\?[^\s"<>]*)?',
            re.IGNORECASE
        )
        recipe_text      = (recipe_input or '').strip()
        detected_media   = ''
        m = MEDIA_URL_RE.search(recipe_text)
        if m:
            detected_media = m.group(0)
            recipe_text    = recipe_text.replace(detected_media, '').strip()

        is_link = bool(re.match(r'^https?://.+', recipe_text, re.IGNORECASE))
        if not recipe_text or (not is_link and len(recipe_text) < 20):
            if detected_media:
                return jsonify(error="Got your link! Now paste the recipe text alongside it and we'll attach the photo to the card."), 400
            return jsonify(error='Recipe is too short — please paste more detail'), 400

        is_url = bool(re.match(r'^https?://.+', recipe_text, re.IGNORECASE))
        if is_url:
            try:
                recipe_text = fetch_url_content(recipe_text)
            except Exception:
                pass  # fall through — pass URL directly to Gemini

        first_line = recipe_text.split('\n')[0][:80]
        card_id    = generate_unique_id(first_line)

        if is_url and bool(re.match(r'^https?://.+', recipe_text, re.IGNORECASE)):
            prompt   = build_url_prompt(recipe_text, category, author_name.strip(), card_id)
            card_html = generate_card_html(prompt, use_search=True)
        else:
            prompt   = build_prompt(recipe_text, category, author_name.strip(), card_id)
            card_html = generate_card_html(prompt)

        final_media = detected_media or (media_url.strip() if re.match(r'^https?://', media_url or '', re.IGNORECASE) else '')
        if final_media:
            card_html = inject_media(card_html, final_media)

        with db_cursor() as cur:
            cur.execute(
                'INSERT INTO recipes (category, author_name, card_html, card_id) VALUES (%s, %s, %s, %s)',
                (category, author_name.strip(), card_html, card_id)
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
        data    = request.get_json(force=True, silent=True) or {}
        message = data.get('message', '')
        history = data.get('history', [])

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

        system_prompt = f"""You are a helpful, warm cooking assistant for the Wall Family Cookbook — a private family recipe collection.

CURRENT COOKBOOK CONTENTS:
{recipe_catalog}

Your role:
- Answer questions about these specific recipes (ingredients, techniques, substitutions, timing, scaling)
- Help family members decide what to cook based on what's in the cookbook
- Suggest modifications and troubleshoot cooking problems
- Be conversational and concise — 2 to 4 sentences unless more detail is genuinely needed
- If asked about something not in the cookbook, say so warmly and offer related help from what's available
- Do not invent recipes that aren't in the cookbook"""

        genai.configure(api_key=GEMINI_KEY)
        model = genai.GenerativeModel(
            model_name='gemini-2.5-flash',
            generation_config=genai.types.GenerationConfig(temperature=0.7, max_output_tokens=1000),
            system_instruction=system_prompt,
        )

        safe_history = [
            {'role': m['role'], 'parts': [str(m['parts'])[:500]]}
            for m in (history or [])[-8:]
            if m and m.get('role') in ('user', 'model') and m.get('parts')
        ]

        chat_session = model.start_chat(history=safe_history)
        result       = chat_session.send_message(message.strip())

        return jsonify(reply=result.text.strip())

    except Exception as e:
        app.logger.error(f'[chat] {e}')
        return jsonify(error='Something went wrong — please try again'), 500

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
