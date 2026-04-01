#!/usr/bin/env python3
"""
migrate_to_json.py — Backfill recipe_json for all recipes that have card_html but no recipe_json.

Usage:
    python migrate_to_json.py            # Run migration
    python migrate_to_json.py --dry-run  # Preview what would be migrated
"""

import os
import re
import sys
import json
import time
import argparse

import psycopg2
import psycopg2.extras
import requests as http_requests

DATABASE_URL = os.environ.get('DATABASE_URL')
GEMINI_KEY = os.environ.get('GEMINI_API_KEY')
_GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'
_GEMINI_MODEL = 'gemini-2.5-flash'

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
  "steps": [{"title": "1-2 word step name e.g. Mix", "detail": "full step detail", "timer_secs": 0}],
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
    "timer_secs rules (IMPORTANT — be very selective):\n"
    "- Set timer_secs ONLY when the cook must actively wait while something runs (baking, roasting,\n"
    "  simmering, boiling, resting, marinating, chilling, proofing, frying, steaming).\n"
    "- Use the MAXIMUM of any time range (e.g. '20-25 minutes' → 1500).\n"
    "- Set to 0 for steps that are just actions: chopping, mixing, seasoning, plating, preheating,\n"
    "  adding ingredients, or any step that mentions a time only as context (e.g. 'a 30-minute recipe').\n"
    "- Do NOT set a timer just because a number appears in the step.\n\n"
    "calibration_notes rules (REQUIRED — always include 2–4):\n"
    "- Each note must be recipe-specific and actionable (NOT generic advice like 'add more salt').\n"
    "- goal: a 1–3 word outcome the cook wants (e.g. 'Crispier Crust', 'Richer Sauce', 'Less Sweet').\n"
    "- tip: exactly how to achieve it for THIS dish (e.g. 'Broil the last 3 min', 'Sub heavy cream for milk').\n"
    "- Infer these from the recipe technique if not stated — every recipe has room to tweak.\n\n"
    "storage rules (REQUIRED — always include 2–3 options):\n"
    "- Always include at least: Refrigerator and one of Freezer or Counter, with specific durations.\n"
    "- Use real durations (e.g. 'Up to 4 days', 'Up to 3 months') — never vague like 'a few days'.\n\n"
    "chefs_note rules (REQUIRED — must be specific and insightful):\n"
    "- Write exactly ONE sentence with a specific pro tip, flavor secret, or key technique for THIS dish.\n"
    "- It must be recipe-specific, not generic (e.g. NOT 'Season to taste').\n"
    "- Examples: 'Letting the dough rest overnight cold-ferments it for a deeper, more complex flavor.'\n"
    "  or 'Browning the butter before adding it gives the sauce a rich, nutty depth.'\n\n"
    "Recipe content:\n---\n{content}\n---"
)


def _gemini_post(contents, gen_config=None):
    if not GEMINI_KEY:
        raise RuntimeError('GEMINI_API_KEY is not set')
    url = f'{_GEMINI_BASE}/{_GEMINI_MODEL}:generateContent?key={GEMINI_KEY}'
    payload = {'contents': contents}
    if gen_config:
        payload['generationConfig'] = gen_config
    resp = http_requests.post(url, json=payload, timeout=60)
    if not resp.ok:
        raise RuntimeError(f'Gemini API error {resp.status_code}: {resp.text[:400]}')
    return resp.json()


def _gemini_text(contents, gen_config=None):
    data = _gemini_post(contents, gen_config=gen_config)
    try:
        return data['candidates'][0]['content']['parts'][0]['text']
    except (KeyError, IndexError, TypeError) as exc:
        raise RuntimeError(f'Unexpected Gemini response shape: {data}') from exc


def extract_recipe_from_html(card_html, category_hint=''):
    gen_cfg = {'temperature': 0.2, 'maxOutputTokens': 8192,
               'responseMimeType': 'application/json'}
    hint = category_hint or 'determine from content'
    prompt = (EXTRACTION_PROMPT
              .replace('{category_hint}', hint)
              .replace('{content}', card_html[:8000]))
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
        raise RuntimeError('AI returned invalid JSON')


def get_title_from_html(html):
    m = re.search(r'class="front-title"[^>]*>([^<]+)', html)
    if m:
        return m.group(1).strip()
    m = re.search(r'<h\d[^>]*>([^<]+)', html)
    if m:
        return m.group(1).strip()
    return '(unknown title)'


def main():
    parser = argparse.ArgumentParser(description='Backfill recipe_json from card_html')
    parser.add_argument('--dry-run', action='store_true',
                        help='Preview what would be migrated without writing to DB')
    args = parser.parse_args()

    if not DATABASE_URL:
        print('ERROR: DATABASE_URL not set')
        sys.exit(1)
    if not GEMINI_KEY and not args.dry_run:
        print('ERROR: GEMINI_API_KEY not set')
        sys.exit(1)

    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    # Count already-done recipes
    cur.execute("SELECT COUNT(*) AS c FROM recipes WHERE recipe_json IS NOT NULL AND recipe_json != ''")
    already_done = cur.fetchone()['c']

    # Get recipes needing migration
    cur.execute("""
        SELECT card_id, category, card_html
        FROM recipes
        WHERE (recipe_json IS NULL OR recipe_json = '')
          AND card_html IS NOT NULL AND card_html != ''
        ORDER BY created_at ASC
    """)
    rows = cur.fetchall()
    total = len(rows)

    print(f'\n=== Recipe JSON Migration ===')
    print(f'Already migrated: {already_done}')
    print(f'Need migration:   {total}')
    if args.dry_run:
        print(f'Mode: DRY RUN (no changes will be written)\n')
    else:
        print(f'Mode: LIVE (will write to database)\n')

    if total == 0:
        print('Nothing to migrate — all recipes already have recipe_json!')
        cur.close()
        conn.close()
        return

    succeeded = 0
    skipped = 0

    for i, row in enumerate(rows, 1):
        title = get_title_from_html(row['card_html'])
        card_id = row['card_id']
        category = row['category']

        if args.dry_run:
            print(f'  [{i}/{total}] Would migrate: {title} (card_id={card_id}, category={category})')
            succeeded += 1
            continue

        try:
            print(f'  [{i}/{total}] Migrating: {title} ...', end=' ', flush=True)
            recipe_json = extract_recipe_from_html(row['card_html'], category_hint=category)
            json_str = json.dumps(recipe_json)

            cur.execute(
                'UPDATE recipes SET recipe_json = %s WHERE card_id = %s',
                (json_str, card_id)
            )
            conn.commit()
            print(f'OK (confidence={recipe_json.get("confidence", "?")})')
            succeeded += 1

        except Exception as e:
            conn.rollback()
            print(f'SKIPPED — {e}')
            skipped += 1

        # Rate limit between Gemini calls
        if i < total:
            time.sleep(1.5)

    print(f'\n=== Migration Summary ===')
    print(f'Succeeded: {succeeded}')
    print(f'Skipped:   {skipped}')
    print(f'Already done: {already_done}')
    print(f'Total recipes: {already_done + succeeded + skipped}')

    cur.close()
    conn.close()


if __name__ == '__main__':
    main()
