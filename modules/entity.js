/**
 * gm-lore-parser / modules/entity.js
 * Unified stat-bearing entity core. Player Character, NPC, Companion, and
 * Creature (bestiary template) all share one schema engine; type-specific
 * rules are layered on top.
 *
 * Blocks (see state.js SHEET_BLOCKS):
 *   [ENTITY_BEGIN]   type: player|npc|companion|creature  — define schema + values
 *   [ENTITY_UPDATE]  type, name  — GM_MUTABLE / dynamic / companion-meta / AP changes
 *   [ENTITY_EVENT]   type, name, reason  — GM_EVENT (milestone) changes, logged per type
 *   [ENTITY_MEMORY]  type, name  — memory lorebook entry (any entity)
 *
 * Storage differs by type (player/companion live in chatMetadata; npc/creature
 * live in the campaign lorebook) and is hidden behind a "handle". GM_EVENT
 * history differs by type and is hidden behind a pluggable "log sink".
 *
 * Loaded after `schema` (engine) and before `lore`/`sheet`/`currency`. Defines
 * functions only; late-bound calls to lore.js helpers resolve at runtime.
 */

var ENTITY_TYPES = ['player', 'npc', 'companion', 'creature'];

// ── Logging sinks (per-type GM_EVENT history) ─────────────────────────────────

var playerLogSink = {
    record(c) {
        getCharState().attr_change_log.push({
            field: c.key, old_value: c.oldVal, new_value: c.newVal,
            reason: c.reason, timestamp: new Date().toISOString(),
        });
    },
};

/** Buffers GM_EVENT changes; flush() writes one episodic NPC memory. */
function makeMemorySink(name, settings) {
    const buf = [];
    return {
        record(c) { buf.push(c); },
        async flush(reason, schema) {
            if (!buf.length) return;
            const summary = buf.map(c => `${schema.fields[c.key]?.label || c.key}: ${c.oldVal}→${c.newVal}`).join(', ');
            await processNpcMemoryDirect(name, 'episodic', `Milestone: ${reason}`,
                `${reason}. Changes: ${summary}.`, expandNameKeys(name), settings);
        },
    };
}

function makeCompanionLogSink(comp) {
    return { record(c) { (comp.history ??= []).push({ field: c.key, from: c.oldVal, to: c.newVal, reason: c.reason }); } };
}

// ── Core operations (delegate to schema.js, operate on a handle) ───────────────

/** Adopt a schema block (if present) and seed initial values for schema fields. */
function entityApplyStatBlock(handle, fields) {
    const ps = parseSchema(fields._raw || '');
    if (Object.keys(ps.fields).length) {
        const s = handle.schema();
        s.fields = ps.fields;
        s.groups = ps.groups;
    }
    const sf = handle.schema().fields, values = handle.values();
    for (const key of Object.keys(sf)) {
        if (fields[key] === undefined) continue;
        const desc = sf[key];
        if (desc.type === 'list') {
            const sep = desc.separator || ',';
            values[key] = String(fields[key]).split(sep).map(s => s.trim()).filter(Boolean);
        } else {
            const n = parseFloat(fields[key]);
            values[key] = isNaN(n) ? fields[key] : n;
        }
    }
}

