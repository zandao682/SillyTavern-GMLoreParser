/**
 * gm-lore-parser / modules/system.js
 * System Definition — the per-campaign ruleset that makes the extension
 * system-agnostic. Defines attributes, derived-stat formulas, reputation
 * scale/tiers, skill model, ranks, needs, item conditions, loyalty, the
 * optional class catalogue, and which subsystems (features) are enabled.
 *
 * The definition is authored once via a [SYSTEM_DEF] block, cached in
 * chatMetadata for synchronous access, and persisted to the campaign
 * lorebook (a constant entry) so it is portable and survives reloads.
 *
 * Loaded after `lorebook` (needs entryBase/upsertEntry) and before every
 * consumer (`schema`, `skills`, `creation`, `reputation`, `needs`, …).
 *
 * Veridia values are the built-in DEFAULT_SYSTEM_DEF, so with no authored
 * definition the extension behaves exactly as before.
 */

var SYSTEM_DEF_COMMENT = '[System Definition]';
var FORMULA_SAFE_RE    = /^[\d\s+\-*/().]+$/;

var ALL_FEATURES = [
    'capabilities', 'ranks', 'reputation', 'currency', 'needs',
    'companions', 'domains', 'quests', 'world_events', 'equipment',
];

var DEFAULT_SYSTEM_DEF = Object.freeze({
    name: 'Default (Veridia)',
    schema_version: 6,
    emit_rule_entries: true,         // generate keyword-triggered [System Rule] lorebook entries
    rules: null,                     // optional per-rule author overrides (keys/content); null → derived defaults
    features: Object.freeze({
        capabilities: true, ranks: true, reputation: true, currency: true, needs: true,
        companions: true, domains: true, quests: true, world_events: true,
    }),
    identity: Object.freeze({
        fields: Object.freeze([
            Object.freeze({ key: 'class',      label: 'Class' }),
            Object.freeze({ key: 'background', label: 'Background' }),
        ]),
    }),
    progression: Object.freeze({
        uses_levels: true, level_field: 'level', level_start: 1,
        uses_xp: true, xp_field: 'xp', leveling: 'xp',
    }),
    creation: Object.freeze({ method: 'point_buy', ap_pool: 100, ap_cost_tiers: [] }),
    classes: Object.freeze({ enabled: false, options: [] }),
    attributes: Object.freeze([
        Object.freeze({ key: 'fortitude', label: 'Fortitude', abbr: 'FOR' }),
        Object.freeze({ key: 'might',     label: 'Might',     abbr: 'MGT' }),
        Object.freeze({ key: 'intellect', label: 'Intellect', abbr: 'INT' }),
        Object.freeze({ key: 'resolve',   label: 'Resolve',   abbr: 'RES' }),
        Object.freeze({ key: 'agility',   label: 'Agility',   abbr: 'AGI' }),
        Object.freeze({ key: 'wits',      label: 'Wits',      abbr: 'WIT' }),
        Object.freeze({ key: 'perception',label: 'Perception',abbr: 'PER' }),
        Object.freeze({ key: 'presence',  label: 'Presence',  abbr: 'PRE' }),
    ]),
    derived_stats: Object.freeze([
        Object.freeze({ key: 'hp',    target: 'hp',    also: Object.freeze(['hp_max']),    formula: '(fortitude*5)+(might*2)+(level*10)' }),
        Object.freeze({ key: 'mp',    target: 'mp',    also: Object.freeze(['mp_max']),    formula: '(intellect*3)+(resolve*3)+(level*5)' }),
        Object.freeze({ key: 'vigor', target: 'vigor', also: Object.freeze(['vigor_max']), formula: '(might*3)+(agility*3)+(level*5)' }),
    ]),
    variables: Object.freeze([ Object.freeze({ key: 'level', default: 1 }) ]),
    reputation: Object.freeze({
        scale_min: 0, scale_max: 100, initial: 50,
        tiers: Object.freeze(['Hostile', 'Cold', 'Neutral', 'Friendly', 'Allied', 'Sworn']),
    }),
    // ── Capabilities (unified abilities + skills) ──
    capabilities: Object.freeze({
        categories: Object.freeze(['boon', 'title', 'passive', 'trait', 'evolution', 'skill']),
        default_category: 'boon', default_activation: 'always', exclusive_category: 'title',
        // category → progression-profile id (anything unlisted = 'none')
        category_progression: Object.freeze({ skill: 'veridia_pp' }),
        // capability whose tier gates #inspect detail (null → no perception gating)
        inspect_capability: 'awareness',
    }),
    // ── Progression profiles a capability can reference (Veridia PP/tier is one of them) ──
    progressions: Object.freeze([
        Object.freeze({ id: 'none', type: 'none' }),
        Object.freeze({ id: 'veridia_pp', type: 'points_tiers', tier_names: null, levels_per_tier: 10,
            cost_formula: '100 * tier_rank', score_formula: '10 + total_levels * 2.5', points_label: 'PP' }),
        Object.freeze({ id: 'use_tracked', type: 'use_tracked', threshold: 5, score_formula: 'skill_level' }),
        Object.freeze({ id: 'simple_level', type: 'counter', score_formula: 'skill_level' }),
        Object.freeze({ id: 'xp_rank', type: 'xp_levels', tier_names: null, levels_per_tier: 10,
            cost_formula: '50 * (skill_level + 1)', score_formula: 'skill_level' }),
        Object.freeze({ id: 'milestone', type: 'milestone', tier_names: null }),
    ]),
    rank_ladder: null,               // null → fall back to RANK_LADDER
    needs: Object.freeze({ warn_threshold: 30, critical_threshold: 10 }),
    item_conditions: null,           // null → fall back to ITEM_CONDITIONS
    loyalty: Object.freeze({ scale_min: 0, scale_max: 100, initial: 50 }),

    // ── Conflict resolution (documentation only — the extension never rolls) ──
    resolution: Object.freeze({
        mechanic:   'd20 + modifier vs. DC',
        dice:       'd20',
        difficulty: 'Easy 10 / Medium 15 / Hard 20 / Very Hard 25',
        crit:       'Natural 20 = critical success; natural 1 = critical failure',
        notes:      'The GM narrates and resolves checks; the extension never rolls dice.',
    }),

    // ── Subsystem vocabularies (optional; defaults preserve current behavior) ──
    quests: Object.freeze({
        categories: Object.freeze(['Main', 'Side', 'Personal', 'Guild']),
        statuses:   Object.freeze(['Active', 'Paused', 'Completed', 'Failed']),
        default_category: 'Side', default_status: 'Active',
    }),
    world_events: Object.freeze({
        statuses:   Object.freeze(['Ongoing', 'Averted', 'Resolved']),
        plot_types: Object.freeze(['Ongoing', 'Historical', 'Rumour']),
        default_status: 'Ongoing',
    }),
    factions: Object.freeze({
        attitudes: Object.freeze(['Unknown', 'Hostile', 'Wary', 'Neutral', 'Cordial', 'Allied']),
        default_attitude: 'Unknown',
    }),
    companions: Object.freeze({
        roles:    Object.freeze(['standard', 'lieutenant']),
        statuses: Object.freeze(['Active', 'Inactive', 'Dismissed', 'Dead']),
        default_role: 'standard', lieutenant_role: 'lieutenant', default_status: 'Active',
    }),

    // ── Possessions (configurable; optional) ──
    inventory: Object.freeze({ model: 'freeform', capacity: null, unit: 'slots', item_box: false }),
    equipment: Object.freeze({ enabled: false, slots: Object.freeze([]) }),

    // ── Locations (first-class lore; instances optional) ──
    locations: Object.freeze({
        types: Object.freeze(['Settlement', 'Wilderness', 'Dungeon', 'Landmark', 'Instance']),
        create_history_lorebook: true,
        instances: Object.freeze({ enabled: false, types: Object.freeze(['Solo', 'Party', 'Raid']) }),
    }),

    // ── Custom command set (optional; null → all built-ins active) ──
    commands: null,

    // ── Presentation / display tuning (optional) ──
    presentation: Object.freeze({
        bar_warn_pct: 50, bar_danger_pct: 25, max_pips: 20, ascii_bar_width: 20, empty_label: 'None',
    }),
});

