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

// ── Media state ──────────────────────────────────────────────────
const INSTAGRAM_RE = /instagram\.com\/(p|reel|tv)\//i;
let _addMediaUrl = ''; // resolved URL for Add Recipe modal
let _dfMediaUrl  = ''; // resolved URL for Direct Edit form

// Add Recipe modal — media helpers
async function handleAddPhotoFile(input) {
  if (!input.files || !input.files[0]) return;
  const form = new FormData();
  form.append('photo', input.files[0]);
  try {
    const res  = await fetch('/api/upload-media', { method: 'POST', body: form });
    const data = await res.json();
    if (!res.ok) { alert(data.error || 'Upload failed'); return; }
    _addMediaUrl = data.url;
    document.getElementById('add-media-url').value = '';
    _renderAddMediaPreview(data.url);
  } catch { alert('Upload failed — please try again'); }
}

function handleAddMediaUrl(val) {
  _addMediaUrl = val.trim();
  _renderAddMediaPreview(_addMediaUrl);
}

function _renderAddMediaPreview(url) {
  const wrap = document.getElementById('add-media-preview');
  const img  = document.getElementById('add-media-preview-img');
  const ig   = document.getElementById('add-media-preview-ig');
  if (!url) { wrap.style.display = 'none'; return; }
  wrap.style.display = 'block';
  if (INSTAGRAM_RE.test(url)) {
    img.style.display = 'none'; ig.style.display = 'flex';
  } else {
    ig.style.display = 'none'; img.src = url; img.style.display = 'block';
  }
}

function clearAddMedia() {
  _addMediaUrl = '';
  document.getElementById('add-media-url').value = '';
  document.getElementById('add-photo-file').value = '';
  document.getElementById('add-media-preview').style.display = 'none';
}

// Direct Edit form — media helpers
async function handleDfPhotoFile(input) {
  if (!input.files || !input.files[0]) return;
  const form = new FormData();
  form.append('photo', input.files[0]);
  try {
    const res  = await fetch('/api/upload-media', { method: 'POST', body: form });
    const data = await res.json();
    if (!res.ok) { alert(data.error || 'Upload failed'); return; }
    _dfMediaUrl = data.url;
    document.getElementById('df-media-url').value = '';
    _renderDfMediaPreview(data.url);
  } catch { alert('Upload failed — please try again'); }
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

// ── Add Recipe modal ─────────────────────────────────────────────
async function submitRecipe(event) {
  event.preventDefault();
  const form   = event.target;
  const btn    = document.getElementById('submit-btn');
  const status = document.getElementById('modal-status');

  btn.disabled    = true;
  btn.textContent = 'Formatting with AI…';
  status.style.display = 'none';
  status.textContent   = '';

  try {
    const res  = await fetch('/api/add-recipe', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        category:    form.category.value,
        authorName:  form.authorName.value.trim(),
        recipeInput: form.recipeInput.value.trim(),
        mediaUrl:    _addMediaUrl || '',
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Something went wrong');

    status.style.display = 'block';
    status.style.color   = '#2a7a2a';
    status.textContent   = '✓ Recipe added! Refreshing page…';
    localStorage.setItem('wfc_author', form.authorName.value.trim());
    clearAddMedia();
    setTimeout(() => window.location.reload(), 2000);

  } catch (err) {
    status.style.display = 'block';
    status.style.color   = 'var(--red)';
    status.textContent   = err.message;
    btn.disabled    = false;
    btn.textContent = 'Add to Cookbook';
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
    .then(r => r.json())
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
    const data = await res.json();
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
    const data = await res.json();
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
    const data = await res.json();
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

// Fallback for browsers that don't support 100dvh: resize the chat panel
// to match the visual viewport height so the input stays above the keyboard.
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', () => {
    const panel = document.getElementById('chat-panel');
    if (chatOpen) panel.style.height = window.visualViewport.height + 'px';
  });
}

function toggleChat() {
  chatOpen = !chatOpen;
  const panel = document.getElementById('chat-panel');
  panel.classList.toggle('open', chatOpen);
  if (!chatOpen) panel.style.height = ''; // reset any JS-set height on close
  if (chatOpen) document.getElementById('chat-input').focus();
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
      body:    JSON.stringify({ message, history: chatHistory }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Something went wrong');

    thinking.remove();
    chatHistory.push({ role: 'user',  parts: message });
    chatHistory.push({ role: 'model', parts: data.reply });
    if (chatHistory.length > 8) chatHistory = chatHistory.slice(-8);
    appendChatMessage('assistant', data.reply);

  } catch (err) {
    thinking.remove();
    appendChatMessage('assistant', 'Sorry, something went wrong — please try again.');
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

// Add "Add the first recipe" CTA to every empty section
document.querySelectorAll('.empty-state').forEach(el => {
  const btn = document.createElement('button');
  btn.className = 'empty-cta-btn';
  btn.textContent = '+ Add the first recipe';
  btn.onclick = () => { document.getElementById('add-recipe-modal').style.display = 'flex'; };
  el.appendChild(btn);
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
