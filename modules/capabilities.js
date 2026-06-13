/**
 * gm-lore-parser / modules/capabilities.js
 * Unified "capability" primitive — merges the former Abilities (static
 * boon/title/passive/trait/evolution) and Skills (progressing) subsystems.
 *
 * A capability's CATEGORY says WHAT it is (vocabulary, exclusivity, default
 * activation); its PROGRESSION PROFILE says HOW it advances (or not). The two are
 * orthogonal, so a system can make titles progress or skills static — PP/tier is
 * just one built-in profile, not hardcoded.
 *
 * Blocks:
 *   [CAPABILITY_BEGIN] … [CAPABILITY_END]
 *     name, category, progression, activation, description, effects, entity,
 *     active, stat_changes, governing, keywords
 *   [CAPABILITY_UPDATE_BEGIN] … [CAPABILITY_UPDATE_END]   (multi-record; repeat `capability:`)
 *     capability, points, level, governing, branch, active, category, progression
 *
 * Stored in state.capabilities (keyed map). System Definition: def.capabilities
 * (categories/exclusivity/category→progression) + def.progressions (named profiles).
 */

// ── Config / profile resolution ─────────────────────────────────────────────

function capabilityCfg() {
    const c = getSystemDef().capabilities || {};
    return {
        categories:         c.categories         || ['boon', 'title', 'passive', 'trait', 'evolution', 'skill'],
        default_category:   c.default_category   || 'boon',
        default_activation: c.default_activation || 'always',
        exclusive_category: c.exclusive_category || 'title',
        category_progression: c.category_progression || {},
        inspect_capability: ('inspect_capability' in c) ? c.inspect_capability : 'awareness',
    };
}

function progressionProfiles() {
    const ps = getSystemDef().progressions;
    return (Array.isArray(ps) && ps.length) ? ps : [{ id: 'none', type: 'none' }];
}

function getProgressionId(cap) {
    if (cap.progression_id) return cap.progression_id;
    return capabilityCfg().category_progression[cap.category] || 'none';
}

function getProgression(cap) {
    const id = getProgressionId(cap);
    return progressionProfiles().find(p => p.id === id) || { id: 'none', type: 'none' };
}

function progIsProgressing(p) { return p && p.type && p.type !== 'none'; }
function progTierNames(p)  { return (p && p.tier_names) || DEFAULT_TIER_NAMES; }
function progLpt(p)        { return (p && p.levels_per_tier) ?? 10; }
function progCost(p, vars) {
    const tr = vars.tier_rank || 1;
    return Math.max(1, Math.round(evalFormula(p && p.cost_formula, vars, 100 * tr)));
}
function progHasScore(p)   { return !!(p && p.score_formula); }
function progScore(p, vars){ return Math.round(evalFormula(p.score_formula, vars, 10)); }

// ── State helpers ───────────────────────────────────────────────────────────

function _capId(category, owner, slug) { return `${category}:${owner}:${slug}`; }
function _nextCapSeq(state) { let m = 0; for (const c of Object.values(state.capabilities || {})) if ((c.seq || 0) > m) m = c.seq; return m + 1; }
function _ownCaps(state, owner) {
    return Object.values(state.capabilities || {}).filter(c => c.entity_slug === owner).sort((a, b) => (a.seq || 0) - (b.seq || 0));
}
function findCapability(state, owner, name) {
    const slug = slugify(name);
    return Object.values(state.capabilities || {}).find(c => c.entity_slug === owner && slugify(c.name) === slug);
}

/** Sum of progressing capability levels for one owner (drives score_formula's total_levels). */
function recalcTotalLevels(owner) {
    let total = 0;
    for (const cap of _ownCaps(getCharState(), owner)) {
        const p = getProgression(cap);
        if (p.type === 'points_tiers' || p.type === 'xp_levels') total += cap.prog.tier_idx * progLpt(p) + cap.prog.level + 1;
        else if (p.type === 'counter' || p.type === 'use_tracked' || p.type === 'milestone') total += (cap.prog.level || 0);
    }
    return total;
}

