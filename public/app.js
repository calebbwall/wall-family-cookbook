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
// Backward-compat alias: old recipe cards saved in DB call openCookNow()
// eslint-disable-next-line no-unused-vars
function openCookNow(title, cardId) { openCookMode(title, cardId); }

let _chatRecipeContext = '';
let _cookSteps        = [];   // { num, text, timerSecs } for step-zoom nav
let _cookStepIndex    = 0;    // current step in step-zoom overlay
let _stepTimers       = {};   // stepIndex → { remaining, interval, btn, display }
let _cookBaseServings  = 1;    // original serving count parsed from card
let _cookCurServings   = 1;    // current (user-adjusted) serving count
let _cookCurrentCardId = null; // card ID currently open in cook mode

// ── Analytics ────────────────────────────────────────────────────
function track(event, data = {}) {
  try {
    // Extend with real analytics (window.gtag, posthog, etc.) as needed
    if (typeof window._wfcTrack === 'function') window._wfcTrack(event, data);
    console.debug('[track]', event, data);
  } catch (e) { /* never throw */ }
}

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

// ══════════════════════════════════════════════════════════════════
// ── Grocery Shopping System ──────────────────────────────────────
// ══════════════════════════════════════════════════════════════════

// ── Unit normalization ──────────────────────────────────────────
const _UNIT_ALIASES = {
  'tsp':'tsp','teaspoon':'tsp','teaspoons':'tsp',
  'tbsp':'tbsp','tablespoon':'tbsp','tablespoons':'tbsp','tbs':'tbsp',
  'cup':'cup','cups':'cup','c':'cup',
  'oz':'oz','ounce':'oz','ounces':'oz',
  'lb':'lb','lbs':'lb','pound':'lb','pounds':'lb',
  'g':'g','gram':'g','grams':'g',
  'kg':'kg','kilogram':'kg','kilograms':'kg',
  'ml':'ml','milliliter':'ml','milliliters':'ml',
  'l':'L','liter':'L','liters':'L','litre':'L','litres':'L',
  'clove':'clove','cloves':'clove',
  'can':'can','cans':'can',
  'bunch':'bunch','bunches':'bunch',
  'slice':'slice','slices':'slice',
  'piece':'piece','pieces':'piece',
  'pinch':'pinch','dash':'dash',
  'sprig':'sprig','sprigs':'sprig',
  'stick':'stick','sticks':'stick',
  'head':'head','heads':'head',
  'ear':'ear','ears':'ear',
  'stalk':'stalk','stalks':'stalk',
  'packet':'packet','packets':'packet',
  'package':'package','packages':'package',
  'box':'box','boxes':'box',
  'bag':'bag','bags':'bag',
  'bottle':'bottle','bottles':'bottle',
  'jar':'jar','jars':'jar',
};

// Unit conversion (convertible families share a base unit)
const _UNIT_CONV = {
  'tsp':  { base:'tsp', factor:1 },
  'tbsp': { base:'tsp', factor:3 },
  'cup':  { base:'tsp', factor:48 },
  'oz':   { base:'oz',  factor:1 },
  'lb':   { base:'oz',  factor:16 },
  'g':    { base:'g',   factor:1 },
  'kg':   { base:'g',   factor:1000 },
  'ml':   { base:'ml',  factor:1 },
  'L':    { base:'ml',  factor:1000 },
};

// Discrete units: always ceil to whole numbers
const _DISCRETE_UNITS = new Set([
  'count','clove','can','bunch','slice','piece','sprig','stick',
  'head','ear','stalk','packet','package','box','bag','bottle','jar',
]);

// ── Ingredient amount parser ────────────────────────────────────
function _parseIngAmount(amountStr) {
  if (!amountStr) return { qty: 0, unit: 'unknown', extra: '' };
  let s = amountStr.trim();
  // Extract leading number using existing _parseFrac
  const numMatch = s.match(_LEAD_NUM_RE);
  if (!numMatch) {
    // No number found — "to taste", "a pinch", etc.
    return { qty: 0, unit: 'unknown', extra: s };
  }
  const qty = _parseFrac(numMatch[1]);
  let rest = numMatch[2].trim();
  // Try to match a unit from the rest
  // Handle parentheticals: "1 can (14 oz)" → unit=can, extra=(14 oz)
  let extra = '';
  const parenIdx = rest.indexOf('(');
  if (parenIdx >= 0) {
    extra = rest.slice(parenIdx).trim();
    rest = rest.slice(0, parenIdx).trim();
  }
  // First word of rest is the candidate unit
  const words = rest.split(/\s+/);
  const candidate = (words[0] || '').toLowerCase().replace(/[.,;:]+$/, '');
  const normUnit = _UNIT_ALIASES[candidate];
  if (normUnit) {
    return { qty: qty || 0, unit: normUnit, extra: (words.slice(1).join(' ') + ' ' + extra).trim() };
  }
  // No recognized unit — if rest is empty, it's a count
  if (!rest && !extra) return { qty: qty || 0, unit: 'count', extra: '' };
  // Rest might be descriptive text (e.g., "large" in "2 large")
  return { qty: qty || 0, unit: 'count', extra: (rest + ' ' + extra).trim() };
}