/** Apply GM_MUTABLE (and optionally dynamic / use-counter) field changes. */
function entityApplyUpdate(handle, fields, { sysProtected = new Set(), allowDynamic = false } = {}) {
    const sf = handle.schema().fields, values = handle.values();
    const changes = [], blocked = [];
    for (const [key, val] of Object.entries(fields)) {
        if (key === 'name' || key === 'type' || key.startsWith('_')) continue;
        if (sysProtected.has(key)) { blocked.push(`${key}(system)`); continue; }
        const desc = sf[key], mut = desc ? getMutability(desc) : null;
        if (mut === MUTABILITY.GM_MUTABLE)        { applyFieldValue(key, val, desc, values); changes.push(key); }
        else if (mut === MUTABILITY.GM_EVENT)     { blocked.push(`${key}(gm_event)`); }
        else if (mut === MUTABILITY.USE_TRACKED)  { blocked.push(`${key}(use_tracked base)`); }
        else if (mut === MUTABILITY.IMMUTABLE)    { blocked.push(`${key}(immutable)`); }
        else if (allowDynamic && key.endsWith('_uses') && sf[key.slice(0, -5)]
                 && getMutability(sf[key.slice(0, -5)]) === MUTABILITY.USE_TRACKED) {
            const cur = parseInt(values[key]) || 0;
            values[key] = val.startsWith('+') ? cur + parseInt(val) : (parseInt(val) || 0);
            changes.push(key);
        }
        else if (allowDynamic && handle.dynamicFields().includes(key)) { values[key] = val; changes.push(key); }
        else blocked.push(`${key}(not in schema${allowDynamic ? ' or dynamic' : ''})`);
    }
    if (blocked.length) console.warn(`[${MODULE_NAME}] ENTITY_UPDATE(${handle.meta().type}) blocked: ${blocked.join(', ')}`);
    const promotions = checkPromotions(sf, values);
    return { changes, blocked, promotions };
}

/** Apply GM_EVENT (milestone) changes; requires a reason; logs via the sink. */
function entityApplyEvent(handle, fields) {
    const sf = handle.schema().fields, values = handle.values();
    const reason = fields.reason;
    if (!reason) { console.warn(`[${MODULE_NAME}] ENTITY_EVENT missing reason`); return { changes: [], blocked: ['no reason'], reason: null }; }
    const changes = [], blocked = [];
    for (const [key, val] of Object.entries(fields)) {
        if (key === 'name' || key === 'type' || key === 'reason' || key.startsWith('_')) continue;
        const desc = sf[key], mut = desc ? getMutability(desc) : null;
        if (mut !== MUTABILITY.GM_EVENT) { blocked.push(`${key}(${mut || 'unknown'})`); continue; }
        const oldVal = values[key];
        applyFieldValue(key, val, desc, values);
        const ch = { key, oldVal, newVal: values[key], reason };
        changes.push(ch);
        if (handle.logSink) handle.logSink.record(ch);
    }
    if (blocked.length) console.warn(`[${MODULE_NAME}] ENTITY_EVENT(${handle.meta().type}) blocked: ${blocked.join(', ')}`);
    return { changes, blocked, reason };
}

/** Compute derived stats from the active system definition's formulas.
 *  Targets that already hold a non-zero value are left untouched. */
function entityComputeDerived(values, schema) {
    const def = getSystemDef();
    const sf  = schema?.fields || {};
    const vars = {};
    for (const variable of (def.variables || [])) {
        const cur = values[variable.key];
        vars[variable.key] = (cur !== undefined && cur !== '') ? (parseFloat(cur) || 0) : (variable.default || 0);
    }
    if (def.progression?.uses_levels && vars.level === undefined)
        vars.level = parseFloat(values[def.progression.level_field || 'level']) || def.progression.level_start || 1;
    for (const a of (def.attributes || [])) {
        const abbr = (a.abbr || '').toLowerCase();
        const val  = values[a.key] ?? (abbr ? values[abbr] : undefined) ?? 0;
        vars[a.key] = parseFloat(val) || 0;
        if (abbr) vars[abbr] = vars[a.key];
    }
    for (const d of (def.derived_stats || [])) {
        if (!sf[d.target]) continue;
        if (values[d.target] !== undefined && values[d.target] !== 0) { vars[d.key] = parseFloat(values[d.target]) || 0; continue; }
        const result = Math.round(evalFormula(d.formula, vars, 0));
        values[d.target] = result;
        vars[d.key] = result;
        for (const extra of (d.also || []))
            if (sf[extra] && (values[extra] === undefined || values[extra] === 0)) values[extra] = result;
    }
}

// ── Handles (storage backends) ────────────────────────────────────────────────

