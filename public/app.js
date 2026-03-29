/**
 * Wall Family Cookbook — Client-Side JavaScript
 * Extracted from index.html for clean separation of concerns.
 *
 * Sections:
 *   - Card flipping
 *   - Add Recipe modal
 *   - Edit Recipe modal
 *   - Direct Edit structured form
 *   - Delete recipe
 *   - Chat assistant
 *   - Search / filter
 *   - Back-to-top button
 *   - Page-load init
 */

// ── Safe JSON helper ─────────────────────────────────────────────
// Wraps res.json() so a non-JSON response (e.g. HTML login page returned
// when a session expires) never leaks a raw WebKit parse error like
// "The string did not match the expected pattern." to the user.
async function safeJson(res) {
  let data;
  try {
    data = await res.json();
  } catch {
    // Response wasn't JSON — almost always means auth expired and the
    // server returned the HTML login page.
    if (res.status === 401 || res.redirected) {
      throw new Error('Session expired — please refresh the page and log in again.');
    }
    throw new Error('Unexpected server response — please try again.');
  }
  // Even if JSON parsed, a 401 status means the session is gone.
  if (res.status === 401) {
    throw new Error(data.error || 'Session expired — please refresh the page and log in again.');
  }
  return data;
}

// ── Media state ──────────────────────────────────────────────────
const INSTAGRAM_RE = /instagram\.com\/(p|reel|tv)\//i;
let _dfMediaUrl = ''; // resolved URL for Direct Edit form

// Direct Edit form — media helpers
async function handleDfPhotoFile(input) {
  if (!input.files || !input.files[0]) return;
  const form = new FormData();
  form.append('photo', input.files[0]);
  try {
    const res  = await fetch('/api/upload-media', { method: 'POST', body: form });
    const data = await safeJson(res);
    if (!res.ok) { alert(data.error || 'Upload failed'); return; }
    _dfMediaUrl = data.url;
    document.getElementById('df-media-url').value = '';
    _renderDfMediaPreview(data.url);
  } catch (err) { alert(err.message || 'Upload failed — please try again'); }
}

function handleDfMediaUrl(val) {
  _dfMediaUrl = val.trim();
  _renderDfMediaPreview(_dfMediaUrl);
}

function _renderDfMediaPreview(url) {
  const wrap = document.getElementById('df-media-preview');
  const img  = document.getElementById('df-media-preview-img');
  const ig   = document.getElementById('df-media-preview-ig');
  if (!url) { wrap.style.display = 'none'; return; }
  wrap.style.display = 'block';
  if (INSTAGRAM_RE.test(url)) {
    img.style.display = 'none'; ig.style.display = 'flex';
  } else {
    ig.style.display = 'none'; img.src = url; img.style.display = 'block';
  }
}

function clearDfMedia() {
  _dfMediaUrl = '';
  document.getElementById('df-media-url').value = '';
  document.getElementById('df-photo-file').value = '';
  document.getElementById('df-media-preview').style.display = 'none';
}

// ── Cook Mode ────────────────────────────────────────────────────
let _chatRecipeContext = '';
let _cookSteps        = [];   // { num, text, timerSecs } for step-zoom nav
let _cookStepIndex    = 0;    // current step in step-zoom overlay
let _stepTimers       = {};   // stepIndex → { remaining, interval, btn, display }
let _cookBaseServings = 1;    // original serving count parsed from card
let _cookCurServings  = 1;    // current (user-adjusted) serving count

// ── Fraction helpers ──────────────────────────────────────────────
const _FRAC_MAP = {
  '\u00BC': 0.25, '\u00BD': 0.5,  '\u00BE': 0.75,
  '\u2150': 1/7,  '\u2151': 1/9,  '\u2152': 1/10,
  '\u2153': 1/3,  '\u2154': 2/3,
  '\u2155': 1/5,  '\u2156': 2/5,  '\u2157': 3/5,  '\u2158': 4/5,
  '\u2159': 1/6,  '\u215A': 5/6,
  '\u215B': 1/8,  '\u215C': 3/8,  '\u215D': 5/8,  '\u215E': 7/8,
};
const _FRAC_CHARS = Object.keys(_FRAC_MAP).join('');

function _parseFrac(str) {
  // Parse a leading number token (int, decimal, slash-fraction, unicode frac, or mixed)
  str = str.trim();
  if (!str) return null;
  // unicode fraction char alone or after integer e.g. "1½"
  const mixedRe = new RegExp(`^(\\d+)?([${_FRAC_CHARS}])`);
  const mixedM  = str.match(mixedRe);
  if (mixedM) {
    const whole = mixedM[1] ? parseInt(mixedM[1], 10) : 0;
    return whole + _FRAC_MAP[mixedM[2]];
  }
  // slash fraction e.g. "3/4"
  const slashM = str.match(/^(\d+)\/(\d+)/);
  if (slashM) return parseInt(slashM[1], 10) / parseInt(slashM[2], 10);
  // plain integer or decimal
  const numM = str.match(/^(\d+(?:\.\d+)?)/);
  if (numM) return parseFloat(numM[1]);
  return null;
}

function _formatNum(n) {
  // Format a number back to a clean fraction string where appropriate
  if (n <= 0) return '0';
  const eighths = Math.round(n * 8);
  const whole   = Math.floor(eighths / 8);
  const rem     = eighths % 8;
  const fracStr = { 0:'', 1:'⅛', 2:'¼', 3:'⅜', 4:'½', 5:'⅝', 6:'¾', 7:'⅞' }[rem] || '';
  if (whole === 0) return fracStr || '0';
  return fracStr ? `${whole}${fracStr}` : `${whole}`;
}

// Leading-number regex: captures the number token + the rest of the string
const _LEAD_NUM_RE = new RegExp(
  `^(\\d+[${_FRAC_CHARS}]|[${_FRAC_CHARS}]|\\d+\\/\\d+|\\d+(?:\\.\\d+)?)(.*)$`,
  's'
);

function _scaleIngText(originalText, ratio) {
  const m = originalText.match(_LEAD_NUM_RE);
  if (!m) return originalText;
  const val = _parseFrac(m[1]);
  if (val === null) return originalText;
  return _formatNum(val * ratio) + m[2];
}

// ── Servings scaler UI ────────────────────────────────────────────
function _buildServingsScaler(baseServings) {
  _cookBaseServings = baseServings;
  _cookCurServings  = baseServings;

  const row = document.createElement('div');
  row.className = 'cook-mode-servings';
  row.innerHTML = `
    <span class="cook-mode-servings-label">Servings</span>
    <button class="cook-mode-servings-btn" id="cm-serv-minus" aria-label="Fewer servings">−</button>
    <span class="cook-mode-servings-count" id="cm-serv-count">${baseServings}</span>
    <button class="cook-mode-servings-btn" id="cm-serv-plus"  aria-label="More servings">+</button>
  `;
  return row;
}

function _updateServings(delta) {
  const next = Math.max(1, _cookCurServings + delta);
  if (next === _cookCurServings) return;
  _cookCurServings = next;
  document.getElementById('cm-serv-count').textContent = next;
  const ratio = next / _cookBaseServings;
  document.querySelectorAll('#cook-mode-body .b-ing-row').forEach(row => {
    const orig = row.dataset.originalText;
    if (orig !== undefined) {
      // find the text node(s) - preserve any child elements (checkboxes)
      const cb = row.querySelector('input.ing-check');
      row.innerHTML = '';
      if (cb) row.appendChild(cb);
      row.appendChild(document.createTextNode(_scaleIngText(orig, ratio)));
    }
  });
}