function _newProg(p) {
    const prog = { tier_idx: 0, level: 0, points: 0, points_needed: 0, total_levels: 0, score: 0, branches: [] };
    if (p.type === 'points_tiers' || p.type === 'xp_levels') {
        prog.points_needed = progCost(p, { tier_rank: 1, skill_level: 0 });
        prog.total_levels = 1; // Novice Lv0 counts as 1 for the level-cap formula
    }
    return prog;
}

// ── CAPABILITY_BEGIN ──────────────────────────────────────────────────────────

async function processCapabilityBlock(fields, settings) {
    const state = getCharState();
    if (!fields.name) { console.warn(`[${MODULE_NAME}] CAPABILITY missing name`); return false; }

    const cfg       = capabilityCfg();
    const category  = (fields.category || cfg.default_category).toLowerCase();
    const owner     = fields.entity ? slugify(fields.entity) : 'player';
    const slug      = slugify(fields.name);
    const id        = _capId(category, owner, slug);
    const keywords  = fields.keywords ? normalizeKeys(fields.keywords.split(',')) : expandNameKeys(fields.name);
    const isExclusive = category === cfg.exclusive_category;
    const makeActive  = isExclusive && (fields.active === undefined || fields.active === 'true' || fields.active === true);

    if (makeActive)
        for (const c of Object.values(state.capabilities))
            if (c.category === cfg.exclusive_category && c.entity_slug === owner) c.active = false;

    const existing = state.capabilities[id];
    const cap = {
        id, seq: existing?.seq ?? _nextCapSeq(state),
        name:        fields.name,
        category,
        entity_slug: owner,
        activation:  fields.activation || cfg.default_activation,
        description: fields.description || '',
        effects:     fields.effects     || '',
        active:      isExclusive ? makeActive : true,
        stat_changes: fields.stat_changes || '',
        governing:   fields.governing || existing?.governing || '',
        keywords,
        progression_id: fields.progression || cfg.category_progression[category] || 'none',
        prog: existing?.prog || null,
    };
    if (!cap.prog) cap.prog = _newProg(getProgression(cap));
    state.capabilities[id] = cap;

    // stat_changes apply once on declaration (the former "evolution" behavior, now generic)
    if (fields.stat_changes && owner === 'player') _applyCapabilityStatChanges(fields.stat_changes, fields.name);

    if (settings.campaignLorebook) {
        await upsertEntry(settings.campaignLorebook, {
            ...entryBase(`[Capability] ${fields.name}`, keywords, _capabilityEntryContent(cap),
                settings.loreOrder, settings, { type: 'CAPABILITY', category, slug, entity_slug: owner, progression: cap.progression_id }),
        });
    }
    console.log(`[${MODULE_NAME}] Capability recorded: ${cap.name} (${category}/${cap.progression_id})`);
    return true;
}

/** Apply "attr:+N, attr:-N" deltas to the player as a logged gm_event change. */
function _applyCapabilityStatChanges(raw, srcName) {
    const state = getCharState();
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
    const lines = [`reason: Capability — ${srcName}`, ...Object.entries(abs).map(([k, v]) => `${k}: ${v}`)];
    if (typeof playerEntityEvent === 'function') playerEntityEvent(parseFields(lines.join('\n')));
}

function _capabilityEntryContent(cap) {
    const lines = [`[${cap.category[0].toUpperCase() + cap.category.slice(1)}] ${cap.name}`];
    if (cap.activation && cap.activation !== 'always') lines.push(`Activation: ${cap.activation}`);
    if (cap.description) lines.push(`Description: ${cap.description}`);
    if (cap.effects)     lines.push(`Effects: ${cap.effects}`);
    if (cap.governing)   lines.push(`Governing: ${cap.governing}`);
    if (cap.stat_changes)lines.push(`Stat changes: ${cap.stat_changes}`);
    const p = getProgression(cap);
    if (progIsProgressing(p)) {
        const tier = progTierNames(p)[cap.prog.tier_idx] || `Tier ${cap.prog.tier_idx + 1}`;
        lines.push(`Progression: ${tier} Lv${cap.prog.level}${progHasScore(p) ? ` | Score ${cap.prog.score}` : ''}`);
    }
    if (cap.category === capabilityCfg().exclusive_category) lines.push(`Active: ${cap.active}`);
    return lines.join('\n');
}

