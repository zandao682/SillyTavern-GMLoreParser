/**
 * gm-lore-parser / modules/reputation.js
 * Faction lore + reputation system.
 *
 * Two block types feed the same lorebook entry per faction:
 *   [FACTION_BEGIN] … [FACTION_END]           — define faction lore (stored in state.factions)
 *   [FACTION_UPDATE_BEGIN] … [FACTION_UPDATE_END] — update mutable lore fields
 *   [REPUTATION_UPDATE_BEGIN] … [REPUTATION_UPDATE_END] — update standing score
 *
 * The lorebook entry for a faction combines both lore and standing so the GM
 * always has the full picture in context.
 *
 * Faction lore fields (mutable via FACTION_UPDATE):
 *   goals, leadership, resources, attitude_to_party, current_state, notes
 *
 * Faction lore fields (immutable after FACTION_BEGIN):
 *   type, keywords
 *
 * Standing is a numeric 0-100 score. Tiers are bands derived from tier_labels.
 * Default bands (6 tiers):
 *   0–16  Hostile | 17–33 Cold | 34–49 Neutral | 50–66 Friendly | 67–83 Allied | 84–100 Sworn
 */

// ── Tier logic ────────────────────────────────────────────────────────────────
// Scale, tiers, and initial standing all come from the active system definition
// (modules/system.js). DEFAULT_REP_TIERS is the fallback when no def is loaded.

var DEFAULT_REP_TIERS = ['Hostile', 'Cold', 'Neutral', 'Friendly', 'Allied', 'Sworn'];

function _repDef() {
    const r = getSystemDef().reputation || {};
    return {
        min:     r.scale_min ?? 0,
        max:     r.scale_max ?? 100,
        initial: r.initial   ?? 50,
        tiers:   (r.tiers && r.tiers.length >= 2) ? r.tiers : DEFAULT_REP_TIERS,
    };
}

function getTierForStanding(standing, tierLabels) {
    const def    = _repDef();
    const labels = (tierLabels && tierLabels.length >= 2) ? tierLabels : def.tiers;
    const n      = labels.length;
    const span   = (def.max - def.min) || 1;
    const frac    = (standing - def.min) / span;
    const idx     = Math.min(Math.floor(frac * n), n - 1);
    return labels[Math.max(0, idx)];
}

function clampStanding(v) {
    const def = _repDef();
    return Math.max(def.min, Math.min(def.max, v));
}

/** Initial standing for a newly-seeded faction (def-driven). */
function initialStanding() { return _repDef().initial; }
/** Max of the active reputation scale (for display). */
function repScaleMax() { return _repDef().max; }

// ── Combined lorebook entry builder ──────────────────────────────────────────
// Called by both processFactionBlock and applyReputationUpdate so the entry
// always reflects the latest state from both sources.

async function rebuildFactionLoreEntry(slug, settings) {
    if (!settings.campaignLorebook) return false;
    const state = getCharState();
    const lore  = state.factions[slug];
    const rep   = state.reputation[slug];
    if (!lore && !rep) return false;

    const name     = (lore || rep).name;
    const keywords = lore?.keywords?.length
        ? lore.keywords
        : [name.toLowerCase(), slug];

    const lines = [`[Faction] ${name}`];
    if (lore) {
        if (lore.type)              lines.push(`Type: ${lore.type}`);
        if (lore.goals)             lines.push(`Goals: ${lore.goals}`);
        if (lore.leadership)        lines.push(`Leadership: ${lore.leadership}`);
        if (lore.resources)         lines.push(`Resources: ${lore.resources}`);
        if (lore.attitude_to_party) lines.push(`Attitude to party: ${lore.attitude_to_party}`);
        if (lore.current_state)     lines.push(`Current state: ${lore.current_state}`);
        if (lore.notes)             lines.push(`Notes: ${lore.notes}`);
        if (lore.history?.length) {
            const last = lore.history[lore.history.length - 1];
            if (last.summary) lines.push(`Recent: ${last.summary}`);
        }
    }
    if (rep) {
        lines.push(`Standing: ${rep.standing}/${repScaleMax()} (${rep.tier})`);
        const tierScale = rep.tier_labels?.join(' → ') || _repDef().tiers.join(' → ');
        lines.push(`Tier scale: ${tierScale}`);
        if (rep.history?.length) {
            const last = rep.history[rep.history.length - 1];
            if (last.reason) lines.push(`Last rep event: ${last.reason}`);
        }
    }

    await upsertEntry(settings.campaignLorebook, {
        ...entryBase(`[Faction] ${name}`, keywords, lines.join('\n'),
            settings.loreOrder, settings, { type: 'FACTION', slug }),
    });
    return true;
}

// ── FACTION_BEGIN handler ─────────────────────────────────────────────────────