// ── Time parser for step timers ───────────────────────────────────
function _parseStepTime(text) {
  // Returns total seconds if step mentions a duration, else null
  let total = 0;
  let found = false;
  const re = /(\d+(?:\.\d+)?)\s*(?:-\s*\d+(?:\.\d+)?\s*)?(hours?|hrs?|h\b|minutes?|mins?|seconds?|secs?)/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    const val  = parseFloat(m[1]);
    const unit = m[2].toLowerCase();
    found = true;
    if (unit.startsWith('h'))      total += val * 3600;
    else if (unit.startsWith('m')) total += val * 60;
    else                           total += val;
  }
  return found ? Math.round(total) : null;
}

function _fmtTime(secs) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ── Step timer management ─────────────────────────────────────────
function _startStepTimer(idx) {
  const t = _stepTimers[idx];
  if (!t || t.interval) return;
  t.btn.textContent = '⏸ ' + _fmtTime(t.remaining);
  t.btn.classList.add('running');
  t.interval = setInterval(() => {
    t.remaining--;
    const label = t.remaining <= 0 ? '✓ Done' : _fmtTime(t.remaining);
    t.btn.textContent = t.remaining <= 0 ? '✓ Done' : '⏸ ' + label;
    if (t.remaining <= 0) {
      clearInterval(t.interval);
      t.interval = null;
      t.btn.classList.remove('running');
      t.btn.classList.add('done');
    }
  }, 1000);
}

function _pauseStepTimer(idx) {
  const t = _stepTimers[idx];
  if (!t || !t.interval) return;
  clearInterval(t.interval);
  t.interval = null;
  t.btn.classList.remove('running');
  t.btn.textContent = '▶ ' + _fmtTime(t.remaining);
}

function _toggleStepTimer(idx) {
  const t = _stepTimers[idx];
  if (!t) return;
  if (t.interval) _pauseStepTimer(idx); else _startStepTimer(idx);
}

// ── Step Zoom ─────────────────────────────────────────────────────
let _stepZoomTimerInterval = null;
let _stepZoomTimerRemaining = 0;
let _stepZoomTimerRunning   = false;

function openStepZoom(idx) {
  _cookStepIndex = idx;
  _renderStepZoom();
  document.getElementById('step-zoom-overlay').style.display = 'flex';
}

function closeStepZoom() {
  document.getElementById('step-zoom-overlay').style.display = 'none';
  if (_stepZoomTimerInterval) { clearInterval(_stepZoomTimerInterval); _stepZoomTimerInterval = null; }
  _stepZoomTimerRunning = false;
}

function _renderStepZoom() {
  const step  = _cookSteps[_cookStepIndex];
  if (!step) return;
  const total = _cookSteps.length;
  document.getElementById('step-zoom-num').textContent   = _cookStepIndex + 1;
  document.getElementById('step-zoom-total').textContent = total;
  document.getElementById('step-zoom-circle').textContent = _cookStepIndex + 1;
  document.getElementById('step-zoom-text').textContent  = step.text;

  // Disable prev/next at boundaries
  document.querySelector('.step-zoom-prev').disabled = _cookStepIndex === 0;
  document.querySelector('.step-zoom-next').disabled = _cookStepIndex === total - 1;

  // Timer section
  const timerDiv = document.getElementById('step-zoom-timer');
  if (step.timerSecs) {
    // Stop any running zoom timer first
    if (_stepZoomTimerInterval) { clearInterval(_stepZoomTimerInterval); _stepZoomTimerInterval = null; }
    _stepZoomTimerRunning   = false;
    // Sync with inline timer if it exists
    const inlineTimer = _stepTimers[_cookStepIndex];
    _stepZoomTimerRemaining = inlineTimer ? inlineTimer.remaining : step.timerSecs;
    document.getElementById('step-zoom-timer-display').textContent = _fmtTime(_stepZoomTimerRemaining);
    document.getElementById('step-zoom-timer-btn').textContent = '▶ Start';
    timerDiv.style.display = 'flex';
  } else {
    timerDiv.style.display = 'none';
  }
}

function stepZoomNav(delta) {
  const next = _cookStepIndex + delta;
  if (next < 0 || next >= _cookSteps.length) return;
  // Stop current zoom timer before navigating
  if (_stepZoomTimerInterval) { clearInterval(_stepZoomTimerInterval); _stepZoomTimerInterval = null; }
  _stepZoomTimerRunning = false;
  _cookStepIndex = next;
  _renderStepZoom();
}

function toggleStepZoomTimer() {
  const btn = document.getElementById('step-zoom-timer-btn');
  const display = document.getElementById('step-zoom-timer-display');
  if (_stepZoomTimerRunning) {
    clearInterval(_stepZoomTimerInterval);
    _stepZoomTimerInterval = null;
    _stepZoomTimerRunning  = false;
    btn.textContent = '▶ ' + _fmtTime(_stepZoomTimerRemaining);
  } else {
    if (_stepZoomTimerRemaining <= 0) return;
    _stepZoomTimerRunning = true;
    btn.textContent = '⏸ ' + _fmtTime(_stepZoomTimerRemaining);
    _stepZoomTimerInterval = setInterval(() => {
      _stepZoomTimerRemaining--;
      // Keep inline timer in sync
      const inlineT = _stepTimers[_cookStepIndex];
      if (inlineT) { inlineT.remaining = _stepZoomTimerRemaining; }
      const label = _stepZoomTimerRemaining <= 0 ? '✓ Done' : _fmtTime(_stepZoomTimerRemaining);
      display.textContent = label;
      btn.textContent     = _stepZoomTimerRemaining <= 0 ? '✓ Done' : '⏸ ' + label;
      if (_stepZoomTimerRemaining <= 0) {
        clearInterval(_stepZoomTimerInterval);
        _stepZoomTimerInterval = null;
        _stepZoomTimerRunning  = false;
      }
    }, 1000);
  }
}

function resetStepZoomTimer() {
  if (_stepZoomTimerInterval) { clearInterval(_stepZoomTimerInterval); _stepZoomTimerInterval = null; }
  _stepZoomTimerRunning = false;
  const step = _cookSteps[_cookStepIndex];
  if (!step || !step.timerSecs) return;
  _stepZoomTimerRemaining = step.timerSecs;
  const inlineT = _stepTimers[_cookStepIndex];
  if (inlineT) { inlineT.remaining = step.timerSecs; inlineT.btn.textContent = '▶ ' + _fmtTime(step.timerSecs); }
  document.getElementById('step-zoom-timer-display').textContent = _fmtTime(step.timerSecs);
  document.getElementById('step-zoom-timer-btn').textContent = '▶ Start';
}

