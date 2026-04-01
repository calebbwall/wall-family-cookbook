# Security Audit & Remediation Plan — Claude Prompt

> **Usage**: Copy this entire prompt and paste it into a Claude session with access to the `calebbwall/wall-family-cookbook` repository. Claude will produce a step-by-step security audit and remediation plan tailored to this codebase.

---

## Prompt Begins Here

You are a senior security engineer, full-stack architect, and code auditor.

Perform a **comprehensive security audit and remediation plan** for the GitHub repository `calebbwall/wall-family-cookbook`. This is a family recipe web application. You have full access to the codebase.

---

### Repo-Specific Context

This is not a generic app. Here is the exact stack and architecture you are auditing:

| Layer | Technology | Key Files |
|-------|-----------|-----------|
| **Backend** | Flask (Python 3.11) | `app.py` (~1968 lines — the entire backend) |
| **Frontend** | React 18 + Vite 6 | `frontend/src/App.jsx`, `frontend/src/api.js`, `frontend/src/components/*.jsx` |
| **Legacy Frontend** | Vanilla HTML/CSS/JS | `public/app.js` (101KB), `public/index.html` (32KB), `index.html` (78KB) |
| **Database** | PostgreSQL via `psycopg2` (raw SQL, no ORM) | Schema defined inline in `app.py:91-156` |
| **AI** | Google Gemini 2.5 Flash | Recipe extraction, HTML card generation, chat assistant, grocery merging — all in `app.py` |
| **Auth** | Shared family passphrase → HMAC-SHA256 cookie | `app.py:267-301` |
| **File Uploads** | Images to `public/uploads/` | `app.py:1248-1257` |
| **Hosting** | Replit (gunicorn, auto-scaling) | `.replit` config |
| **Dependencies** | `Flask>=3.0.0`, `psycopg2-binary>=2.9.9`, `requests>=2.31.0`, `Werkzeug>=3.0.0`, `gunicorn>=21.2.0` | `requirements.txt` |
| **Frontend Deps** | `react@^18.3.1`, `react-dom@^18.3.1`, `marked@^9.1.6`, `vite@^6.0.0` | `frontend/package.json` |

**Database Tables** (defined in `app.py:91-156`):
- `recipes` — columns: `id`, `category`, `author_name`, `card_html` (legacy HTML), `card_id` (unique slug), `created_at`, `recipe_json` (structured JSON), `source_type`
- `households` — columns: `id`, `name`, `sort_order`, `created_at` (pre-seeded with 6 families)
- `grocery_state` — columns: `household` (PK), `state_json` (JSON blob), `updated_at`

**Environment Variables** (loaded in `app.py:45-48`):
- `PASSPHRASE` — defaults to `'Joe+Linda'` if not set
- `GEMINI_API_KEY` — required for AI features
- `DATABASE_URL` — auto-set by Replit PostgreSQL
- `PORT` — defaults to `5000`

---

### Output Rules (Strictly Follow These)

* Do **not** give a generic security checklist.
* Do **not** stop at listing vulnerabilities.
* Do **not** write vague advice like "consider using a WAF" or "review your security posture."
* Produce a **step-by-step implementation plan** with concrete remediation steps, including code snippets.
* Keep all suggested fixes **free / open-source only**.
* This is a **family-use app** — avoid overengineering. No Kubernetes, no enterprise IAM, no paid SaaS.
* Prioritize practical hardening that can be completed in small increments.

---

### Section 1: Map the Architecture

Read the following files and produce a runtime architecture diagram (text-based):

- `app.py` — the entire Flask backend (routes, auth, DB, AI integration, HTML generation)
- `frontend/src/App.jsx` — React SPA root
- `frontend/src/api.js` — frontend HTTP client (fetch wrapper)
- `frontend/vite.config.js` — Vite config with API proxy
- `.replit` — deployment manifest
- `requirements.txt` and `frontend/package.json` — dependencies

Identify:
1. Where secrets exist at rest and in transit (env vars, cookies, API keys in URL query strings)
2. Where user-supplied data enters the system (form inputs, URL imports, file uploads, AI chat messages)
3. Where generated/stored HTML is rendered (recipe cards, AI chat responses)
4. Where external network calls are made (Gemini API, URL fetching for recipe import, Instagram scraping)
5. Any mismatch between `README.md` documentation and actual implementation

---

### Section 2: Authentication & Access Control

Audit the passphrase-based auth system at `app.py:267-301`. Specifically:

**Auth token generation** (`app.py:269-270`):
```python
def make_auth_token(passphrase):
    return hmac.new(b'wfc-2026-apr-salt', passphrase.encode('utf-8'), hashlib.sha256).hexdigest()
```
- The HMAC salt `'wfc-2026-apr-salt'` is hardcoded. Assess whether this is acceptable for a family app or whether it should be moved to an env var.
- The token is deterministic — same passphrase always produces the same token. Assess replayability.
- There is no session invalidation mechanism. Assess the impact of cookie theft.

**Cookie settings** (`app.py:1149-1155`):
```python
resp.set_cookie(COOKIE_NAME, VALID_TOKEN,
    max_age=COOKIE_MAX_AGE,   # 30 days
    httponly=True,
    samesite='None',           # ⚠ Allows cross-site cookie submission
    secure=True,
    path='/')
```
- `SameSite='None'` enables CSRF. Assess whether this should be `'Lax'` or `'Strict'`.
- The 30-day cookie has no rotation or revocation mechanism.

**Authorization gaps**:
- All authenticated users share the same privilege level. Any user can edit or delete any recipe.
- The `author_name` field is stored (`app.py:1395`) but never validated for authorization.
- The `/api/add-household` endpoint (`app.py`) requires a valid passphrase but has no admin concept.
- Check every `@require_auth` route and identify any unprotected routes that should be protected.

**Login endpoint** (`app.py` — `/api/login`):
- No rate limiting on login attempts. Assess brute-force risk given a simple shared passphrase.
- No account lockout mechanism.

Provide concrete fixes for each issue. Suggest whether per-user accounts (even lightweight ones) would be worth adding.

---

### Section 3: Input Validation & Injection Risks

**SQL Injection**: Verify that ALL database queries in `app.py` use parameterized queries (`%s` placeholders with `cur.execute()`). Confirm no string concatenation or f-strings are used in SQL. Report any exceptions.

**XSS / HTML Injection** — This is the highest-risk area. Audit these specific patterns:

1. **Stored HTML recipe cards**: The `recipes.card_html` column stores full HTML. This HTML is:
   - Generated by Gemini AI (`app.py:781-802`) — treat as untrusted
   - Built from structured JSON via `build_card_html_from_json()` (`app.py:917-1062`) — uses `esc()` helper
   - Manually edited and saved via `/api/save-card-html` (`app.py:1560-1588`)

2. **Regex-based HTML sanitization** (`app.py:1574-1576`):
   ```python
   if re.search(r'<script[\s\S]*?</script>|<iframe|<object|<embed|<link\s|<meta\s|javascript:', sanitized, re.IGNORECASE):
       return jsonify(error='HTML contains forbidden elements...'), 400
   ```
   - This is a blacklist approach. Assess whether it can be bypassed (e.g., `<img onerror=...>`, `<svg onload=...>`, `<body onload=...>`, data URIs, CSS `expression()`, etc.).
   - Recommend replacing with a proper allowlist sanitizer like `bleach` (Python) or `DOMPurify` (client-side).

3. **`dangerouslySetInnerHTML` in React** — Two locations:
   - `frontend/src/components/RecipeCard.jsx:34` — renders `recipe.cardHtml` from the database
   - `frontend/src/components/ChatPanel.jsx:85` — renders `marked.parse(msg.content)` from AI chat
   - Assess whether `marked` (v9.1.6) sanitizes HTML by default. If not, recommend adding `DOMPurify`.

4. **The `esc()` helper** (`app.py:922-925`):
   ```python
   def esc(s):
       return (str(s).replace('&', '&amp;').replace('<', '&lt;')
               .replace('>', '&gt;').replace('"', '&quot;'))
   ```
   - This escapes 4 characters but misses single quotes (`'`). Assess whether this matters in the contexts where `esc()` is used. Recommend using `markupsafe.escape()` or `html.escape()` instead.

5. **Category validation** (`app.py:1400`): Verify the category whitelist is enforced server-side.
6. **Author name** (`app.py:1402`): Check length validation (1-40 chars). Is HTML injection possible in author names?
7. **Chat messages** (`app.py:1656`): Check length limit (max 500 chars). Is prompt injection possible?
8. **Card ID validation** (`app.py:1490, 1630`): Verify the regex `^card-[a-z0-9-]+$` is sufficient.

---

### Section 4: Server-Side Request Forgery (SSRF)

Audit the URL-fetching logic at `app.py:496-551`. This code fetches external URLs for recipe imports.