/** Player & companion: schema/values are live refs on chatMetadata. */
function makeMetadataHandle({ type, name, slug, schemaRef, valuesRef, dynamic = [], logSink = null }) {
    return {
        meta: () => ({ type, name, slug }),
        schema: schemaRef, values: valuesRef,
        dynamicFields: () => dynamic, logSink,
        async load() { /* live refs — nothing to do */ },
        async commit() { await saveCharState(); },
    };
}

function makePlayerHandle(logSink = playerLogSink) {
    const state = getCharState();
    if (!state.schema) state.schema = { fields: {}, groups: [] };
    return makeMetadataHandle({
        type: 'player', name: state.name || 'Player', slug: 'player',
        schemaRef: () => getCharState().schema,
        valuesRef: () => getCharState().values,
        dynamic: [], logSink,
    });
}

/** NPC & creature: schema lives in the lorebook core entry; values are
 *  reconstructed from the State/Progression entries. */
function makeLorebookHandle(name, kind, settings, logSink = null) {
    let _schema = { fields: {}, groups: [] }, _values = {}, _dynamic = [], _keys = expandNameKeys(name), _found = false;
    return {
        meta: () => ({ type: kind, name, slug: slugify(name) }),
        schema: () => _schema, values: () => _values, dynamicFields: () => _dynamic, logSink,
        keys: () => _keys, found: () => _found,
        setKeys(k)    { _keys = k; },
        setDynamic(d) { _dynamic = d; },
        async load() {
            const { loadWorldInfo } = SillyTavern.getContext();
            const world = await loadWorldInfo(settings.campaignLorebook);
            const core  = world?.entries && Object.values(world.entries).find(e => e.comment === `[NPC] ${name}`);
            if (!core) return false;
            _schema  = core.extensions?.npc_schema ?? { fields: {}, groups: [] };
            _dynamic = core.extensions?.dynamic_fields ?? [];
            _keys    = core.key;
            _values  = parseNpcCurrentValues(world, name);
            _found   = true;
            return true;
        },
        async commit() {
            await rebuildNpcStateEntry(name, _dynamic, _values, _schema, _keys, settings);
            if (Object.keys(_schema.fields).length)
                await rebuildNpcProgressionEntry(name, _schema, _values, _keys, settings);
        },
    };
}

// ── from_template inheritance ─────────────────────────────────────────────────
// Look up a creature template's stored schema + base values so an instance can
// inherit them. Ranges ("18-28") collapse to their midpoint; `_per_level` scales
// by the instance level.

async function loadEntityTemplate(templateName, settings, level = 1) {
    if (!settings.campaignLorebook) return null;
    const { loadWorldInfo } = SillyTavern.getContext();
    const world = await loadWorldInfo(settings.campaignLorebook);
    const entry = world?.entries && Object.values(world.entries)
        .find(e => e.comment === `[Creature] ${templateName}` && e.extensions?.entity_schema);
    if (!entry) return null;
    const schema = structuredClone(entry.extensions.entity_schema);
    const base   = entry.extensions.template_values || {};
    const values = {};
    for (const [k, v] of Object.entries(base)) {
        const range = String(v).match(/^(-?\d+)\s*(?:-|to)\s*(-?\d+)$/);
        if (range) values[k] = Math.round((parseInt(range[1]) + parseInt(range[2])) / 2);
        else { const n = parseFloat(v); values[k] = isNaN(n) ? v : n; }
    }
    for (const [k, v] of Object.entries(entry.extensions.template_scaling || {}))
        if (values[k] !== undefined && !isNaN(parseFloat(values[k])))
            values[k] = parseFloat(values[k]) + (parseFloat(v) || 0) * (level - 1);
    return { schema, values };
}

// ── Dispatcher ─────────────────────────────────────────────────────────────────

/** The block-level entity type, read from top-level lines only (so a `type:`
 *  descriptor inside the schema section is never mistaken for the discriminator). */
function entityType(raw) { return (parseFlatFields(raw).type || 'player').toLowerCase(); }