// ── Main openCookMode ─────────────────────────────────────────────
function openCookMode(title, cardId) {
  // Clear previous timer state
  Object.values(_stepTimers).forEach(t => { if (t.interval) clearInterval(t.interval); });
  _stepTimers = {};
  _cookSteps  = [];

  const card = document.getElementById(cardId);
  const back = card ? card.querySelector('.flip-back') : null;
  const body = document.getElementById('cook-mode-body');
  document.getElementById('cook-mode-title').textContent = '🍳 ' + title;
  body.innerHTML = '';

  if (back) {
    // ── Parse base servings from the yield stat ──────────────────
    const yieldEl = back.querySelector('.back-stat-val');
    const yieldTxt = yieldEl ? yieldEl.textContent.trim() : '';
    const yieldNum = parseInt(yieldTxt, 10) || 0;

    // ── Build servings scaler if we have a number ────────────────
    if (yieldNum > 0) {
      const scalerRow = _buildServingsScaler(yieldNum);
      scalerRow.querySelector('#cm-serv-minus').addEventListener('click', e => { e.stopPropagation(); _updateServings(-1); });
      scalerRow.querySelector('#cm-serv-plus').addEventListener('click',  e => { e.stopPropagation(); _updateServings(+1); });
      body.appendChild(scalerRow);
    }

    const clone = back.cloneNode(true);
    const backHeader = clone.querySelector('.back-header');
    if (backHeader) backHeader.remove();
    clone.querySelectorAll('.ing-check').forEach(cb => cb.remove());
    body.appendChild(clone);

    // ── Ingredient checkboxes + store original text ──────────────
    clone.querySelectorAll('.b-ing-row').forEach(row => {
      // Store original text for scaling (text only, no child nodes)
      row.dataset.originalText = row.textContent.trim();
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'ing-check';
      cb.setAttribute('aria-label', 'Mark ingredient done');
      cb.addEventListener('change', () => row.classList.toggle('ing-checked', cb.checked));
      cb.addEventListener('click', e => e.stopPropagation());
      row.insertBefore(cb, row.firstChild);
    });

    // ── Steps: tap-to-complete + timer + zoom button ─────────────
    clone.querySelectorAll('.b-step').forEach((step, idx) => {
      step.style.cursor = 'pointer';
      step.setAttribute('role', 'checkbox');
      step.setAttribute('aria-checked', 'false');

      // Gather step text (title + body)
      const titleEl = step.querySelector('.b-step-title');
      const textEl  = step.querySelector('.b-step-text');
      const numEl   = step.querySelector('.b-step-num');
      const stepNum = numEl ? numEl.textContent.trim() : String(idx + 1);
      const stepText = [titleEl?.textContent, textEl?.textContent]
        .filter(Boolean).map(s => s.trim()).join(' — ');

      // Parse timer from step text
      const timerSecs = _parseStepTime(stepText);
      _cookSteps.push({ num: stepNum, text: stepText, timerSecs });

      // Tap-to-complete (only when not clicking timer/zoom buttons)
      step.addEventListener('click', e => {
        if (e.target.closest('.step-timer-btn') || e.target.closest('.step-zoom-btn')) return;
        const done = step.classList.toggle('step-done');
        step.setAttribute('aria-checked', done ? 'true' : 'false');
      });

      // Timer button
      if (timerSecs) {
        const label = timerSecs >= 3600
          ? _fmtTime(timerSecs).replace(/^0:/, '')
          : _fmtTime(timerSecs);
        const timerBtn = document.createElement('button');
        timerBtn.className = 'step-timer-btn';
        timerBtn.textContent = `⏱ ${label}`;
        timerBtn.setAttribute('aria-label', `Start ${label} timer`);
        _stepTimers[idx] = { remaining: timerSecs, interval: null, btn: timerBtn, display: null };
        timerBtn.addEventListener('click', e => { e.stopPropagation(); _toggleStepTimer(idx); });
        // Insert after step number
        if (numEl && numEl.nextSibling) step.insertBefore(timerBtn, numEl.nextSibling);
        else step.appendChild(timerBtn);
      }

      // Zoom button
      const zoomBtn = document.createElement('button');
      zoomBtn.className = 'step-zoom-btn';
      zoomBtn.textContent = '⤢';
      zoomBtn.title = 'Focus this step';
      zoomBtn.setAttribute('aria-label', 'Zoom step');
      zoomBtn.addEventListener('click', e => { e.stopPropagation(); openStepZoom(idx); });
      step.appendChild(zoomBtn);
    });

    // ── Build AI context ─────────────────────────────────────────
    const tempEl = back.querySelector('.b-temp');
    const timeEl = back.querySelector('.b-time');
    const ings   = [...back.querySelectorAll('.b-ing-row')]
                     .map(r => r.textContent.trim()).filter(Boolean);
    const steps  = [...back.querySelectorAll('.b-step')]
                     .map(s => s.textContent.trim()).filter(Boolean);
    let ctx = `Recipe: ${title}`;
    if (yieldTxt)       ctx += `\nServings: ${yieldTxt}`;
    if (tempEl)         ctx += `\nTemp: ${tempEl.textContent.trim()}`;
    if (timeEl)         ctx += `\nTime: ${timeEl.textContent.trim()}`;
    if (ings.length)    ctx += `\nIngredients:\n${ings.map(i => '- ' + i).join('\n')}`;
    if (steps.length)   ctx += `\nInstructions:\n${steps.map((s, i) => `${i+1}. ${s}`).join('\n')}`;
    _chatRecipeContext = ctx;
  }

  document.getElementById('cook-mode-overlay').style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function closeCookMode() {
  // Stop all running timers
  Object.values(_stepTimers).forEach(t => { if (t.interval) clearInterval(t.interval); });
  _stepTimers = {};
  if (_stepZoomTimerInterval) { clearInterval(_stepZoomTimerInterval); _stepZoomTimerInterval = null; }
  _stepZoomTimerRunning = false;
  document.getElementById('cook-mode-overlay').style.display = 'none';
  document.getElementById('step-zoom-overlay').style.display = 'none';
  document.body.style.overflow = '';
  _chatRecipeContext = '';
}

function openCookModeChat() {
  // Open the AI chat panel on top of cook mode, pre-loaded with recipe context
  // Show just the recipe title in the context bar (first line of context string)
  const displayTitle = _chatRecipeContext.split('\n')[0].replace(/^Recipe:\s*/i, '') || _chatRecipeContext;
  document.getElementById('chat-recipe-name').textContent = displayTitle;
  document.getElementById('chat-recipe-context-bar').style.display = '';
  if (!chatOpen) toggleChat();
  document.getElementById('chat-messages').scrollTop = 99999;
  // Don't auto-focus on mobile — it opens keyboard which can hide the panel
  if (window.innerWidth > 600) document.getElementById('chat-input').focus();
}

function clearChatRecipeContext() {
  _chatRecipeContext = '';
  document.getElementById('chat-recipe-context-bar').style.display = 'none';
  document.getElementById('chat-recipe-name').textContent = '';
}

// ── Card flipping ────────────────────────────────────────────────
function toggleFlip(cardEl) {
  cardEl.classList.toggle('flipped');
  // Reset ingredient checkboxes when flipping back to the front
  if (!cardEl.classList.contains('flipped')) {
    cardEl.querySelectorAll('.ing-check').forEach(cb => {
      cb.checked = false;
      cb.closest('.b-ing-row').classList.remove('ing-checked');
    });
  }
}

// ── Add Recipe modal — two-step: Compose → Review ────────────────
let _composerMode    = 'text';
let _composerPhotoFile = null;
let _composerPhotoUrl  = '';
let _composerIgText    = '';
let _cachedRecipeJson  = null;
let _cachedSourceType  = 'text';

function openAddModal() {
  document.getElementById('add-author').value =
    localStorage.getItem('wfc_author') || '';
  showComposeStep();
  document.getElementById('add-recipe-modal').style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function closeAddModal() {
  document.getElementById('add-recipe-modal').style.display = 'none';
  document.body.style.overflow = '';
}

function selectComposerMode(mode) {
  _composerMode = mode;
  document.querySelectorAll('.composer-mode').forEach(btn => {
    const active = btn.dataset.mode === mode;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  document.querySelectorAll('.composer-pane').forEach(pane => {
    pane.classList.toggle('active', pane.id === 'composer-pane-' + mode);
  });
}

function handleComposerTextInput(value) {
}

function handlePhotoDrop(event) {
  event.preventDefault();
  event.currentTarget.classList.remove('drag-over');
  const file = event.dataTransfer.files && event.dataTransfer.files[0];
  if (file && file.type.startsWith('image/')) {
    _previewComposerPhoto(file);
  }
}

function handleComposerPhotoFile(input) {
  if (!input.files || !input.files[0]) return;
  _previewComposerPhoto(input.files[0]);
}

function _previewComposerPhoto(file) {
  _composerPhotoFile = file;
  _composerPhotoUrl  = '';
  const preview = document.getElementById('composer-photo-preview');
  const img     = document.getElementById('composer-photo-img');
  const meta    = document.getElementById('composer-photo-meta');
  const reader  = new FileReader();
  reader.onload = e => {
    img.src = e.target.result;
    preview.style.display = 'block';
    const kb = Math.round(file.size / 1024);
    meta.textContent = file.name + ' · ' + kb + ' KB';
  };
  reader.readAsDataURL(file);
}

function clearComposerPhoto() {
  _composerPhotoFile = null;
  _composerPhotoUrl  = '';
  document.getElementById('composer-photo-file').value   = '';
  document.getElementById('composer-photo-camera').value = '';
  document.getElementById('composer-photo-preview').style.display = 'none';
}

let _igFetchTimeout = null;
function handleIgUrlInput(value) {
  _composerIgText = '';
  const status   = document.getElementById('ig-status');
  const fallback = document.getElementById('ig-fallback');
  const extracted = document.getElementById('ig-extracted');
  fallback.style.display  = 'none';
  extracted.style.display = 'none';
  status.style.display    = 'none';
  clearTimeout(_igFetchTimeout);
  if (!value.trim() || !/instagram\.com\/(p|reel|tv)\//i.test(value)) return;
  status.style.display  = 'block';
  status.textContent    = 'Fetching post…';
  _igFetchTimeout = setTimeout(async () => {
    try {
      const res  = await fetch('/api/fetch-instagram', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ url: value.trim() }),
      });
      const data = await safeJson(res);
      if (data.success && data.extractedText) {
        _composerIgText = data.extractedText;
        document.getElementById('ig-extracted-text').textContent =
          data.extractedText.slice(0, 200) + (data.extractedText.length > 200 ? '…' : '');
        extracted.style.display = 'block';
        status.style.display    = 'none';
      } else {
        status.style.display   = 'none';
        fallback.style.display = 'block';
      }
    } catch {
      status.style.display   = 'none';
      fallback.style.display = 'block';
    }
  }, 800);
}

function showComposeStep() {
  document.getElementById('add-step-compose').style.display = '';
  document.getElementById('add-step-review').style.display  = 'none';
  const status = document.getElementById('compose-status');
  status.style.display = 'none';
  const btn = document.getElementById('extract-btn');
  btn.disabled    = false;
  btn.textContent = 'Extract Recipe →';
}

async function startExtraction() {
  const btn    = document.getElementById('extract-btn');
  const status = document.getElementById('compose-status');
  const category   = document.getElementById('add-category').value;
  const authorName = document.getElementById('add-author').value.trim();

  status.style.display = 'none';

  if (!category) {
    status.style.display = 'block';
    status.style.color   = 'var(--red)';
    status.textContent   = 'Please choose a category.';
    return;
  }
  if (!authorName) {
    status.style.display = 'block';
    status.style.color   = 'var(--red)';
    status.textContent   = 'Please enter your name.';
    return;
  }

  btn.disabled    = true;
  btn.textContent = 'Extracting…';

  try {
    let res, data;

    if (_composerMode === 'photo') {
      if (!_composerPhotoFile) throw new Error('Please choose a photo first.');
      const form = new FormData();
      form.append('photo', _composerPhotoFile);
      form.append('category', category);
      res  = await fetch('/api/extract-recipe', { method: 'POST', body: form });
      data = await safeJson(res);
    } else if (_composerMode === 'instagram') {
      const content = _composerIgText ||
        document.getElementById('composer-ig-url').value.trim();
      if (!content) throw new Error('Please enter an Instagram URL.');
      res  = await fetch('/api/extract-recipe', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ content, category, sourceType: 'instagram' }),
      });
      data = await safeJson(res);
    } else {
      const content = document.getElementById('composer-text-input').value.trim();
      if (!content) throw new Error('Please paste some recipe text or a URL.');
      res  = await fetch('/api/extract-recipe', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ content, category, sourceType: 'text' }),
      });
      data = await safeJson(res);
    }

    if (!res.ok) throw new Error(data.error || 'Extraction failed — please try again.');

    _cachedRecipeJson = data.recipeJson || {};
    _cachedSourceType = data.sourceType || _composerMode;
    localStorage.setItem('wfc_author', authorName);
    _populateReviewForm(_cachedRecipeJson);
    document.getElementById('add-step-compose').style.display = 'none';
    document.getElementById('add-step-review').style.display  = '';

  } catch (err) {
    status.style.display = 'block';
    status.style.color   = 'var(--red)';
    status.textContent   = err.message;
    btn.disabled    = false;
    btn.textContent = 'Extract Recipe →';
  }
}