// ── Ingredient name normalizer ──────────────────────────────────
const _PREP_WORDS = new Set([
  'fresh','dried','chopped','minced','diced','sliced','grated','shredded',
  'large','small','medium','finely','roughly','thinly','coarsely',
  'frozen','canned','packed','softened','melted','room temperature',
  'boneless','skinless','trimmed','peeled','seeded','crushed','ground',
  'whole','halved','quartered',
]);

function _normalizeIngName(name) {
  let n = name.toLowerCase().trim();
  // Remove commas and everything after (prep instructions)
  const commaIdx = n.indexOf(',');
  if (commaIdx > 0) n = n.slice(0, commaIdx).trim();
  // Strip prep words
  n = n.split(/\s+/).filter(w => !_PREP_WORDS.has(w)).join(' ');
  // Basic depluralize
  if (n.endsWith('ies') && n.length > 4) n = n.slice(0, -3) + 'y';
  else if (n.endsWith('ves') && n.length > 4) n = n.slice(0, -3) + 'f';
  else if (n.endsWith('oes') && n.length > 4) n = n.slice(0, -2);
  else if (n.endsWith('es') && n.length > 3 && !n.endsWith('cheese') && !n.endsWith('rice') && !n.endsWith('sauce')) n = n.slice(0, -2);
  else if (n.endsWith('s') && n.length > 2 && !n.endsWith('hummus') && !n.endsWith('couscous') && !n.endsWith('molasses')) n = n.slice(0, -1);
  return n.trim();
}

// ── Ingredient category classification ──────────────────────────
const _ING_CATEGORIES = {
  produce: ['onion','garlic','tomato','potato','carrot','celery','pepper','bell pepper',
    'lettuce','spinach','broccoli','mushroom','lemon','lime','avocado','cilantro',
    'parsley','basil','ginger','jalape','scallion','shallot','zucchini','squash',
    'corn','green bean','pea','apple','banana','berry','strawberr','blueberr',
    'raspberr','orange','cucumber','cabbage','kale','arugula','fennel','leek',
    'asparagus','eggplant','radish','beet','turnip','sweet potato','mango','peach',
    'pear','plum','grape','pineapple','watermelon','cantaloupe','cherry','fig',
    'pomegranate','cranberr','herb'],
  dairy: ['milk','butter','cheese','cream','yogurt','egg','sour cream','whipping cream',
    'half and half','mozzarella','parmesan','cheddar','ricotta','cream cheese',
    'goat cheese','feta','gruyere','provolone','swiss','cottage cheese','ghee',
    'mascarpone','brie'],
  meat: ['chicken','beef','pork','turkey','bacon','sausage','ground meat','steak',
    'lamb','shrimp','salmon','fish','tuna','ham','prosciutto','pepperoni',
    'anchov','crab','lobster','scallop','clam','mussel','oyster','duck',
    'veal','bison','venison','chorizo','bratwurst'],
  bakery: ['bread','tortilla','bun','roll','pita','naan','croissant','bagel',
    'english muffin','crouton','flatbread','wrap','pizza dough','pie crust',
    'puff pastry','phyllo'],
  pantry: ['flour','sugar','salt','oil','olive oil','vegetable oil','coconut oil',
    'vinegar','soy sauce','broth','stock','paste','tomato sauce','honey',
    'maple syrup','vanilla','baking powder','baking soda','cornstarch',
    'rice','pasta','noodle','oat','breadcrumb','panko','coconut milk',
    'peanut butter','almond butter','jam','jelly','ketchup','mustard',
    'mayonnaise','hot sauce','worcestershire','sesame oil','fish sauce',
    'sriracha','chocolate','cocoa','condensed milk','evaporated milk',
    'corn syrup','molasses','agave','brown sugar','powdered sugar',
    'yeast','gelatin','nut','almond','walnut','pecan','cashew','pistachio',
    'pine nut','sesame seed','sunflower seed','flaxseed','chia seed',
    'raisin','dried cranberr','date','coconut flake'],
  spices: ['cumin','paprika','oregano','thyme','rosemary','cinnamon','nutmeg',
    'cayenne','chili powder','turmeric','coriander','black pepper','red pepper',
    'bay leaf','allspice','cardamom','clove','fennel seed','dill',
    'sage','tarragon','marjoram','curry','garam masala','five spice',
    'smoked paprika','garlic powder','onion powder','italian seasoning',
    'everything bagel','old bay','taco seasoning','ranch seasoning',
    'chili flake','red pepper flake','white pepper','star anise','saffron',
    'sumac','za\'atar'],
  frozen: ['frozen'],
  other: [],
};

function _categorizeIngredient(name) {
  const n = name.toLowerCase();
  for (const [cat, keywords] of Object.entries(_ING_CATEGORIES)) {
    if (cat === 'other') continue;
    for (const kw of keywords) {
      if (n.includes(kw)) return cat;
    }
  }
  return 'other';
}

const _CAT_META = {
  produce: { icon: '🥬', label: 'Produce', order: 0 },
  dairy:   { icon: '🥛', label: 'Dairy & Eggs', order: 1 },
  meat:    { icon: '🥩', label: 'Meat & Seafood', order: 2 },
  bakery:  { icon: '🍞', label: 'Bakery', order: 3 },
  pantry:  { icon: '🫙', label: 'Pantry', order: 4 },
  spices:  { icon: '🧂', label: 'Spices & Seasonings', order: 5 },
  frozen:  { icon: '🧊', label: 'Frozen', order: 6 },
  other:   { icon: '📦', label: 'Other', order: 7 },
};