// ── Accessors ──────────────────────────────────────────────────────────────────

/** Synchronous, cached. Returns the authored def or the Veridia default. */
function getSystemDef() {
    const { chatMetadata } = SillyTavern.getContext();
    const s = chatMetadata[MODULE_NAME];
    return (s && s.system_def) ? s.system_def : DEFAULT_SYSTEM_DEF;
}

/** Convenience: the array of attribute descriptors for the active def. */
function getAttributes()    { return getSystemDef().attributes || []; }
/** Convenience: is an optional subsystem enabled in the active def? */
function featureOn(name)     { const f = getSystemDef().features || {}; return f[name] !== false; }
/** Convenience: the rank ladder (def → fallback). */
function getRankLadder()    { return getSystemDef().rank_ladder || RANK_LADDER; }
/** Convenience: the item-condition tiers (def → fallback). */
function getItemConditions() { return getSystemDef().item_conditions || ITEM_CONDITIONS; }
/** Convenience: presentation/display tuning (def → fallback). */
function presentationCfg() {
    const p = getSystemDef().presentation || {};
    return {
        bar_warn_pct:    p.bar_warn_pct    ?? 50,
        bar_danger_pct:  p.bar_danger_pct  ?? 25,
        max_pips:        p.max_pips        ?? 20,
        ascii_bar_width: p.ascii_bar_width ?? 20,
        empty_label:     p.empty_label     || 'None',
    };
}

// ── Safe formula evaluator ───────────────────────────────────────────────────
// Substitutes named variables (longest-first, word-boundary) then evaluates the
// arithmetic with a strict character whitelist. Used by derived stats AND skills.

function evalFormula(formula, vars, fallback = 0) {
    if (typeof formula !== 'string') return fallback;
    try {
        let expr = formula;
        const names = Object.keys(vars || {}).sort((a, b) => b.length - a.length);
        for (const n of names) {
            const num = Number(vars[n]);
            expr = expr.replace(new RegExp('\\b' + escapeRegex(n) + '\\b', 'g'),
                                 Number.isFinite(num) ? String(num) : '0');
        }
        if (!FORMULA_SAFE_RE.test(expr)) return fallback;
        const out = Function('"use strict"; return (' + expr + ')')();
        return Number.isFinite(out) ? out : fallback;
    } catch { return fallback; }
}

