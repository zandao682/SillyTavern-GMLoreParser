/**
 * gm-lore-parser / modules/header.js
 * In-narrative status header — merged from the former gm-narrative-header
 * extension. Prepends a formatted, per-message header to GM messages, populated
 * from the parser's own character state + System Definition. Authored via a
 * [HEADER_FORMAT] block (captured per-chat) or a manual format in settings.
 *
 * Missing/unknown tokens resolve to nothing (never a literal {token}); a line
 * whose tokens ALL resolve empty is dropped, and leftover artifacts (orphan "/",
 * empty "()", stray separators) are tidied. One stat per line auto-hides cleanly.
 *
 * Settings (in gm-lore-parser settings): headerEnabled, headerUseFormatBlock,
 * headerManualFormat, headerSeparator, headerShowOnEveryMsg. Captured format is
 * stored on getCharState().header_format.
 */

function _hdrFormatRegen(rpmFloat) {
    if (!rpmFloat) return '0';
    const abs = Math.abs(rpmFloat);
    const str = abs < 0.1 ? abs.toFixed(2) : abs < 1 ? abs.toFixed(1) : abs % 1 === 0 ? abs.toString() : abs.toFixed(1);
    return rpmFloat < 0 ? `-${str}` : `+${str}`;
}

/** Does this capability advance (skill-like) under the active System Definition? */
function _hdrCapProgressing(cap, def) {
    const id = cap.progression_id || def?.capabilities?.category_progression?.[cap.category] || 'none';
    const p  = (def?.progressions || []).find(x => x.id === id);
    return !!(p && p.type && p.type !== 'none');
}

/** Resolve a single {token}. Genuinely-missing/unknown data → '' (hidden). */
function resolveHeaderToken(token, charState) {
    if (!charState) return '';
    const values     = charState.values || {};
    const schema     = charState.schema?.fields || {};
    const def        = charState.system_def || getSystemDef();
    const needs      = charState.needs || {};
    const caps       = (charState.capabilities && typeof charState.capabilities === 'object')
        ? Object.values(charState.capabilities).filter(c => (c.entity_slug || 'player') === 'player') : [];
    const exCat      = def?.capabilities?.exclusive_category || 'title';
    // Header tokens ALWAYS resolve empty data to '' (the segment/line then drops) —
    // the header never shows an empty-label placeholder, for consistent degradation.

    if (token === 'name')       return charState.name       || '';
    if (token === 'class')      return charState.class_      || '';
    if (token === 'background') return charState.background  || '';
    if (token === 'rank')       return charState.adventurer_rank?.rank || '';
    if (token === 'time' || token === 'date') return charState.world_time?.display || '';

    if (token === 'conditions')
        return (Array.isArray(values.conditions) && values.conditions.length) ? values.conditions.join(', ') : '';
    if (token === 'inventory_count')
        return Array.isArray(values.inventory) ? values.inventory.length : 0;
    if (token === 'inventory_max')
        return def?.inventory?.capacity ?? values.inventory_max ?? values.bag_slots ?? '';

    if (token === 'active_title') {
        const t = caps.find(c => c.category === exCat && c.active);
        return t ? t.name : '';
    }
    if (token === 'titles')
        return caps.filter(c => c.category === exCat).map(c => c.name).join(', ') || '';
    if (token === 'boons')
        return caps.filter(c => c.category === 'boon').map(c => c.name).join(', ') || '';
    if (token === 'abilities')
        return caps.filter(c => c.category !== exCat && !_hdrCapProgressing(c, def)).map(c => c.name).join(', ') || '';
    if (token === 'party')
        return Object.values(charState.party || {}).map(m => m.name).join(', ') || '';
    if (token === 'scene')
        return Object.values(charState.scene || {}).map(m => m.name).join(', ') || '';

    if (token === 'currency') {
        const c = charState.currency || {};
        const parts = Object.entries(c).filter(([, v]) => v > 0).map(([d, v]) => `${v} ${d}`);
        return parts.length ? parts.join(', ') : '';
    }
    if (token.startsWith('currency:')) return charState.currency?.[token.slice(9).trim().toLowerCase()] ?? 0;

    if (token.startsWith('reputation:')) {
        const wanted = token.slice(11).trim().toLowerCase();
        const rep = Object.values(charState.reputation || {}).find(r => (r.name || '').toLowerCase() === wanted);
        return rep ? `${rep.tier} (${rep.standing})` : '';
    }
    if (token.startsWith('skill_score:')) {
        const wanted = token.slice(12).trim().toLowerCase();
        const cap = caps.find(c => (c.name || '').toLowerCase() === wanted);
        return (cap && cap.prog && cap.prog.score !== undefined) ? cap.prog.score : '';
    }

    if (token.endsWith('_regen')) {
        const rpm = regenPerMinute(schema[token.slice(0, -6)]);
        return rpm ? _hdrFormatRegen(rpm) : '';
    }
    if (token.endsWith('_pct')) {
        const baseKey = token.slice(0, -4);
        const meter = needs[baseKey];
        if (meter && meter.max) return Math.round((meter.value / meter.max) * 100);
        if (values[baseKey] !== undefined && schema[baseKey]?.max_field)
            return Math.round((values[baseKey] / (values[schema[baseKey].max_field] || 1)) * 100);
        return '';
    }
    if (token.endsWith('_max')) {
        const baseKey = token.slice(0, -4);
        if (values[token] !== undefined) return values[token];
        const desc = schema[baseKey];
        if (desc?.max_field) return values[desc.max_field] ?? '';
        if (needs[baseKey]) return needs[baseKey].max ?? '';
        return '';
    }
    if (token === 'xp_next') return values.xp_next ?? values.xp_to_next_level ?? '';

    if (values[token] !== undefined) {
        const v = values[token];
        return Array.isArray(v) ? v.join(', ') : v;
    }
    if (needs[token] !== undefined) return needs[token].value;
    return '';
}