async function processFactionBlock(fields, settings) {
    if (!fields.name) { console.warn(`[${MODULE_NAME}] FACTION_BEGIN missing name`); return false; }

    const slug    = slugify(fields.name);
    const state   = getCharState();
    const keywords = fields.keywords
        ? fields.keywords.split(',').map(k => k.trim()).filter(Boolean)
        : [fields.name.toLowerCase(), slug];

    // Preserve existing entry if already registered (FACTION_BEGIN can be emitted multiple times)
    const existing = state.factions[slug] || {};
    state.factions[slug] = {
        name:              fields.name,
        type:              fields.type              || existing.type              || '',
        goals:             fields.goals             || existing.goals             || '',
        leadership:        fields.leadership        || existing.leadership        || '',
        resources:         fields.resources         || existing.resources         || '',
        attitude_to_party: fields.attitude_to_party || existing.attitude_to_party || 'Unknown',
        current_state:     fields.current_state     || existing.current_state     || '',
        notes:             fields.notes             || existing.notes             || '',
        keywords,
        history: existing.history || [],
    };

    // Auto-seed reputation entry at the system's initial standing if not yet tracked
    if (!state.reputation[slug]) {
        const seed = initialStanding();
        state.reputation[slug] = {
            name:        fields.name,
            standing:    seed,
            tier:        getTierForStanding(seed, null),
            tier_labels: null,
            history:     [],
        };
    }

    await rebuildFactionLoreEntry(slug, settings);
    console.log(`[${MODULE_NAME}] Faction registered: "${fields.name}"`);
    return true;
}

// ── FACTION_UPDATE handler ────────────────────────────────────────────────────

async function processFactionUpdate(raw, settings) {
    const fields = parseFields(raw);
    if (!fields.name) { console.warn(`[${MODULE_NAME}] FACTION_UPDATE missing name`); return false; }

    const slug  = slugify(fields.name);
    const state = getCharState();

    // Auto-create minimal faction if not yet registered
    if (!state.factions[slug]) {
        state.factions[slug] = {
            name: fields.name, type: '', goals: '', leadership: '',
            resources: '', attitude_to_party: 'Unknown', current_state: '',
            notes: '', keywords: [fields.name.toLowerCase(), slug], history: [],
        };
    }
    const faction = state.factions[slug];

    // Merge mutable fields
    const mutable = ['goals', 'leadership', 'resources', 'attitude_to_party', 'current_state', 'notes'];
    let changed = false;
    for (const key of mutable) {
        if (fields[key] !== undefined) { faction[key] = fields[key]; changed = true; }
    }

    // Append additional keywords
    if (fields.add_keywords) {
        const extras = fields.add_keywords.split(',').map(k => k.trim()).filter(Boolean);
        for (const kw of extras) if (!faction.keywords.includes(kw)) faction.keywords.push(kw);
        changed = true;
    }

    if (fields.summary) {
        faction.history.push({ summary: fields.summary });
        changed = true;
    }

    if (!changed) { console.warn(`[${MODULE_NAME}] FACTION_UPDATE: no recognised mutable fields`); return false; }

    await rebuildFactionLoreEntry(slug, settings);
    console.log(`[${MODULE_NAME}] Faction updated: "${fields.name}"`);
    return true;
}

// ── REPUTATION_UPDATE handler ─────────────────────────────────────────────────

async function applyReputationUpdate(raw, settings) {
    const fields  = parseFields(raw);
    const faction = fields.faction || fields.name;
    if (!faction) { console.warn(`[${MODULE_NAME}] REPUTATION_UPDATE missing faction`); return false; }

    const slug  = slugify(faction);
    const state = getCharState();

    if (!state.reputation[slug]) {
        const seed = initialStanding();
        state.reputation[slug] = {
            name:        faction,
            standing:    seed,
            tier:        getTierForStanding(seed, null),
            tier_labels: null,
            history:     [],
        };
    }
    const rep = state.reputation[slug];

    // Tier labels override (comma-separated)
    if (fields.tier_labels)
        rep.tier_labels = fields.tier_labels.split(',').map(t => t.trim()).filter(Boolean);

    const prevStanding = rep.standing;
    const prevTier     = rep.tier;

    if (fields.change !== undefined) {
        const delta = parseFloat(fields.change);
        if (!isNaN(delta)) rep.standing = clampStanding(rep.standing + delta);
    }
    if (fields.standing !== undefined) {
        const abs = parseFloat(fields.standing);
        if (!isNaN(abs)) rep.standing = clampStanding(abs);
    }

    rep.tier = getTierForStanding(rep.standing, rep.tier_labels);
    rep.history.push({
        prev_standing: prevStanding,
        new_standing:  rep.standing,
        prev_tier:     prevTier,
        new_tier:      rep.tier,
        reason:        fields.reason || '',
    });

    // Sync faction name if faction lore exists
    if (!state.factions[slug]) {
        state.factions[slug] = {
            name: faction, type: '', goals: '', leadership: '', resources: '',
            attitude_to_party: 'Unknown', current_state: '', notes: '',
            keywords: [faction.toLowerCase(), slug], history: [],
        };
    }

    await rebuildFactionLoreEntry(slug, settings);
    const tierChanged = prevTier !== rep.tier;
    console.log(`[${MODULE_NAME}] Reputation "${faction}": ${prevStanding}->${rep.standing} (${rep.tier}${tierChanged ? ' — tier changed!' : ''})`);
    return true;
}