// ── Block parsing ──────────────────────────────────────────────────────────────

/** Group a SYSTEM_DEF block into top-level sections.
 *  Returns { sectionName: { inline: string, lines: [string] } } where `lines`
 *  are the indented body lines (leading indentation stripped of one level). */
function _groupSections(raw) {
    const sections = {};
    let cur = null;
    for (const line of raw.split('\n')) {
        if (!line.trim()) continue;
        const indented = /^\s/.test(line);
        if (!indented) {
            const colon = line.indexOf(':');
            const key   = (colon === -1 ? line : line.slice(0, colon)).trim().toLowerCase();
            const inline = colon === -1 ? '' : line.slice(colon + 1).trim();
            sections[key] = { inline, lines: [] };
            cur = sections[key];
        } else if (cur) {
            cur.lines.push(line.replace(/^\s+/, ''));
        }
    }
    return sections;
}

function _parseScale(str) {
    const m = String(str).match(/(-?\d+)\s*[-–]\s*(-?\d+)/);
    return m ? { min: parseInt(m[1]), max: parseInt(m[2]) } : null;
}

function _kvLines(lines) {
    const o = {};
    for (const l of lines) {
        const c = l.indexOf(':'); if (c === -1) continue;
        o[l.slice(0, c).trim().toLowerCase()] = l.slice(c + 1).trim();
    }
    return o;
}

function _bool(v, dflt) {
    if (v === undefined || v === '') return dflt;
    return /^(true|yes|on|1)$/i.test(String(v).trim());
}

function _csv(v) { return String(v || '').split(',').map(s => s.trim()).filter(Boolean); }

/** Parse a [SYSTEM_DEF] block body into a (partial) def object, then merge over
 *  the defaults so omitted sections keep Veridia behavior. */