async function onEntityBegin(raw, settings) {
    const fields = parseFlatFields(raw); fields._raw = raw;
    switch (entityType(raw)) {
        case 'player':    return playerEntityBegin(fields);
        case 'companion': return companionEntityBegin(fields, settings);
        case 'npc':       return npcEntityBegin(fields, settings);
        case 'creature':  return creatureEntityBegin(fields, settings);
        default: console.warn(`[${MODULE_NAME}] ENTITY_BEGIN unknown type "${entityType(raw)}"`); return false;
    }
}

async function onEntityUpdate(raw, settings) {
    const fields = parseFlatFields(raw); fields._raw = raw;
    switch (entityType(raw)) {
        case 'player':    return playerEntityUpdate(fields);
        case 'companion': return applyCompanionUpdate(raw, settings);   // companion meta + AP + schema
        case 'npc':       return npcEntityUpdate(fields, settings);
        case 'creature':  console.warn(`[${MODULE_NAME}] creatures are immutable templates — ignoring ENTITY_UPDATE`); return false;
        default: return false;
    }
}

async function onEntityEvent(raw, settings) {
    const fields = parseFlatFields(raw); fields._raw = raw;
    switch (entityType(raw)) {
        case 'player':    return playerEntityEvent(fields);
        case 'companion': return companionEntityEvent(fields, settings);
        case 'npc':       return npcEntityEvent(fields, settings);
        default: console.warn(`[${MODULE_NAME}] ENTITY_EVENT unsupported type "${entityType(raw)}"`); return false;
    }
}

async function onEntityMemory(raw, settings) {
    // Memory works for any entity name; reuse the NPC memory lorebook writer.
    return processNpcMemory(raw, settings);
}

// ── Player wrappers ─────────────────────────────────────────────────────────

function playerEntityBegin(fields) {
    // applyPlayerSheet handles identity (name/class/background), schema adoption,
    // and value seeding (incl. inventory/conditions and any declared identity
    // fields). We then compute derived stats from the active system definition.
    applyPlayerSheet(fields._raw || '');
    const state = getCharState();
    augmentSchemaWithDefAttributes(state.schema, state.values);   // def attributes are the source of truth for the panel
    entityComputeDerived(state.values, state.schema);
    return true;
}

function playerEntityUpdate(fields) {
    // Equipment directives are handled by the inventory module, not as schema fields.
    let equipChanged = false;
    if (fields.equip || fields.unequip) {
        equipChanged = applyEquipDirective(fields.equip, fields.unequip);
        delete fields.equip; delete fields.unequip;
    }
    const handle = makePlayerHandle();
    const r = entityApplyUpdate(handle, fields, { sysProtected: SYS_PROTECTED });
    return (r.changes.length > 0 || equipChanged) ? (r.changes.length ? r.changes : ['equipment']) : false;
}

function playerEntityEvent(fields) {
    const handle = makePlayerHandle(playerLogSink);
    return entityApplyEvent(handle, fields);
}

// ── NPC wrappers ────────────────────────────────────────────────────────────

async function npcEntityBegin(fields, settings) {
    // from_template inheritance: merge template schema/values under explicit ones
    if (fields.from_template) {
        const lvl = parseFloat(fields.level) || 1;
        const tpl = await loadEntityTemplate(fields.from_template, settings, lvl);
        if (tpl) {
            fields._inherited_schema = tpl.schema;
            for (const [k, v] of Object.entries(tpl.values))
                if (fields[k] === undefined) fields[k] = v;
        }
    }
    return processNpcBlock(fields, settings);
}

async function npcEntityUpdate(fields, settings) {
    const name = fields.name;
    if (!name) { console.warn(`[${MODULE_NAME}] ENTITY_UPDATE(npc) missing name`); return false; }
    const handle = makeLorebookHandle(name, 'npc', settings);
    if (!(await handle.load())) { console.warn(`[${MODULE_NAME}] ENTITY_UPDATE(npc): no core for "${name}"`); return false; }
    const r = entityApplyUpdate(handle, fields, { allowDynamic: true });
    if (!r.changes.length) return false;
    for (const p of r.promotions)
        await processNpcMemoryDirect(name, 'episodic',
            `Skill gain: ${handle.schema().fields[p.key]?.label || p.key}`, `${p.reason}.`,
            expandNameKeys(name), settings);
    await handle.commit();
    return { changed: true, promotions: r.promotions };
}