function _populateReviewForm(r) {
  document.getElementById('rv-emoji').value    = r.emoji    || '';
  document.getElementById('rv-badge').value    = r.badge    || '';
  document.getElementById('rv-title').value    = r.title    || '';
  document.getElementById('rv-subtitle').value = r.subtitle || '';
  document.getElementById('rv-servings').value = r.servings || '';
  document.getElementById('rv-prep').value     = r.prep_time    || '';
  document.getElementById('rv-cook').value     = r.cook_time    || '';
  document.getElementById('rv-temp').value     = r.temperature  || '';
  document.getElementById('rv-chefs-note').value = r.chefs_note || '';

  const confEl = document.getElementById('review-confidence');
  confEl.textContent = '';
  const warnEl = document.getElementById('review-warnings');
  warnEl.style.display = 'none';
  warnEl.textContent   = '';

  const ingContainer = document.getElementById('rv-ingredients');
  ingContainer.innerHTML = '';
  (r.ingredients || []).forEach(i => rvAddIngredient(i.name || '', i.amount || ''));
  if (!(r.ingredients || []).length) rvAddIngredient('', '');

  const stepsContainer = document.getElementById('rv-steps');
  stepsContainer.innerHTML = '';
  (r.steps || []).forEach(s => rvAddStep(s.title || '', s.detail || ''));
  if (!(r.steps || []).length) rvAddStep('', '');

  const notesContainer = document.getElementById('rv-notes');
  notesContainer.innerHTML = '';
  (r.calibration_notes || []).forEach(n => rvAddNote(n.goal || '', n.tip || ''));

  const storageContainer = document.getElementById('rv-storage');
  storageContainer.innerHTML = '';
  (r.storage || []).forEach(s => rvAddStorage(s.method || '', s.duration || ''));

  document.getElementById('review-status').style.display = 'none';
  const saveBtn = document.getElementById('review-save-btn');
  saveBtn.disabled    = false;
  saveBtn.textContent = 'Save to Cookbook';
}

function _rvRemoveRow(btn) {
  btn.closest('.rv-row').remove();
}