function parseSystemDef(raw) {
    const sec = _groupSections(raw);
    const parsed = {};

    if (sec.name) parsed.name = sec.name.inline || sec.name.lines.join(' ') || DEFAULT_SYSTEM_DEF.name;

    if (sec.emit_rule_entries) parsed.emit_rule_entries = _bool(sec.emit_rule_entries.inline, true);

    // rules: per-rule author overrides — `rule: <id>` opens an entry; indented
    // `keywords:` (added to derived keys) and `content:` (replaces derived prose).
    if (sec.rules) {
        const rules = {};
        let cur = null, curId = null;
        for (const l of sec.rules.lines) {
            const m = l.match(/^rule\s*:(.*)$/i);
            if (m) { curId = slugify(m[1].trim()); cur = { keywords: [], content: '' }; if (curId) rules[curId] = cur; }
            else if (cur) {
                const c = l.indexOf(':'); if (c === -1) continue;
                const k = l.slice(0, c).trim().toLowerCase(), v = l.slice(c + 1).trim();
                if (k === 'keywords')     cur.keywords = _csv(v);
                else if (k === 'content') cur.content = v;
            }
        }
        if (Object.keys(rules).length) parsed.rules = rules;
    }

    // features: flat comma list of ENABLED features; anything omitted → false
    if (sec.features) {
        const enabled = new Set(_csv(sec.features.inline || sec.features.lines.join(',')).map(s => s.toLowerCase()));
        parsed.features = {};
        for (const f of ALL_FEATURES) parsed.features[f] = enabled.has(f);
    }

    // identity: rows of `key | label`
    if (sec.identity) {
        const fields = [];
        for (const l of sec.identity.lines) {
            const [key, label] = l.split('|').map(s => s.trim());
            if (key) fields.push({ key: key.toLowerCase(), label: label || key });
        }
        parsed.identity = { fields };
    }

    if (sec.progression) {
        const kv = _kvLines(sec.progression.lines);
        parsed.progression = {
            uses_levels: _bool(kv.levels ?? kv.uses_levels, true),
            level_field: kv.level_field || 'level',
            level_start: parseInt(kv.level_start) || 1,
            uses_xp: _bool(kv.xp ?? kv.uses_xp, true),
            xp_field: kv.xp_field || 'xp',
            leveling: kv.leveling || 'xp',
        };
    }

    if (sec.creation) {
        const kv = _kvLines(sec.creation.lines);
        parsed.creation = {
            method: kv.method || 'point_buy',
            ap_pool: parseInt(kv.ap_pool) || 0,
            ap_cost_tiers: _csv(kv.ap_cost_tiers),
        };
    }

    // classes: `option: Name | category` opens an option; indented props follow
    if (sec.classes) {
        const kv = _kvLines(sec.classes.lines.filter(l => !/^option\s*:/i.test(l)));
        const options = [];
        let cur = null;
        for (const l of sec.classes.lines) {
            const m = l.match(/^option\s*:(.*)$/i);
            if (m) {
                const [name, category] = m[1].split('|').map(s => s.trim());
                cur = { key: slugify(name || ''), name: name || '', category: (category || 'class').toLowerCase(),
                        attribute_mods: {}, grants_skills: [], grants_abilities: [], restrictions: '', notes: '' };
                options.push(cur);
            } else if (cur) {
                const c = l.indexOf(':'); if (c === -1) continue;
                const k = l.slice(0, c).trim().toLowerCase(), v = l.slice(c + 1).trim();
                if (k === 'description')       cur.description = v;
                else if (k === 'restrictions') cur.restrictions = v;
                else if (k === 'notes')        cur.notes = v;
                else if (k === 'grants_skills')    cur.grants_skills = _csv(v);
                else if (k === 'grants_abilities') cur.grants_abilities = _csv(v);
                else if (k === 'attribute_mods') {
                    for (const pair of _csv(v)) {
                        const [ak, av] = pair.split(':').map(s => s.trim());
                        if (ak) cur.attribute_mods[ak.toLowerCase()] = parseInt(av) || 0;
                    }
                }
            }
        }
        parsed.classes = { enabled: _bool(kv.enabled, options.length > 0), options };
    }

    // attributes: rows `key | label | abbr`
    if (sec.attributes) {
        const attrs = [];
        for (const l of sec.attributes.lines) {
            const [key, label, abbr] = l.split('|').map(s => s.trim());
            if (key) attrs.push({ key: key.toLowerCase(), label: label || key, abbr: abbr || '' });
        }
        if (attrs.length) parsed.attributes = attrs;
    }

    // derived: rows `key = formula -> target, also…`
    if (sec.derived) {
        const ds = [];
        for (const l of sec.derived.lines) {
            const eq = l.indexOf('='); if (eq === -1) continue;
            const key = l.slice(0, eq).trim().toLowerCase();
            let rest  = l.slice(eq + 1).trim();
            let target = key, also = [];
            const arrow = rest.indexOf('->');
            if (arrow !== -1) {
                const targets = _csv(rest.slice(arrow + 2));
                target = (targets[0] || key).toLowerCase();
                also   = targets.slice(1).map(s => s.toLowerCase());
                rest   = rest.slice(0, arrow).trim();
            }
            if (key && rest) ds.push({ key, target, also, formula: rest });
        }
        if (ds.length) parsed.derived_stats = ds;
    }

    // variables: rows `key | default`
    if (sec.variables) {
        const vars = [];
        for (const l of sec.variables.lines) {
            const [key, dflt] = l.split('|').map(s => s.trim());
            if (key) vars.push({ key: key.toLowerCase(), default: parseFloat(dflt) || 0 });
        }
        if (vars.length) parsed.variables = vars;
    }

    if (sec.reputation) {
        const kv = _kvLines(sec.reputation.lines);
        const scale = _parseScale(kv.scale) || { min: 0, max: 100 };
        parsed.reputation = {
            scale_min: scale.min, scale_max: scale.max,
            initial: kv.initial !== undefined ? parseInt(kv.initial) : Math.round((scale.min + scale.max) / 2),
            tiers: _csv(kv.tiers),
        };
        if (!parsed.reputation.tiers.length) parsed.reputation.tiers = DEFAULT_SYSTEM_DEF.reputation.tiers.slice();
    }

    // capabilities: vocabulary + per-category progression-profile mapping
    if (sec.capabilities) {
        const kv = _kvLines(sec.capabilities.lines.filter(l => !/^category_progression\s*:/i.test(l)));
        const dc = DEFAULT_SYSTEM_DEF.capabilities;
        const catProg = {};
        for (const l of sec.capabilities.lines) {
            const m = l.match(/^category_progression\s*:(.*)$/i);
            if (!m) continue;
            for (const pair of _csv(m[1])) {
                const [cat, prog] = pair.split(':').map(s => s.trim());
                if (cat) catProg[cat.toLowerCase()] = (prog || 'none').toLowerCase();
            }
        }
        parsed.capabilities = {
            categories: kv.categories ? _csv(kv.categories).map(s => s.toLowerCase()) : dc.categories.slice(),
            default_category:   (kv.default_category   || dc.default_category).toLowerCase(),
            default_activation: kv.default_activation || dc.default_activation,
            exclusive_category: kv.exclusive_category !== undefined
                ? (kv.exclusive_category.toLowerCase() || null)
                : dc.exclusive_category,
            category_progression: Object.keys(catProg).length ? catProg : { ...dc.category_progression },
            inspect_capability: kv.inspect_capability !== undefined
                ? (kv.inspect_capability.trim().toLowerCase() || null)
                : dc.inspect_capability,
        };
    }

    // progressions: `profile: <id> | <type>` opens a profile; indented props follow
    if (sec.progressions) {
        const profiles = [];
        let cur = null;
        for (const l of sec.progressions.lines) {
            const m = l.match(/^profile\s*:(.*)$/i);
            if (m) {
                const [id, type] = m[1].split('|').map(s => s.trim());
                // keep underscores — profile ids are identifiers (veridia_pp, use_tracked, …)
                const pid = String(id || '').toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_|_$/g, '');
                cur = { id: pid, type: (type || 'none').toLowerCase() };
                if (cur.id) profiles.push(cur);
            } else if (cur) {
                const c = l.indexOf(':'); if (c === -1) continue;
                const k = l.slice(0, c).trim().toLowerCase(), v = l.slice(c + 1).trim();
                if (k === 'tier_names')        cur.tier_names = _csv(v);
                else if (k === 'levels_per_tier') cur.levels_per_tier = parseInt(v) || 10;
                else if (k === 'cost_formula')    cur.cost_formula = v;
                else if (k === 'score_formula')   cur.score_formula = v;
                else if (k === 'threshold')       cur.threshold = parseFloat(v) || 0;
                else if (k === 'points_label')    cur.points_label = v;
            }
        }
        if (profiles.length) {
            // merge over the built-in profiles so authored entries override by id
            const byId = {};
            for (const p of DEFAULT_SYSTEM_DEF.progressions) byId[p.id] = structuredClone(p);
            for (const p of profiles) byId[p.id] = { ...byId[p.id], ...p };
            parsed.progressions = Object.values(byId);
        }
    }

    if (sec.rank_ladder) {
        const ladder = _csv(sec.rank_ladder.inline || sec.rank_ladder.lines.join(','));
        if (ladder.length) parsed.rank_ladder = ladder;
    }

    if (sec.needs) {
        const kv = _kvLines(sec.needs.lines);
        parsed.needs = {
            warn_threshold:     kv.warn     !== undefined ? parseInt(kv.warn)     : DEFAULT_SYSTEM_DEF.needs.warn_threshold,
            critical_threshold: kv.critical !== undefined ? parseInt(kv.critical) : DEFAULT_SYSTEM_DEF.needs.critical_threshold,
        };
    }

    if (sec.item_conditions) {
        const conds = [];
        for (const l of sec.item_conditions.lines) {
            const c = l.indexOf(':'); if (c === -1) continue;
            conds.push({ label: l.slice(0, c).trim(), min: parseInt(l.slice(c + 1)) || 0 });
        }
        if (conds.length) parsed.item_conditions = conds.sort((a, b) => b.min - a.min);
    }

    if (sec.loyalty) {
        const kv = _kvLines(sec.loyalty.lines);
        const scale = _parseScale(kv.scale) || { min: 0, max: 100 };
        parsed.loyalty = {
            scale_min: scale.min, scale_max: scale.max,
            initial: kv.initial !== undefined ? parseInt(kv.initial) : Math.round((scale.min + scale.max) / 2),
        };
    }

    // ── Conflict resolution ──
    if (sec.resolution) {
        const kv = _kvLines(sec.resolution.lines);
        const d  = DEFAULT_SYSTEM_DEF.resolution;
        parsed.resolution = {
            mechanic:   kv.mechanic   || sec.resolution.inline || d.mechanic,
            dice:       kv.dice       || d.dice,
            difficulty: kv.difficulty || d.difficulty,
            crit:       kv.crit       || d.crit,
            notes:      kv.notes      || d.notes,
        };
    }

    // ── Subsystem vocabularies ──
    if (sec.quests) {
        const kv = _kvLines(sec.quests.lines);
        parsed.quests = {
            categories: kv.categories ? _csv(kv.categories) : DEFAULT_SYSTEM_DEF.quests.categories.slice(),
            statuses:   kv.statuses   ? _csv(kv.statuses)   : DEFAULT_SYSTEM_DEF.quests.statuses.slice(),
            default_category: kv.default_category || DEFAULT_SYSTEM_DEF.quests.default_category,
            default_status:   kv.default_status   || DEFAULT_SYSTEM_DEF.quests.default_status,
        };
    }
    if (sec.world_events) {
        const kv = _kvLines(sec.world_events.lines);
        parsed.world_events = {
            statuses:   kv.statuses   ? _csv(kv.statuses)   : DEFAULT_SYSTEM_DEF.world_events.statuses.slice(),
            plot_types: kv.plot_types ? _csv(kv.plot_types) : DEFAULT_SYSTEM_DEF.world_events.plot_types.slice(),
            default_status: kv.default_status || DEFAULT_SYSTEM_DEF.world_events.default_status,
        };
    }
    if (sec.factions) {
        const kv = _kvLines(sec.factions.lines);
        parsed.factions = {
            attitudes: kv.attitudes ? _csv(kv.attitudes) : DEFAULT_SYSTEM_DEF.factions.attitudes.slice(),
            default_attitude: kv.default_attitude || DEFAULT_SYSTEM_DEF.factions.default_attitude,
        };
    }
    if (sec.companions) {
        const kv = _kvLines(sec.companions.lines);
        parsed.companions = {
            roles:    kv.roles    ? _csv(kv.roles)    : DEFAULT_SYSTEM_DEF.companions.roles.slice(),
            statuses: kv.statuses ? _csv(kv.statuses) : DEFAULT_SYSTEM_DEF.companions.statuses.slice(),
            default_role:    kv.default_role    || DEFAULT_SYSTEM_DEF.companions.default_role,
            lieutenant_role: kv.lieutenant_role || DEFAULT_SYSTEM_DEF.companions.lieutenant_role,
            default_status:  kv.default_status  || DEFAULT_SYSTEM_DEF.companions.default_status,
        };
    }
    // ── Possessions ──
    if (sec.inventory) {
        const kv = _kvLines(sec.inventory.lines);
        parsed.inventory = {
            model:    kv.model    || 'freeform',
            capacity: kv.capacity !== undefined ? (parseFloat(kv.capacity) || null) : null,
            unit:     kv.unit     || 'slots',
            item_box: _bool(kv.item_box, false),
        };
    }
    if (sec.equipment) {
        const kv = _kvLines(sec.equipment.lines.filter(l => !/^slot\s*:/i.test(l)));
        const slots = [];
        for (const l of sec.equipment.lines) {
            const m = l.match(/^slot\s*:(.*)$/i);
            if (!m) continue;
            const [key, label] = m[1].split('|').map(s => s.trim());
            if (key) slots.push({ key: key.toLowerCase().replace(/\s+/g, '_'), label: label || key });
        }
        parsed.equipment = { enabled: _bool(kv.enabled, slots.length > 0), slots };
    }

    // ── Locations ──
    if (sec.locations) {
        const kv = _kvLines(sec.locations.lines.filter(l => !/^instance/i.test(l)));
        const inst = {};
        for (const l of sec.locations.lines) {
            const m = l.match(/^instances?[._]?(enabled|types)\s*:(.*)$/i);
            if (!m) continue;
            if (m[1].toLowerCase() === 'enabled') inst.enabled = _bool(m[2].trim(), false);
            else inst.types = _csv(m[2]);
        }
        parsed.locations = {
            types: kv.types ? _csv(kv.types) : DEFAULT_SYSTEM_DEF.locations.types.slice(),
            create_history_lorebook: _bool(kv.create_history_lorebook, true),
            instances: {
                enabled: inst.enabled ?? false,
                types: inst.types && inst.types.length ? inst.types : DEFAULT_SYSTEM_DEF.locations.instances.types.slice(),
            },
        };
    }

    // ── Presentation / display tuning ──
    if (sec.presentation) {
        const kv = _kvLines(sec.presentation.lines);
        const dp = DEFAULT_SYSTEM_DEF.presentation;
        parsed.presentation = {
            bar_warn_pct:    kv.bar_warn_pct    !== undefined ? parseFloat(kv.bar_warn_pct)    : dp.bar_warn_pct,
            bar_danger_pct:  kv.bar_danger_pct  !== undefined ? parseFloat(kv.bar_danger_pct)  : dp.bar_danger_pct,
            max_pips:        kv.max_pips        !== undefined ? parseInt(kv.max_pips)          : dp.max_pips,
            ascii_bar_width: kv.ascii_bar_width !== undefined ? parseInt(kv.ascii_bar_width)   : dp.ascii_bar_width,
            empty_label:     kv.empty_label     || dp.empty_label,
        };
    }

    // ── Custom command set: `command: <Label>` opens an entry; indented props follow ──
    if (sec.commands) {
        const cmds = [];
        let cur = null;
        for (const l of sec.commands.lines) {
            const m = l.match(/^command\s*:(.*)$/i);
            if (m) {
                cur = { label: m[1].trim(), triggers: [], view: '', template: '' };
                cmds.push(cur);
            } else if (cur) {
                const c = l.indexOf(':'); if (c === -1) continue;
                const k = l.slice(0, c).trim().toLowerCase(), v = l.slice(c + 1).trim();
                if (k === 'triggers')      cur.triggers = _csv(v).map(t => t.startsWith('#') ? t.toLowerCase() : '#' + t.toLowerCase());
                else if (k === 'view')     cur.view = v.toLowerCase();
                else if (k === 'template') cur.template = v;
                else if (k === 'label')    cur.label = v;
            }
        }
        parsed.commands = cmds.filter(c => c.triggers.length && (c.view || c.template));
    }

    return mergeWithDefaults(parsed);
}