async function npcEntityEvent(fields, settings) {
    const name = fields.name, reason = fields.reason;
    if (!name || !reason) { console.warn(`[${MODULE_NAME}] ENTITY_EVENT(npc) needs name + reason`); return false; }
    const sink   = makeMemorySink(name, settings);
    const handle = makeLorebookHandle(name, 'npc', settings, sink);
    if (!(await handle.load())) return false;
    const r = entityApplyEvent(handle, fields);
    if (!r.changes.length) return false;
    await sink.flush(reason, handle.schema());
    await handle.commit();
    return { changes: r.changes, reason };
}

// ── Companion event (GM_EVENT on companion schema fields) ─────────────────────

async function companionEntityEvent(fields, settings) {
    const name = fields.name;
    if (!name) return false;
    const state = getCharState();
    const slug  = slugify(name);
    const comp  = state.companions[slug];
    if (!comp || !comp.schema) { console.warn(`[${MODULE_NAME}] ENTITY_EVENT(companion) needs an existing schema-bearing companion`); return false; }
    const handle = makeMetadataHandle({
        type: 'companion', name, slug,
        schemaRef: () => comp.schema, valuesRef: () => (comp.values ??= {}),
        logSink: makeCompanionLogSink(comp),
    });
    const r = entityApplyEvent(handle, fields);
    if (!r.changes.length) return false;
    await saveCharState();
    if (settings.campaignLorebook) {
        await upsertEntry(settings.campaignLorebook, {
            ...entryBase(`[Companion] ${name}`, normalizeKeys([...expandNameKeys(name), `${name.toLowerCase()} companion`]),
                buildCompanionContent(comp), settings.loreOrder, settings, { type: 'COMPANION', slug }),
        });
    }
    return { changes: r.changes, reason: r.reason };
}

// ── Companion begin (companion rules + optional shared stat block) ────────────

async function companionEntityBegin(fields, settings) {
    const ok = await applyCompanionUpdate(fields._raw ?? '', settings);
    if (!ok) return false;
    // Optional schema: companions can carry the same stat-block engine as anyone.
    const ps = parseSchema(fields._raw || '');
    if (Object.keys(ps.fields).length) {
        const state = getCharState();
        const comp  = state.companions[slugify(fields.name)];
        if (comp) {
            comp.schema = ps;
            comp.values ??= {};
            const handle = makeMetadataHandle({
                type: 'companion', name: comp.name, slug: slugify(comp.name),
                schemaRef: () => comp.schema, valuesRef: () => comp.values,
            });
            entityApplyStatBlock(handle, fields);
            entityComputeDerived(comp.values, comp.schema);
            await saveCharState();
            if (settings.campaignLorebook)
                await upsertEntry(settings.campaignLorebook, {
                    ...entryBase(`[Companion] ${comp.name}`, normalizeKeys([...expandNameKeys(comp.name), `${comp.name.toLowerCase()} companion`]),
                        buildCompanionContent(comp), settings.loreOrder, settings, { type: 'COMPANION', slug: slugify(comp.name) }),
                });
        }
    }
    return ok;
}

// ── Creature (bestiary template) ──────────────────────────────────────────────