function rvAddIngredient(name, amount) {
  const container = document.getElementById('rv-ingredients');
  const row = document.createElement('div');
  row.className = 'rv-row rv-ing-row';
  row.innerHTML =
    '<input type="text" class="rv-ing-name" placeholder="Ingredient" value="' + _esc(name) + '">' +
    '<input type="text" class="rv-ing-amt"  placeholder="Amount"     value="' + _esc(amount) + '">' +
    '<button type="button" class="rv-remove-btn" onclick="_rvRemoveRow(this)" aria-label="Remove">✕</button>';
  container.appendChild(row);
}

function rvAddStep(title, detail) {
  const container = document.getElementById('rv-steps');
  const row = document.createElement('div');
  row.className = 'rv-row rv-step-row';
  row.innerHTML =
    '<input type="text" class="rv-step-title"  placeholder="Step title" value="' + _esc(title) + '">' +
    '<textarea class="rv-step-detail" placeholder="Detail" rows="2">' + _escText(detail) + '</textarea>' +
    '<button type="button" class="rv-remove-btn" onclick="_rvRemoveRow(this)" aria-label="Remove">✕</button>';
  container.appendChild(row);
}

function rvAddNote(goal, tip) {
  const container = document.getElementById('rv-notes');
  const row = document.createElement('div');
  row.className = 'rv-row rv-note-row';
  row.innerHTML =
    '<input type="text" class="rv-note-goal" placeholder="Goal"  value="' + _esc(goal) + '">' +
    '<input type="text" class="rv-note-tip"  placeholder="Tip"   value="' + _esc(tip) + '">' +
    '<button type="button" class="rv-remove-btn" onclick="_rvRemoveRow(this)" aria-label="Remove">✕</button>';
  container.appendChild(row);
}

function rvAddStorage(method, duration) {
  const container = document.getElementById('rv-storage');
  const row = document.createElement('div');
  row.className = 'rv-row rv-storage-row';
  row.innerHTML =
    '<input type="text" class="rv-storage-method"   placeholder="Method"   value="' + _esc(method) + '">' +
    '<input type="text" class="rv-storage-duration" placeholder="Duration" value="' + _esc(duration) + '">' +
    '<button type="button" class="rv-remove-btn" onclick="_rvRemoveRow(this)" aria-label="Remove">✕</button>';
  container.appendChild(row);
}

function _esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function _escText(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function _readReviewJson() {
  const ingredients = [];
  document.querySelectorAll('#rv-ingredients .rv-ing-row').forEach(row => {
    const name   = row.querySelector('.rv-ing-name').value.trim();
    const amount = row.querySelector('.rv-ing-amt').value.trim();
    if (name || amount) ingredients.push({ name, amount });
  });

  const steps = [];
  document.querySelectorAll('#rv-steps .rv-step-row').forEach(row => {
    const title  = row.querySelector('.rv-step-title').value.trim();
    const detail = row.querySelector('.rv-step-detail').value.trim();
    if (title || detail) steps.push({ title, detail });
  });

  const calibration_notes = [];
  document.querySelectorAll('#rv-notes .rv-note-row').forEach(row => {
    const goal = row.querySelector('.rv-note-goal').value.trim();
    const tip  = row.querySelector('.rv-note-tip').value.trim();
    if (goal || tip) calibration_notes.push({ goal, tip });
  });

  const storage = [];
  document.querySelectorAll('#rv-storage .rv-storage-row').forEach(row => {
    const method   = row.querySelector('.rv-storage-method').value.trim();
    const duration = row.querySelector('.rv-storage-duration').value.trim();
    if (method || duration) storage.push({ method, duration });
  });

  return {
    emoji:       document.getElementById('rv-emoji').value.trim(),
    badge:       document.getElementById('rv-badge').value.trim(),
    title:       document.getElementById('rv-title').value.trim(),
    subtitle:    document.getElementById('rv-subtitle').value.trim(),
    servings:    document.getElementById('rv-servings').value.trim(),
    prep_time:   document.getElementById('rv-prep').value.trim(),
    cook_time:   document.getElementById('rv-cook').value.trim(),
    temperature: document.getElementById('rv-temp').value.trim(),
    chefs_note:  document.getElementById('rv-chefs-note').value.trim(),
    category:    document.getElementById('add-category').value,
    ingredients,
    steps,
    calibration_notes,
    storage,
  };
}

async function saveFromReview() {
  const btn    = document.getElementById('review-save-btn');
  const status = document.getElementById('review-status');
  const category   = document.getElementById('add-category').value;
  const authorName = document.getElementById('add-author').value.trim();

  if (!category) {
    status.style.display = 'block';
    status.style.color   = 'var(--red)';
    status.textContent   = 'No category — go back and choose one.';
    return;
  }

  const recipeJson = _readReviewJson();
  if (!recipeJson.title) {
    status.style.display = 'block';
    status.style.color   = 'var(--red)';
    status.textContent   = 'Recipe title is required.';
    return;
  }

  btn.disabled    = true;
  btn.textContent = 'Saving…';
  status.style.display = 'none';

  try {
    const res  = await fetch('/api/add-recipe', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        category,
        authorName,
        recipeJson,
        sourceType: _cachedSourceType,
        mediaUrl:   _composerPhotoUrl,
      }),
    });
    const data = await safeJson(res);
    if (!res.ok) throw new Error(data.error || 'Something went wrong');

    status.style.display = 'block';
    status.style.color   = '#2a7a2a';
    status.textContent   = '✓ Recipe added! Refreshing…';
    setTimeout(() => window.location.reload(), 2000);

  } catch (err) {
    status.style.display = 'block';
    status.style.color   = 'var(--red)';
    status.textContent   = err.message;
    btn.disabled    = false;
    btn.textContent = 'Save to Cookbook';
  }
}

// ── Edit Recipe modal ────────────────────────────────────────────
function openEditModal(cardId) {
  document.getElementById('edit-card-id').value = cardId;
  document.getElementById('edit-instructions').value = '';
  document.getElementById('direct-edit-html').value = 'Loading…';
  document.getElementById('direct-edit-btn').disabled = true;
  document.getElementById('edit-modal-status').style.display = 'none';
  document.getElementById('delete-confirm-check').checked = false;
  document.getElementById('delete-btn').disabled = true;
  document.getElementById('delete-btn').textContent = 'Delete Recipe';
  document.getElementById('ai-edit-btn').disabled = false;
  document.getElementById('ai-edit-btn').textContent = 'Update with AI';
  switchEditTab('ai');
  document.getElementById('edit-recipe-modal').style.display = 'flex';
  document.getElementById('edit-instructions').focus();

  const card = document.getElementById(cardId);
  const titleEl = card ? card.querySelector('.front-title') : null;
  document.getElementById('delete-recipe-name').textContent = titleEl ? titleEl.textContent : cardId;

  fetch('/api/get-card-html?cardId=' + encodeURIComponent(cardId))
    .then(r => safeJson(r))
    .then(data => {
      if (data.cardHtml) {
        document.getElementById('direct-edit-html').value = data.cardHtml;
        document.getElementById('direct-edit-btn').disabled = false;
        // If user already switched to Direct tab while loading, populate now
        if (document.getElementById('edit-pane-direct').classList.contains('active')) {
          populateDirectForm(data.cardHtml);
        }
      } else {
        document.getElementById('direct-edit-html').value = 'Error: could not load card HTML';
      }
    })
    .catch(() => {
      document.getElementById('direct-edit-html').value = 'Error: could not load card HTML';
    });
}

function closeEditModal() {
  document.getElementById('edit-recipe-modal').style.display = 'none';
}