/** Overlay a partial def onto a deep clone of the defaults. */
function mergeWithDefaults(partial) {
    const base = structuredClone(DEFAULT_SYSTEM_DEF);
    if (!partial) return base;
    for (const [k, v] of Object.entries(partial)) {
        if (v === undefined || v === null) continue;
        if (Array.isArray(v)) base[k] = v;
        else if (typeof v === 'object') base[k] = { ...base[k], ...v };
        else base[k] = v;
    }
    base.schema_version = 6;
    return base;
}

// ── Persistence ────────────────────────────────────────────────────────────────

async function saveSystemDef(def, settings) {
    const state = getCharState();
    state.system_def = def;
    await saveCharState();
    if (settings.campaignLorebook) {
        const entry = entryBase(
            SYSTEM_DEF_COMMENT, ['system definition', 'ruleset'],
            buildSystemDefSummary(def), settings.ruleOrder ?? 50, settings,
            { type: 'SYSTEM_DEF', system_def: def });
        entry.constant = true;   // always in context
        await upsertEntry(settings.campaignLorebook, entry);

        // Detailed mechanics as keyword-triggered [System Rule] entries (on demand).
        if (def.emit_rule_entries !== false) {
            for (const re of buildSystemRuleEntries(def, settings))
                await upsertEntry(settings.campaignLorebook, re);
        }
        await pruneSystemRuleEntries(def, settings);   // drop stale rules (feature off / disabled emit)
    }
    console.log(`[${MODULE_NAME}] System definition saved: ${def.name}`);
}