async function creatureEntityBegin(fields, settings) {
    const name = fields.name || `Creature ${Object.keys(getCharState().companions || {}).length + 1}`;
    const keys = fields.keywords ? normalizeKeys(fields.keywords.split(',')) : expandNameKeys(name);
    const schema = Object.keys(parseSchema(fields._raw || '').fields).length
        ? parseSchema(fields._raw || '') : { fields: {}, groups: [] };

    const coreLines = [], scaling = {}, templateValues = {};
    const skip = new Set([...LORE_META, 'schema', 'type', 'from_template']);
    const schemaKeys = new Set(Object.keys(schema.fields));
    for (const [k, v] of Object.entries(fields)) {
        if (skip.has(k) || k.startsWith('_')) continue;
        if (k.endsWith('_per_level')) {
            const base = k.replace(/_per_level$/, '');
            scaling[base] = v;
            coreLines.push(`  ${base.replace(/_/g, ' ')} +${v} per level`);
        } else {
            templateValues[k] = v;
            const isRange = /^-?\d+\s*(?:-|to)\s*-?\d+$/.test(String(v).trim());
            coreLines.push(`${k.replace(/_/g, ' ')}: ${v}${isRange ? ' (range)' : ''}`);
        }
    }
    coreLines.push('[Immutable creature template — never rewrite. Spawn instances with from_template.]');

    return upsertEntry(settings.campaignLorebook, {
        ...entryBase(`[Creature] ${name}`, keys, coreLines.join('\n'), settings.loreOrder, settings, {
            type: 'CREATURE', immutable: true,
            entity_schema: schemaKeys.size ? schema : null,
            template_values: templateValues, template_scaling: scaling,
        }),
    });
}

// ── Companion rules & rendering ───────────────────────────────────────────────
// Companions are an entity type; all companion-specific logic (loyalty, control
// limit, role, AP point-buy, the legion/delegation tree, and companion
// rendering/commands) lives here in the entity module. Vocabularies come from the
// active System Definition's `companions` section via companionCfg().

function companionCfg() {
    const c = getSystemDef().companions || {};
    return {
        roles:          c.roles          || ['standard', 'lieutenant'],
        statuses:       c.statuses       || ['Active', 'Inactive', 'Dismissed', 'Dead'],
        default_role:   c.default_role   || 'standard',
        lieutenant_role:c.lieutenant_role|| 'lieutenant',
        active_status:  c.default_status || 'Active',
    };
}

/** Max of the active loyalty scale (for display). */
function loyaltyScaleMax() { return getSystemDef().loyalty?.scale_max ?? 100; }
/** Normalize a loyalty value to a 0-100 percentage for bar widths. */
function loyaltyPct(v) {
    const loy  = getSystemDef().loyalty || { scale_min: 0, scale_max: 100 };
    const span = ((loy.scale_max ?? 100) - (loy.scale_min ?? 0)) || 1;
    return Math.max(0, Math.min(100, ((v - (loy.scale_min ?? 0)) / span) * 100));
}