// ── CAPABILITY_UPDATE ─────────────────────────────────────────────────────────

function applyCapabilityUpdate(raw) {
    const state = getCharState();
    const notifications = [];

    // Split into per-capability records (repeat `capability:`)
    const records = [];
    let cur = null;
    for (const line of raw.split('\n')) {
        const colon = line.indexOf(':'); if (colon === -1) continue;
        const key = line.slice(0, colon).trim().toLowerCase();
        const val = line.slice(colon + 1).trim();
        if (key === 'capability' || key === 'skill') {
            if (cur) records.push(cur);
            cur = { name: val, points: 0, level: null, governing: '', branches: [], active: null, category: '', progression: '' };
        } else if (cur) {
            if (key === 'points' || key === 'pp') cur.points = parseInt(val) || 0;
            else if (key === 'level')       cur.level = parseInt(val);
            else if (key === 'governing')   cur.governing = val;
            else if (key === 'branch')      cur.branches = val.split(',').map(s => s.trim()).filter(Boolean);
            else if (key === 'active')      cur.active = (val === 'true' || val === true);
            else if (key === 'category')    cur.category = val.toLowerCase();
            else if (key === 'progression') cur.progression = val;
        }
    }
    if (cur) records.push(cur);

    const cfg = capabilityCfg();
    for (const rec of records) {
        const owner = 'player';
        let cap = findCapability(state, owner, rec.name);
        if (!cap) {
            // Lazy-create (mirrors old SKILL_UPDATE auto-create). Default to a progressing
            // category if the system declares one, else the default category.
            const category = (rec.category || _firstProgressingCategory() || cfg.default_category).toLowerCase();
            const fields = { name: rec.name, category, progression: rec.progression, governing: rec.governing };
            const id = _capId(category, owner, slugify(rec.name));
            cap = {
                id, seq: _nextCapSeq(state), name: rec.name, category, entity_slug: owner,
                activation: cfg.default_activation, description: '', effects: '',
                active: category === cfg.exclusive_category ? false : true, stat_changes: '',
                governing: rec.governing || '', keywords: expandNameKeys(rec.name),
                progression_id: rec.progression || cfg.category_progression[category] || 'none', prog: null,
            };
            cap.prog = _newProg(getProgression(cap));
            state.capabilities[id] = cap;
        }
        if (rec.governing && !cap.governing) cap.governing = rec.governing;

        // Branch unlocks (per-capability)
        for (const branch of rec.branches) {
            if (!cap.prog.branches.find(b => b.branch === branch)) {
                cap.prog.branches.push({ branch, tier_idx: cap.prog.tier_idx, level: cap.prog.level, unlocked_at: new Date().toISOString() });
                notifications.push({ type: 'branch', msg: `${cap.name}: [${branch}] unlocked!` });
            }
        }

        // Exclusivity toggle
        if (rec.active !== null) {
            cap.active = rec.active;
            if (rec.active && cap.category === cfg.exclusive_category)
                for (const c of Object.values(state.capabilities))
                    if (c !== cap && c.category === cfg.exclusive_category && c.entity_slug === owner) c.active = false;
        }

        _advanceCapability(cap, rec, notifications);
    }
    return notifications;
}

function _firstProgressingCategory() {
    const cp = capabilityCfg().category_progression;
    for (const [cat, prof] of Object.entries(cp)) if (prof && prof !== 'none') return cat;
    return null;
}

