/**
 * gm-lore-parser / modules/scene.js
 * Party & Scene rosters — lightweight membership lists that persist in
 * chatMetadata and are surfaced as ALWAYS-ON (constant) lorebook entries so the
 * GM remembers who travels with the player and who is present, even across large
 * context shifts. Distinct from the companions sub-game (loyalty/control) — a
 * companion may also appear here. Members optionally `ref` an existing
 * NPC/companion record so the panel can open its lore entry.
 *
 *   [PARTY_UPDATE_BEGIN] … [PARTY_UPDATE_END]
 *     add: Name | role (note)   (repeatable) · remove: Name · clear: true
 *   [SCENE_UPDATE_BEGIN] … [SCENE_UPDATE_END]
 *     enter|add: Name | role (note) · exit|remove: Name · set: A, B, C ·
 *     clear: true · location: <where>
 *
 * Stored in state.party / state.scene (+ state.scene_location). Rosters are kept
 * terse because they are always-on.
 */

var PARTY_ENTRY_COMMENT = '[Party]';
var SCENE_ENTRY_COMMENT = '[Scene]';

/** "Name | role (note)" → { slug, name, role, note }. */
function _parseMember(spec) {
    let s = String(spec).trim();
    let note = '';
    const nm = s.match(/\(([^)]*)\)\s*$/);
    if (nm) { note = nm[1].trim(); s = s.slice(0, nm.index).trim(); }
    const [name, role] = s.split('|').map(x => x.trim());
    if (!name) return null;
    return { slug: slugify(name), name, role: role || '', note };
}

/** Link a roster member to an existing companion record (panel popup target). */
function _memberRef(name) {
    const st = getCharState();
    const slug = slugify(name);
    return (st.companions && st.companions[slug]) ? slug : '';
}

function _rosterContent(roster, emptyMsg, location) {
    const members = Object.values(roster || {});
    const lines = [];
    if (location) lines.push(`Location: ${location}`);
    if (!members.length) { lines.push(emptyMsg); return lines.join('\n'); }
    for (const m of members) lines.push(`${m.name}${m.role ? ` — ${m.role}` : ''}${m.note ? ` (${m.note})` : ''}`);
    return lines.join('\n');
}

async function _upsertConstant(lb, comment, content, keys, order, settings, type) {
    if (!lb) return;
    const e = entryBase(comment, keys, content, order, settings, { type });
    e.constant = true;   // always in context — who's in the party / present now
    await upsertEntry(lb, e);
}

// ── PARTY_UPDATE ───────────────────────────────────────────────────────────────

async function applyPartyUpdate(raw, settings) {
    const st = getCharState();
    let changed = false;
    for (const line of raw.split('\n')) {
        const c = line.indexOf(':'); if (c === -1) continue;
        const verb = line.slice(0, c).trim().toLowerCase();
        const val  = line.slice(c + 1).trim();
        if (verb === 'clear') { st.party = {}; changed = true; }
        else if (verb === 'add' || verb === 'member') {
            const m = _parseMember(val); if (m) { m.ref = _memberRef(m.name); st.party[m.slug] = m; changed = true; }
        } else if (verb === 'remove' || verb === 'exit') {
            const slug = slugify(val); if (st.party[slug]) { delete st.party[slug]; changed = true; }
        }
    }
    if (changed)
        await _upsertConstant(settings.campaignLorebook, PARTY_ENTRY_COMMENT,
            _rosterContent(st.party, 'Travelling alone.'), ['party', 'the party', 'group'],
            (settings.ruleOrder ?? 50) - 2, settings, 'PARTY');
    return changed;
}

// ── SCENE_UPDATE ───────────────────────────────────────────────────────────────