async function applyCompanionUpdate(raw, settings) {
    const fields = parseFlatFields(raw);   // top-level only (a companion may carry a schema)
    if (!fields.name) { console.warn(`[${MODULE_NAME}] ENTITY(companion) missing name`); return false; }

    const cfg   = companionCfg();
    const slug  = slugify(fields.name);
    const state = getCharState();

    if (!state.companions[slug]) {
        state.companions[slug] = { name: fields.name, type: '', control_cost: 0, loyalty: (getSystemDef().loyalty?.initial ?? 50), status: cfg.active_status, role: cfg.default_role, notes: '', history: [] };
    }
    const comp = state.companions[slug];

    if (fields.type)         comp.type         = fields.type;
    if (fields.control_cost) comp.control_cost  = parseInt(fields.control_cost) || comp.control_cost;
    if (fields.loyalty)      comp.loyalty       = parseInt(fields.loyalty)      || comp.loyalty;
    if (fields.status)       comp.status        = fields.status;
    if (fields.notes)        comp.notes         = fields.notes;
    if (fields.role)         comp.role          = fields.role;
    if (fields.assigned_to)  comp.assigned_to   = fields.assigned_to;

    // Ensure AP fields exist
    if (comp.ap_unspent  === undefined) comp.ap_unspent  = 0;
    if (comp.ap_total    === undefined) comp.ap_total    = 0;
    if (!comp.attributes)               comp.attributes  = {};

    // AP award
    if (fields.ap_award) {
        const gained = parseInt(fields.ap_award) || 0;
        comp.ap_unspent += gained;
        comp.ap_total   += gained;
        console.log(`[${MODULE_NAME}] Companion "${comp.name}" AP award: +${gained} (unspent: ${comp.ap_unspent})`);
    }

    // Attribute allocation — spends from ap_unspent
    if (fields.attribute_allocate) {
        let allocObj = {};
        try { allocObj = JSON.parse(fields.attribute_allocate); } catch (_) {
            fields.attribute_allocate.split(',').forEach(pair => {
                const [k, v] = pair.split(':').map(s => s.trim());
                if (k && v) allocObj[k] = parseInt(v) || 0;
            });
        }
        const totalCost = Object.values(allocObj).reduce((a, b) => a + b, 0);
        if (totalCost > comp.ap_unspent) {
            console.warn(`[${MODULE_NAME}] Companion "${comp.name}" AP allocation (${totalCost}) exceeds unspent (${comp.ap_unspent}) — applying anyway.`);
        }
        for (const [attr, pts] of Object.entries(allocObj)) {
            comp.attributes[attr] = (comp.attributes[attr] || 0) + pts;
        }
        comp.ap_unspent = Math.max(0, comp.ap_unspent - totalCost);
        console.log(`[${MODULE_NAME}] Companion "${comp.name}" allocated ${totalCost} AP.`);
    }

    const loy = getSystemDef().loyalty || { scale_min: 0, scale_max: 100 };
    comp.loyalty = Math.max(loy.scale_min ?? 0, Math.min(loy.scale_max ?? 100, comp.loyalty));

    // Control limit check
    const totalCost = Object.values(state.companions)
        .filter(c => c.status === cfg.active_status)
        .reduce((sum, c) => sum + (parseInt(c.control_cost) || 0), 0);
    const limit = state.values?.control_limit || state.values?.control_limit_max;
    if (limit !== undefined && totalCost > limit) {
        console.warn(`[${MODULE_NAME}] Control limit exceeded: ${totalCost}/${limit}`);
    }

    // Lorebook entry
    if (settings.campaignLorebook) {
        const keywords = normalizeKeys([...expandNameKeys(fields.name), `${fields.name.toLowerCase()} companion`]);
        const content  = buildCompanionContent(comp);
        await upsertEntry(settings.campaignLorebook, {
            ...entryBase(`[Companion] ${fields.name}`, keywords, content, settings.loreOrder, settings, { type: 'COMPANION', slug }),
        });
    }
    console.log(`[${MODULE_NAME}] Companion "${fields.name}": ${comp.status}, loyalty ${comp.loyalty}`);
    return true;
}

function buildCompanionContent(comp) {
    const cfg   = companionCfg();
    const lines = [];
    if (comp.type)         lines.push(`Type: ${comp.type}`);
    lines.push(`Status: ${comp.status}`);
    lines.push(`Loyalty: ${comp.loyalty}/${loyaltyScaleMax()}`);
    if (comp.control_cost) lines.push(`Control Cost: ${comp.control_cost}`);
    if (comp.rank)         lines.push(`Rank: ${comp.rank}`);
    if (comp.role && comp.role !== cfg.default_role) lines.push(`Role: ${comp.role}`);
    if (comp.attributes && Object.keys(comp.attributes).length)
        lines.push(`Attributes: ${Object.entries(comp.attributes).map(([k, v]) => `${k}:${v}`).join(', ')}`);
    // Shared stat block (companions may carry the same schema engine as any entity)
    if (comp.schema && Object.keys(comp.schema.fields || {}).length)
        lines.push(buildValueSummary('Stats', comp.schema, comp.values || {}).split('\n').slice(1).join('\n'));
    if (comp.notes)        lines.push(`Notes: ${comp.notes}`);
    return lines.join('\n');
}

function buildCompanionContextString(companions) {
    const cfg    = companionCfg();
    const active = Object.values(companions).filter(c => c.status === cfg.active_status);
    if (!active.length) return '';
    const lines = ['[Companions]'];
    const max = loyaltyScaleMax();
    for (const c of active) {
        const rankStr = c.rank ? ` [${c.rank}]` : '';
        lines.push(`  ${c.name}${rankStr} — Loyalty: ${c.loyalty}/${max}`);
    }
    return lines.join('\n');
}