/** Apply progression per the capability's profile type. */
function _advanceCapability(cap, rec, notifications) {
    const p = getProgression(cap);
    const prog = cap.prog;

    switch (p.type) {
        case 'counter':
            if (rec.level !== null && !isNaN(rec.level)) prog.level = rec.level;
            else prog.level += (rec.points || 1);
            notifications.push({ type: 'level', msg: `${cap.name}: Level ${prog.level}` });
            break;
        case 'use_tracked': {
            const threshold = p.threshold || 5;
            prog.points += (rec.points || 1);
            while (prog.points >= threshold) { prog.points -= threshold; prog.level += 1; notifications.push({ type: 'level', msg: `${cap.name}: Level ${prog.level}` }); }
            break;
        }
        case 'milestone':
            if (rec.level !== null && !isNaN(rec.level)) { prog.level = rec.level; notifications.push({ type: 'level', msg: `${cap.name}: reached milestone ${prog.level}` }); }
            break;
        case 'points_tiers':
        case 'xp_levels': {
            if (rec.points <= 0) break;
            const lpt = progLpt(p);
            prog.points += rec.points;
            let advanced = false;
            while (prog.points >= prog.points_needed) {
                prog.points -= prog.points_needed;
                prog.level  += 1;
                prog.total_levels = prog.tier_idx * lpt + prog.level + 1;
                advanced = true;
                if (prog.level >= lpt) {
                    const tierNames = progTierNames(p);
                    const next = prog.tier_idx + 1;
                    if (next < tierNames.length) {
                        prog.tier_idx = next; prog.level = 0;
                        prog.points_needed = progCost(p, { tier_rank: next + 1, skill_level: prog.tier_idx * lpt });
                        notifications.push({ type: 'tier', msg: `${cap.name}: Advanced to ${tierNames[next]}!` });
                    } else { prog.level = lpt; prog.points = 0; notifications.push({ type: 'tier', msg: `${cap.name}: Maximum mastery achieved!` }); }
                } else {
                    notifications.push({ type: 'level', msg: `${cap.name}: ${progTierNames(p)[prog.tier_idx]} Lv${prog.level}` });
                }
            }
            if (advanced) prog.points_needed = progCost(p, { tier_rank: prog.tier_idx + 1, skill_level: prog.tier_idx * lpt + prog.level });
            break;
        }
        default: break; // 'none'
    }

    if (progHasScore(p))
        prog.score = progScore(p, { total_levels: recalcTotalLevels(cap.entity_slug), skill_level: prog.tier_idx * progLpt(p) + prog.level });
}

// ── Context / panel ───────────────────────────────────────────────────────────

function buildCapabilityContextString(caps) {
    const own = _ownCaps({ capabilities: caps }, 'player');
    if (!own.length) return '';
    const cfg = capabilityCfg();
    const parts = [];
    const activeExclusive = own.find(c => c.category === cfg.exclusive_category && c.active);
    if (activeExclusive) parts.push(`Active ${cfg.exclusive_category[0].toUpperCase() + cfg.exclusive_category.slice(1)}: ${activeExclusive.name}`);
    const staticNamed = own.filter(c => c.category !== cfg.exclusive_category && !progIsProgressing(getProgression(c))).map(c => c.name);
    if (staticNamed.length) parts.push(`Abilities: ${staticNamed.join(', ')}`);
    const progressing = own.filter(c => progIsProgressing(getProgression(c)));
    if (progressing.length) {
        const lines = ['[Skills]'];
        for (const c of progressing) {
            const p = getProgression(c);
            const tier = progTierNames(p)[c.prog.tier_idx] || `Tier ${c.prog.tier_idx + 1}`;
            lines.push(`${c.name}: ${tier} Lv${c.prog.level}${progHasScore(p) ? ` | Score ${c.prog.score}` : ''}`);
        }
        parts.push(lines.join('\n'));
    }
    return parts.join('\n');
}