// ── Unit conversion helpers ─────────────────────────────────────
function _toBaseUnit(qty, unit) {
  const conv = _UNIT_CONV[unit];
  if (!conv) return { qty, baseUnit: unit };
  return { qty: qty * conv.factor, baseUnit: conv.base };
}

function _fromBaseUnit(qty, baseUnit) {
  // Pick the largest unit where qty >= 1
  const family = Object.entries(_UNIT_CONV).filter(([, v]) => v.base === baseUnit);
  family.sort((a, b) => b[1].factor - a[1].factor); // largest first
  for (const [unitName, { factor }] of family) {
    if (qty >= factor) {
      return { qty: qty / factor, unit: unitName };
    }
  }
  // Fallback to base
  return { qty, unit: baseUnit };
}

// ── Aggregation engine ──────────────────────────────────────────
// _allRecipesCache is populated once from /api/recipes-json
let _allRecipesCache = null;

async function _fetchAllRecipes() {
  if (_allRecipesCache) return _allRecipesCache;
  try {
    const res = await fetch('/api/recipes-json');
    const data = await res.json();
    _allRecipesCache = data.recipes || [];
  } catch (e) {
    console.error('[grocery] Failed to fetch recipes:', e);
    _allRecipesCache = [];
  }
  return _allRecipesCache;
}

function _invalidateRecipeCache() { _allRecipesCache = null; }