/** Idempotent: hydrate the cache from the lorebook entry once per chat. */
async function loadSystemDefFromLorebook(settings) {
    const state = getCharState();
    if (state.system_def) return;                       // already cached
    if (!settings.campaignLorebook) return;
    const { loadWorldInfo } = SillyTavern.getContext();
    const data  = await loadWorldInfo(settings.campaignLorebook);
    const entry = data?.entries && Object.values(data.entries)
        .find(e => e.comment === SYSTEM_DEF_COMMENT);
    if (entry?.extensions?.system_def) {
        state.system_def = mergeWithDefaults(entry.extensions.system_def);
        await saveCharState();
        console.log(`[${MODULE_NAME}] System definition hydrated from lorebook: ${state.system_def.name}`);
    }
}

// ── Def-driven [System Rule] entries ────────────────────────────────────────
// Detailed mechanics are surfaced on demand as keyword-triggered lorebook
// entries instead of bloating the always-on summary. Each rule's trigger keys
// are DERIVED from the vocabulary the def itself introduces (tier names, rank
// labels, attitudes, need meters, dice/mechanic tokens, …) plus a few universal
// terms — so a rule fires on the system's own words. A `rules:` section in the
// System Definition may add keywords or replace the prose per rule.

var SYSTEM_RULE_COMMENT = '[System Rule]';