function switchEditTab(tab) {
  document.querySelectorAll('.edit-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.edit-pane').forEach(p => p.classList.remove('active'));
  document.querySelector('.edit-tab[data-tab="' + tab + '"]').classList.add('active');
  document.getElementById('edit-pane-' + tab).classList.add('active');
  document.getElementById('edit-modal-status').style.display = 'none';
  if (tab === 'direct') {
    const html = document.getElementById('direct-edit-html').value;
    if (html && html !== 'Loading…') populateDirectForm(html);
  }
}

function showEditStatus(msg, isError) {
  const status = document.getElementById('edit-modal-status');
  status.style.display = 'block';
  status.style.color = isError ? 'var(--red)' : '#2a7a2a';
  status.textContent = msg;
}

async function submitAiEdit(event) {
  event.preventDefault();
  const cardId       = document.getElementById('edit-card-id').value;
  const instructions = document.getElementById('edit-instructions').value.trim();
  const btn          = document.getElementById('ai-edit-btn');

  btn.disabled    = true;
  btn.textContent = 'Updating with AI…';
  document.getElementById('edit-modal-status').style.display = 'none';

  try {
    const res  = await fetch('/api/edit-recipe', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ cardId, editInstructions: instructions }),
    });
    const data = await safeJson(res);
    if (!res.ok) throw new Error(data.error || 'Something went wrong');

    showEditStatus('Recipe updated! Refreshing…', false);
    setTimeout(() => window.location.reload(), 2000);
  } catch (err) {
    showEditStatus(err.message, true);
    btn.disabled    = false;
    btn.textContent = 'Update with AI';
  }
}

// ── Direct Edit: parse card HTML into form fields ────────────────
function populateDirectForm(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');

  // Existing photo / Instagram link
  const frontImg = doc.querySelector('.front-img');
  const existingPhoto = frontImg?.querySelector('.front-photo');
  const existingIg    = frontImg?.querySelector('.front-instagram');
  _dfMediaUrl = existingPhoto?.getAttribute('src') || existingIg?.getAttribute('href') || '';
  document.getElementById('df-media-url').value = _dfMediaUrl;
  _renderDfMediaPreview(_dfMediaUrl);

  // Emoji — try <span class="front-emoji"> first (new cards), fall back to text node (legacy)
  let emoji = '';
  const emojiSpan = frontImg?.querySelector('.front-emoji');
  if (emojiSpan) {
    emoji = emojiSpan.textContent.trim();
  } else if (frontImg) {
    for (const node of frontImg.childNodes) {
      if (node.nodeType === 3 && node.textContent.trim()) { emoji = node.textContent.trim(); break; }
    }
  }
  document.getElementById('df-emoji').value = emoji;
  document.getElementById('df-badge').value = doc.querySelector('.front-badge')?.textContent.trim() ?? '';
  document.getElementById('df-title').value = doc.querySelector('.front-title')?.textContent.trim() ?? '';
  document.getElementById('df-sub').value   = doc.querySelector('.front-sub')?.textContent.trim() ?? '';

  const chips = [...doc.querySelectorAll('.chip')];
  for (let i = 0; i < 4; i++) document.getElementById('df-chip-' + i).value = chips[i]?.textContent.trim() ?? '';

  // Stats — always 3 rows
  const statsEl = document.getElementById('df-stats');
  statsEl.innerHTML = '';
  const stats = [...doc.querySelectorAll('.back-stat')];
  for (let i = 0; i < 3; i++) {
    const lbl = stats[i]?.querySelector('.back-stat-label')?.textContent.trim() ?? '';
    const val = stats[i]?.querySelector('.back-stat-val')?.textContent.trim() ?? '';
    const row = document.createElement('div');
    row.className = 'df-stat-row';
    const li = document.createElement('input'); li.id = 'df-stat-label-' + i; li.type = 'text'; li.placeholder = 'Label'; li.value = lbl;
    const vi = document.createElement('input'); vi.id = 'df-stat-val-' + i;   vi.type = 'text'; vi.placeholder = 'Value'; vi.value = val;
    row.appendChild(li); row.appendChild(vi);
    statsEl.appendChild(row);
  }

  // Ingredients
  document.getElementById('df-ingredients').innerHTML = '';
  doc.querySelectorAll('.b-ing-row').forEach(r => dfAddIngredient(
    r.querySelector('.b-ing-name')?.textContent.trim() ?? '',
    r.querySelector('.b-ing-amt')?.textContent.trim() ?? ''
  ));

  // Steps
  document.getElementById('df-steps').innerHTML = '';
  doc.querySelectorAll('.b-step').forEach(s => {
    const stepTitle = s.querySelector('.b-step-title')?.textContent.trim().replace(/\.$/, '') ?? '';
    const full      = s.querySelector('.b-step-text')?.textContent.trim() ?? '';
    const detail    = full.startsWith(stepTitle + '.') ? full.slice(stepTitle.length + 1).trim() : full;
    dfAddStep(stepTitle, detail);
  });

  // Calibration notes
  document.getElementById('df-notes').innerHTML = '';
  doc.querySelectorAll('.b-note').forEach(n => dfAddNote(
    n.querySelector('.b-note-goal')?.textContent.trim() ?? '',
    n.querySelector('.b-note-tip')?.textContent.trim() ?? ''
  ));

  // Storage
  document.getElementById('df-storage').innerHTML = '';
  doc.querySelectorAll('.b-storage-row').forEach(r => dfAddStorage(
    r.querySelector('.b-storage-method')?.textContent.trim() ?? '',
    r.querySelector('.b-storage-dur')?.textContent.trim() ?? ''
  ));

  document.getElementById('df-chefs-note').value = doc.querySelector('.b-chefs-note')?.textContent.trim() ?? '';
}

function dfAddIngredient(name, amt) {
  const row = document.createElement('div'); row.className = 'df-list-row';
  const ni = document.createElement('input'); ni.type = 'text'; ni.className = 'df-ing-name'; ni.placeholder = 'Ingredient'; ni.value = name;
  const ai = document.createElement('input'); ai.type = 'text'; ai.className = 'df-ing-amt';  ai.placeholder = 'Amount';     ai.value = amt;
  const rb = document.createElement('button'); rb.type = 'button'; rb.className = 'df-remove-btn'; rb.textContent = '×'; rb.onclick = () => row.remove();
  row.appendChild(ni); row.appendChild(ai); row.appendChild(rb);
  document.getElementById('df-ingredients').appendChild(row);
}

function dfAddStep(stepTitle, detailText) {
  const row  = document.createElement('div'); row.className = 'df-list-row';
  const body = document.createElement('div'); body.className = 'df-step-body';
  const ti   = document.createElement('input');    ti.type = 'text'; ti.className = 'df-step-title-input'; ti.placeholder = 'Step name (e.g. Mix, Bake)'; ti.value = stepTitle;
  const ta   = document.createElement('textarea'); ta.className = 'df-step-text-input'; ta.placeholder = 'Step detail…'; ta.value = detailText;
  const rb   = document.createElement('button');   rb.type = 'button'; rb.className = 'df-remove-btn'; rb.textContent = '×'; rb.onclick = () => row.remove();
  body.appendChild(ti); body.appendChild(ta);
  row.appendChild(body); row.appendChild(rb);
  document.getElementById('df-steps').appendChild(row);
}