/** Tidy artifacts left WITHIN a segment after a token resolved empty (empty
 *  parens/brackets, a dangling "/"). Deliberately does NOT touch the spacing
 *  around inter-segment separators — that is handled at the segment level so
 *  well-formed lines like "A | B" keep their spaces. */
function _cleanupHeaderLine(s) {
    return s
        .replace(/\(\s*\/[^)]*\)/g, '')    // "(EMPTY/unit)" — leading value gone, e.g. "(/min)"
        .replace(/\(\s*\)/g, '')           // empty ()
        .replace(/\[\s*\]/g, '')           // empty []
        .replace(/\s*\/\s*(?=\s|$)/g, '')  // dangling "/" before space/end ("90/" )
        .replace(/(^|\s)\/\s*/g, '$1')     // dangling "/" after a space ("/ 90")
        .replace(/\s{2,}/g, ' ')           // collapse a gap left by a removed mid-segment token
        .trim();
}

/** Canonical form for a captured inter-segment separator. */
function _headerSep(raw) {
    if (/\|/.test(raw)) return ' | ';
    if (/·/.test(raw)) return ' · ';
    return '   ';                          // a run of 2+ spaces → a 3-space gap
}

function renderHeader(format, charState) {
    if (!format) return null;
    // Segments are separated by " | ", " · ", or a run of 2+ spaces. A segment
    // whose tokens ALL resolve empty is dropped (with its label); survivors are
    // rejoined with the original separator, so intentional spacing is preserved.
    const sepRe = /(\s*\|\s*|\s*·\s*|\s{2,})/;
    const out = format.split('\n').map(line => {
        const parts = line.split(sepRe);
        const seps  = parts.filter((_, i) => i % 2 === 1);
        let sawToken = false;
        const survivors = parts.filter((_, i) => i % 2 === 0).map(seg => {
            let had = false, allEmpty = true;
            const rep = seg.replace(/\{([^}]+)\}/g, (_, token) => {
                had = true; sawToken = true;
                const v = resolveHeaderToken(token.trim(), charState);
                const s = (v === null || v === undefined) ? '' : String(v);
                if (s !== '') allEmpty = false;
                return s;
            });
            if (had && allEmpty) return null;          // token-bearing segment that resolved empty → drop it + its label
            const cleaned = _cleanupHeaderLine(rep);
            return cleaned === '' ? null : cleaned;
        }).filter(x => x !== null);
        if (!sawToken) { const t = line.trim(); return t === '' ? null : t; } // literal line kept verbatim
        if (!survivors.length) return null;            // every token-bearing segment was empty → drop the line
        return survivors.join(_headerSep(seps[0] || '   '));
    }).filter(l => l !== null && l.trim() !== '');
    const result = out.join('\n').trim();
    return result || null;
}

function extractHeaderFormat(text) {
    const begin = SHEET_BLOCKS.HEADER_FORMAT.begin, end = SHEET_BLOCKS.HEADER_FORMAT.end;
    const start = text.indexOf(begin); if (start === -1) return null;
    const e = text.indexOf(end, start); if (e === -1) return null;
    return { format: text.slice(start + begin.length, e).trim(), fullMatch: text.slice(start, e + end.length) };
}

function stripHeaderBlock(text, fullMatch) {
    return text.replace(fullMatch, '').replace(/\n{3,}/g, '\n\n').trim();
}

/** Capture a [HEADER_FORMAT] block from a GM message into header_format. */
function captureHeaderFormat(messageId) {
    const { chat } = SillyTavern.getContext();
    const message = chat[messageId];
    if (!message || message.is_user) return false;
    const blk = extractHeaderFormat(message.mes || '');
    message._glpHadHeaderBlock = !!blk;
    if (blk) { getCharState().header_format = blk.format; return true; }
    return false;
}

/** Render + prepend the header to a finalized GM message (one re-render). */
function applyNarrativeHeader(messageId) {
    const settings = getSettings();
    if (!settings.headerEnabled) return;
    const { chat, messageFormatting } = SillyTavern.getContext();
    const message = chat[messageId];
    if (!message || message.is_user) return;

    const st  = getCharState();
    const fmt = (settings.headerUseFormatBlock && st.header_format) ? st.header_format : settings.headerManualFormat;
    if (!fmt) return;
    if (!settings.headerShowOnEveryMsg && !message._glpHadHeaderBlock) return;

    let body = message.mes || '';
    // Strip the raw [HEADER_FORMAT] spec ONLY when hide-blocks is on (consistent with
    // every other block). With hide-blocks off it stays visible like any raw block —
    // you'll see the rendered header AND the raw format spec below it. (When hide-blocks
    // is on, stripAllBlocks already removed it before this runs, so this is a no-op then.)
    if (settings.hideBlocks) {
        const blk = extractHeaderFormat(body);
        if (blk) body = stripHeaderBlock(body, blk.fullMatch);
    }

    const rendered = renderHeader(fmt, st);
    if (!rendered) return;
    const sep = settings.headerSeparator ? `\n${settings.headerSeparator}\n` : '\n';
    if (body.startsWith(rendered)) return;          // already prepended this turn

    message.mes = rendered + sep + body;
    const $el = $(`#chat .mes[mesid="${messageId}"] .mes_text`);
    if ($el.length && messageFormatting)
        $el.html(messageFormatting(message.mes, message.name, message.is_system, message.is_user, messageId));
}