/** Normalize + drop stopwords/too-short tokens (keeps multi-word phrases). */
function _ruleKeys(arr) {
    return normalizeKeys(arr).filter(k => k.length >= 2 && !KEY_STOPWORDS.has(k));
}

/** Distinctive single words from a free-text phrase (e.g. a resolution mechanic). */
function _phraseTokens(str) {
    return String(str || '').toLowerCase().match(/[a-z0-9][a-z0-9+-]{1,}/g) || [];
}

/** Build the candidate [System Rule] entries for a def (before feature gating
 *  and author overrides are applied). Returns [{ id, name, gate, keys[], content }]. */
function _ruleDescriptors(def) {
    const out = [];
    const r = def.resolution || {};
    if (r.mechanic) {
        const keys = _ruleKeys([
            r.dice, ...(r.dice ? [] : []),
            ..._phraseTokens(r.mechanic).filter(w => /^(d\d+|dc|\d+d\d+)$/.test(w) || w.length >= 4),
            'check', 'contest', 'roll', 'difficulty',
        ]);
        const lines = [`[Resolution]`, `Mechanic: ${r.mechanic}`];
        if (r.difficulty) lines.push(`Difficulty: ${r.difficulty}`);
        if (r.crit)       lines.push(`Crits: ${r.crit}`);
        if (r.notes)      lines.push(r.notes);
        out.push({ id: 'resolution', name: 'Resolution', gate: () => !!r.mechanic, keys, content: lines.join('\n') });
    }

    if (def.features.capabilities !== false && def.capabilities) {
        const cats = def.capabilities.categories || [];
        const tierNames = new Set();
        for (const p of (def.progressions || [])) {
            if (p.type === 'none') continue;
            // tier_names:null means the profile uses the built-in ladder at runtime
            const tn = p.tier_names || (['points_tiers', 'xp_levels', 'milestone'].includes(p.type) ? DEFAULT_TIER_NAMES : []);
            for (const t of tn) tierNames.add(t);
        }
        const keys = _ruleKeys([...cats, ...tierNames, 'skill', 'ability', 'capability', 'mastery', 'tier']);
        const lines = ['[Capabilities]', `Categories: ${cats.join(', ')}`];
        for (const p of (def.progressions || [])) {
            if (p.type === 'none') continue;
            const tn = p.tier_names ? ` — tiers: ${p.tier_names.join(' < ')}` : '';
            lines.push(`Progression "${p.id}" (${p.type})${p.levels_per_tier ? `, ${p.levels_per_tier}/tier` : ''}${tn}`);
        }
        const cp = def.capabilities.category_progression || {};
        if (Object.keys(cp).length) lines.push(`Category → progression: ${Object.entries(cp).map(([c, p]) => `${c}:${p}`).join(', ')}`);
        out.push({ id: 'capabilities', name: 'Capabilities', gate: () => def.features.capabilities !== false, keys, content: lines.join('\n') });
    }

    if (def.features.reputation !== false && def.reputation?.tiers?.length) {
        const rep = def.reputation;
        const att = def.factions?.attitudes || [];
        const keys = _ruleKeys([...rep.tiers, ...att, 'reputation', 'standing', 'attitude']);
        const lines = ['[Reputation]', `Scale ${rep.scale_min}-${rep.scale_max}, initial ${rep.initial}`,
            `Tiers: ${rep.tiers.join(' < ')}`];
        if (att.length) lines.push(`Faction attitudes: ${att.join(', ')}`);
        out.push({ id: 'reputation', name: 'Reputation', gate: () => def.features.reputation !== false, keys, content: lines.join('\n') });
    }

    if (def.features.ranks !== false) {
        const ladder = def.rank_ladder || RANK_LADDER;
        const keys = _ruleKeys([...ladder, 'rank', 'guild', 'adventurer']);
        out.push({ id: 'ranks', name: 'Ranks', gate: () => def.features.ranks !== false,
            keys, content: ['[Ranks]', `Ladder: ${ladder.join(' < ')}`].join('\n') });
    }

    if (def.features.companions !== false && def.companions) {
        const c = def.companions;
        const keys = _ruleKeys([...(c.roles || []), c.lieutenant_role, 'companion', 'loyalty', 'control']);
        const ly = def.loyalty || {};
        out.push({ id: 'companions', name: 'Companions', gate: () => def.features.companions !== false, keys,
            content: ['[Companions]', `Roles: ${(c.roles || []).join(', ')}`,
                `Lieutenants (${c.lieutenant_role}) raise the control limit.`,
                `Loyalty scale ${ly.scale_min ?? 0}-${ly.scale_max ?? 100}, initial ${ly.initial ?? 50}.`].join('\n') });
    }

    if (def.features.needs !== false) {
        const n = def.needs || {};
        const keys = _ruleKeys(['needs', 'meter', 'warn', 'critical', 'threshold']);
        out.push({ id: 'needs', name: 'Needs', gate: () => def.features.needs !== false, keys,
            content: ['[Needs]', `Warn at ${n.warn_threshold ?? 30}, critical at ${n.critical_threshold ?? 10}.`,
                'Meters below the warn threshold surface in context; critical demands action.'].join('\n') });
    }

    const p = def.progression || {};
    {
        const keys = _ruleKeys([p.level_field, p.xp_field, 'level', 'experience', 'xp', 'progression', p.leveling]);
        out.push({ id: 'progression', name: 'Progression', gate: () => true, keys,
            content: ['[Progression]',
                `${p.uses_levels ? `Uses levels (field "${p.level_field}", start ${p.level_start})` : 'Levelless'}.`,
                `${p.uses_xp ? `Uses XP (field "${p.xp_field}")` : 'No XP'}; leveling mode: ${p.leveling}.`].join('\n') });
    }

    return out;
}