function dfAddNote(goal, tip) {
  const row  = document.createElement('div'); row.className = 'df-list-row';
  const body = document.createElement('div'); body.className = 'df-step-body';
  const gi   = document.createElement('input'); gi.type = 'text'; gi.className = 'df-note-goal'; gi.placeholder = 'Goal (e.g. Crispier)'; gi.value = goal;
  const ti   = document.createElement('input'); ti.type = 'text'; ti.className = 'df-note-tip';  ti.placeholder = 'Tip';                   ti.value = tip;
  const rb   = document.createElement('button'); rb.type = 'button'; rb.className = 'df-remove-btn'; rb.textContent = '×'; rb.onclick = () => row.remove();
  body.appendChild(gi); body.appendChild(ti);
  row.appendChild(body); row.appendChild(rb);
  document.getElementById('df-notes').appendChild(row);
}

function dfAddStorage(method, dur) {
  const row = document.createElement('div'); row.className = 'df-list-row';
  const mi  = document.createElement('input'); mi.type = 'text'; mi.className = 'df-storage-method'; mi.placeholder = 'Method (e.g. Fridge)'; mi.value = method;
  const di  = document.createElement('input'); di.type = 'text'; di.className = 'df-storage-dur';    di.placeholder = 'Duration (e.g. 3 days)'; di.value = dur;
  const rb  = document.createElement('button'); rb.type = 'button'; rb.className = 'df-remove-btn'; rb.textContent = '×'; rb.onclick = () => row.remove();
  row.appendChild(mi); row.appendChild(di); row.appendChild(rb);
  document.getElementById('df-storage').appendChild(row);
}

function buildCardHtmlFromForm() {
  const originalHtml = document.getElementById('direct-edit-html').value;
  const doc = new DOMParser().parseFromString(originalHtml, 'text/html');

  const frontImg = doc.querySelector('.front-img');
  if (frontImg) {
    // Remove old media elements before re-inserting
    frontImg.querySelector('.front-photo')?.remove();
    frontImg.querySelector('.front-instagram')?.remove();

    // Inject new media
    const photoUrl = _dfMediaUrl;
    if (photoUrl) {
      if (INSTAGRAM_RE.test(photoUrl)) {
        const a = doc.createElement('a');
        a.className = 'front-instagram';
        a.href = photoUrl;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.setAttribute('onclick', 'event.stopPropagation()');
        a.textContent = '📷 Instagram';
        frontImg.insertBefore(a, frontImg.firstChild);
      } else {
        const img = doc.createElement('img');
        img.className = 'front-photo';
        img.src = photoUrl;
        img.alt = 'Recipe photo';
        img.loading = 'lazy';
        img.setAttribute('onerror', 'this.remove()');
        frontImg.insertBefore(img, frontImg.firstChild);
      }
    }

    // Emoji — update <span class="front-emoji"> (new cards) or legacy text node
    const emojiVal  = document.getElementById('df-emoji').value.trim();
    const emojiSpan = frontImg.querySelector('.front-emoji');
    if (emojiSpan) {
      emojiSpan.textContent = emojiVal;
    } else {
      for (const node of frontImg.childNodes) {
        if (node.nodeType === 3 && node.textContent.trim()) {
          node.textContent = emojiVal + '\n        ';
          break;
        }
      }
    }
  }
  const badge = doc.querySelector('.front-badge');
  if (badge) badge.textContent = document.getElementById('df-badge').value.trim();

  const titleVal = document.getElementById('df-title').value.trim();
  doc.querySelectorAll('.front-title, .back-title').forEach(el => el.textContent = titleVal);
  const sub = doc.querySelector('.front-sub');
  if (sub) sub.textContent = document.getElementById('df-sub').value.trim();

  const chips = doc.querySelectorAll('.chip');
  for (let i = 0; i < 4; i++) {
    if (chips[i]) chips[i].textContent = document.getElementById('df-chip-' + i)?.value.trim() ?? chips[i].textContent;
  }

  const stats = doc.querySelectorAll('.back-stat');
  for (let i = 0; i < 3; i++) {
    const le = stats[i]?.querySelector('.back-stat-label'), ve = stats[i]?.querySelector('.back-stat-val');
    if (le) le.textContent = document.getElementById('df-stat-label-' + i)?.value.trim() ?? le.textContent;
    if (ve) ve.textContent = document.getElementById('df-stat-val-' + i)?.value.trim()   ?? ve.textContent;
  }

  // Replace a section by its heading text
  function replaceSection(headingText, newEls) {
    const all = [...doc.querySelectorAll('.b-heading')];
    const idx = all.findIndex(h => h.textContent.trim() === headingText);
    if (idx === -1) return;
    const heading = all[idx], next = all[idx + 1];
    let node = heading.nextElementSibling;
    while (node && node !== next) { const nx = node.nextElementSibling; node.remove(); node = nx; }
    newEls.forEach(el => next ? heading.parentElement.insertBefore(el, next) : heading.parentElement.appendChild(el));
  }

  // Ingredients
  replaceSection('Ingredients', [...document.querySelectorAll('#df-ingredients .df-list-row')].map(row => {
    const name = row.querySelector('.df-ing-name')?.value.trim() ?? '';
    const amt  = row.querySelector('.df-ing-amt')?.value.trim() ?? '';
    const el = doc.createElement('div'); el.className = 'b-ing-row';
    const ns = doc.createElement('span'); ns.className = 'b-ing-name'; ns.textContent = name;
    const as = doc.createElement('span'); as.className = 'b-ing-amt';  as.textContent = amt;
    el.appendChild(ns); el.appendChild(as); return el;
  }));

  // Steps
  replaceSection('Method', [...document.querySelectorAll('#df-steps .df-list-row')].map((row, i) => {
    const t = row.querySelector('.df-step-title-input')?.value.trim() ?? '';
    const d = row.querySelector('.df-step-text-input')?.value.trim() ?? '';
    const el = doc.createElement('div'); el.className = 'b-step';
    const num = doc.createElement('span'); num.className = 'b-step-num'; num.textContent = i + 1;
    const p   = doc.createElement('p');   p.className = 'b-step-text';
    const sp  = doc.createElement('span'); sp.className = 'b-step-title'; sp.textContent = t + '.';
    p.appendChild(sp); p.append(' ' + d);
    el.appendChild(num); el.appendChild(p); return el;
  }));

  // Calibration notes (wrapped in b-notes-grid)
  const noteRows = [...document.querySelectorAll('#df-notes .df-list-row')];
  const grid = doc.createElement('div'); grid.className = 'b-notes-grid';
  noteRows.forEach(row => {
    const g = row.querySelector('.df-note-goal')?.value.trim() ?? '';
    const t = row.querySelector('.df-note-tip')?.value.trim() ?? '';
    const n = doc.createElement('div'); n.className = 'b-note';
    const gp = doc.createElement('p'); gp.className = 'b-note-goal'; gp.textContent = g;
    const tp = doc.createElement('p'); tp.className = 'b-note-tip';  tp.textContent = t;
    n.appendChild(gp); n.appendChild(tp); grid.appendChild(n);
  });
  replaceSection('Calibration Notes', noteRows.length ? [grid] : []);

  // Storage
  replaceSection('Storage', [...document.querySelectorAll('#df-storage .df-list-row')].map(row => {
    const m = row.querySelector('.df-storage-method')?.value.trim() ?? '';
    const d = row.querySelector('.df-storage-dur')?.value.trim() ?? '';
    const el = doc.createElement('div'); el.className = 'b-storage-row';
    const ms = doc.createElement('span'); ms.className = 'b-storage-method'; ms.textContent = m;
    const ds = doc.createElement('span'); ds.className = 'b-storage-dur';    ds.textContent = d;
    el.appendChild(ms); el.appendChild(ds); return el;
  }));

  const cn = doc.querySelector('.b-chefs-note');
  if (cn) cn.textContent = document.getElementById('df-chefs-note').value.trim();

  const card = doc.querySelector('.flip-card');
  return card ? card.outerHTML : originalHtml;
}

