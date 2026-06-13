/**
 * gm-lore-parser / modules/abilities.js
 * Unified "ability" primitive — one concept for what used to be four separate
 * subsystems: Boons, Titles, race/innate Passives, and Evolution traits.
 *
 * Block:
 *   [ABILITY_BEGIN] … [ABILITY_END]
 *     name:        <ability name>
 *     category:    boon | title | passive | trait | evolution   (default: boon)
 *     activation:  always | on_condition | on_use               (default: always)
 *     description: <narrative>
 *     effects:     <mechanical summary>
 *     entity:      <owner name>            (default: the player)
 *     active:      true|false              (titles — only one active at a time)
 *     stat_changes: attr:+N, attr:-N       (evolution — applied to the owner)
 *     keywords:    <comma list>
 *
 * Abilities live in state.abilities[] and (when a campaign lorebook is set) each
 * gets a lorebook entry. Commands #boons / #titles / #abilities filter by category.
 */

var ABILITY_CATEGORIES = ['boon', 'title', 'passive', 'trait', 'evolution'];

async function processAbilityBlock(fields, settings) {
    const state = getCharState();
    if (!fields.name) { console.warn(`[${MODULE_NAME}] ABILITY missing name`); return false; }

    const category = (fields.category || 'boon').toLowerCase();
    const slug     = slugify(fields.name);
    const ownerSlug = fields.entity ? slugify(fields.entity) : 'player';
    const keywords = fields.keywords ? fields.keywords.split(',').map(k => k.trim()).filter(Boolean) : [fields.name];

    // Titles: only one active per owner
    const makeActive = category === 'title' && (fields.active === undefined || fields.active === 'true' || fields.active === true);
    if (makeActive)
        state.abilities.forEach(a => { if (a.category === 'title' && a.entity_slug === ownerSlug) a.active = false; });

    const ability = {
        id: `${category}:${ownerSlug}:${slug}`,
        name:        fields.name,
        category,
        activation:  fields.activation  || 'always',
        description: fields.description || '',
        effects:     fields.effects     || '',
        entity_slug: ownerSlug,
        active:      category === 'title' ? makeActive : true,
        stat_changes: fields.stat_changes || '',
        keywords,
    };

    const idx = state.abilities.findIndex(a => a.id === ability.id);
    if (idx >= 0) state.abilities[idx] = ability; else state.abilities.push(ability);

    // Evolution: apply its stat changes to the owner as a milestone event.
    if (category === 'evolution' && fields.stat_changes && ownerSlug === 'player')
        _applyEvolutionStatChanges(fields.stat_changes, fields.name);

    // Lorebook entry
    if (settings.campaignLorebook) {
        await upsertEntry(settings.campaignLorebook, {
            ...entryBase(`[Ability] ${fields.name}`, keywords, _abilityEntryContent(ability),
                settings.loreOrder, settings, { type: 'ABILITY', category, slug, entity_slug: ownerSlug }),
        });
    }
    console.log(`[${MODULE_NAME}] Ability recorded: ${ability.name} (${category})`);
    return true;
}

/** Apply "attr:+N, attr:-N" deltas to the player as a logged gm_event change. */
function _applyEvolutionStatChanges(raw, evoName) {
    const state = getCharState();
    const sf    = state.schema?.fields || {};
    const abs   = {};
    for (const pair of String(raw).split(',')) {
        const [k, vRaw] = pair.split(':').map(s => s.trim());
        if (!k || vRaw === undefined) continue;
        const key = k.toLowerCase().replace(/\s+/g, '_');
        const n   = parseFloat(vRaw);
        if (isNaN(n)) continue;
        const isDelta = /^[+-]/.test(vRaw.trim());
        abs[key] = isDelta ? (parseFloat(state.values[key]) || 0) + n : n;
    }
    if (!Object.keys(abs).length) return;
    // Route through the player event path so gm_event gating + change-log apply.
    const lines = [`reason: Evolution — ${evoName}`, ...Object.entries(abs).map(([k, v]) => `${k}: ${v}`)];
    if (typeof playerEntityEvent === 'function') playerEntityEvent(parseFields(lines.join('\n')));
}