async function applySceneUpdate(raw, settings) {
    const st = getCharState();
    let changed = false;
    for (const line of raw.split('\n')) {
        const c = line.indexOf(':'); if (c === -1) continue;
        const verb = line.slice(0, c).trim().toLowerCase();
        const val  = line.slice(c + 1).trim();
        if (verb === 'clear') { st.scene = {}; st.scene_location = ''; changed = true; }
        else if (verb === 'location') { st.scene_location = val; changed = true; }
        else if (verb === 'set') {
            st.scene = {};
            for (const piece of val.split(',')) { const m = _parseMember(piece); if (m) { m.ref = _memberRef(m.name); st.scene[m.slug] = m; } }
            changed = true;
        } else if (verb === 'enter' || verb === 'add') {
            const m = _parseMember(val); if (m) { m.ref = _memberRef(m.name); st.scene[m.slug] = m; changed = true; }
        } else if (verb === 'exit' || verb === 'remove') {
            const slug = slugify(val); if (st.scene[slug]) { delete st.scene[slug]; changed = true; }
        }
    }
    if (changed)
        await _upsertConstant(settings.campaignLorebook, SCENE_ENTRY_COMMENT,
            _rosterContent(st.scene, 'No other characters present.', st.scene_location),
            ['scene', 'present', 'here'], (settings.ruleOrder ?? 50) - 3, settings, 'SCENE');
    return changed;
}

// ── Panels ─────────────────────────────────────────────────────────────────────

function _rosterPanel(roster, location) {
    const members = Object.values(roster || {});
    if (!members.length && !location) return '';
    const rows = members.map(m =>
        `<div class="glp-cap-row"><div class="glp-cap-head"><span class="glp-cap-name${m.ref ? ' glp-member' : ''}"${m.ref ? ` data-member="${String(m.name).replace(/"/g, '&quot;')}" title="Click for details"` : ''}>${m.name}</span>${m.role ? `<span class="glp-cap-tag">${m.role}</span>` : ''}</div>${m.note ? `<div class="glp-cap-desc">${m.note}</div>` : ''}</div>`
    ).join('');
    const loc = location ? `<div class="glp-cap-desc"><b>Location:</b> ${location}</div>` : '';
    return `${loc}<div class="glp-cap-list">${rows}</div>`;
}
function buildPartyPanel(party)          { return _rosterPanel(party, ''); }
function buildScenePanel(scene, location) { return _rosterPanel(scene, location); }

// ── Commands ─────────────────────────────────────────────────────────────────

function cmdParty(state) {
    const members = Object.values(state.party || {});
    if (!members.length) return '[Party]\nTravelling alone.';
    return '[Party]\n' + members.map(m => `  ${m.name}${m.role ? ` — ${m.role}` : ''}${m.note ? ` (${m.note})` : ''}`).join('\n');
}
function cmdScene(state) {
    const members = Object.values(state.scene || {});
    const lines = ['[Scene]'];
    if (state.scene_location) lines.push(`  Location: ${state.scene_location}`);
    if (!members.length) lines.push('  No other characters present.');
    else for (const m of members) lines.push(`  ${m.name}${m.role ? ` — ${m.role}` : ''}${m.note ? ` (${m.note})` : ''}`);
    return lines.join('\n');
}

// ── Member popup — open the linked NPC/companion/creature lore entry ──────────

async function glpShowMemberPopup(name) {
    const ctx = SillyTavern.getContext();
    const lb  = getSettings().campaignLorebook;
    let content = '', title = name;
    if (lb) {
        try {
            const data    = await ctx.loadWorldInfo(lb);
            const entries = Object.values(data?.entries || {});
            const hit = entries.find(e => [`[NPC] ${name}`, `[Companion] ${name}`, `[Creature] ${name}`].includes(e.comment));
            if (hit) { content = hit.content || ''; title = hit.comment; }
        } catch (e) { /* ignore */ }
    }
    const esc  = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const body = content ? esc(content) : 'No lore entry recorded for this character yet.';
    const html = `<div class="glp-item-popup"><h3>${esc(title)}</h3><pre class="glp-item-popup-body">${body}</pre></div>`;
    if (typeof ctx.callGenericPopup === 'function' && ctx.POPUP_TYPE) ctx.callGenericPopup(html, ctx.POPUP_TYPE.TEXT);
    else if (typeof ctx.callPopup === 'function') ctx.callPopup(html, 'text');
}
