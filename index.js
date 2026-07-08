/**
 * GM Lore Parser — SillyTavern Extension  v0.0.19 (beta)
 *
 * Entry point only. All logic lives in modules/. Load order matters:
 * state → utils → lorebook → system → schema → entity → progression →
 *   inventory → capabilities → domain → lore → sheet → creation →
 *   quests → reputation → events → currency → needs →
 *   commands → panel → context
 *
 * To add a new block type:
 *   1. Add its begin/end strings to UPDATE_BLOCKS or SHEET_BLOCKS in modules/state.js
 *   2. Write a handler function in a new or existing module file
 *   3. Register it in the appropriate handler loop below (onMessageReceived)
 *   4. Add a stripAllBlocks entry (automatic via the registry arrays in state.js)
 */

// SillyTavern loads this entry as an ES module (<script type="module">), so its
// top-level declarations are NOT global. The classic module scripts injected by
// glpLoadModules (state.js, …) read MODULE_NAME / VERSION as globals, so expose
// them on window. (MODULE_NAME is also the settings/chatMetadata key.)
var MODULE_NAME = window.MODULE_NAME = 'gm-lore-parser';
var VERSION     = window.VERSION     = '0.0.20';

// Resolve our own install folder from this module's own URL so module loading
// works regardless of the third-party folder name (a GitHub clone is typically
// "SillyTavern-GMLoreParser", not "gm-lore-parser"). Falls back to the
// MODULE_NAME path if import.meta is unavailable.
var GLP_MODULES_BASE = (function () {
    try {
        if (import.meta && import.meta.url)
            return import.meta.url.replace(/index\.js(?:\?.*)?$/, 'modules/');
    } catch (e) { /* fall through */ }
    return `/scripts/extensions/third-party/${MODULE_NAME}/modules/`;
})();

// ── Module loader ─────────────────────────────────────────────────────────────

var GLP_MODULE_LOAD_ORDER = [
    'state',      // constants, block registries, settings/state accessors
    'utils',      // pure utilities, parseFields, extractBlocks, parseSchema
    'telemetry',  // per-chat token/cost instrumentation for GLP's side-generations
    'lorebook',   // lorebook CRUD helpers
    'system',     // system definition (ruleset) — getSystemDef, evalFormula
    'schema',     // schema engine (applyFieldValue, regen, promotions)
    'entity',     // unified entity core + all type rules (player/npc/companion/creature)
    'scene',      // party & scene rosters (always-on constant entries)
    'progression',// rank ladders + XP awards
    'inventory',  // equipment slots, inventory model, item box
    'capabilities',// unified capabilities (static + progressing; def-driven progression)
    'domain',     // domain sub-game
    'lore',       // npc storage internals, item, location, generic lore handlers
    'sheet',      // player sheet + world time
    'creation',   // interactive character creation session
    'quests',     // quest tracker
    'reputation', // faction reputation
    'events',     // world events + plot lorebook
    'currency',   // pure wealth tracking
    'needs',      // life simulation needs meters
    'header',     // narrative status header (merged from gm-narrative-header)
    'commands',   // # command interceptor
    'panel',      // status panel rendering
    'context',    // context injection
    'tools',      // optional native function-calling surface (chat-completion backends)
];

async function glpLoadModules() {
    const base = GLP_MODULES_BASE;
    for (const name of GLP_MODULE_LOAD_ORDER) {
        await new Promise((resolve) => {
            const s = document.createElement('script');
            s.src = `${base}${name}.js?v=${VERSION}`;
            s.onload = resolve;
            s.onerror = () => {
                console.error(`[${MODULE_NAME}] Failed to load module: ${name}.js`);
                resolve(); // non-fatal — keep loading remaining modules
            };
            document.head.appendChild(s);
        });
    }
}

// ── CARD_OUTPUT handler ───────────────────────────────────────────────────────

/** Trigger a browser download of a card object as pretty JSON. Shared by the
 *  one-shot [CARD_OUTPUT] path and the chunked [CARD_FINALIZE] assembly. */
function _downloadCardJson(obj) {
    const name = obj?.data?.name || 'generated-gm-card';
    const url  = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' }));
    const a    = Object.assign(document.createElement('a'), {
        href: url, download: `${name.toLowerCase().replace(/\s+/g, '-')}.json`,
    });
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return name;
}

function handleCardOutput(raw) {
    try {
        const name = _downloadCardJson(JSON.parse(raw));
        SillyTavern.getContext().toastr?.success(`Card "${name}" downloaded`, 'GM Lore Parser', { timeOut: 4000 });
        return true;
    } catch (e) {
        console.error(`[${MODULE_NAME}] CARD_OUTPUT parse error:`, e);
        SillyTavern.getContext().toastr?.error('Card JSON invalid', 'GM Lore Parser');
        return false;
    }
}

// ── Chunked card assembly (CARD_BEGIN → CARD_FIELD* → CARD_BOOK_ENTRY* → CARD_FINALIZE) ──
// Lets a small model build a produced GM card across many small messages instead
// of emitting the whole JSON at once. State buffers in getCharState().card_draft.

/** Split a block body into a `key: value` header (lines before the first blank
 *  line) and a verbatim body (everything after it) — so multi-line prose values
 *  with colons aren't mangled by parseFields. */
// Header keys a [CARD_FIELD] / [CARD_BOOK_ENTRY] header line may use. Used by the
// lenient fallback below so a body line like "Resolution: roll 2d6" is NOT mistaken
// for a header line.
const CARD_HEADER_KEY_RE = /^[ \t]*(key|append|keys|comment|constant|order)[ \t]*:/i;

function _splitHeaderBody(raw) {
    const nl = raw.indexOf('\n\n');
    if (nl !== -1) return { header: parseFields(raw.slice(0, nl)), body: raw.slice(nl + 2).replace(/\s+$/, '') };
    // No blank-line separator (a common small-model slip that would otherwise leave
    // an empty body). Consume the leading run of recognized header lines, treat the
    // rest as the body.
    const lines = raw.split('\n');
    let i = 0;
    while (i < lines.length && CARD_HEADER_KEY_RE.test(lines[i])) i++;
    if (i === 0 || i === lines.length) return { header: parseFields(raw), body: '' };
    return { header: parseFields(lines.slice(0, i).join('\n')), body: lines.slice(i).join('\n').replace(/^\s+|\s+$/g, '') };
}

function applyCardBegin(raw) {
    const fields = parseFields(raw);
    const draft  = getCharState().card_draft;
    // A second [CARD_BEGIN] on an already-open draft must NOT wipe the accumulated
    // fields/entries — small models sometimes re-emit [CARD_BEGIN] (e.g. right before
    // finalizing), and a reset there silently discards the whole card. Treat a repeat
    // open as a rename only: keep data + book_entries, update the name if a new one was
    // given. Only a fresh (inactive) draft starts empty.
    if (draft.active) {
        if (fields.name) draft.name = fields.name;
        console.log(`[${MODULE_NAME}] CARD_BEGIN on an open draft — kept ${Object.keys(draft.data || {}).length} field(s) + ${(draft.book_entries || []).length} entr(y/ies); name now "${draft.name}".`);
        return true;
    }
    draft.active = true;
    draft.name   = fields.name || 'Generated GM Card';
    draft.data   = {};
    draft.book_entries = [];
    draft.auto_retries = 0;   // fresh draft — reset the finalize auto-retry budget
    console.log(`[${MODULE_NAME}] Card assembly opened: "${draft.name}".`);
    SillyTavern.getContext().toastr?.info(`Building card: "${draft.name}" — sections will assemble as you confirm each stage; it downloads on finalize.`, 'GM Lore Parser', { timeOut: 5000 });
    return true;
}

function applyCardField(raw) {
    const draft = getCharState().card_draft;
    if (!draft.active) { console.warn(`[${MODULE_NAME}] CARD_FIELD outside an active card assembly — ignoring.`); return false; }
    const { header, body } = _splitHeaderBody(raw);
    const key = (header.key || '').trim();
    if (!key) { console.warn(`[${MODULE_NAME}] CARD_FIELD missing key — ignoring.`); return false; }
    const append = header.append === 'true' || header.append === true;
    if (key === 'name') { draft.name = body.trim() || draft.name; return true; }
    // Fold unrecognized keys into system_prompt as a titled section. A small model
    // continuing a chunked emission sometimes splits the system_prompt into its own
    // named fields (e.g. `entity_protocol`, `gm_directives`) instead of appending to
    // `system_prompt` — left alone those would strand the content in stray fields and
    // the system_prompt would never form (blocking finalize). Absorbing them keeps the
    // artifact whole (same tolerate-the-model, guarantee-the-card philosophy as the gate).
    if (!KNOWN_CARD_FIELDS.has(key)) {
        const heading = key.replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        const section = `## ${heading}\n${body}`;
        draft.data.system_prompt = draft.data.system_prompt ? `${draft.data.system_prompt}\n\n${section}` : section;
        console.warn(`[${MODULE_NAME}] CARD_FIELD: unrecognized key "${key}" folded into system_prompt as a section.`);
        return true;
    }
    // Append joins with a newline — chunks of a long field (e.g. system_prompt) are
    // split at line/section boundaries, and extractBlocks trims each chunk's edges.
    draft.data[key] = append && draft.data[key] ? `${draft.data[key]}\n${body}` : body;
    return true;
}

function applyCardBookEntry(raw) {
    const draft = getCharState().card_draft;
    if (!draft.active) { console.warn(`[${MODULE_NAME}] CARD_BOOK_ENTRY outside an active card assembly — ignoring.`); return false; }
    const { header, body } = _splitHeaderBody(raw);
    draft.book_entries.push({
        keys:     (header.keys || '').split(',').map(s => s.trim()).filter(Boolean),
        content:  body,
        comment:  header.comment || '',
        constant: header.constant === 'true' || header.constant === true,
        order:    parseInt(header.order) || 100,
    });
    return true;
}

/** Remove standalone markdown code-fence marker lines (``` or ```lang) from a
 *  message before block extraction. Small models often wrap their block output in
 *  a fenced code block; the fence lines would otherwise sit between/around our
 *  [..._BEGIN]/[..._END] tags. We strip only the fence MARKER lines, never content,
 *  so bracket-delimited blocks survive intact. */