function _abilityEntryContent(a) {
    const lines = [`[${a.category[0].toUpperCase() + a.category.slice(1)}] ${a.name}`];
    if (a.activation && a.activation !== 'always') lines.push(`Activation: ${a.activation}`);
    if (a.description) lines.push(`Description: ${a.description}`);
    if (a.effects)     lines.push(`Effects: ${a.effects}`);
    if (a.stat_changes)lines.push(`Stat changes: ${a.stat_changes}`);
    if (a.category === 'title') lines.push(`Active: ${a.active}`);
    return lines.join('\n');
}

// ── Context injection ─────────────────────────────────────────────────────────

function buildAbilityContextString(abilities) {
    if (!abilities || !abilities.length) return '';
    const own = abilities.filter(a => a.entity_slug === 'player');
    if (!own.length) return '';
    const parts = [];
    const activeTitle = own.find(a => a.category === 'title' && a.active);
    if (activeTitle) parts.push(`Active Title: ${activeTitle.name}`);
    const named = own.filter(a => a.category !== 'title').map(a => a.name);
    if (named.length) parts.push(`Abilities: ${named.join(', ')}`);
    return parts.join('\n');
}

// ── Panel HTML ────────────────────────────────────────────────────────────────

function buildAbilityPanelHTML(abilities, settings) {
    if (!settings.showBoonPanel) return '';
    const own = (abilities || []).filter(a => a.entity_slug === 'player');
    if (!own.length) return '';

    const titles = own.filter(a => a.category === 'title');
    const rest   = own.filter(a => a.category !== 'title');

    const titleRows = titles.map(t =>
        `<div class="glp-title-row${t.active ? ' glp-title-active' : ''}">
            <span class="glp-title-name">${t.active ? '★ ' : ''}${t.name}</span>
            ${t.description ? `<span class="glp-title-desc">${t.description}</span>` : ''}
        </div>`).join('');

    const abilityRows = rest.map(a =>
        `<details class="glp-boon-row">
            <summary class="glp-boon-name">${a.name} <span class="glp-boon-type">[${a.category}]</span></summary>
            ${a.description ? `<div class="glp-boon-desc">${a.description}</div>` : ''}
            ${a.effects     ? `<div class="glp-boon-effects">${a.effects}</div>`     : ''}
        </details>`).join('');

    return `<div class="glp-panel-section glp-boons-section">
        ${titles.length ? `<div class="glp-boons-titles"><b>Titles</b>${titleRows}</div>` : ''}
        ${rest.length   ? `<div class="glp-boons-list"><b>Abilities</b>${abilityRows}</div>` : ''}
    </div>`;
}

// ── Commands ──────────────────────────────────────────────────────────────────

function _byCategory(state, cats) {
    return (state.abilities || []).filter(a => a.entity_slug === 'player' && cats.includes(a.category));
}

function cmdBoons(state) {
    const list = _byCategory(state, ['boon']);
    if (!list.length) return 'No boons recorded.';
    return list.map(a => {
        const lines = [`**${a.name}** (${a.activation})`];
        if (a.description) lines.push(`  ${a.description}`);
        if (a.effects)     lines.push(`  Effects: ${a.effects}`);
        return lines.join('\n');
    }).join('\n\n');
}

function cmdTitles(state) {
    const list = _byCategory(state, ['title']);
    if (!list.length) return 'No titles recorded.';
    return list.map(t => `${t.active ? '★ ' : '○ '}**${t.name}**${t.description ? ' — ' + t.description : ''}`).join('\n');
}

function cmdAbilities(state) {
    const all = (state.abilities || []).filter(a => a.entity_slug === 'player');
    if (!all.length) return 'No abilities recorded.';
    const parts = [];
    for (const cat of ABILITY_CATEGORIES) {
        const list = all.filter(a => a.category === cat);
        if (!list.length) continue;
        parts.push(`**${cat[0].toUpperCase() + cat.slice(1)}s**`);
        for (const a of list)
            parts.push(`  • ${a.active === false ? '' : ''}${a.name}${a.effects ? ': ' + a.effects : ''}`);
    }
    return parts.join('\n');
}