function buildCapabilityPanelHTML(caps, settings) {
    const own = _ownCaps({ capabilities: caps }, 'player');
    if (!own.length) return '';
    const cfg = capabilityCfg();
    const titles = own.filter(c => c.category === cfg.exclusive_category);
    const staticNon = own.filter(c => c.category !== cfg.exclusive_category && !progIsProgressing(getProgression(c)));
    const progressing = own.filter(c => progIsProgressing(getProgression(c)));

    // Header for the exclusive group derives from the configured category name
    // (e.g. exclusive_category 'title' → "Titles", 'mark' → "Marks").
    const exLabel = cfg.exclusive_category
        ? cfg.exclusive_category[0].toUpperCase() + cfg.exclusive_category.slice(1) + 's' : '';

    const sections = [];
    if (settings.showBoonPanel && (titles.length || staticNon.length)) {
        const titleRows = titles.map(t =>
            `<div class="glp-title-row${t.active ? ' glp-title-active' : ''}"><span class="glp-title-name">${t.active ? '★ ' : ''}${t.name}</span>${t.description ? `<span class="glp-title-desc">${t.description}</span>` : ''}</div>`).join('');
        const abilityRows = staticNon.map(a =>
            `<details class="glp-boon-row"><summary class="glp-boon-name">${a.name} <span class="glp-boon-type">[${a.category}]</span></summary>${a.description ? `<div class="glp-boon-desc">${a.description}</div>` : ''}${a.effects ? `<div class="glp-boon-effects">${a.effects}</div>` : ''}</details>`).join('');
        sections.push(`<div class="glp-panel-section glp-boons-section">${titles.length ? `<div class="glp-boons-titles"><b>${exLabel}</b>${titleRows}</div>` : ''}${staticNon.length ? `<div class="glp-boons-list"><b>Abilities</b>${abilityRows}</div>` : ''}</div>`);
    }
    if (settings.showSkillPanel && progressing.length) {
        const rows = progressing.map(c => {
            const p = getProgression(c);
            const tier = progTierNames(p)[c.prog.tier_idx] || `Tier ${c.prog.tier_idx + 1}`;
            const pct  = c.prog.points_needed > 0 ? Math.min(100, (c.prog.points / c.prog.points_needed) * 100) : 0;
            return `<div class="glp-skill-row"><div class="glp-skill-name">${c.name}</div><div class="glp-skill-tier">${tier} Lv${c.prog.level}</div><div class="glp-skill-bar-wrap"><div class="glp-skill-bar" style="width:${pct}%"></div></div><div class="glp-skill-pp">${c.prog.points}/${c.prog.points_needed}</div>${progHasScore(p) ? `<div class="glp-skill-score">Score ${c.prog.score}</div>` : ''}</div>`;
        }).join('');
        sections.push(`<div class="glp-panel-section glp-skills-section">${rows}</div>`);
    }
    return sections.join('');
}

// ── Generic command view (triggers are wired by the command-definition system) ──

function cmdCapabilityView(state, filter = {}) {
    const cfg = capabilityCfg();
    let caps = _ownCaps(state, 'player');
    if (filter.category)    caps = caps.filter(c => c.category === filter.category);
    if (filter.exclusive)   caps = caps.filter(c => c.category === cfg.exclusive_category);
    if (filter.progressing) caps = caps.filter(c => progIsProgressing(getProgression(c)));
    if (filter.static)      caps = caps.filter(c => c.category !== cfg.exclusive_category && !progIsProgressing(getProgression(c)));
    if (!caps.length) return '[Capabilities]\nNothing recorded.';

    if (filter.exclusive)
        return caps.map(t => `${t.active ? '★ ' : '○ '}**${t.name}**${t.description ? ' — ' + t.description : ''}`).join('\n');

    if (filter.progressing) {
        const lines = ['[Skills]'];
        for (const c of caps) {
            const p = getProgression(c);
            const tier = progTierNames(p)[c.prog.tier_idx] || `Tier ${c.prog.tier_idx + 1}`;
            lines.push(`  ${c.name}: ${tier} Lv${c.prog.level} | ${c.prog.points}/${c.prog.points_needed}${progHasScore(p) ? ` | Score ${c.prog.score}` : ''}`);
            const br = c.prog.branches?.map(b => b.branch) || [];
            if (br.length) lines.push(`    Branches: ${br.join(', ')}`);
        }
        return lines.join('\n');
    }

    // category / static / all
    const lines = ['[Capabilities]'];
    for (const c of caps) {
        const lead = c.category === cfg.exclusive_category ? (c.active ? '★ ' : '○ ') : '• ';
        lines.push(`${lead}**${c.name}** [${c.category}]${c.effects ? ` — ${c.effects}` : c.description ? ` — ${c.description}` : ''}`);
    }
    return lines.join('\n');
}