Check for:
1. **Internal network access**: Can a user submit `http://localhost:5000/api/...`, `http://127.0.0.1`, `http://169.254.169.254` (cloud metadata), or `http://[::1]` to reach internal services?
2. **Redirect following**: Does `requests.get()` follow redirects by default? Can an attacker use a redirect chain from an external URL to reach internal services?
3. **DNS rebinding**: Can a hostname resolve to an internal IP after the initial check?
4. **Protocol confusion**: Are `file://`, `ftp://`, `gopher://` schemes blocked?
5. **Content-type confusion**: Does the code validate the response content type before processing?
6. **Response size limits**: Is there a limit on how much data the server will download?

Also audit the Instagram fetcher at `/api/fetch-instagram` for similar SSRF risks.

Provide a concrete fix: an allowlist validator function that checks scheme (http/https only), resolves DNS, validates the IP is not private/reserved/loopback, limits redirects, and enforces a response size cap.

---

### Section 5: AI Integration Risks

Audit all Gemini API interactions in `app.py`. Key concerns:

1. **Prompt injection**: Can a user craft recipe text, a URL, or an image that causes Gemini to:
   - Return malicious HTML/JavaScript in generated recipe cards?
   - Leak the system prompt or other recipes?
   - Execute unintended actions?

2. **Unsafe AI output**: The app directly renders Gemini-generated HTML in recipe cards. Even with post-generation sanitization, assess whether:
   - The regex sanitizer (`app.py:1415`) catches all dangerous patterns Gemini could produce
   - The structured JSON path (`build_card_html_from_json`) is safer and should be the only path

3. **API key exposure**: The Gemini API key is passed as a URL query parameter (`app.py:753`):
   ```python
   url = f'{_GEMINI_BASE}/{model}:generateContent?key={GEMINI_KEY}'
   ```
   - This means the key appears in server access logs, Replit logs, and potentially error messages.
   - Recommend switching to header-based authentication if the Gemini API supports it.

4. **Error handling**: Check what happens when Gemini returns unexpected output, errors, or empty responses. Are error messages leaked to the client?

5. **Cost/abuse**: Without rate limiting, an attacker with the shared passphrase could make unlimited Gemini API calls. Assess the financial risk and recommend per-session or per-IP rate limits.

---

### Section 6: Frontend-Specific Risks

Audit the React frontend in `frontend/src/` and the legacy frontend in `public/`:

1. **`api.js` (`frontend/src/api.js`)**: How does the frontend handle 401 responses? Does it expose auth state? Does it trust server responses too much?

2. **Token/cookie handling**: The `wfc_household` cookie is readable by JavaScript (no `httponly`). Verify this cookie contains no sensitive data. Check if any sensitive data is stored in `localStorage` or `sessionStorage`.

3. **Legacy code** (`public/app.js` — 101KB, `public/index.html`): This appears to be a massive legacy single-page app. Assess:
   - Inline event handlers and `onclick` attributes
   - Direct DOM manipulation with `innerHTML`
   - Any inline `<script>` blocks in HTML templates
   - Whether this legacy code is still served or has been fully replaced by the React SPA

4. **`marked` library** (`frontend/src/components/ChatPanel.jsx`): Check if `marked@^9.1.6` sanitizes HTML by default. If not, AI chat responses could contain executable HTML. Recommend adding DOMPurify.

5. **Client-side trust**: Does the frontend ever trust user input or server data without validation before rendering?

---

### Section 7: Database & Persistence

Audit the PostgreSQL usage in `app.py`:

1. **Parameterized queries**: Confirm ALL queries use `%s` placeholders. Flag any that don't.
2. **Connection pool**: The `ThreadedConnectionPool(1, 10)` at `app.py:91` — assess pool exhaustion risk under load.
3. **Stored HTML**: The `card_html` column stores raw HTML. This is the primary XSS vector. Recommend whether to:
   - Sanitize on write (before storage)
   - Sanitize on read (before rendering)
   - Both (defense in depth)
4. **`grocery_state.state_json`**: A JSON blob stored as TEXT. Is it validated before storage? Could malformed JSON cause errors?
5. **Data export** (`/api/export`): Does the export endpoint leak any sensitive data (household info, internal IDs)?
6. **Migration script** (`migrate_to_json.py`): Review for SQL injection or unsafe operations.
7. **Schema constraints**: Are there missing `NOT NULL`, length limits, or foreign key constraints that could cause data integrity issues?

---

### Section 8: Infrastructure & Deployment

1. **Replit hosting** (`.replit`):
   - HTTPS is enforced by Replit's proxy. Confirm this is relied upon correctly.
   - Replit Secrets should store env vars. Confirm the code doesn't fall back to insecure defaults in production.

2. **Default passphrase** (`app.py:45`):
   ```python
   PASSPHRASE = os.environ.get('PASSPHRASE', 'Joe+Linda')
   ```
   - The default `'Joe+Linda'` means the app is accessible with a known passphrase if the env var is not set.
   - Recommend: crash on startup if `PASSPHRASE` is not set, or at minimum log a warning.

