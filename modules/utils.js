/**
 * gm-lore-parser / modules/utils.js
 * Pure utility functions — no ST API calls, no side effects.
 */

function escapeRegex(s)  { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function slugify(s)      { return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }

// ── Lorebook keyword helpers ───────────────────────────────────────────────────
// Keys trigger a lorebook entry to load into context. We normalize (dedup,
// lowercase) and conservatively expand multi-word names so "The Lost Heir" also
// triggers on the distinctive phrase "lost heir" — without emitting bare common
// words that would over-trigger.

var KEY_STOPWORDS = new Set(['the', 'of', 'a', 'an', 'and', 'to', 'in', 'for', 'de', 'la', 'le', 'el', 'los']);

/** Trim, lowercase, drop empties, dedup (stable order). */
function normalizeKeys(keys) {
    const seen = new Set(), out = [];
    for (const k of (keys || [])) {
        const t = String(k).trim().toLowerCase();
        if (!t || seen.has(t)) continue;
        seen.add(t); out.push(t);
    }
    return out;
}

/** Full lowercased name + a conservative significant-phrase sub-token. */
function expandNameKeys(name) {
    const full = String(name || '').trim().toLowerCase();
    if (!full) return [];
    const words = full.split(/\s+/);
    const sig   = words.filter(w => w.length >= 4 && !KEY_STOPWORDS.has(w));
    const out   = [full];
    if (words.length >= 2 && sig.length >= 2) out.push(sig.join(' '));      // "the lost heir" -> "lost heir"
    else if (sig.length === 1 && sig[0].length >= 5 && sig[0] !== full) out.push(sig[0]);
    return normalizeKeys(out);
}

function getMutability(d) {
    if (!d) return MUTABILITY.IMMUTABLE;
    if (d.mutability) return d.mutability;
    if (d.gm_mutable === true)  return MUTABILITY.GM_MUTABLE;
    if (d.gm_mutable === false) return MUTABILITY.IMMUTABLE;
    return MUTABILITY.IMMUTABLE;
}

function isMaxFieldOf(key, fields)     { return Object.values(fields).some(d => d.max_field === key); }
function isUsesCounterOf(key, fields)  {
    if (!key.endsWith('_uses')) return false;
    const base = key.slice(0, -5);
    return fields[base] && getMutability(fields[base]) === MUTABILITY.USE_TRACKED;
}

function parseElapsedMinutes(str) {
    if (!str) return 0;
    let t = 0;
    const s = str.toLowerCase();
    for (const { re, f } of [
        { re: /(\d+(?:\.\d+)?)\s*day/, f: 1440 },
        { re: /(\d+(?:\.\d+)?)\s*h/,   f: 60   },
        { re: /(\d+(?:\.\d+)?)\s*min/, f: 1    },
        { re: /(\d+(?:\.\d+)?)\s*m(?!o)/, f: 1 },
    ]) { const m = s.match(re); if (m) t += parseFloat(m[1]) * f; }
    return t;
}

function regenPerMinute(desc) {
    if (!desc?.regen?.rate) return 0;
    const r = desc.regen.rate;
    if (desc.regen.time_unit === 'hour') return r / 60;
    if (desc.regen.time_unit === 'day')  return r / 1440;
    return r;
}

function formatRegenDisplay(rpmFloat) {
    if (!rpmFloat) return '';
    const sign = rpmFloat > 0 ? '+' : '';
    const abs  = Math.abs(rpmFloat);
    const str  = abs < 0.1 ? abs.toFixed(2) : abs < 1 ? abs.toFixed(1) : abs % 1 === 0 ? abs.toString() : abs.toFixed(1);
    return `${sign}${rpmFloat < 0 ? '-' : ''}${str}/min`;
}

/** Parse key: value lines from a block's raw text. */
function parseFields(raw) {
    const fields = {};
    let ck = null;
    for (const line of raw.split('\n')) {
        const colon = line.indexOf(':');
        if (ck && line.match(/^\s+\S/) && colon === -1) { fields[ck] += ' ' + line.trim(); continue; }
        if (colon === -1) { ck = null; continue; }
        const key = line.slice(0, colon).trim().toLowerCase().replace(/\s+/g, '_');
        const val = line.slice(colon + 1).trim();
        if (key && val !== undefined) { fields[key] = val; ck = key; }
    }
    return fields;
}

/** Parse only TOP-LEVEL (non-indented) key: value lines, skipping the indented
 *  `schema:` block. Use this for blocks that carry a schema section (ENTITY,
 *  PLAYER_SHEET) so schema field descriptors (label/type/group/…) do not collide
 *  with or pollute block-level fields and values. */
function parseFlatFields(raw) {
    const fields = {};
    let ck = null;
    for (const line of raw.split('\n')) {
        if (/^\s/.test(line)) {
            // indented continuation of a top-level field (no colon) — append; else skip (schema body)
            if (ck && line.indexOf(':') === -1 && line.trim()) fields[ck] += ' ' + line.trim();
            continue;
        }
        const t = line.trim();
        if (!t) { ck = null; continue; }
        if (t.toLowerCase() === 'schema:') { ck = null; continue; }
        const colon = t.indexOf(':');
        if (colon === -1) { ck = null; continue; }
        const key = t.slice(0, colon).trim().toLowerCase().replace(/\s+/g, '_');
        fields[key] = t.slice(colon + 1).trim();
        ck = key;
    }
    return fields;
}

/** Extract all [BEGIN]…[END] pairs from a text string. */
function extractBlocks(text, begin, end) {
    const blocks = [];
    let cur = 0;
    while (true) {
        const s = text.indexOf(begin, cur); if (s === -1) break;
        const e = text.indexOf(end, s);     if (e === -1) break;
        blocks.push({ raw: text.slice(s + begin.length, e).trim(), fullMatch: text.slice(s, e + end.length) });
        cur = e + end.length;
    }
    return blocks;
}

/** Remove all known block tags from a message text. */
function stripAllBlocks(text) {
    let r = text;
    const allBlocks = [
        ...Object.values(LORE_BLOCKS),
        ...Object.values(UPDATE_BLOCKS),
        ...Object.values(SHEET_BLOCKS),
    ];
    for (const cfg of allBlocks) {
        if (cfg.begin && cfg.end)
            r = r.replace(new RegExp(escapeRegex(cfg.begin) + '[\\s\\S]*?' + escapeRegex(cfg.end), 'g'), '');
    }
    return r.replace(/\n{3,}/g, '\n\n').trim();
}

/** Re-render a chat message element with updated text. */
function rerenderMessage(messageId, newText) {
    const { chat, messageFormatting } = SillyTavern.getContext();
    const msg = chat[messageId]; if (!msg) return;
    msg.mes = newText;
    const $el = $(`#chat .mes[mesid="${messageId}"] .mes_text`);
    if ($el.length && messageFormatting)
        $el.html(messageFormatting(newText, msg.name, msg.is_system, msg.is_user, messageId));
}

/**
 * Parse the indented schema: block from a PLAYER_SHEET or NPC block.
 * Returns { fields: {}, groups: [] }.
 */
function parseSchema(raw) {
    const schema = { fields: {}, groups: [] };
    let inSchema = false, cf = null;
    for (const line of raw.split('\n')) {
        const t = line.trim();
        if (!t) continue;
        if (t.toLowerCase() === 'schema:') { inSchema = true; continue; }
        if (!inSchema) continue;
        if (!line.match(/^\s/) && t) break;
        const c = t.indexOf(':'); if (c === -1) continue;
        const key = t.slice(0, c).trim().toLowerCase();
        const val = t.slice(c + 1).trim();
        if (key === 'groups') { schema.groups = val.split(',').map(s => s.trim()).filter(Boolean); continue; }
        if (key === 'field')  { cf = val.trim(); if (cf) schema.fields[cf] = {}; continue; }
        if (!cf) continue;
        const fd = schema.fields[cf];
        switch (key) {
            case 'label':           fd.label          = val; break;
            case 'type':            fd.type           = val; break;
            case 'group':           fd.group          = val; break;
            case 'max_field':       fd.max_field      = val; break;
            case 'separator':       fd.separator      = val; break;
            case 'color':           fd.color          = val; break;
            case 'mutability':      fd.mutability     = val; break;
            case 'gm_mutable':      fd.gm_mutable     = val.toLowerCase() === 'true'; break;
            case 'uses_threshold':  fd.uses_threshold = parseFloat(val) || 0; break;
            case 'uses_gain':       fd.uses_gain      = parseFloat(val) || 1; break;
            case 'regen_rate':      (fd.regen ??= {}).rate      = parseFloat(val) || 0; break;
            case 'regen_unit':      (fd.regen ??= {}).time_unit = val; break;
            case 'regen_condition': (fd.regen ??= {}).condition = val; break;
        }
    }
    return schema;
}