function buildCompanionPanel(companions) {
    const cfg = companionCfg();
    const activeComps = Object.values(companions).filter(c => c.status === cfg.active_status);
    if (!activeComps.length) return '';
    const rows = activeComps.map(c => {
        const rankBadge = c.rank ? `<span class="glp-rank-badge">${c.rank}</span>` : '';
        return `<div class="glp-companion-row">
            <span class="glp-companion-name">${c.name}</span>${rankBadge}
            <div class="glp-loyalty-bar-wrap"><div class="glp-loyalty-bar" style="width:${loyaltyPct(c.loyalty)}%"></div></div>
            <span class="glp-loyalty-val">${c.loyalty}</span>
        </div>`;
    }).join('');
    return `<div class="glp-section"><div class="glp-section-title">Companions</div>${rows}</div>`;
}

function cmdCompanions(state, filterName) {
    const cfg   = companionCfg();
    const comps = Object.values(state.companions || {});
    if (!comps.length) return '[Companions]\nNo companions recorded.';
    const target = filterName ? filterName.toLowerCase() : null;
    const filtered = target ? comps.filter(c => c.name.toLowerCase().includes(target)) : comps;
    if (!filtered.length) return `[Companions]\nNo companion matching "${filterName}" found.`;
    const lines = ['[Companions]'];
    for (const c of filtered) {
        const rankStr = c.rank ? ` [${c.rank}]` : '';
        lines.push(`  ${c.name}${rankStr} (${c.status}) — Loyalty: ${c.loyalty}/${loyaltyScaleMax()}`);
        if (c.role && c.role !== cfg.default_role) lines.push(`    Role: ${c.role}`);
        if (c.ap_unspent || c.ap_total) lines.push(`    AP: ${c.ap_unspent} unspent / ${c.ap_total} total`);
        if (c.attributes && Object.keys(c.attributes).length)
            lines.push(`    Attributes: ${Object.entries(c.attributes).map(([k, v]) => `${k}:${v}`).join(', ')}`);
        if (c.notes) lines.push(`    ${c.notes}`);
    }
    return lines.join('\n');
}

function cmdLegion(state) {
    const cfg    = companionCfg();
    const comps  = state.companions || {};
    const limit  = state.values?.control_limit || state.values?.control_limit_max;
    const active = Object.values(comps).filter(c => c.status === cfg.active_status);
    const usedSlots = active.reduce((sum, c) => sum + (parseInt(c.control_cost) || 0), 0);

    const lines = ['[Legion / Hierarchy]'];
    if (limit !== undefined) lines.push(`Control Limit: ${usedSlots}/${limit}`);

    const lieutenants = active.filter(c => c.role === cfg.lieutenant_role);
    const standards   = active.filter(c => c.role !== cfg.lieutenant_role);

    const directMinions = standards.filter(c => !c.assigned_to);
    if (directMinions.length) {
        lines.push('\nDirect Command:');
        for (const c of directMinions) {
            const rankStr = c.rank ? ` [${c.rank}]` : '';
            lines.push(`  ○ ${c.name}${rankStr} — cost:${c.control_cost || 0} loyalty:${c.loyalty}`);
        }
    }

    for (const lt of lieutenants) {
        const rankStr  = lt.rank ? ` [${lt.rank}]` : '';
        lines.push(`\nLieutenant: ${lt.name}${rankStr} — cost:${lt.control_cost || 0} loyalty:${lt.loyalty}`);
        const delegated = active.filter(c => c.assigned_to && c.assigned_to.toLowerCase() === lt.name.toLowerCase());
        for (const sub of delegated) {
            const subRank = sub.rank ? ` [${sub.rank}]` : '';
            lines.push(`    └ ${sub.name}${subRank} — cost:${sub.control_cost || 0} loyalty:${sub.loyalty}`);
        }
    }

    if (!active.length) lines.push('No active companions.');
    return lines.join('\n');
}