/** entryBase-built [System Rule] entries for the active def, feature-gated, with
 *  author overrides applied. constant:false → keyword-triggered, not always-on. */
function buildSystemRuleEntries(def, settings) {
    const overrides = def.rules || {};
    const entries = [];
    for (const d of _ruleDescriptors(def)) {
        if (!d.gate()) continue;
        const ov = overrides[d.id] || {};
        const keys = _ruleKeys([...d.keys, ...(ov.keywords || [])]);
        if (!keys.length) continue;
        const content = ov.content || d.content;
        const e = entryBase(`${SYSTEM_RULE_COMMENT} ${d.name}`, keys, content,
            settings.ruleOrder ?? 50, settings, { type: 'SYSTEM_RULE', rule_id: d.id });
        entries.push(e);
    }
    return entries;
}

/** Drop SYSTEM_RULE entries no longer wanted (feature disabled, rule removed). */
async function pruneSystemRuleEntries(def, settings) {
    if (!settings.campaignLorebook) return;
    const keep = new Set(buildSystemRuleEntries(def, settings).map(e => e.comment));
    await removeEntriesByComment(settings.campaignLorebook, keep, 'SYSTEM_RULE');
}

// ── Summary / panel ──────────────────────────────────────────────────────────

function buildSystemDefSummary(def) {
    const lines = [`[System Definition: ${def.name}]`];
    const onFeatures = ALL_FEATURES.filter(f => def.features[f] !== false);
    lines.push(`Features: ${onFeatures.join(', ') || 'none'}`);
    if (def.attributes?.length)
        lines.push(`Attributes: ${def.attributes.map(a => a.label || a.key).join(', ')}`);
    if (def.derived_stats?.length)
        lines.push(`Derived: ${def.derived_stats.map(d => d.target).join(', ')}`);
    const p = def.progression || {};
    lines.push(`Progression: ${p.uses_levels ? 'levels' : 'levelless'}${p.uses_xp ? ' + xp' : ''} (${p.leveling})`);
    if (def.classes?.enabled && def.classes.options?.length)
        lines.push(`Classes: ${def.classes.options.map(o => o.name).join(', ')}`);
    if (def.features.reputation !== false && def.reputation?.tiers?.length)
        lines.push(`Reputation: ${def.reputation.tiers.length}-tier scale ${def.reputation.scale_min}-${def.reputation.scale_max}`);
    if (def.features.capabilities !== false && def.capabilities?.categories?.length)
        lines.push(`Capabilities: ${def.capabilities.categories.join(', ')}`);
    if (def.resolution?.mechanic)
        lines.push(`Resolution: ${def.resolution.mechanic}`);
    if (def.features.equipment !== false && def.equipment?.enabled && def.equipment.slots?.length)
        lines.push(`Equipment slots: ${def.equipment.slots.map(s => s.label || s.key).join(', ')}`);
    if (def.inventory && def.inventory.model !== 'freeform')
        lines.push(`Inventory: ${def.inventory.model}${def.inventory.capacity ? ` (${def.inventory.capacity} ${def.inventory.unit})` : ''}`);
    return lines.join('\n');
}

/** Context block documenting how checks are resolved, so the GM stays consistent. */
function buildResolutionContextString(def) {
    const r = (def || getSystemDef()).resolution;
    if (!r || !r.mechanic) return '';
    // Always-on line stays terse: mechanic + crits. The full difficulty table
    // lives in the keyword-triggered [System Rule] Resolution entry.
    const lines = ['[Resolution]', `Mechanic: ${r.mechanic}`];
    if (r.crit) lines.push(`Crits: ${r.crit}`);
    return lines.join('\n');
}