3. **Missing security headers**: Add an `@app.after_request` handler that sets:
   - `Content-Security-Policy` (restrict script sources, block inline scripts if possible)
   - `X-Content-Type-Options: nosniff`
   - `X-Frame-Options: DENY`
   - `Strict-Transport-Security: max-age=31536000; includeSubDomains`
   - `Referrer-Policy: strict-origin-when-cross-origin`
   - `Permissions-Policy: camera=(), microphone=(), geolocation=()`
   Provide the exact Python code.

4. **Gemini API key in logs**: The API key appears in URL query strings, which may be logged by gunicorn, Replit, or any reverse proxy. Recommend header-based auth.

5. **Upload directory**: `public/uploads/` is served statically. Ensure uploaded files cannot be executed (e.g., `.html`, `.svg` files that contain JavaScript). Recommend serving uploads with `Content-Disposition: attachment` or `X-Content-Type-Options: nosniff`.

6. **`.gitignore` gaps**: Currently excludes `.env`, `node_modules/`, `public/dist/`. Recommend also excluding:
   - `*.key`, `*.pem`, `*.p12` (private keys)
   - `.env*` (all env variants)
   - `*.log` (log files)
   - `public/uploads/*` (user-uploaded content)

---

### Section 9: Dependency & Supply-Chain Risk

1. **Python dependencies** (`requirements.txt`): All use `>=` version specifiers with no upper bound. Recommend pinning exact versions or using `~=` (compatible release). Run `pip audit` or `safety check` to identify known CVEs.

2. **Frontend dependencies** (`frontend/package.json`): Uses `^` version specifiers. Run `npm audit` to check for known vulnerabilities.

3. **`marked` library**: Check if version `^9.1.6` has known XSS vulnerabilities. If so, recommend upgrading or adding DOMPurify.

4. **`psycopg2-binary`**: This is the binary distribution. For production, consider whether `psycopg2` (source build) is preferred for security, or whether binary is acceptable for a family app.

5. **No lock file for Python**: There's no `requirements.lock` or `Pipfile.lock`. Recommend adding one for reproducible builds.

---

### Severity Classification

For every finding, classify as:

| Severity | Criteria |
|----------|----------|
| **Critical** | Exploitable now with no auth, leads to data loss or RCE |
| **High** | Exploitable with auth or minor effort, leads to XSS/data exfil/SSRF |
| **Medium** | Requires specific conditions, limited impact |
| **Low** | Best practice, defense in depth, maintainability |

For each finding, state:
1. **What**: The vulnerability
2. **Where**: Exact file path and line number(s)
3. **Why**: Impact if exploited
4. **Fix**: Concrete code change or configuration
5. **Effort**: Quick win (<1 hour) or deeper refactor
6. **Priority**: Implementation order (1 = do first)

---

### Required Output Structure

Produce your audit in exactly this structure:

#### 1. Executive Summary
- 3-5 sentence overview of the security posture
- Top 3 most critical findings
- Overall risk rating for a family-use app

#### 2. Architecture Map
- Text-based diagram of the runtime architecture
- Data flow for: login, recipe creation, recipe import via URL, AI chat, file upload
- Trust boundaries

#### 3. Findings by Severity
- Group all findings under Critical / High / Medium / Low
- Each finding follows the What/Where/Why/Fix/Effort/Priority format

#### 4. Quick Wins (< 1 Hour Each)
- Ordered list of fixes that can be applied immediately
- Include exact code snippets

#### 5. Medium-Term Refactors (1-4 Hours Each)
- Ordered list of deeper fixes
- Include implementation approach

#### 6. Long-Term Hardening
- Architectural improvements for ongoing security
- Lightweight auth evolution path (if per-user accounts make sense)
- Monitoring and alerting recommendations (free tools only)

#### 7. Verification Plan
- How to test each fix
- Manual test steps
- Free automated tools to run (e.g., `pip audit`, `npm audit`, `bandit`, `semgrep`)

#### 8. Security Maintenance Checklist
- Ongoing tasks for the maintainer
- Dependency update cadence
- What to check before each deployment

---

### Constraints Reminder

- **Free tools only** — no paid services, no enterprise features
- **Family app** — don't suggest enterprise auth, complex RBAC, or heavyweight infrastructure
- **Actionable** — every recommendation must include a concrete implementation step
- **Prioritized** — order fixes by impact and effort, quick wins first
- **Code-level** — include code snippets for all non-trivial fixes
- **No fluff** — skip generic advice, focus on this specific codebase