function _stripCodeFences(s) {
    return String(s || '').replace(/^[ \t]*```[^\n]*$/gm, '');
}

/** Un-decorate block tags a small model wrapped in markdown. On a line whose only
 *  meaningful content is a known [..._BEGIN]/[..._END] tag dressed up as a heading,
 *  bold, or quote (e.g. `## [ENTITY_UPDATE_BEGIN]`, `**[ENTITY_UPDATE_END]**`,
 *  `> [HEADER_FORMAT_BEGIN]`), strip the markers back to the bare tag so extractBlocks
 *  still matches. Conservative: only rewrites lines that ALREADY contain a real
 *  square-bracket BEGIN/END tag, so it can't corrupt prose or invent tags. */
function _normalizeBlockTags(s) {
    return String(s || '')
        // XML/markdown-style closer: a small model often ends a block with
        // `[/SCENE_UPDATE_BEGIN]` (or `[/SCENE_UPDATE_END]`) instead of the required
        // `[SCENE_UPDATE_END]`. Rewrite any `[/FOO_BEGIN]` / `[/FOO_END]` → `[FOO_END]`
        // so extractBlocks finds a complete block. Only touches bracketed BEGIN/END tags.
        .replace(/\[\/([A-Z][A-Z0-9_]*)_(?:BEGIN|END)\]/g, '[$1_END]')
        .replace(/^[ \t>]*[#*_]{1,3}[ \t]*(\[[A-Z][A-Z0-9_]*_(?:BEGIN|END)\])[ \t]*[#*_]{0,3}[ \t]*$/gm, '$1')
        .replace(/^[ \t>]+(\[[A-Z][A-Z0-9_]*_(?:BEGIN|END)\])[ \t]*$/gm, '$1');
}

// Lore entries shorter than this are flagged as shallow (logged, not dropped).
const SHALLOW_ENTRY_CHARS = 120;

// Recognized chara_card_v2 `data.*` field keys a [CARD_FIELD] may target. Any other
// key is folded into system_prompt (see applyCardField). `character_book` is omitted
// deliberately — it is assembled from [CARD_BOOK_ENTRY] blocks, not set as a field.
const KNOWN_CARD_FIELDS = new Set([
    'name', 'description', 'personality', 'scenario', 'first_mes', 'mes_example',
    'system_prompt', 'post_history_instructions', 'creator_notes', 'tags',
    'creator', 'character_version', 'alternate_greetings', 'extensions',
]);

/** De-duplicate assembled lore entries before finalizing. A chatty model can emit
 *  the same entry twice (e.g. a full protocol entry plus a thin restatement). We
 *  collapse EXACT duplicates only — same normalized comment, or the same key-set —
 *  keeping whichever copy has the richer (longer) content; semantic near-duplicates
 *  with distinct comments/keys are left to the model directive, not guessed at here.
 *  Returns { entries, dropped[], shallow[] }. */
function _dedupeBookEntries(rawEntries) {
    const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const sig  = keys => (keys || []).map(norm).filter(Boolean).sort().join('|');
    const kept = [];
    const byComment = new Map();   // normalized comment -> index in kept
    const byKeys    = new Map();   // key signature       -> index in kept
    const dropped = [];
    for (const e of rawEntries) {
        const c = norm(e.comment);
        const k = sig(e.keys);
        const hitIdx = (c && byComment.has(c)) ? byComment.get(c) : (k && byKeys.has(k)) ? byKeys.get(k) : -1;
        if (hitIdx !== -1) {
            const existing = kept[hitIdx];
            // keep the richer copy
            if (String(e.content || '').length > String(existing.content || '').length) {
                dropped.push(`"${existing.comment}" (kept richer copy)`);
                kept[hitIdx] = e;
            } else {
                dropped.push(`"${e.comment}"`);
            }
            // refresh indices to the kept copy
            if (c) byComment.set(c, hitIdx);
            if (k) byKeys.set(k, hitIdx);
            continue;
        }
        const idx = kept.push(e) - 1;
        if (c) byComment.set(c, idx);
        if (k) byKeys.set(k, idx);
    }
    // Drop entries with no content body (e.g. a model that emitted only the header).
    // A hollow entry is useless; dropping it also lets the completeness gate refuse a
    // card whose lore is all empty (0 real entries → finalize blocked) rather than
    // shipping shells.
    const nonEmpty = [];
    for (const e of kept) {
        if (!String(e.content || '').trim()) { dropped.push(`"${e.comment}" (empty content)`); continue; }
        nonEmpty.push(e);
    }
    const shallow = nonEmpty.filter(e => String(e.content || '').trim().length < SHALLOW_ENTRY_CHARS).map(e => `"${e.comment}"`);
    return { entries: nonEmpty, dropped, shallow };
}

/** Resolve a trustworthy produced-card name. A model that forgets the
 *  `[CARD_BEGIN] name:` line leaves draft.name empty → the card would ship with
 *  data.name:'' and SillyTavern would import it under the DESIGNER's name ("The
 *  Architect"). Fall back to the system name parsed from the emitted [System
 *  Definition] entry; return '' (unresolved) if nothing usable is found. */
function _resolveCardName(draftName, bookEntries) {
    const ctx = SillyTavern.getContext();
    const designer = String(ctx.characters?.[ctx.characterId]?.name || '').trim().toLowerCase();
    const clean = String(draftName || '').trim();
    const lc = clean.toLowerCase();
    const bad = !clean || lc === designer || lc === 'generated gm card' || lc === 'generated card';
    if (!bad) return clean;
    const sd = (bookEntries || []).find(e => String(e.comment || '').trim() === (typeof SYSTEM_DEF_COMMENT !== 'undefined' ? SYSTEM_DEF_COMMENT : '[System Definition]'));
    if (sd) {
        const m = String(sd.content || '').match(/\[SYSTEM_DEF_BEGIN\][\s\S]*?\bname:\s*([^\n]+)/i);
        const nm = m && m[1].trim();
        if (nm) return /\bGM\b/i.test(nm) ? nm : `${nm} GM`;
    }
    return '';
}

// The mandatory character-card fields a finalize requires.
var CARD_REQUIRED_FIELDS = ['system_prompt', 'first_mes', 'post_history_instructions'];

/** Pure completeness check for a card draft. Returns the deduped lore entries, the
 *  resolved name, and the list of still-missing required pieces (empty = ready to
 *  ship). Shared by applyCardFinalize (the gate) and autoCompleteCard (the retry). */
function _cardMissing(draft) {
    const { entries: bookEntries, dropped, shallow } = _dedupeBookEntries(draft.book_entries);
    const finalName = _resolveCardName(draft.name, bookEntries);
    const missing = CARD_REQUIRED_FIELDS.filter(k => !String(draft.data[k] || '').trim());
    if (bookEntries.length === 0) missing.push('a non-empty character_book entry');
    if (!finalName) missing.push('a system name (emit [CARD_BEGIN] name: <System> GM)');
    return { bookEntries, finalName, missing, dropped, shallow };
}

function applyCardFinalize() {
    const draft = getCharState().card_draft;
    if (!draft.active) { console.warn(`[${MODULE_NAME}] CARD_FINALIZE outside an active card assembly — ignoring.`); return false; }
    // Clean the lore entries FIRST (drop duplicates + empty shells), so the gate below
    // judges the entries that will actually ship — not raw shells that vanish on
    // assembly (which would otherwise let a 0-entry card through).
    const { bookEntries, finalName, missing, dropped, shallow } = _cardMissing(draft);
    if (dropped.length) {
        console.warn(`[${MODULE_NAME}] CARD_FINALIZE de-duped/dropped ${dropped.length} lore entr${dropped.length === 1 ? 'y' : 'ies'}: ${dropped.join('; ')}`);
        SillyTavern.getContext().toastr?.info(`Removed ${dropped.length} duplicate/empty lore entr${dropped.length === 1 ? 'y' : 'ies'} during assembly.`, 'GM Lore Parser', { timeOut: 5000 });
    }
    if (shallow.length) {
        console.warn(`[${MODULE_NAME}] CARD_FINALIZE: ${shallow.length} lore entr${shallow.length === 1 ? 'y is' : 'ies are'} very short (<${SHALLOW_ENTRY_CHARS} chars): ${shallow.join('; ')}`);
    }
    // Completeness gate: refuse to assemble a structurally broken card. A finalize is
    // only honored once the mandatory fields and at least one REAL lore entry survive —
    // otherwise the draft stays active so emission can continue (mirrors the item-box
    // gate: reject the bad state rather than produce it).
    if (missing.length) {
        console.warn(`[${MODULE_NAME}] CARD_FINALIZE blocked — incomplete card (missing: ${missing.join(', ')}). Draft stays open.`);
        SillyTavern.getContext().toastr?.warning(`Card not finalized — still missing: ${missing.join(', ')}. Keep emitting, then finalize.`, 'GM Lore Parser', { timeOut: 6000 });
        return false;
    }
    // Non-blocking: a produced card with no [System Definition] entry won't auto-load
    // its ruleset (the GM would have to re-emit [SYSTEM_DEF] at play time).
    const hasSysDefEntry = bookEntries.some(e => String(e.comment || '').trim() === (typeof SYSTEM_DEF_COMMENT !== 'undefined' ? SYSTEM_DEF_COMMENT : '[System Definition]') && /\[SYSTEM_DEF_BEGIN\]/.test(e.content || ''));
    if (!hasSysDefEntry) {
        console.warn(`[${MODULE_NAME}] CARD_FINALIZE: no [System Definition] entry — produced card won't hydrate its ruleset on load.`);
        SillyTavern.getContext().toastr?.warning('Card has no [System Definition] lore entry — its ruleset won\'t auto-load. Add one (content = the [SYSTEM_DEF] block).', 'GM Lore Parser', { timeOut: 7000 });
    }
    const data = { ...draft.data, name: finalName, character_version: VERSION };
    if (typeof data.tags === 'string') data.tags = data.tags.split(',').map(s => s.trim()).filter(Boolean);
    data.character_book = {
        name: `${finalName} Lore`, description: '', scan_depth: 4, token_budget: 2000, recursive_scanning: true,
        entries: bookEntries.map((e, i) => ({
            id: i, keys: e.keys, secondary_keys: [], comment: e.comment, content: e.content,
            constant: e.constant, selective: false, insertion_order: e.order, enabled: true,
            position: 'before_char', extensions: {},
        })),
    };
    const card = { spec: 'chara_card_v2', spec_version: '2.0', data };
    let name;
    try { name = _downloadCardJson(card); }
    catch (e) { console.error(`[${MODULE_NAME}] CARD_FINALIZE assembly error:`, e); SillyTavern.getContext().toastr?.error('Card assembly failed', 'GM Lore Parser'); return false; }
    draft.active = false;
    SillyTavern.getContext().toastr?.success(`Card "${name}" assembled & downloaded (${data.character_book.entries.length} lore entries)`, 'GM Lore Parser', { timeOut: 5000 });
    console.log(`[${MODULE_NAME}] Card assembly finalized: "${name}".`);
    return true;
}

/** The block a model should emit to supply a missing required field. */
function _cardFieldTemplate(key) {
    return `[CARD_FIELD_BEGIN]\nkey: ${key}\n\n<real ${key.replace(/_/g, ' ')} content>\n[CARD_FIELD_END]`;
}

/** Auto-retry the completeness gate (Multihog-style validate→retry, adapted to GLP's
 *  block flow). When a [CARD_FINALIZE] is blocked, ask the model — via personaless
 *  generateRaw — for ONLY the missing card-assembly blocks, harvest + apply them to the
 *  open draft, and re-attempt finalize. Bounded by cardAutoRetryMax; stops early if a
 *  round makes no progress. Never throws. Returns true iff the card finalized as a
 *  result. Falls back to the manual-nudge toast when it can't complete. */
async function autoCompleteCard(settings) {
    if (settings.cardAutoRetry === false) return false;
    if (window.__glpCardRetrying) return false;
    const ctx = SillyTavern.getContext();
    if (typeof ctx.generateRaw !== 'function') return false;
    const draft = getCharState().card_draft;
    if (!draft || !draft.active) return false;

    const MAX = Math.max(1, parseInt(settings.cardAutoRetryMax) || 2);
    draft.auto_retries = draft.auto_retries || 0;

    try {
        window.__glpCardRetrying = true;
        while (draft.auto_retries < MAX) {
            const { missing } = _cardMissing(draft);
            if (!missing.length) break;
            draft.auto_retries++;

            // Focused, block-only request for exactly what's missing.
            const wantName   = missing.some(m => m.startsWith('a system name'));
            const wantEntry  = missing.some(m => m.startsWith('a non-empty character_book'));
            const wantFields = missing.filter(m => /^[a-z_]+$/.test(m));   // field keys only
            const templates = [];
            if (wantName) templates.push('[CARD_BEGIN]\nname: <System> GM\n[CARD_END]');
            for (const k of wantFields) templates.push(_cardFieldTemplate(k));
            if (wantEntry) templates.push('[CARD_BOOK_ENTRY_BEGIN]\nkeys: <comma,separated,triggers>\ncomment: [System Definition]\nconstant: true\n\n<lore entry content — e.g. the [SYSTEM_DEF] block or a piece of world lore>\n[CARD_BOOK_ENTRY_END]');

            const present = Object.keys(draft.data || {}).filter(k => String(draft.data[k] || '').trim());
            const already = [
                draft.name ? `Card name: ${draft.name}` : '',
                present.length ? `Fields already present: ${present.join(', ')}` : '',
                `Lore entries so far: ${(draft.book_entries || []).length}`,
                draft.data?.system_prompt ? `system_prompt (excerpt): ${String(draft.data.system_prompt).slice(0, 600)}` : '',
            ].filter(Boolean).join('\n');

            const systemPrompt = 'You are finishing a partially-built SillyTavern character card for the gm-lore-parser extension. Output ONLY the requested card-assembly blocks as literal square-bracket tags — each block opened AND closed with its matching _END tag. Write real, coherent content that fits the card (never placeholders). No prose, no commentary, no markdown before/after the blocks.';
            const prompt = [
                'The card is missing the pieces below. Emit each as its block, in order, with real content:',
                ...missing.map(m => `- ${m}`),
                '',
                'Use EXACTLY these block shapes (replace every <...> with real content):',
                ...templates,
                '',
                'What is already built (make new content consistent with it):',
                already || '(nothing yet)',
            ].join('\n');

            let out = '';
            try { out = await ctx.generateRaw({ prompt, systemPrompt, responseLength: 1200 }); }
            catch (e) { console.warn(`[${MODULE_NAME}] card auto-retry generateRaw failed:`, e); break; }
            glpRecordPass({ kind: 'card-retry', promptText: `${systemPrompt}\n${prompt}`, outputText: out || '' });
            const harvested = _normalizeBlockTags(_stripCodeFences(out || ''));

            let applied = 0;
            for (const b of extractBlocks(harvested, SHEET_BLOCKS.CARD_BEGIN.begin, SHEET_BLOCKS.CARD_BEGIN.end))
                { applyCardBegin(b.raw); applied++; }
            for (const b of extractBlocks(harvested, SHEET_BLOCKS.CARD_FIELD.begin, SHEET_BLOCKS.CARD_FIELD.end))
                { if (applyCardField(b.raw)) applied++; }
            for (const b of extractBlocks(harvested, SHEET_BLOCKS.CARD_BOOK_ENTRY.begin, SHEET_BLOCKS.CARD_BOOK_ENTRY.end))
                { if (applyCardBookEntry(b.raw)) applied++; }

            console.log(`[${MODULE_NAME}] card auto-retry ${draft.auto_retries}/${MAX}: applied ${applied} block(s) for missing [${missing.join(', ')}].`);
            if (!applied) break;   // no progress — don't keep hammering the model
        }
    } finally {
        window.__glpCardRetrying = false;
    }

    const { missing } = _cardMissing(getCharState().card_draft);
    if (!missing.length) {
        ctx.toastr?.info('Auto-completed the missing card pieces — finalizing.', 'GM Lore Parser', { timeOut: 4000 });
        return applyCardFinalize();
    }
    ctx.toastr?.warning(`Auto-retry couldn't finish the card — still missing: ${missing.join(', ')}. Emit the block(s), then finalize.`, 'GM Lore Parser', { timeOut: 7000 });
    return false;
}

// ── Message handlers ──────────────────────────────────────────────────────────

async function onMessageReceived(messageId) {
    const settings = getSettings();
    if (!settings.enabled) return;
    await loadSystemDefFromLorebook(settings);   // hydrate ruleset cache (idempotent)
    const { chat, toastr } = SillyTavern.getContext();
    const message = chat[messageId]; if (!message) return;
    if (message.is_user && !settings.scanUserMessages) {
        await handlePlayerSheetBlocks(message, messageId, settings);
        return;
    }

    const text = _normalizeBlockTags(_stripCodeFences(message.mes));
    // Self-heal the extractor re-entrancy guard: turns are processed sequentially, so a
    // still-set flag here means a prior extractor generation hung/was interrupted before
    // its finally ran — clear it so the extractor never wedges permanently until reload.
    window.__glpStateExtracting = false;
    const headerChanged = captureHeaderFormat(messageId);   // narrative header (rendered at end)

    // Apply the narrator's own emitted state/lore blocks.
    const applied = await applyStateBlocks(text, settings);
    // Optional 2nd-pass state extractor: recover state an immersive narrator dropped,
    // or maintain state entirely for a pure-prose narrator. No-op unless enabled.
    const extracted = await runStateExtractorPass(text, settings, applied);

    const sheetChanged  = applied.sheetChanged || headerChanged || (extracted?.sheetChanged ?? false);
    const loreSaved     = applied.loreSaved + (extracted?.loreSaved ?? 0);
    const notifications = [...applied.notifications, ...(extracted?.notifications ?? [])];
    await _finishMessage(messageId, text, settings, sheetChanged, loreSaved, notifications);
}

// Apply every gm-lore-parser state/lore block found in `text`, returning the change
// accumulators. Shared by the narrator pass and the optional 2nd-pass extractor so
// both feed the exact same handlers.
async function applyStateBlocks(text, settings) {
    let sheetChanged = false;
    const notifications = [];

    // ── System definition (must apply before any consumer this message) ────────
    for (const b of extractBlocks(text, SHEET_BLOCKS.SYSTEM_DEF.begin, SHEET_BLOCKS.SYSTEM_DEF.end)) {
        await saveSystemDef(parseSystemDef(b.raw), settings);
        sheetChanged = true;
    }

    // ── Entity blocks (player / npc / companion / creature) ────────────────────
    let loreSaved = 0;
    for (const b of extractBlocks(text, SHEET_BLOCKS.ENTITY.begin, SHEET_BLOCKS.ENTITY.end)) {
        const type = entityType(b.raw);
        const ok = await onEntityBegin(b.raw, settings);
        if (!ok) continue;
        if (type === 'player') sheetChanged = true; else loreSaved++;
    }

    for (const b of extractBlocks(text, SHEET_BLOCKS.ENTITY_UPDATE.begin, SHEET_BLOCKS.ENTITY_UPDATE.end)) {
        const type = entityType(b.raw);
        const r = await onEntityUpdate(b.raw, settings);
        if (!r) continue;
        if (type === 'player' || type === 'companion') {
            sheetChanged = true;
            const p = checkPromotions(getCharState().schema?.fields || {}, getCharState().values);
            for (const x of p) notifications.push({ type: 'promotion', msg: x.reason });
        } else {
            loreSaved++;
            if (r.promotions?.length)
                for (const p of r.promotions)
                    notifications.push({ type: 'npc_promotion', msg: `${parseFlatFields(b.raw).name}: ${p.reason}` });
        }
    }

    for (const b of extractBlocks(text, SHEET_BLOCKS.ENTITY_EVENT.begin, SHEET_BLOCKS.ENTITY_EVENT.end)) {
        const type = entityType(b.raw);
        const r = await onEntityEvent(b.raw, settings);
        if (!r || !r.changes?.length) continue;
        if (type === 'player' || type === 'companion') {
            sheetChanged = true;
            notifications.push({ type: 'attr_change', msg: `${r.reason}: ${r.changes.map(c => `${c.key}:${c.oldVal}→${c.newVal}`).join(', ')}` });
        } else {
            loreSaved++;
            notifications.push({ type: 'npc_attr_change', msg: `${parseFlatFields(b.raw).name} — ${r.reason}` });
        }
    }

    for (const b of extractBlocks(text, SHEET_BLOCKS.ENTITY_MEMORY.begin, SHEET_BLOCKS.ENTITY_MEMORY.end))
        if (await onEntityMemory(b.raw, settings)) loreSaved++;

    if (featureOn('capabilities')) {
    for (const b of extractBlocks(text, SHEET_BLOCKS.CAPABILITY.begin, SHEET_BLOCKS.CAPABILITY.end))
        { if (await processCapabilityBlock(parseFields(b.raw), settings)) sheetChanged = true; }

    for (const b of extractBlocks(text, SHEET_BLOCKS.CAPABILITY_UPDATE.begin, SHEET_BLOCKS.CAPABILITY_UPDATE.end)) {
        const n = applyCapabilityUpdate(b.raw);
        if (n.length) { sheetChanged = true; for (const x of n) notifications.push({ type: x.type, msg: x.msg }); }
    }
    }

    if (featureOn('party'))
    for (const b of extractBlocks(text, SHEET_BLOCKS.PARTY_UPDATE.begin, SHEET_BLOCKS.PARTY_UPDATE.end))
        { if (await applyPartyUpdate(b.raw, settings)) sheetChanged = true; }

    if (featureOn('scene'))
    for (const b of extractBlocks(text, SHEET_BLOCKS.SCENE_UPDATE.begin, SHEET_BLOCKS.SCENE_UPDATE.end))
        { if (await applySceneUpdate(b.raw, settings)) sheetChanged = true; }

    if (featureOn('domains'))
    for (const b of extractBlocks(text, SHEET_BLOCKS.DOMAIN_UPDATE.begin, SHEET_BLOCKS.DOMAIN_UPDATE.end))
        { applyDomainUpdate(b.raw); sheetChanged = true; }

    if (featureOn('reputation'))
    for (const b of extractBlocks(text, SHEET_BLOCKS.REPUTATION_UPDATE.begin, SHEET_BLOCKS.REPUTATION_UPDATE.end))
        { if (await applyReputationUpdate(b.raw, settings)) sheetChanged = true; }

    if (featureOn('world_events')) {
    for (const b of extractBlocks(text, SHEET_BLOCKS.WORLD_EVENT.begin, SHEET_BLOCKS.WORLD_EVENT.end))
        { if (await applyWorldEventBlock(b.raw, settings)) sheetChanged = true; }

    for (const b of extractBlocks(text, SHEET_BLOCKS.PLOT_ENTRY.begin, SHEET_BLOCKS.PLOT_ENTRY.end))
        { await processPlotEntry(b.raw, settings); }
    }

    if (featureOn('currency'))
    for (const b of extractBlocks(text, SHEET_BLOCKS.CURRENCY_UPDATE.begin, SHEET_BLOCKS.CURRENCY_UPDATE.end))
        { if (applyCurrencyUpdate(b.raw)) sheetChanged = true; }

    if (featureOn('ranks'))
    for (const b of extractBlocks(text, SHEET_BLOCKS.RANK_CHANGE.begin, SHEET_BLOCKS.RANK_CHANGE.end))
        { if (applyRankChange(b.raw)) sheetChanged = true; }

    for (const b of extractBlocks(text, SHEET_BLOCKS.XP_AWARD.begin, SHEET_BLOCKS.XP_AWARD.end))
        { if (applyXpAward(b.raw)) sheetChanged = true; }

    for (const b of extractBlocks(text, SHEET_BLOCKS.WORLD_TIME.begin, SHEET_BLOCKS.WORLD_TIME.end)) {
        const r = await applyWorldTime(b.raw, settings);
        if (r.playerRegenChanged || r.playerPromotions.length) sheetChanged = true;
        for (const p of r.playerPromotions) notifications.push({ type: 'promotion',     msg: p.reason });
        for (const p of r.npcPromotions)    notifications.push({ type: 'npc_promotion', msg: `${p.npc}: ${p.reason}` });
    }

    for (const b of extractBlocks(text, SHEET_BLOCKS.CARD_OUTPUT.begin, SHEET_BLOCKS.CARD_OUTPUT.end))
        handleCardOutput(b.raw);

    // ── Chunked card assembly ───────────────────────────────────────────────────
    for (const b of extractBlocks(text, SHEET_BLOCKS.CARD_BEGIN.begin, SHEET_BLOCKS.CARD_BEGIN.end))
        { applyCardBegin(b.raw); sheetChanged = true; }
    for (const b of extractBlocks(text, SHEET_BLOCKS.CARD_FIELD.begin, SHEET_BLOCKS.CARD_FIELD.end))
        { if (applyCardField(b.raw)) sheetChanged = true; }
    for (const b of extractBlocks(text, SHEET_BLOCKS.CARD_BOOK_ENTRY.begin, SHEET_BLOCKS.CARD_BOOK_ENTRY.end))
        { if (applyCardBookEntry(b.raw)) sheetChanged = true; }
    for (const b of extractBlocks(text, SHEET_BLOCKS.CARD_FINALIZE.begin, SHEET_BLOCKS.CARD_FINALIZE.end)) {
        if (applyCardFinalize()) sheetChanged = true;
        else if (await autoCompleteCard(settings)) sheetChanged = true;
    }

    // ── Character creation blocks ──────────────────────────────────────────────
    for (const b of extractBlocks(text, SHEET_BLOCKS.CHAR_CREATE_BEGIN.begin, SHEET_BLOCKS.CHAR_CREATE_BEGIN.end))
        { applyCharCreateBegin(b.raw); sheetChanged = true; }

    for (const b of extractBlocks(text, SHEET_BLOCKS.CHAR_CREATE_STEP.begin, SHEET_BLOCKS.CHAR_CREATE_STEP.end))
        { if (await applyCharCreateStep(b.raw, settings)) sheetChanged = true; }

    for (const b of extractBlocks(text, SHEET_BLOCKS.CHAR_CREATE_FINALIZE.begin, SHEET_BLOCKS.CHAR_CREATE_FINALIZE.end))
        { applyCharCreateFinalize(b.raw); sheetChanged = true; }

    // ── Needs blocks ───────────────────────────────────────────────────────────
    if (featureOn('needs')) {
    for (const b of extractBlocks(text, SHEET_BLOCKS.NEEDS_SYSTEM.begin, SHEET_BLOCKS.NEEDS_SYSTEM.end))
        { applyNeedsSystem(b.raw); sheetChanged = true; }

    for (const b of extractBlocks(text, SHEET_BLOCKS.NEEDS_UPDATE.begin, SHEET_BLOCKS.NEEDS_UPDATE.end))
        { if (applyNeedsUpdate(b.raw)) sheetChanged = true; }
    }

    for (const b of extractBlocks(text, SHEET_BLOCKS.ITEM_BOX_UPDATE.begin, SHEET_BLOCKS.ITEM_BOX_UPDATE.end))
        { if (applyItemBoxUpdate(b.raw)) sheetChanged = true; }

    // ── Lore blocks (Location / Faction / Item / Rule / Event / Quest) ─────────
    if (settings.campaignLorebook) {
        for (const [type, cfg] of Object.entries(LORE_BLOCKS)) {
            for (const b of extractBlocks(text, cfg.begin, cfg.end)) {
                const fields = parseFields(b.raw); fields._raw = b.raw;
                let ok = false;
                if (type === 'ITEM')          ok = await processItemBlock(fields, settings);
                else if (type === 'LOCATION') ok = await processLocationBlock(fields, settings);
                else if (type === 'QUEST')    { if (featureOn('quests')) ok = await processQuestBlock(fields, settings); }
                else if (type === 'FACTION')  { if (featureOn('reputation')) ok = await processFactionBlock(fields, settings); }
                else ok = await processGenericLore(type, cfg, fields, settings);
                if (ok) loreSaved++;
            }
        }

        for (const b of extractBlocks(text, UPDATE_BLOCKS.ITEM_UPDATE.begin, UPDATE_BLOCKS.ITEM_UPDATE.end))
            if (await processItemUpdate(b.raw, settings)) loreSaved++;

        if (featureOn('quests'))
        for (const b of extractBlocks(text, UPDATE_BLOCKS.QUEST_UPDATE.begin, UPDATE_BLOCKS.QUEST_UPDATE.end))
            if (await applyQuestUpdate(b.raw, settings)) loreSaved++;

        if (featureOn('reputation'))
        for (const b of extractBlocks(text, UPDATE_BLOCKS.FACTION_UPDATE.begin, UPDATE_BLOCKS.FACTION_UPDATE.end))
            if (await processFactionUpdate(b.raw, settings)) loreSaved++;

        if (featureOn('world_events'))
        for (const b of extractBlocks(text, UPDATE_BLOCKS.WORLD_EVENT_UPDATE.begin, UPDATE_BLOCKS.WORLD_EVENT_UPDATE.end))
            if (await applyWorldEventUpdate(b.raw, settings)) loreSaved++;

        for (const b of extractBlocks(text, UPDATE_BLOCKS.LOCATION_MEMORY.begin, UPDATE_BLOCKS.LOCATION_MEMORY.end))
            if (await processLocationMemory(b.raw, settings)) loreSaved++;
    }

    return { sheetChanged, loreSaved, notifications };
}

// Finalize a processed message: persist state, refresh UI, emit notifications, hide
// raw blocks, render the narrative header, and run autonomous-memory hooks. Split out
// of onMessageReceived so the narrator pass and the 2nd-pass extractor share one commit.
async function _finishMessage(messageId, text, settings, sheetChanged, loreSaved, notifications) {
    const { toastr } = SillyTavern.getContext();

    // ── Post-processing ───────────────────────────────────────────────────────
    if (sheetChanged) {
        await saveCharState(); refreshStatusPanel(); injectCharacterContext(); await rebuildPlayerLoreEntries(settings);
        if (settings.notifyOnSave && toastr) {
            toastr.info('Character sheet updated', 'GM Lore Parser', { timeOut: 2000, positionClass: 'toast-bottom-right' });
            for (const n of notifications) {
                const isGood = ['tier','promotion','npc_promotion','branch','level'].includes(n.type);
                if (isGood)
                    toastr.success(n.msg, 'GM Lore Parser', { timeOut: 6000, positionClass: 'toast-bottom-right' });
                else if (['attr_change','npc_attr_change'].includes(n.type))
                    toastr.info(n.msg, 'GM Lore Parser', { timeOut: 5000, positionClass: 'toast-bottom-right' });
            }
        }
    }
    if (loreSaved > 0 && settings.notifyOnSave && toastr)
        toastr.success(`${loreSaved} ${loreSaved === 1 ? 'entry' : 'entries'} saved`, 'GM Lore Parser',
            { timeOut: 3000, positionClass: 'toast-bottom-right' });

    if (settings.hideBlocks) {
        const c = stripAllBlocks(text);
        if (c !== text) rerenderMessage(messageId, c);
    }

    // ── Narrative header: render + prepend after the message text is finalized ──
    applyNarrativeHeader(messageId);

    // ── Autonomous memory: periodic scene capture + snapshot for chat-away flush ──
    await _glpAutoMemoryPeriodic(settings);
    _glpCaptureSceneSnapshot(settings);
}

// ── Optional 2nd-pass state extractor (dual-model, Multihog-style) ─────────────
// The narrator writes prose; a separate extraction pass reads that prose + current
// state and emits the gm-lore-parser update blocks the narration implies, which then
// flow through the SAME handlers (applyStateBlocks). This removes the block-emission
// burden from an immersive narrator — GLP's most fragile point. Fully opt-in.

/** Route a headless extraction generation: through a chosen ST connection profile when
 *  one is set (a cheaper/faster extractor model, silent — no UI flicker), else the
 *  active model via generateRaw. Returns raw text, or '' on any failure. Never throws. */
async function runStateExtraction(systemPrompt, userPrompt, settings) {
    const ctx = SillyTavern.getContext();
    const profileId = String(settings.stateExtractorProfileId || '').trim();
    if (profileId) {
        const service = ctx.ConnectionManagerRequestService;
        if (service && typeof service.sendRequest === 'function') {
            try {
                const raw = await service.sendRequest(
                    profileId,
                    [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
                    undefined,
                    { stream: false, extractData: true, includePreset: true, includeInstruct: true },
                );
                if (typeof raw === 'string') return raw;
                return raw?.content ?? raw?.message?.content ?? raw?.choices?.[0]?.message?.content ?? raw?.choices?.[0]?.text ?? '';
            } catch (e) {
                console.warn(`[${MODULE_NAME}] state-extractor profile "${profileId}" failed; falling back to generateRaw:`, e);
            }
        } else {
            console.warn(`[${MODULE_NAME}] ConnectionManagerRequestService unavailable; state extractor using the active model.`);
        }
    }
    if (typeof ctx.generateRaw !== 'function') return '';
    try { return (await ctx.generateRaw({ prompt: userPrompt, systemPrompt, responseLength: 600 })) || ''; }
    catch (e) { console.warn(`[${MODULE_NAME}] state-extractor generateRaw failed:`, e); return ''; }
}

/** Run the 2nd-pass extractor over the narrator's latest message and apply whatever
 *  blocks it emits through the shared handlers. Gated by stateExtractorMode: 'off'
 *  (skip), 'fallback' (only when the narrator emitted no state blocks), 'always'.
 *  Re-entrancy guarded; never throws. Returns the applied accumulators, or null. */
async function runStateExtractorPass(narratorText, settings, priorResult) {
    const mode = settings.stateExtractorMode || 'off';
    if (mode === 'off') return null;
    if (mode === 'fallback' && (priorResult?.sheetChanged || priorResult?.loreSaved > 0)) return null;
    if (window.__glpStateExtracting) return null;
    if (!String(narratorText || '').trim()) return null;

    const def = getSystemDef();
    const stateSummary = (typeof buildContextString === 'function' && buildContextString(getCharState())) || '';
    const cheatSheet = (typeof buildBlockFormatEntries === 'function')
        ? buildBlockFormatEntries(def, settings).map(e => e.content).join('\n\n') : '';

    const systemPrompt = 'You are a game-state extractor for a tabletop RPG. Read the GM narration and the current character/world state, then output ONLY the gm-lore-parser update blocks that the narration IMPLIES actually changed (damage/healing, attribute or condition changes, currency, reputation, needs, party/scene changes, new items/quests, time passing, etc.). Output ONLY literal [BLOCK_BEGIN]…[BLOCK_END] tags exactly as shown in the formats — no prose, no commentary, no markdown. If nothing changed, output nothing.';
    const userPrompt = [
        stateSummary ? `CURRENT STATE:\n${stateSummary}` : '',
        cheatSheet   ? `BLOCK FORMATS (copy the shape; change the values):\n${cheatSheet}` : '',
        `GM NARRATION (extract state changes from this):\n${narratorText}`,
    ].filter(Boolean).join('\n\n');

    try {
        window.__glpStateExtracting = true;
        const out = await runStateExtraction(systemPrompt, userPrompt, settings);
        glpRecordPass({ kind: 'extractor', promptText: `${systemPrompt}\n${userPrompt}`, outputText: out || '' });
        const blocks = _normalizeBlockTags(_stripCodeFences(out || ''));
        if (!blocks.trim()) return null;
        const res = await applyStateBlocks(blocks, settings);
        if (res.sheetChanged || res.loreSaved)
            console.log(`[${MODULE_NAME}] 2nd-pass extractor applied blocks (sheet:${res.sheetChanged}, lore:${res.loreSaved}).`);
        return res;
    } catch (e) {
        console.warn(`[${MODULE_NAME}] state extractor pass failed:`, e);
        return null;
    } finally {
        window.__glpStateExtracting = false;
    }
}

/** Periodic auto-memory: every N GM turns, summarize the current scene into an episodic
 *  memory (keyed to the scene location if set, else the present subjects). Opt-in;
 *  fires in the background so it never delays the message pipeline. */
async function _glpAutoMemoryPeriodic(settings) {
    if (!settings.autoMemory || !settings.autoMemoryPeriodic || typeof autoWriteSubjectMemory !== 'function') return;
    const st = getCharState();
    const N  = Math.max(2, parseInt(settings.autoMemoryEveryNMessages) || 20);
    st.auto_mem_turns = (st.auto_mem_turns || 0) + 1;
    if (st.auto_mem_turns < N) return;
    const chatLen = (SillyTavern.getContext().chat || []).length;
    const since   = st.auto_mem_last_index ?? Math.max(0, chatLen - N);
    st.auto_mem_turns = 0;
    st.auto_mem_last_index = chatLen;
    (async () => {
        try {
            if (st.scene_location) await autoWriteSubjectMemory(st.scene_location, 'location', since, settings, 'periodic');
            else for (const m of Object.values(st.scene || {}).slice(0, 3))
                await autoWriteSubjectMemory(m.name, 'npc', since, settings, 'periodic');
        } catch (e) { /* background */ }
    })();
}

/** Capture a lightweight snapshot of the current scene + recent transcript so the
 *  chat-away trigger can summarize the chat we just left (by the time CHAT_CHANGED
 *  fires, ctx.chat is already the new chat). Only when the chat-away trigger is on. */
function _glpCaptureSceneSnapshot(settings) {
    if (!settings.autoMemory || !settings.autoMemoryOnChatAway) { window.__glpSceneSnapshot = null; return; }
    const ctx  = SillyTavern.getContext();
    const st   = getCharState();
    const full = ctx.chat || [];
    const base = Math.max(0, full.length - 120);   // cap the copy to the last 120 messages
    window.__glpSceneSnapshot = {
        chatId:     ctx.getCurrentChatId?.(),
        scene:      Object.values(st.scene || {}).map(m => ({ name: m.name, since_msg: m.since_msg })),
        location:   st.scene_location,
        locSince:   st.scene_location_since,
        baseIndex:  base,
        transcript: full.slice(base).map(m => ({ is_user: !!m.is_user, name: m.name, mes: (m.mes || '') })),
    };
}

/** Chat-away flush: on leaving a chat, write an episodic memory for each still-present
 *  subject (and the location) from the snapshot of the chat we left. Background/serialized. */
async function _glpFlushChatAwayMemory() {
    const snap = window.__glpSceneSnapshot;
    window.__glpSceneSnapshot = null;
    const settings = getSettings();
    if (!snap || !settings.autoMemory || !settings.autoMemoryOnChatAway || typeof autoWriteSubjectMemory !== 'function') return;
    if (snap.chatId && snap.chatId === SillyTavern.getContext().getCurrentChatId?.()) return; // not actually a switch
    if (!(snap.scene || []).length && !snap.location) return;
    const slice = (sinceIdx) => {
        const rel = Math.max(0, (typeof sinceIdx === 'number' ? sinceIdx : snap.baseIndex) - snap.baseIndex);
        return snap.transcript.slice(rel)
            .map(m => `${m.is_user ? 'User' : (m.name || 'GM')}: ${(m.mes || '').trim()}`)
            .filter(l => l.length > 5).join('\n');
    };
    for (const m of (snap.scene || [])) await autoWriteSubjectMemory(m.name, 'npc', null, settings, 'chat-away', slice(m.since_msg));
    if (snap.location) await autoWriteSubjectMemory(snap.location, 'location', null, settings, 'chat-away', slice(snap.locSince));
}

async function onUserMessageRendered(messageId) {
    const settings = getSettings(); if (!settings.enabled) return;
    const { chat }  = SillyTavern.getContext();
    const message   = chat[messageId]; if (!message || !message.is_user) return;

    if (settings.interceptCommands && message.mes?.trim().startsWith('#')) {
        const response = tryHandleCommand(message.mes);
        if (response) { injectCommandResponse(response, messageId); return; }
    }
    await handlePlayerSheetBlocks(message, messageId, settings);
}

/** Player may paste a player [ENTITY_BEGIN] block in their own message. */
async function handlePlayerSheetBlocks(message, messageId, settings) {
    await loadSystemDefFromLorebook(settings);
    const blocks = extractBlocks(message.mes, SHEET_BLOCKS.ENTITY.begin, SHEET_BLOCKS.ENTITY.end);
    if (!blocks.length) return;
    let applied = false;
    for (const b of blocks) {
        if (entityType(b.raw) !== 'player') continue;
        await onEntityBegin(b.raw, settings);
        applied = true;
    }
    if (!applied) return;
    await saveCharState(); refreshStatusPanel(); injectCharacterContext(); await rebuildPlayerLoreEntries(settings);
    if (settings.hideBlocks) {
        let c = message.mes;
        for (const b of blocks) c = c.replace(b.fullMatch, '');
        rerenderMessage(messageId, c.trim());
    }
}

function onGenerationStarted() { injectCharacterContext(); }
async function onChatChanged() {
    _glpFlushChatAwayMemory().catch(() => {});   // flush a memory for the chat we just left (opt-in, background)
    await loadSystemDefFromLorebook(getSettings());
    await linkCampaignBooks(getSettings());   // ensure all generated campaign books are WI-active for this chat
    const st = getCharState();
    if (st.name) augmentSchemaWithDefAttributes(st.schema, st.values);   // backfill panel fields for def attributes (existing chars / def changes)
    refreshStatusPanel();
    injectCharacterContext();
    await rebuildPlayerLoreEntries(getSettings());
}

// ── Settings UI ───────────────────────────────────────────────────────────────

async function renderSettingsPanel() {
    const { world_names } = SillyTavern.getContext();
    const settings = getSettings();
    const opts = (world_names || []).map(n =>
        `<option value="${n}" ${n === settings.campaignLorebook ? 'selected' : ''}>${n}</option>`
    ).join('');

    // Connection profiles for the optional 2nd-pass extractor (blank = same as narrator).
    const _profiles = SillyTavern.getContext().extensionSettings?.connectionManager?.profiles || [];
    const extractorProfileOpts = _profiles.map(p =>
        `<option value="${p.id}" ${p.id === settings.stateExtractorProfileId ? 'selected' : ''}>${p.name || p.id}</option>`
    ).join('');
    const em = settings.stateExtractorMode || 'off';

    const html = `
<div class="glp-settings">
  <div class="inline-drawer">
    <div class="inline-drawer-toggle inline-drawer-header">
      <b>GM Lore Parser</b>
      <div class="flex-container alignItemsCenter" style="gap:8px;margin-inline-start:auto;">
        <div id="glp-settings-popout" class="fa-solid fa-window-restore interactable" title="Pop out settings" tabindex="0"></div>
        <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
      </div>
    </div>
    <div class="inline-drawer-content">
      <label class="glp-row"><input type="checkbox" id="glp-enabled" ${settings.enabled ? 'checked' : ''}><span>Enable GM Lore Parser</span></label>
      <div class="glp-field-setting">
        <label for="glp-lorebook">Campaign Lorebook</label>
        <select id="glp-lorebook" class="text_pole"><option value="">— Select —</option>${opts}</select>
        <small>All lore entries written here. NPC memories → per-NPC lorebooks (auto-created).</small>
      </div>
      <label class="glp-row"><input type="checkbox" id="glp-hide"      ${settings.hideBlocks       ? 'checked' : ''}><span>Hide raw blocks from chat</span></label>
      <label class="glp-row"><input type="checkbox" id="glp-notify"    ${settings.notifyOnSave     ? 'checked' : ''}><span>Show toast notifications</span></label>
      <label class="glp-row"><input type="checkbox" id="glp-scan-user" ${settings.scanUserMessages ? 'checked' : ''}><span>Scan user messages for lore blocks</span></label>
      <label class="glp-row"><input type="checkbox" id="glp-intercept" ${settings.interceptCommands? 'checked' : ''}><span>Intercept # commands</span></label>
      <details class="glp-settings-group"><summary>Panels</summary>
      <label class="glp-row"><input type="checkbox" id="glp-show-panel"    ${settings.showStatusPanel  ? 'checked' : ''}><span>Character status panel</span></label>
      <label class="glp-row"><input type="checkbox" id="glp-show-skills"   ${settings.showSkillPanel   ? 'checked' : ''}><span>Skill panel</span></label>
      <label class="glp-row"><input type="checkbox" id="glp-show-domain"   ${settings.showDomainPanel  ? 'checked' : ''}><span>Domain panel</span></label>
      <label class="glp-row"><input type="checkbox" id="glp-show-quests"   ${settings.showQuestPanel   ? 'checked' : ''}><span>Quest panel</span></label>
      <label class="glp-row"><input type="checkbox" id="glp-show-rep"      ${settings.showRepPanel     ? 'checked' : ''}><span>Reputation panel</span></label>
      <label class="glp-row"><input type="checkbox" id="glp-show-events"   ${settings.showEventsPanel  ? 'checked' : ''}><span>World events panel</span></label>
      <label class="glp-row"><input type="checkbox" id="glp-show-currency" ${settings.showCurrencyPanel? 'checked' : ''}><span>Currency &amp; companions panel</span></label>
      <label class="glp-row"><input type="checkbox" id="glp-show-boons"    ${settings.showBoonPanel    ? 'checked' : ''}><span>Abilities &amp; titles panel</span></label>
      <label class="glp-row"><input type="checkbox" id="glp-show-needs"    ${settings.showNeedsPanel   ? 'checked' : ''}><span>Needs panel</span></label>
      <label class="glp-row"><input type="checkbox" id="glp-show-scene"    ${settings.showScenePanel!==false ? 'checked' : ''}><span>Scene panel</span></label>
      <label class="glp-row"><input type="checkbox" id="glp-show-party"    ${settings.showPartyPanel!==false ? 'checked' : ''}><span>Party panel</span></label>
      </details>
      <details class="glp-settings-group"><summary>Narrative Header</summary>
      <label class="glp-row"><input type="checkbox" id="glp-hdr-enabled"   ${settings.headerEnabled!==false ? 'checked' : ''}><span>Prepend status header to GM messages</span></label>
      <label class="glp-row"><input type="checkbox" id="glp-hdr-block"     ${settings.headerUseFormatBlock!==false ? 'checked' : ''}><span>Use [HEADER_FORMAT] block when present</span></label>
      <label class="glp-row"><input type="checkbox" id="glp-hdr-every"     ${settings.headerShowOnEveryMsg!==false ? 'checked' : ''}><span>Show on every GM message</span></label>
      <div class="glp-field-setting">
        <label for="glp-hdr-sep">Header separator</label>
        <input type="text" id="glp-hdr-sep" class="text_pole" value="${(settings.headerSeparator ?? '---')}">
      </div>
      <div class="glp-field-setting">
        <label for="glp-hdr-manual">Manual header format (fallback)</label>
        <textarea id="glp-hdr-manual" class="text_pole" rows="2" placeholder="{name}  HP {hp}/{hp_max}  {conditions}  {time}">${settings.headerManualFormat || ''}</textarea>
      </div>
      </details>
      <details class="glp-settings-group"><summary>Context &amp; lore injection</summary>
      <div class="glp-field-setting">
        <label for="glp-plot-lorebook">Plot Lorebook (optional)</label>
        <select id="glp-plot-lorebook" class="text_pole"><option value="">— auto (campaign-plot) —</option>${opts}</select>
        <small>Plot entries go here. Auto-created if blank.</small>
      </div>
      <label class="glp-row"><input type="checkbox" id="glp-inject-ctx"   ${settings.injectIntoContext?'checked' : ''}><span>Inject state into context</span></label>
      <label class="glp-row"><input type="checkbox" id="glp-inject-res"   ${settings.injectResolution!==false?'checked' : ''}><span>Inject resolution mechanic into context</span></label>
      <label class="glp-row"><input type="checkbox" id="glp-tiered-ctx"   ${settings.tieredContext!==false?'checked' : ''}><span>Tiered context (lean core + keyword-triggered detail)</span></label>
      <label class="glp-row"><input type="checkbox" id="glp-rules-digest" ${settings.alwaysOnRulesDigest!==false?'checked' : ''}><span>Always-on rules digest (subsystem params in [System Definition])</span></label>
      <label class="glp-row"><input type="checkbox" id="glp-full-rules"   ${settings.fullRulesAlwaysOn===true?'checked' : ''}><span>Full rules always-on (promote [System Rule] entries to constant)</span></label>
      <div class="glp-field-setting">
        <label for="glp-ctx-depth">Context injection depth</label>
        <input type="number" id="glp-ctx-depth" class="text_pole" min="0" max="20" value="${settings.contextDepth}">
      </div>
      </details>
      <details class="glp-settings-group"><summary>Memory &amp; tools</summary>
      <label class="glp-row"><input type="checkbox" id="glp-enrich-mem" ${settings.enrichMemories ? 'checked' : ''}><span>Enrich memory content (summarize the scene into memory blocks)</span></label>
      <div class="glp-field-setting">
        <label for="glp-enrich-window">Memory enrichment window (messages)</label>
        <input type="number" id="glp-enrich-window" class="text_pole" min="2" max="50" value="${settings.enrichMemoryWindow ?? 10}">
      </div>
      <label class="glp-row"><input type="checkbox" id="glp-use-tools" ${settings.useFunctionTools ? 'checked' : ''}><span>Function tools for state changes (chat-completion backends)</span></label>
      <label class="glp-row"><input type="checkbox" id="glp-card-autoretry" ${settings.cardAutoRetry!==false ? 'checked' : ''}><span>Auto-complete card assembly (headless retry for missing [CARD_*] blocks on finalize)</span></label>
      <div class="glp-field-setting">
        <label for="glp-card-autoretry-max">Card auto-retry rounds</label>
        <input type="number" id="glp-card-autoretry-max" class="text_pole" min="1" max="5" value="${settings.cardAutoRetryMax ?? 2}">
      </div>
      <div class="glp-field-setting">
        <label for="glp-extractor-mode">2nd-pass state extractor</label>
        <select id="glp-extractor-mode" class="text_pole">
          <option value="off"      ${em==='off'      ? 'selected' : ''}>Off (narrator emits its own blocks)</option>
          <option value="fallback" ${em==='fallback' ? 'selected' : ''}>Fallback (only when the narrator emits none)</option>
          <option value="always"   ${em==='always'   ? 'selected' : ''}>Always (pure-prose narrator)</option>
        </select>
        <small>A separate pass reads the GM's prose + current state and emits the state blocks itself — fixes an immersive narrator dropping blocks. Uses a personaless side-generation.</small>
      </div>
      <div class="glp-field-setting">
        <label for="glp-extractor-profile">Extractor connection profile</label>
        <select id="glp-extractor-profile" class="text_pole"><option value="">— same model as narrator —</option>${extractorProfileOpts}</select>
        <small>Optional: run the extraction pass on a cheaper/faster model (a SillyTavern Connection Profile).</small>
      </div>
      <label class="glp-row"><input type="checkbox" id="glp-telemetry" ${settings.telemetryEnabled ? 'checked' : ''}><span>Measure side-generation token cost (extractor / memory / card-retry)</span></label>
      <div class="glp-field-setting">
        <div id="glp-telemetry-readout"><small>${settings.telemetryEnabled ? 'Enabled — send a few turns, then Refresh.' : 'Off — enable to accumulate per-chat token/cost for GLP&#39;s own model calls.'}</small></div>
        <div class="flex-container" style="gap:6px;margin-top:4px;">
          <div id="glp-telemetry-refresh" class="menu_button menu_button_icon"><i class="fa-solid fa-arrows-rotate"></i><span>Refresh</span></div>
          <div id="glp-telemetry-reset" class="menu_button menu_button_icon"><i class="fa-solid fa-trash-can"></i><span>Reset</span></div>
        </div>
      </div>
      </details>
      <details class="glp-settings-group"><summary>Autonomous memory capture</summary>
      <label class="glp-row"><input type="checkbox" id="glp-auto-mem" ${settings.autoMemory ? 'checked' : ''}><span>Auto-create memories from the transcript (even when no memory block is emitted)</span></label>
      <div class="glp-field-setting"><small>Summarizes the recent scene into a <b>[Memory]</b> entry for the relevant subject/location via a personaless side-generation (same summarizer as enrichment). Writes nothing on failure. Each auto memory is tagged <code>auto</code>. All triggers below require this master switch.</small></div>
      <label class="glp-row glp-auto-mem-sub"><input type="checkbox" id="glp-auto-mem-scene-exit" ${settings.autoMemoryOnSceneExit ? 'checked' : ''}><span>…when a subject leaves the scene (their time on-screen)</span></label>
      <label class="glp-row glp-auto-mem-sub"><input type="checkbox" id="glp-auto-mem-loc-change" ${settings.autoMemoryOnLocationChange ? 'checked' : ''}><span>…when the scene location changes (the previous location)</span></label>
      <label class="glp-row glp-auto-mem-sub"><input type="checkbox" id="glp-auto-mem-away" ${settings.autoMemoryOnChatAway ? 'checked' : ''}><span>…on leaving the chat (still-present subjects)</span></label>
      <label class="glp-row glp-auto-mem-sub"><input type="checkbox" id="glp-auto-mem-periodic" ${settings.autoMemoryPeriodic ? 'checked' : ''}><span>…periodically, every N GM turns (the current scene)</span></label>
      <div class="glp-two-col">
        <div class="glp-field-setting"><label for="glp-auto-mem-every">Periodic cadence (GM turns)</label><input type="number" id="glp-auto-mem-every" class="text_pole" min="2" max="200" value="${settings.autoMemoryEveryNMessages ?? 20}"></div>
        <div class="glp-field-setting"><label for="glp-auto-mem-min">Min messages to summarize</label><input type="number" id="glp-auto-mem-min" class="text_pole" min="1" max="50" value="${settings.autoMemoryMinMessages ?? 4}"></div>
      </div>
      <div class="glp-field-setting">
        <small><b>Semantic recall:</b> to retrieve memories by meaning (not just keywords), enable SillyTavern's built-in <b>Vector Storage → Vectorize All / World Info</b> against your Campaign Lorebook (the local <i>transformers</i> source works offline). Enrich memory content above for best results.</small>
      </div>
      </details>
      <details class="glp-settings-group"><summary>Advanced</summary>
      <div class="glp-two-col">
        <div class="glp-field-setting"><label>Scan depth</label><input  type="number" id="glp-scan-depth"  class="text_pole" min="1" max="20"  value="${settings.defaultScanDepth}"></div>
        <div class="glp-field-setting"><label>Lore order</label><input  type="number" id="glp-lore-order"  class="text_pole" min="1" max="999" value="${settings.loreOrder}"></div>
        <div class="glp-field-setting"><label>Rule order</label><input  type="number" id="glp-rule-order"  class="text_pole" min="1" max="999" value="${settings.ruleOrder}"></div>
      </div>
      </details>
      <details class="glp-settings-group"><summary>About &amp; changelog</summary>
      <div class="glp-info">
        <b>v0.0.20 (beta) — modular build.</b> A lorebook-hosted <b>[SYSTEM_DEF]</b> declares the ruleset; a unified <b>[ENTITY]</b> engine drives player/NPC/companion/creature; <b>[CAPABILITY]</b> unifies boons/titles/passives/traits/evolution/skills.<br>
        <b>v0.0.20:</b> the constant <b>[System Definition]</b> entry now carries an always-on <b>rules digest</b> (tier names/scales/mechanic per subsystem) so the GM knows every rule's shape on turn 1 before any keyword fires (toggle <b>Always-on rules digest</b>; <b>Full rules always-on</b> promotes the detailed [System Rule] entries to constant). An optional <b>2nd-pass state extractor</b> (off / fallback / always) reads the GM's prose and emits the state blocks itself — fixing an immersive narrator that drops blocks — optionally on a separate <b>connection profile</b>. <b>Card-assembly auto-retry</b> headlessly fetches missing <b>[CARD_*]</b> blocks when a finalize is gate-blocked. Settings are now <b>collapsible groups</b> and panel state-colors are themable <b>--glp-*</b> CSS variables. Opt-in <b>token telemetry</b> measures the per-chat cost of GLP's own side-generations (extractor/memory/card-retry). Settings sub-sections default <b>collapsed</b>. <b>Header polish:</b> empty tokens — including capability/roster lists (<code>{boons}</code>/<code>{abilities}</code>/<code>{conditions}</code>/…) — now uniformly drop their segment (no "None" placeholder), and the raw <b>[HEADER_FORMAT]</b> block now respects the Hide-blocks toggle. <b>Fixes:</b> an <b>XML-style block closer</b> (<code>[/SCENE_UPDATE_BEGIN]</code> instead of <code>[SCENE_UPDATE_END]</code>) is now normalized to the proper <code>_END</code> tag — a wrong closer silently dropped the whole block, which commonly broke party/scene updates; and every capability now <b>self-heals</b> its clickable <b>[Capability]</b> lorebook entry on rebuild (a cap created before the campaign lorebook was set no longer lacks its entry). All new behavior defaults OFF/unchanged.<br>
        <b>v0.0.19:</b> the structured parsers are now <b>format-tolerant</b> — both the <b>[SYSTEM_DEF]</b> parser and the entity/char_create <b>schema:</b> parser accept the canonical indented form <i>and</i> the reshaped variants small models emit: pipe-prefixed inline rows (<code>attributes|Brawn|BRN|desc</code>, <code>field|hp|HP|bar|vitals</code>, <code>derived|hp = … -&gt; …</code>), keyless <code>Label | ABBR | desc</code> attribute rows (the machine key is derived from the label), and un-indented descriptor lines — so a produced card hydrates even when the model doesn't reproduce the exact indentation. A repeat <b>[CARD_BEGIN]</b> on an already-open draft is now a <b>rename</b>, not a reset — it keeps every accumulated field/entry (a stray re-open before finalize used to silently discard the whole card). Plus opt-in <b>autonomous memory capture</b> — auto-create <b>[Memory]</b> entries from the transcript even when the model emits no memory block: when a subject <b>leaves the scene</b> (their time on-screen), when the scene <b>location changes</b> (the place just left), <b>periodically</b> every N GM turns, and on <b>leaving the chat</b> (still-present subjects). Each is a personaless side-generation (same summarizer as enrichment), writes <i>nothing</i> on failure (no stub), is de-duplicated, and is tagged <code>auto</code>. All triggers default OFF, so the local text-completion path is unchanged unless opted in.<br>
        <b>v0.0.18:</b> character-creation panel now groups the finalized sheet correctly (HP in <i>vitals</i>, attributes in <i>attributes</i>) without needing a refresh, and reloads correct any previously mis-grouped fields; the tiered <b>[Player:*]</b> projections moved into a dedicated <b>per-chat player lorebook</b> (<code>&lt;campaign&gt;-player-&lt;chat&gt;</code>) so two chats sharing a campaign book can't overwrite each other's player state (legacy entries auto-pruned from the campaign book); and <b>every lorebook-backed panel row</b> (quests, item box, equipment, capabilities, factions, world events, companions) is now <b>click-to-view</b> — opening its lorebook entry in a popup.<br>
        <b>v0.0.17:</b> opt-in <b>memory enrichment</b> (summarize the recent scene into [Memory] bodies via a personaless side-prompt; raw text is the fallback); all generated campaign lorebooks (campaign, plot, per-subject) are now <b>auto-linked to the active chat</b> so their entries are pulled by keyword World Info <i>and</i> Vector Storage; a <b>Semantic recall</b> note for pairing with built-in Vector Storage; and opt-in <b>function tools</b> for state changes on chat-completion backends (inert on text-completion — the prose-block path is unchanged).<br>
        <b>v0.0.16:</b> per-subject memory lorebooks are now <b>campaign-scoped</b> (<code>&lt;campaign&gt;-npc-&lt;slug&gt;</code> / <code>&lt;campaign&gt;-location-&lt;slug&gt;</code>) so two campaigns sharing an NPC name no longer cross-contaminate; <b>core memories are keyword-triggered</b> (not always-on) — an off-screen subject's memories stay out of context until it's named or present.<br>
        <b>The Architect</b> designs systems and emits a produced GM card; small models build it incrementally via <b>chunked card assembly</b> (<code>[CARD_BEGIN]</code> → <code>[CARD_FIELD]</code> → <code>[CARD_BOOK_ENTRY]</code> → <code>[CARD_FINALIZE]</code>), assembled + downloaded by the extension (one-shot <code>[CARD_OUTPUT]</code> still supported).<br>
        <b>Capability progression</b> is configurable per category via named profiles: none · counter · use_tracked · points_tiers · xp_levels · milestone (Veridia PP/tier = the built-in <i>veridia_pp</i>).<br>
        <b>Tiered context</b> (default on): the player's always-on injection is a lean core (identity, vitals, attributes, conditions, title, rank, time); skills, possessions &amp; domains move to keyword-triggered <b>[Player:Skills]</b>/<b>[Player:Possessions]</b>/<b>[Player:Domains]</b> entries that load only when referenced. <code>capabilities.require_granted</code> rejects progression on un-owned skills.<br>
        <b>Party &amp; scene</b> rosters, <b>GM realism directives</b>, and a built-in <b>narrative header</b> (merged from gm-narrative-header) are always-on backstops: only <b>[System Definition]</b>, <b>[GM Directives]</b>, <b>[Scene]</b>, <b>[Party]</b> and NPC core memories stay in context; everything else is keyword-triggered.<br>
        <b>Detailed mechanics</b> surface on demand as keyword-triggered <b>[System Rule]</b> lorebook entries (keys derived from the def's own vocabulary); <b># commands</b> are derived from the def and reshapeable via its <code>commands:</code> section.<br>
        <b>Add a block type:</b> register tags in modules/state.js + add a handler in the relevant module + dispatch in index.js.
      </div>
      </details>
    </div>
  </div>
</div>`;

    $('#extensions_settings2').append(html);
    const save = () => SillyTavern.getContext().saveSettingsDebounced();
    $('#glp-enabled').on('change', function()    { getSettings().enabled          = this.checked; save(); });
    $('#glp-lorebook').on('change', async function() { getSettings().campaignLorebook = this.value; save(); await linkCampaignBooks(getSettings()); });
    $('#glp-hide').on('change', function()       { getSettings().hideBlocks       = this.checked; save(); });
    $('#glp-notify').on('change', function()     { getSettings().notifyOnSave     = this.checked; save(); });
    $('#glp-scan-user').on('change', function()  { getSettings().scanUserMessages = this.checked; save(); });
    $('#glp-intercept').on('change', function()  { getSettings().interceptCommands= this.checked; save(); });
    $('#glp-show-panel').on('change', function() { getSettings().showStatusPanel  = this.checked; refreshStatusPanel(); save(); });
    $('#glp-show-skills').on('change', function(){ getSettings().showSkillPanel   = this.checked; refreshStatusPanel(); save(); });
    $('#glp-show-domain').on('change', function()   { getSettings().showDomainPanel   = this.checked; refreshStatusPanel(); save(); });
    $('#glp-show-quests').on('change', function()   { getSettings().showQuestPanel    = this.checked; refreshStatusPanel(); save(); });
    $('#glp-show-rep').on('change', function()      { getSettings().showRepPanel      = this.checked; refreshStatusPanel(); save(); });
    $('#glp-show-events').on('change', function()   { getSettings().showEventsPanel   = this.checked; refreshStatusPanel(); save(); });
    $('#glp-show-currency').on('change', function() { getSettings().showCurrencyPanel = this.checked; refreshStatusPanel(); save(); });
    $('#glp-show-boons').on('change',    function()  { getSettings().showBoonPanel    = this.checked; refreshStatusPanel(); save(); });
    $('#glp-show-needs').on('change',    function()  { getSettings().showNeedsPanel   = this.checked; refreshStatusPanel(); save(); });
    $('#glp-show-scene').on('change',    function()  { getSettings().showScenePanel   = this.checked; refreshStatusPanel(); save(); });
    $('#glp-show-party').on('change',    function()  { getSettings().showPartyPanel   = this.checked; refreshStatusPanel(); save(); });
    $('#glp-hdr-enabled').on('change',   function()  { getSettings().headerEnabled        = this.checked; save(); });
    $('#glp-hdr-block').on('change',     function()  { getSettings().headerUseFormatBlock = this.checked; save(); });
    $('#glp-hdr-every').on('change',     function()  { getSettings().headerShowOnEveryMsg = this.checked; save(); });
    $('#glp-hdr-sep').on('change',       function()  { getSettings().headerSeparator      = this.value;   save(); });
    $('#glp-hdr-manual').on('change',    function()  { getSettings().headerManualFormat   = this.value;   save(); });
    $('#glp-plot-lorebook').on('change', function() { getSettings().plotLorebook      = this.value;   save(); });
    $('#glp-inject-ctx').on('change', function()    { getSettings().injectIntoContext = this.checked; injectCharacterContext(); save(); });
    $('#glp-inject-res').on('change', function()    { getSettings().injectResolution = this.checked; injectCharacterContext(); save(); });
    $('#glp-tiered-ctx').on('change', async function() { getSettings().tieredContext = this.checked; injectCharacterContext(); await rebuildPlayerLoreEntries(getSettings()); save(); });
    // Re-persist the committed def so the always-on [System Definition] entry (digest)
    // and the [System Rule] entries (constant flag) rebuild. Guard on an actually
    // committed def so toggling in a system-less chat doesn't write a default entry.
    const _rebuildRuleEntries = async (label) => {
        const committed = SillyTavern.getContext().chatMetadata?.[MODULE_NAME]?.system_def;
        if (!committed) return;
        try { await saveSystemDef(committed, getSettings()); }
        catch (e) { console.warn(`[${MODULE_NAME}] ${label} rebuild:`, e); }
    };
    $('#glp-rules-digest').on('change', async function() { getSettings().alwaysOnRulesDigest = this.checked; await _rebuildRuleEntries('rules-digest'); save(); });
    $('#glp-full-rules').on('change', async function() { getSettings().fullRulesAlwaysOn = this.checked; await _rebuildRuleEntries('full-rules'); save(); });
    $('#glp-ctx-depth').on('change', function()  { getSettings().contextDepth     = parseInt(this.value) || 1; injectCharacterContext(); save(); });
    $('#glp-enrich-mem').on('change', function()    { getSettings().enrichMemories    = this.checked; save(); });
    $('#glp-enrich-window').on('change', function() { getSettings().enrichMemoryWindow = parseInt(this.value) || 10; save(); });
    $('#glp-use-tools').on('change', function()     { getSettings().useFunctionTools  = this.checked; save(); if (typeof syncGlpTools === 'function') syncGlpTools(); });
    $('#glp-card-autoretry').on('change', function()     { getSettings().cardAutoRetry    = this.checked; save(); });
    $('#glp-card-autoretry-max').on('change', function() { getSettings().cardAutoRetryMax = Math.max(1, Math.min(5, parseInt(this.value) || 2)); save(); });
    $('#glp-extractor-mode').on('change', function()     { getSettings().stateExtractorMode = this.value; save(); });
    $('#glp-extractor-profile').on('change', function()  { getSettings().stateExtractorProfileId = this.value; save(); });
    const _refreshTele = () => { const el = document.getElementById('glp-telemetry-readout'); if (el && typeof glpTelemetrySummary === 'function') el.innerHTML = `<small>${glpTelemetrySummary()}</small>`; };
    $('#glp-telemetry').on('change', function()          { getSettings().telemetryEnabled = this.checked; save(); _refreshTele(); });
    $('#glp-telemetry-refresh').on('click', _refreshTele);
    $('#glp-telemetry-reset').on('click', function()     { if (typeof glpResetTelemetry === 'function') glpResetTelemetry(SillyTavern.getContext().chatId); _refreshTele(); });
    // Console probe: window.glpTelemetry.summary() / .cost() / .get() / .reset()
    window.glpTelemetry = { summary: (c) => glpTelemetrySummary(c), cost: (c) => glpProjectCost(c), get: (c) => glpGetTelemetry(c), reset: (c) => glpResetTelemetry(c) };
    $('#glp-auto-mem').on('change', function()            { getSettings().autoMemory                 = this.checked; save(); });
    $('#glp-auto-mem-scene-exit').on('change', function() { getSettings().autoMemoryOnSceneExit      = this.checked; save(); });
    $('#glp-auto-mem-loc-change').on('change', function() { getSettings().autoMemoryOnLocationChange = this.checked; save(); });
    $('#glp-auto-mem-away').on('change', function()       { getSettings().autoMemoryOnChatAway       = this.checked; save(); });
    $('#glp-auto-mem-periodic').on('change', function()   { getSettings().autoMemoryPeriodic         = this.checked; save(); });
    $('#glp-auto-mem-every').on('change', function()      { getSettings().autoMemoryEveryNMessages   = parseInt(this.value) || 20; save(); });
    $('#glp-auto-mem-min').on('change', function()        { getSettings().autoMemoryMinMessages      = parseInt(this.value) || 4;  save(); });
    $('#glp-scan-depth').on('change', function() { getSettings().defaultScanDepth = parseInt(this.value) || 4; save(); });
    $('#glp-lore-order').on('change', function() { getSettings().loreOrder        = parseInt(this.value) || 100; save(); });
    $('#glp-rule-order').on('change', function() { getSettings().ruleOrder        = parseInt(this.value) || 50;  save(); });
    $('#glp-settings-popout').off('click').on('click', glpSettingsTogglePopout);
}

// ── Settings pop-out (detach the settings into a draggable floating panel) ─────
// Mirrors ST's Summarize extension. We MOVE the live .inline-drawer-content (so
// its change handlers travel with it) into a float, and move it back on close.

async function glpSettingsTogglePopout(e) {
    e?.stopPropagation?.();
    if (document.getElementById('glp-settings-popout-panel')) { $('#glpSettingsPopoutClose').trigger('click'); return; }

    const $content = $('.glp-settings .inline-drawer-content');
    if (!$content.length) return;
    const $origParent = $content.parent();

    const tpl = $('#zoomed_avatar_template').html();
    const $panel = tpl ? $(tpl) : $('<div></div>');
    $panel.attr('id', 'glp-settings-popout-panel')
        .removeClass('zoomed_avatar').addClass('draggable')
        .css('display', 'flex').empty();
    const controlBar = `<div class="panelControlBar flex-container">
        <div id="glpSettingsPopoutHeader" class="fa-solid fa-grip drag-grabber hoverglow"></div>
        <div id="glpSettingsPopoutClose" class="fa-solid fa-circle-xmark hoverglow dragClose" title="Close"></div>
    </div>`;
    $panel.append(controlBar).append($content);            // moves the live element
    $('#movingDivs').append($panel);

    try {
        const ra = await import('../../../RossAscends-mods.js');
        const pu = await import('../../../power-user.js');
        pu.loadMovingUIState?.();
        ra.dragElement?.($panel);
    } catch (err) { console.warn(`[${MODULE_NAME}] popout drag unavailable:`, err); }

    $('#glpSettingsPopoutClose').off('click').on('click', function () {
        $origParent.append($content);                      // move the live element back
        $('#glp-settings-popout-panel').remove();
    });
}

// ── GM State drawer (top-bar, pinnable; hosts the status panel) ────────────────
// Modeled on ST's AI Response Configuration drawer. ST binds `.drawer-toggle`
// once at init, so our late-injected toggle wires its own open/close. The pin
// uses ST's own `pinnedOpen` class, which exempts the drawer from ST's
// outside-click auto-close (see script.js html mousedown handler).

function mountGlpDrawer() {
    if (document.getElementById('glp-drawer-button')) return;       // mount once
    if (!document.getElementById('top-settings-holder')) return;
    const html = `
<div id="glp-drawer-button" class="drawer">
  <div class="drawer-toggle drawer-header">
    <div id="glpDrawerIcon" class="drawer-icon fa-solid fa-scroll fa-fw closedIcon interactable" title="GM State"></div>
  </div>
  <div id="glp-drawer" class="drawer-content fillLeft closedDrawer">
    <div id="glp-drawer-pin-div" title="Lock — the GM State panel stays open">
      <input type="checkbox" id="glp-drawer-pin">
      <label for="glp-drawer-pin">
        <div class="unchecked fa-solid fa-unlock"></div>
        <div class="checked fa-solid fa-lock"></div>
      </label>
    </div>
    <div id="glp-drawer-body"></div>
  </div>
</div>`;
    $('#top-settings-holder').append(html);

    const $icon = $('#glpDrawerIcon'), $drawer = $('#glp-drawer');
    const applyPin = (pinned) => {
        $drawer.toggleClass('pinnedOpen', pinned);
        $icon.toggleClass('drawerPinnedOpen', pinned);
        if (pinned) { $drawer.addClass('openDrawer').removeClass('closedDrawer'); $icon.addClass('openIcon').removeClass('closedIcon'); }
    };
    $('#glp-drawer-button > .drawer-toggle').on('click', function () {
        $drawer.toggleClass('openDrawer closedDrawer');
        $icon.toggleClass('openIcon closedIcon');
    });
    $('#glp-drawer-pin').prop('checked', !!getSettings().pinPanel).on('change', function () {
        getSettings().pinPanel = this.checked;
        SillyTavern.getContext().saveSettingsDebounced();
        applyPin(this.checked);
    });
    if (getSettings().pinPanel) applyPin(true);

    // Inventory item → popup its [Item] lorebook entry (delegated; survives re-renders).
    $(document).off('click.glpInvItem').on('click.glpInvItem', '.glp-inv-item', function () {
        if (typeof glpShowItemPopup === 'function') glpShowItemPopup($(this).attr('data-item'));
    });
    // Party/scene member → popup their NPC/companion/creature entry.
    $(document).off('click.glpMember').on('click.glpMember', '.glp-member', function () {
        if (typeof glpShowMemberPopup === 'function') glpShowMemberPopup($(this).attr('data-member'));
    });
    // Any lorebook-backed panel row → popup its entry (quests, item box, equipment,
    // capabilities, factions, world events, companions). One unified handler.
    $(document).off('click.glpLore').on('click.glpLore', '.glp-lore-clickable', function () {
        if (typeof glpShowLorePopup === 'function') glpShowLorePopup($(this).attr('data-lore'));
    });
}

// ── Entry point ───────────────────────────────────────────────────────────────

jQuery(async () => {
    await glpLoadModules();

    const { eventSource, event_types } = SillyTavern.getContext();
    getSettings();

    eventSource.on(event_types.MESSAGE_RECEIVED,      onMessageReceived);
    eventSource.on(event_types.USER_MESSAGE_RENDERED, onUserMessageRendered);
    eventSource.on(event_types.GENERATION_STARTED,    onGenerationStarted);
    eventSource.on(event_types.CHAT_CHANGED,          onChatChanged);

    // Belt-and-suspenders: flush any unsaved character state when the tab is hidden or
    // closed (only acts if dirty — normal per-message saves already persist immediately).
    if (!window.__glpFlushHooked) {
        window.__glpFlushHooked = true;
        window.addEventListener('pagehide', () => { flushCharStateIfDirty(); });
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushCharStateIfDirty(); });
    }
    eventSource.on(event_types.APP_READY, async () => {
        await renderSettingsPanel();
        mountGlpDrawer();
        refreshStatusPanel();
        injectCharacterContext();
        if (typeof syncGlpTools === 'function') syncGlpTools();
    });

    console.log(`[${MODULE_NAME}] v${VERSION} loaded. Modules: ${GLP_MODULE_LOAD_ORDER.join(', ')}`);
});