async function submitDirectEdit() {
  const cardId = document.getElementById('edit-card-id').value;
  const btn    = document.getElementById('direct-edit-btn');

  btn.disabled    = true;
  btn.textContent = 'Saving…';
  document.getElementById('edit-modal-status').style.display = 'none';

  try {
    const newHtml = buildCardHtmlFromForm();
    const res = await fetch('/api/save-card-html', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ cardId, cardHtml: newHtml }),
    });
    const data = await safeJson(res);
    if (!res.ok) throw new Error(data.error || 'Something went wrong');

    showEditStatus('Changes saved! Refreshing…', false);
    setTimeout(() => window.location.reload(), 2000);
  } catch (err) {
    showEditStatus(err.message, true);
    btn.disabled    = false;
    btn.textContent = 'Save Changes';
  }
}

// ── Delete recipe ────────────────────────────────────────────────
async function submitDelete() {
  const cardId = document.getElementById('edit-card-id').value;
  const btn    = document.getElementById('delete-btn');

  btn.disabled    = true;
  btn.textContent = 'Deleting…';
  document.getElementById('edit-modal-status').style.display = 'none';

  try {
    const res = await fetch('/api/delete-recipe', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ cardId }),
    });
    const data = await safeJson(res);
    if (!res.ok) throw new Error(data.error || 'Something went wrong');

    showEditStatus('Recipe deleted! Refreshing…', false);
    setTimeout(() => window.location.reload(), 2000);
  } catch (err) {
    showEditStatus(err.message, true);
    btn.disabled    = false;
    btn.textContent = 'Delete Recipe';
  }
}

// ── Chat assistant ────────────────────────────────────────────────
let chatHistory = [];
let chatOpen    = false;

function toggleChat() {
  chatOpen = !chatOpen;
  const panel = document.getElementById('chat-panel');
  panel.classList.toggle('open', chatOpen);
  // Only auto-focus on desktop — on mobile, letting the keyboard open automatically
  // can push the panel off-screen before it fades in
  if (chatOpen && window.innerWidth > 600) document.getElementById('chat-input').focus();
}

function appendChatMessage(role, text) {
  const messages = document.getElementById('chat-messages');
  const div      = document.createElement('div');
  div.className  = 'chat-msg chat-msg-' + (role === 'user' ? 'user' : 'assistant');
  div.textContent = text;
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
  return div;
}

async function sendChat() {
  const input   = document.getElementById('chat-input');
  const sendBtn = document.getElementById('chat-send-btn');
  const message = input.value.trim();
  if (!message || sendBtn.disabled) return;

  appendChatMessage('user', message);
  input.value        = '';
  input.style.height = 'auto';
  sendBtn.disabled   = true;

  const thinking     = document.createElement('div');
  thinking.className = 'chat-msg chat-msg-thinking';
  thinking.textContent = 'Thinking…';
  document.getElementById('chat-messages').appendChild(thinking);
  document.getElementById('chat-messages').scrollTop = 99999;

  try {
    const res  = await fetch('/api/chat', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ message, history: chatHistory, recipeContext: _chatRecipeContext }),
    });
    const data = await safeJson(res);
    if (!res.ok) throw new Error(data.error || 'Something went wrong');

    thinking.remove();
    chatHistory.push({ role: 'user',  parts: message });
    chatHistory.push({ role: 'model', parts: data.reply });
    if (chatHistory.length > 8) chatHistory = chatHistory.slice(-8);
    appendChatMessage('assistant', data.reply);

  } catch (err) {
    thinking.remove();
    appendChatMessage('assistant', err.message || 'Sorry, something went wrong — please try again.');
  } finally {
    sendBtn.disabled = false;
    input.focus();
  }
}

// ── Search / filter ───────────────────────────────────────────────
// Filters recipe cards by title as the user types in the search box.
// Also hides empty sections when filtering is active.
function filterRecipes(query) {
  const q = query.toLowerCase().trim();
  document.querySelectorAll('.flip-card').forEach(card => {
    const title  = card.querySelector('.front-title')?.textContent.toLowerCase() ?? '';
    const author = card.querySelector('.front-author')?.textContent.toLowerCase() ?? '';
    card.style.display = (!q || title.includes(q) || author.includes(q)) ? '' : 'none';
  });
  // Hide/show entire sections based on whether any cards match
  document.querySelectorAll('section[id]').forEach(section => {
    if (!q) { section.style.display = ''; return; }
    const hasMatch = [...section.querySelectorAll('.flip-card')]
      .some(c => c.style.display !== 'none');
    section.style.display = hasMatch ? '' : 'none';
  });
}
document.getElementById('recipe-search')?.addEventListener('input', e => filterRecipes(e.target.value));

// ── Back-to-top button ────────────────────────────────────────────
const backToTopBtn = document.getElementById('back-to-top');
window.addEventListener('scroll', () => {
  backToTopBtn.classList.toggle('visible', window.scrollY > 400);
}, { passive: true });
backToTopBtn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));

// ── Page-load init ────────────────────────────────────────────────

// Pre-fill author name from the last successful submission
(function () {
  const saved = localStorage.getItem('wfc_author');
  if (saved) document.getElementById('recipe-author').value = saved;
})();

// Keyboard accessibility — let keyboard users flip cards with Enter/Space
document.querySelectorAll('.flip-card').forEach(card => {
  card.setAttribute('tabindex', '0');
  card.setAttribute('role', 'button');
  const title = card.querySelector('.front-title')?.textContent.trim() ?? 'Recipe';
  card.setAttribute('aria-label', title + ' — press Enter to flip');
  card.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleFlip(card); }
    if (e.key === 'Escape' && card.classList.contains('flipped')) { card.classList.remove('flipped'); }
  });
});


// Inject "Cook Now" button into old-style cards that don't have one yet
document.querySelectorAll('.flip-card').forEach(card => {
  const header = card.querySelector('.back-header');
  if (!header || header.querySelector('.cook-now-btn')) return;
  const title = card.querySelector('.back-title')?.textContent.trim()
             || card.querySelector('.front-title')?.textContent.trim()
             || 'Recipe';
  const cardId = card.id;
  const flipBtn = header.querySelector('.back-flip-btn');
  const actions = document.createElement('div');
  actions.className = 'back-header-actions';
  const cookBtn = document.createElement('button');
  cookBtn.className = 'cook-now-btn';
  cookBtn.textContent = '🍳 Cook Now';
  cookBtn.title = 'Open guided cooking mode';
  cookBtn.onclick = e => { e.stopPropagation(); openCookMode(title, cardId); };
  actions.appendChild(cookBtn);
  if (flipBtn) {
    flipBtn.onclick = e => { e.stopPropagation(); toggleFlip(card); };
    header.removeChild(flipBtn);
    actions.appendChild(flipBtn);
  }
  header.appendChild(actions);
});

// Ingredient checkboxes — check off ingredients while cooking
document.querySelectorAll('.b-ing-row').forEach(row => {
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.className = 'ing-check';
  cb.setAttribute('aria-label', 'Mark ingredient done');
  cb.addEventListener('change', () => row.classList.toggle('ing-checked', cb.checked));
  cb.addEventListener('click', e => e.stopPropagation()); // don't flip the card
  row.insertBefore(cb, row.firstChild);
});