// ── Context string ────────────────────────────────────────────────────────────

function buildRepContextString(reputation) {
    const entries = Object.values(reputation);
    if (!entries.length) return '';
    const lines = ['[Faction Reputation]'];
    const max = repScaleMax();
    for (const rep of entries)
        lines.push(`  ${rep.name}: ${rep.standing}/${max} — ${rep.tier}`);
    return lines.join('\n');
}

function buildFactionContextString(factions, reputation) {
    const slugs = new Set([...Object.keys(factions), ...Object.keys(reputation)]);
    if (!slugs.size) return '';
    const lines = ['[Factions]'];
    for (const slug of slugs) {
        const f   = factions[slug];
        const rep = reputation[slug];
        const name = (f || rep).name;
        const standing = rep ? ` — ${rep.standing}/${repScaleMax()} (${rep.tier})` : '';
        lines.push(`  ${name}${standing}`);
        if (f?.goals)      lines.push(`    Goals: ${f.goals}`);
        if (f?.leadership) lines.push(`    Led by: ${f.leadership}`);
        if (f?.attitude_to_party && f.attitude_to_party !== 'Unknown')
            lines.push(`    Attitude: ${f.attitude_to_party}`);
    }
    return lines.join('\n');
}

// ── Panel HTML ────────────────────────────────────────────────────────────────

function buildRepPanelHTML(factions, reputation) {
    const slugs = new Set([...Object.keys(factions), ...Object.keys(reputation)]);
    if (!slugs.size) return '<div class="glp-panel-empty">No factions recorded.</div>';

    const def = _repDef();
    return [...slugs].map(slug => {
        const f   = factions[slug];
        const rep = reputation[slug];
        const name  = (f || rep).name;
        const span  = (def.max - def.min) || 1;
        const pct   = rep ? Math.max(0, Math.min(100, ((rep.standing - def.min) / span) * 100)) : 50;
        const tier  = rep ? rep.tier : '—';
        const tierClass = `glp-rep-${tier.toLowerCase()}`;
        const attitude  = f?.attitude_to_party && f.attitude_to_party !== 'Unknown'
            ? `<span class="glp-faction-attitude">${f.attitude_to_party}</span>` : '';
        const goals = f?.goals
            ? `<div class="glp-faction-goals">${f.goals}</div>` : '';
        return `<div class="glp-rep-row">
            <div class="glp-rep-header">
                <span class="glp-rep-name">${name}</span>
                ${attitude}
                <span class="glp-rep-tier ${tierClass}">${tier}</span>
            </div>
            <div class="glp-rep-bar-wrap">
                <div class="glp-rep-bar ${tierClass}" style="width:${pct}%"></div>
            </div>
            ${goals}
        </div>`;
    }).join('');
}

// ── Commands ──────────────────────────────────────────────────────────────────

function cmdReputation(state) {
    const rep = state.reputation || {};
    if (!Object.keys(rep).length) return '[Reputation]\nNo faction relations recorded.';
    const lines = ['[Reputation]'];
    const max = repScaleMax();
    for (const r of Object.values(rep)) {
        lines.push(`  ${r.name}: ${r.standing}/${max} (${r.tier})`);
        if (r.history.length) {
            const last = r.history[r.history.length - 1];
            if (last.reason) lines.push(`    Last: ${last.reason}`);
        }
    }
    return lines.join('\n');
}

function cmdFactions(state) {
    const factions    = state.factions    || {};
    const reputation  = state.reputation  || {};
    const slugs = new Set([...Object.keys(factions), ...Object.keys(reputation)]);
    if (!slugs.size) return '[Factions]\nNo factions recorded.';

    const lines = ['[Factions]'];
    for (const slug of slugs) {
        const f   = factions[slug];
        const rep = reputation[slug];
        const name     = (f || rep).name;
        const standing = rep ? ` (${rep.standing}/${repScaleMax()}, ${rep.tier})` : '';
        lines.push(`  ${name}${standing}`);
        if (f?.type)              lines.push(`    Type: ${f.type}`);
        if (f?.leadership)        lines.push(`    Leadership: ${f.leadership}`);
        if (f?.goals)             lines.push(`    Goals: ${f.goals}`);
        if (f?.attitude_to_party && f.attitude_to_party !== 'Unknown')
            lines.push(`    Attitude: ${f.attitude_to_party}`);
        if (f?.current_state)     lines.push(`    State: ${f.current_state}`);
    }
    return lines.join('\n');
}