function _parseServingsNum(servingsStr) {
  const m = String(servingsStr || '').match(/(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

function _computeGroceryList(state, allRecipes) {
  // Map cardId → recipe data
  const recipeMap = {};
  for (const r of allRecipes) recipeMap[r.cardId] = r;

  // Accumulator: key = normalizedName + '|' + baseUnit → { qty, originalName, sources, category }
  const merged = {};

  for (const sr of (state.recipes || [])) {
    const recipe = recipeMap[sr.cardId];
    if (!recipe) continue;
    const baseServ = sr.baseServings || _parseServingsNum(recipe.servings) || 1;
    const curServ = sr.servings || baseServ;
    const ratio = curServ / baseServ;

    for (const ing of (recipe.ingredients || [])) {
      const parsed = _parseIngAmount(ing.amount || '');
      if (parsed.unit === 'unknown' && parsed.qty === 0) continue; // skip "to taste" etc.
      const normName = _normalizeIngName(ing.name || '');
      if (!normName) continue;
      const scaledQty = parsed.qty * ratio;
      const { qty: baseQty, baseUnit } = _toBaseUnit(scaledQty, parsed.unit);
      const key = normName + '|' + baseUnit;

      if (!merged[key]) {
        merged[key] = {
          normName,
          originalName: ing.name || normName,
          baseUnit,
          baseQty: 0,
          sources: [],
          category: _categorizeIngredient(ing.name || normName),
        };
      }
      merged[key].baseQty += baseQty;
      if (!merged[key].sources.includes(sr.title || recipe.title)) {
        merged[key].sources.push(sr.title || recipe.title);
      }
    }
  }

  // Convert back from base units, apply rounding, subtract pantry, apply locks
  const items = [];
  for (const [key, item] of Object.entries(merged)) {
    // Check if locked
    if (state.locked && state.locked[key]) {
      const lock = state.locked[key];
      items.push({
        key,
        name: item.originalName,
        normName: item.normName,
        quantity: lock.quantity,
        unit: lock.unit,
        category: item.category,
        sources: item.sources,
        locked: true,
        pantryReduced: false,
      });
      continue;
    }

    let { qty, unit } = _fromBaseUnit(item.baseQty, item.baseUnit);

    // Pantry subtraction
    let pantryReduced = false;
    if (state.pantry && state.pantry[item.normName]) {
      const p = state.pantry[item.normName];
      const { qty: pBaseQty } = _toBaseUnit(p.quantity || 0, p.unit || unit);
      const { qty: curBaseQty } = _toBaseUnit(qty, unit);
      if (pBaseQty > 0) {
        const remaining = Math.max(0, curBaseQty - pBaseQty);
        const result = _fromBaseUnit(remaining, item.baseUnit);
        qty = result.qty;
        unit = result.unit;
        pantryReduced = true;
      }
    }

    // Rounding
    if (_DISCRETE_UNITS.has(unit)) {
      qty = Math.ceil(qty);
    }

    if (qty <= 0) continue;

    items.push({
      key,
      name: item.originalName,
      normName: item.normName,
      quantity: qty,
      unit,
      category: item.category,
      sources: item.sources,
      locked: false,
      pantryReduced,
    });
  }

  // Add manual items
  for (const mi of (state.manualItems || [])) {
    items.push({
      key: 'manual-' + mi.id,
      name: mi.name,
      normName: _normalizeIngName(mi.name),
      quantity: mi.quantity || 1,
      unit: mi.unit || 'count',
      category: mi.category || 'other',
      sources: ['Manual'],
      locked: false,
      pantryReduced: false,
      isManual: true,
    });
  }

  // Group by category
  const grouped = {};
  for (const it of items) {
    if (!grouped[it.category]) grouped[it.category] = [];
    grouped[it.category].push(it);
  }

  // Sort categories by defined order, items alphabetically within
  const sortedCats = Object.keys(grouped).sort(
    (a, b) => ((_CAT_META[a]?.order ?? 99) - (_CAT_META[b]?.order ?? 99))
  );
  const result = {};
  for (const cat of sortedCats) {
    result[cat] = grouped[cat].sort((a, b) => a.name.localeCompare(b.name));
  }
  return result;
}

// ── Grocery state management ────────────────────────────────────
let _groceryState = { recipes: [], manualItems: [], pantry: {}, checked: [], locked: {} };
let _groceryDirty = true;
let _groceryComputed = {};
let _mergedCache = null;
let _mergedCacheKey = null;
let _grocerySaveTimer = null;

async function _loadGroceryState() {
  try {
    const res = await fetch('/api/grocery');
    const data = await res.json();
    if (data.state && typeof data.state === 'object') {
      _groceryState = {
        recipes: data.state.recipes || [],
        manualItems: data.state.manualItems || [],
        pantry: data.state.pantry || {},
        checked: data.state.checked || [],
        locked: data.state.locked || {},
      };
    }
  } catch (e) {
    console.error('[grocery] Failed to load state:', e);
  }
  _groceryDirty = true;
}

function _saveGroceryState() {
  // Debounce saves
  clearTimeout(_grocerySaveTimer);
  _grocerySaveTimer = setTimeout(async () => {
    try {
      await fetch('/api/grocery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: _groceryState }),
      });
    } catch (e) {
      console.error('[grocery] Failed to save state:', e);
    }
  }, 500);
}

function _formatGroceryQty(qty, unit) {
  if (_DISCRETE_UNITS.has(unit) || unit === 'count') {
    return String(Math.ceil(qty));
  }
  return _formatNum(qty);
}

function _formatGroceryUnit(unit) {
  if (unit === 'count') return '';
  return unit;
}

// ── Grocery public API (called from UI) ─────────────────────────

async function addRecipeToGrocery(cardId) {
  const allRecipes = await _fetchAllRecipes();
  const recipe = allRecipes.find(r => r.cardId === cardId);
  if (!recipe) { _showToast('Recipe not found'); return; }
  // Check if already added
  if (_groceryState.recipes.some(r => r.cardId === cardId)) {
    _showToast('Already in grocery list');
    return;
  }
  const baseServ = _parseServingsNum(recipe.servings) || 1;
  _groceryState.recipes.push({
    cardId,
    title: recipe.title,
    servings: baseServ,
    baseServings: baseServ,
  });
  _groceryDirty = true;
  _saveGroceryState();
  _showToast('Added to groceries!');
  _updateGroceryBadge();
  if (document.getElementById('grocery-tab')?.style.display !== 'none') {
    await _renderGroceryTab();
  }
}

function removeRecipeFromGrocery(cardId) {
  _groceryState.recipes = _groceryState.recipes.filter(r => r.cardId !== cardId);
  _groceryDirty = true;
  _mergedCache = null;
  _mergedCacheKey = null;
  _saveGroceryState();
  _updateGroceryBadge();
  _renderGroceryTab();
}

function _updateGroceryBadge() {
  const count = _groceryState.recipes.length;
  for (const id of ['grocery-badge', 'grocery-badge-mobile']) {
    const badge = document.getElementById(id);
    if (!badge) continue;
    badge.textContent = String(count);
    badge.style.display = count > 0 ? 'inline-block' : 'none';
  }
}

// Toast notification system
function _showToast(message, duration = 2500) {
  const el = document.createElement('div');
  el.className = 'wfc-toast';
  el.textContent = message;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('wfc-toast-show'));
  setTimeout(() => {
    el.classList.remove('wfc-toast-show');
    setTimeout(() => el.remove(), 300);
  }, duration);
}

// ══════════════════════════════════════════════════════════════════
// ── End Grocery System Core ─────────────────────────────────────
// ══════════════════════════════════════════════════════════════════

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
    const origAmt = row.dataset.originalAmount;
    if (origAmt === undefined) return;
    const amtEl = row.querySelector('.b-ing-amt');
    if (amtEl) amtEl.textContent = origAmt ? _scaleIngText(origAmt, ratio) : '';
  });
  track('servings_changed', { servings: next });
  if (_cookCurrentCardId) {
    try {
      const saved = JSON.parse(localStorage.getItem(`cook_progress_${_cookCurrentCardId}`) || '{}');
      saved.servings = next;
      localStorage.setItem(`cook_progress_${_cookCurrentCardId}`, JSON.stringify(saved));
    } catch (e) { /* storage unavailable */ }
  }
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
  _cookCurrentCardId = cardId;

  const card = document.getElementById(cardId);
  const back = card ? card.querySelector('.flip-back') : null;
  const body = document.getElementById('cook-mode-body');
  document.getElementById('cook-mode-title').textContent = '🍳 ' + title;
  body.innerHTML = '';

  track('cook_now_started', { recipeId: cardId, title });

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

    // ── Ingredient checkboxes + store original amount ────────────
    clone.querySelectorAll('.b-ing-row').forEach(row => {
      // Store original amount text for scaling (amount span only, not name)
      const amtEl = row.querySelector('.b-ing-amt');
      row.dataset.originalAmount = amtEl ? amtEl.textContent.trim() : '';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'ing-check';
      cb.setAttribute('aria-label', 'Mark ingredient done');
      cb.addEventListener('change', () => row.classList.toggle('ing-checked', cb.checked));
      cb.addEventListener('click', e => e.stopPropagation());
      row.insertBefore(cb, row.firstChild);
    });

    // ── Restore saved servings from localStorage ──────────────────
    try {
      const saved = JSON.parse(localStorage.getItem(`cook_progress_${cardId}`) || '{}');
      if (saved.servings && saved.servings !== (parseInt(yieldTxt, 10) || 0)) {
        const diff = saved.servings - _cookBaseServings;
        if (diff !== 0) _updateServings(diff);
      }
    } catch (e) { /* storage unavailable */ }

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

      // Use AI-determined timer from data-timer-secs attribute (set at recipe creation).
      // Falls back to text parsing only for legacy cards that predate the attribute.
      const attrSecs = step.dataset.timerSecs !== undefined ? parseInt(step.dataset.timerSecs, 10) : -1;
      const timerSecs = attrSecs > 0 ? attrSecs : (attrSecs === 0 ? null : _parseStepTime(stepText));
      _cookSteps.push({ num: stepNum, text: stepText, timerSecs });

      // Tap-to-complete (only when not clicking timer/zoom buttons)
      step.addEventListener('click', e => {
        if (e.target.closest('.step-timer-btn') || e.target.closest('.step-zoom-btn')) return;
        const done = step.classList.toggle('step-done');
        step.setAttribute('aria-checked', done ? 'true' : 'false');
        if (done) track('step_advanced', { step: idx + 1, total: _cookSteps.length });
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
  // Track recipe_completed if all steps were marked done
  const allSteps = document.querySelectorAll('#cook-mode-body .b-step');
  const doneSteps = document.querySelectorAll('#cook-mode-body .b-step.step-done');
  if (allSteps.length > 0 && allSteps.length === doneSteps.length) {
    track('recipe_completed', { recipeId: _cookCurrentCardId });
  }
  // Stop all running timers
  Object.values(_stepTimers).forEach(t => { if (t.interval) clearInterval(t.interval); });
  _stepTimers = {};
  if (_stepZoomTimerInterval) { clearInterval(_stepZoomTimerInterval); _stepZoomTimerInterval = null; }
  _stepZoomTimerRunning = false;
  document.getElementById('cook-mode-overlay').style.display = 'none';
  document.getElementById('step-zoom-overlay').style.display = 'none';
  document.body.style.overflow = '';
  _chatRecipeContext = '';
  _cookCurrentCardId = null;
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
  if (role === 'user') {
    div.textContent = text;
  } else {
    // Render markdown for assistant responses
    if (typeof marked !== 'undefined') {
      div.innerHTML = marked.parse(text, { breaks: true, gfm: true });
    } else {
      div.textContent = text;
    }
  }
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

// ══════════════════════════════════════════════════════════════════
// ── Grocery Tab UI Rendering ────────────────────────────────────
// ══════════════════════════════════════════════════════════════════

let _groceryTabVisible = false;

function toggleGroceryTab() {
  _groceryTabVisible = !_groceryTabVisible;
  document.body.classList.toggle('grocery-open', _groceryTabVisible);
  const tab = document.getElementById('grocery-tab');
  const sections = document.querySelectorAll('.section, .section-divider, .hero, footer');
  if (_groceryTabVisible) {
    tab.style.display = 'block';
    sections.forEach(s => s.style.display = 'none');
    _renderGroceryTab();
  } else {
    tab.style.display = 'none';
    sections.forEach(s => s.style.display = '');
  }
}

let _groceryRenderTimer = null;
async function _renderGroceryTab() {
  clearTimeout(_groceryRenderTimer);
  _groceryRenderTimer = setTimeout(async () => { await _doRenderGroceryTab(); }, 80);
}

async function _doRenderGroceryTab() {
  const listElEarly = document.getElementById('grocery-list');
  if (listElEarly) listElEarly.innerHTML = '<p style="text-align:center;padding:2rem;color:var(--muted)">Loading…</p>';
  const allRecipes = await _fetchAllRecipes();
  const computed = _computeGroceryList(_groceryState, allRecipes);
  _groceryComputed = computed;

  // Render active recipes strip
  const recipesEl = document.getElementById('grocery-recipes');
  recipesEl.innerHTML = '';
  for (const sr of (_groceryState.recipes || [])) {
    const chip = document.createElement('div');
    chip.className = 'grocery-recipe-chip';
    chip.innerHTML = `
      <span>${_escHtml(sr.title)}</span>
      <span class="grocery-recipe-chip-servings">
        <button onclick="event.stopPropagation();changeGroceryServings('${sr.cardId}',-1)">−</button>
        <span>${sr.servings}</span>
        <button onclick="event.stopPropagation();changeGroceryServings('${sr.cardId}',1)">+</button>
      </span>
      <button class="grocery-recipe-chip-remove" onclick="removeRecipeFromGrocery('${sr.cardId}')" title="Remove">&times;</button>
    `;
    recipesEl.appendChild(chip);
  }

  // Render grocery list (unmerged first for immediate display)
  _renderGroceryItems(computed);

  // AI merge: progressive enhancement
  const cacheKey = JSON.stringify(_groceryState.recipes);
  const flatItems = [];
  for (const items of Object.values(computed)) {
    for (const item of items) flatItems.push({ name: item.name, quantity: item.quantity, unit: item.unit, category: item.category, sources: item.sources });
  }

  if (flatItems.length > 0) {
    if (_mergedCache && _mergedCacheKey === cacheKey) {
      // Use cached merged result
      _renderMergedGroceryItems(_mergedCache);
      _setMergeIndicator('done');
    } else {
      _setMergeIndicator('loading');
      fetch('/api/grocery/merge-ingredients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ingredients: flatItems })
      })
      .then(r => r.json())
      .then(data => {
        if (data.warning) {
          _setMergeIndicator('error');
        } else if (data.merged && data.merged.length > 0) {
          _mergedCache = data.merged;
          _mergedCacheKey = cacheKey;
          _renderMergedGroceryItems(data.merged);
          _setMergeIndicator('done');
        } else {
          _setMergeIndicator('error');
        }
      })
      .catch(() => { _setMergeIndicator('error'); });
    }
  }

  // Render pantry section
  _renderPantry();
}

function _setMergeIndicator(state) {
  let el = document.getElementById('grocery-merge-status');
  if (!el) {
    el = document.createElement('span');
    el.id = 'grocery-merge-status';
    el.style.cssText = 'font-size:0.75rem;margin-left:0.75rem;font-weight:600;';
    const titleEl = document.querySelector('.grocery-title');
    if (titleEl) titleEl.appendChild(el);
  }
  if (state === 'loading') {
    el.textContent = '⏳ Merging…';
    el.style.color = 'var(--muted)';
  } else if (state === 'done') {
    el.textContent = '✓ AI-merged';
    el.style.color = 'var(--green, #2a7d2a)';
  } else if (state === 'error') {
    el.textContent = 'Smart merge unavailable';
    el.style.color = 'var(--muted)';
  }
}

function _renderMergedGroceryItems(mergedItems) {
  if (!mergedItems || mergedItems.length === 0) return;
  // Re-group merged items by category
  const grouped = {};
  for (const item of mergedItems) {
    const cat = item.category || 'other';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push({
      key: (item.name || '').toLowerCase().replace(/\s+/g, '-') + '|' + (item.unit || ''),
      name: item.name,
      normName: (item.name || '').toLowerCase(),
      quantity: item.quantity,
      unit: item.unit,
      category: cat,
      sources: item.sources || [],
      locked: false,
      pantryReduced: false,
      isManual: false,
    });
  }
  const sortedCats = Object.keys(grouped).sort(
    (a, b) => ((_CAT_META[a]?.order ?? 99) - (_CAT_META[b]?.order ?? 99))
  );
  const result = {};
  for (const cat of sortedCats) {
    result[cat] = grouped[cat].sort((a, b) => a.name.localeCompare(b.name));
  }
  _renderGroceryItems(result);
}

function _renderGroceryItems(computed) {
  const listEl = document.getElementById('grocery-list');
  const hasItems = Object.keys(computed).length > 0;

  listEl.innerHTML = '';

  if (!hasItems) {
    listEl.innerHTML = `
      <div class="grocery-empty" id="grocery-empty">
        <div class="grocery-empty-icon">🛒</div>
        <p class="grocery-empty-title">No items yet</p>
        <p class="grocery-empty-sub">Add recipes to start building your grocery list.</p>
        <button class="grocery-btn" onclick="openRecipePicker()" style="margin-top:1rem">+ Add Recipes</button>
      </div>
    `;
    return;
  }

  for (const [cat, items] of Object.entries(computed)) {
      const meta = _CAT_META[cat] || _CAT_META.other;
      const section = document.createElement('details');
      section.className = 'grocery-category';
      section.open = true;
      section.innerHTML = `
        <summary>
          <span class="grocery-cat-icon">${meta.icon}</span>
          <span>${meta.label}</span>
          <span class="grocery-cat-count">${items.length} item${items.length !== 1 ? 's' : ''}</span>
        </summary>
      `;
      const itemsDiv = document.createElement('div');
      itemsDiv.className = 'grocery-items';

      for (const item of items) {
        const isChecked = (_groceryState.checked || []).includes(item.key);
        const row = document.createElement('div');
        row.className = 'grocery-item' + (isChecked ? ' grocery-item-checked' : '') +
          (item.locked ? ' grocery-item-locked' : '') +
          (item.pantryReduced ? ' grocery-item-pantry' : '');
        row.dataset.key = item.key;

        const fmtQty = _formatGroceryQty(item.quantity, item.unit);
        const fmtUnit = _formatGroceryUnit(item.unit);
        const sourceTip = item.sources.join(', ');
        const sourceLabel = item.sources.length > 1 ? `${item.sources.length} recipes` :
          (item.isManual ? 'Manual' : item.sources[0] || '');

        row.innerHTML = `
          <input type="checkbox" class="grocery-check" ${isChecked ? 'checked' : ''}
            onchange="toggleGroceryCheck('${_escAttr(item.key)}', this.checked)">
          <span class="grocery-item-qty">${fmtQty}</span>
          <span class="grocery-item-unit">${fmtUnit}</span>
          <span class="grocery-item-name">${_escHtml(item.name)}${item.locked ? ' 🔒' : ''}${item.pantryReduced ? ' 🏠' : ''}</span>
          <span class="grocery-item-sources" title="${_escAttr(sourceTip)}">${_escHtml(sourceLabel)}</span>
          <div class="grocery-item-actions">
            <button class="grocery-item-action-btn" onclick="addToPantry('${_escAttr(item.normName)}',${item.quantity},'${_escAttr(item.unit)}')" title="I have this">🏠</button>
            ${item.isManual ? `<button class="grocery-item-action-btn" onclick="removeManualItem('${_escAttr(item.key)}')" title="Remove">🗑</button>` : ''}
          </div>
        `;
        itemsDiv.appendChild(row);
      }
      section.appendChild(itemsDiv);
      listEl.appendChild(section);
    }
}

function _renderPantry() {
  const pantry = _groceryState.pantry || {};
  const pantryKeys = Object.keys(pantry);
  const section = document.getElementById('grocery-pantry-section');
  const listEl = document.getElementById('grocery-pantry');

  if (pantryKeys.length === 0) {
    section.style.display = 'none';
    return;
  }
  section.style.display = '';
  listEl.innerHTML = '';
  for (const [name, data] of Object.entries(pantry)) {
    const div = document.createElement('div');
    div.className = 'grocery-pantry-item';
    const fmtUnit = data.unit === 'count' ? '' : data.unit;
    div.innerHTML = `
      <span>${_escHtml(name)}</span>
      <span style="margin-left:auto;color:var(--muted)">${_formatGroceryQty(data.quantity, data.unit)} ${fmtUnit}</span>
      <button class="grocery-item-action-btn" onclick="removePantryItem('${_escAttr(name)}')" title="Remove from pantry">×</button>
    `;
    listEl.appendChild(div);
  }
}

function _escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function _escAttr(s) { return String(s).replace(/'/g, "\\'").replace(/"/g, '&quot;'); }

// ── Grocery UI event handlers ───────────────────────────────────

function toggleGroceryCheck(key, checked) {
  const arr = _groceryState.checked || [];
  if (checked && !arr.includes(key)) arr.push(key);
  else if (!checked) _groceryState.checked = arr.filter(k => k !== key);
  else _groceryState.checked = arr;
  _saveGroceryState();
  // Update visual immediately
  const row = document.querySelector(`.grocery-item[data-key="${CSS.escape(key)}"]`);
  if (row) row.classList.toggle('grocery-item-checked', checked);
}

function changeGroceryServings(cardId, delta) {
  const sr = _groceryState.recipes.find(r => r.cardId === cardId);
  if (!sr) return;
  sr.servings = Math.max(1, (sr.servings || 1) + delta);
  _groceryDirty = true;
  _mergedCache = null;
  _mergedCacheKey = null;
  _saveGroceryState();
  _renderGroceryTab();
}

// ── Recipe picker ───────────────────────────────────────────────
async function openRecipePicker() {
  const allRecipes = await _fetchAllRecipes();
  const body = document.getElementById('recipe-picker-body');
  body.innerHTML = '';
  const existing = new Set((_groceryState.recipes || []).map(r => r.cardId));

  for (const r of allRecipes) {
    const baseServ = _parseServingsNum(r.servings) || 1;
    const div = document.createElement('div');
    div.className = 'recipe-picker-item';
    div.innerHTML = `
      <input type="checkbox" class="recipe-picker-check" data-card-id="${r.cardId}" ${existing.has(r.cardId) ? 'checked disabled' : ''}>
      <span class="recipe-picker-title">${_escHtml(r.title)}</span>
      <span class="recipe-picker-servings">
        <span>Servings:</span>
        <input type="number" class="recipe-picker-serv-input" data-card-id="${r.cardId}" value="${baseServ}" min="1" max="50">
      </span>
    `;
    body.appendChild(div);
  }
  document.getElementById('recipe-picker-modal').style.display = 'flex';
}

function closeRecipePicker() {
  document.getElementById('recipe-picker-modal').style.display = 'none';
}

async function applyRecipePicker() {
  const allRecipes = await _fetchAllRecipes();
  const checks = document.querySelectorAll('.recipe-picker-check:checked:not(:disabled)');
  let added = 0;
  checks.forEach(cb => {
    const cardId = cb.dataset.cardId;
    const recipe = allRecipes.find(r => r.cardId === cardId);
    if (!recipe) return;
    if (_groceryState.recipes.some(r => r.cardId === cardId)) return;
    const servInput = document.querySelector(`.recipe-picker-serv-input[data-card-id="${cardId}"]`);
    const servings = parseInt(servInput?.value, 10) || _parseServingsNum(recipe.servings) || 1;
    const baseServ = _parseServingsNum(recipe.servings) || 1;
    _groceryState.recipes.push({ cardId, title: recipe.title, servings, baseServings: baseServ });
    added++;
  });
  if (added > 0) {
    _groceryDirty = true;
    _invalidateRecipeCache();
    _mergedCache = null;
    _mergedCacheKey = null;
    _saveGroceryState();
    _updateGroceryBadge();
    _showToast(`Added ${added} recipe${added > 1 ? 's' : ''}!`);
    _renderGroceryTab();
  }
  closeRecipePicker();
}

// ── Manual item ─────────────────────────────────────────────────
function openManualItemForm() {
  document.getElementById('manual-item-name').value = '';
  document.getElementById('manual-item-qty').value = '1';
  document.getElementById('manual-item-cat').value = 'pantry';
  document.getElementById('manual-item-modal').style.display = 'flex';
}
function closeManualItemForm() {
  document.getElementById('manual-item-modal').style.display = 'none';
}

function addManualItem() {
  const name = document.getElementById('manual-item-name').value.trim();
  const qty = parseFloat(document.getElementById('manual-item-qty').value) || 1;
  const cat = document.getElementById('manual-item-cat').value;
  if (!name) { _showToast('Please enter an item name'); return; }
  if (!_groceryState.manualItems) _groceryState.manualItems = [];
  _groceryState.manualItems.push({
    id: 'm-' + Date.now(),
    name,
    quantity: qty,
    unit: 'count',
    category: cat,
  });
  _groceryDirty = true;
  _saveGroceryState();
  closeManualItemForm();
  _showToast('Item added!');
  _renderGroceryTab();
}

function removeManualItem(key) {
  const id = key.replace('manual-', '');
  _groceryState.manualItems = (_groceryState.manualItems || []).filter(m => m.id !== id);
  _groceryDirty = true;
  _saveGroceryState();
  _renderGroceryTab();
}

// ── Pantry ──────────────────────────────────────────────────────
function addToPantry(normName, qty, unit) {
  if (!_groceryState.pantry) _groceryState.pantry = {};
  _groceryState.pantry[normName] = { quantity: qty, unit };
  _groceryDirty = true;
  _saveGroceryState();
  _showToast('Added to pantry');
  _renderGroceryTab();
}

function removePantryItem(name) {
  if (_groceryState.pantry) delete _groceryState.pantry[name];
  _groceryDirty = true;
  _saveGroceryState();
  _renderGroceryTab();
}

function clearPantry() {
  _groceryState.pantry = {};
  _groceryDirty = true;
  _saveGroceryState();
  _renderGroceryTab();
  _showToast('Pantry cleared');
}

// ── Export ───────────────────────────────────────────────────────
function exportGroceryList() {
  const computed = _groceryComputed;
  if (!computed || Object.keys(computed).length === 0) {
    _showToast('Nothing to copy'); return;
  }
  let text = '🛒 Grocery List\n\n';
  for (const [cat, items] of Object.entries(computed)) {
    const meta = _CAT_META[cat] || _CAT_META.other;
    text += `${meta.icon} ${meta.label.toUpperCase()}\n`;
    items.forEach(i => {
      const fmtUnit = _formatGroceryUnit(i.unit);
      const checked = (_groceryState.checked || []).includes(i.key);
      text += `  ${checked ? '☑' : '☐'} ${_formatGroceryQty(i.quantity, i.unit)} ${fmtUnit} ${i.name}\n`;
    });
    text += '\n';
  }
  navigator.clipboard.writeText(text.trim()).then(() => {
    _showToast('Grocery list copied!');
  }).catch(() => {
    _showToast('Copy failed — try again');
  });
}

function clearGroceryList() {
  if (!confirm('Clear the entire grocery list?')) return;
  _groceryState.recipes = [];
  _groceryState.manualItems = [];
  _groceryState.checked = [];
  _groceryState.locked = {};
  // Keep pantry
  _groceryDirty = true;
  _saveGroceryState();
  _updateGroceryBadge();
  _renderGroceryTab();
  _showToast('Grocery list cleared');
}

// ── Add to Groceries button injection on recipe cards ───────────
function _injectGroceryButtons() {
  document.querySelectorAll('.flip-card').forEach(card => {
    const header = card.querySelector('.back-header');
    if (!header || header.querySelector('.add-grocery-btn')) return;
    const cardId = card.id;
    const actions = header.querySelector('.back-header-actions');
    if (!actions) return;
    const btn = document.createElement('button');
    btn.className = 'add-grocery-btn';
    btn.textContent = '🛒 Add to Groceries';
    btn.onclick = e => { e.stopPropagation(); addRecipeToGrocery(cardId); };
    actions.insertBefore(btn, actions.firstChild);
  });
}

// ══════════════════════════════════════════════════════════════════
// ── End Grocery Tab UI ──────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════

// ── Household helpers ──────────────────────────────────────────────
function _getHousehold() {
  const m = document.cookie.match(/(?:^|;\s*)wfc_household=([^;]*)/);
  return m ? decodeURIComponent(m[1]) : '';
}

// ── Page-load init ────────────────────────────────────────────────

// Display current household in footer
(function () {
  const hh = _getHousehold();
  const label = document.getElementById('household-label');
  if (label && hh) label.textContent = 'Logged in as: ' + hh;
})();

// Pre-fill author name from household cookie, then localStorage fallback
(function () {
  const hh = _getHousehold();
  const saved = hh || localStorage.getItem('wfc_author');
  if (saved) {
    // Try both possible IDs (public template uses add-author, root uses recipe-author)
    const el = document.getElementById('add-author') || document.getElementById('recipe-author');
    if (el) el.value = saved;
  }
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

// ── Step-zoom swipe navigation (mobile) ───────────────────────────
(function _initStepZoomSwipe() {
  const panel = document.querySelector('.step-zoom-panel');
  if (!panel) return;
  let _swipeStartX = 0;
  panel.addEventListener('touchstart', e => {
    _swipeStartX = e.touches[0].clientX;
  }, { passive: true });
  panel.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - _swipeStartX;
    if (Math.abs(dx) > 50) stepZoomNav(dx < 0 ? 1 : -1);
  }, { passive: true });
})();

// ── Grocery system init ─────────────────────────────────────────
(async function _initGrocery() {
  await _loadGroceryState();
  _updateGroceryBadge();
  _injectGroceryButtons();
})();
