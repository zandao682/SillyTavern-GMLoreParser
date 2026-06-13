/**
 * gm-lore-parser / modules/sheet.js
 * Player sheet handlers — PLAYER_SHEET, PLAYER_UPDATE, ATTR_CHANGE, WORLD_TIME.
 */

// ── PLAYER_SHEET ──────────────────────────────────────────────────────────────

function applyPlayerSheet(raw) {
    const state  = getCharState();
    const fields = parseFields(raw);
    if (fields.name)       state.name       = fields.name;
    if (fields.class)      state.class_     = fields.class;
    if (fields.background) state.background = fields.background;

    const ps = parseSchema(raw);
    if (Object.keys(ps.fields).length > 0) state.schema = ps;

    const reserved = new Set(['name', 'class', 'background', 'schema', 'schema_version']);
    for (const [key, val] of Object.entries(fields)) {
        if (reserved.has(key)) continue;
        if (key === 'inventory')   state.values.inventory   = val.split(';').map(s => s.trim()).filter(Boolean);
        else if (key === 'conditions') state.values.conditions = val.split(',').map(s => s.trim()).filter(Boolean);
        else { const num = parseFloat(val); state.values[key] = isNaN(num) ? val : num; }
    }
}

// ── PLAYER_UPDATE ─────────────────────────────────────────────────────────────

function applyPlayerUpdate(raw) {
    const fields  = parseFields(raw);
    const state   = getCharState();
    const schema  = state.schema?.fields || {};
    const changes = [], blocked = [];

    for (const [key, val] of Object.entries(fields)) {
        if (SYS_PROTECTED.has(key)) { blocked.push(`${key}(system)`); continue; }
        const desc = schema[key];
        const mut  = desc ? getMutability(desc) : null;
        if (mut === MUTABILITY.GM_EVENT)    { blocked.push(`${key}(gm_event)`); continue; }
        if (mut === MUTABILITY.IMMUTABLE)   { blocked.push(`${key}(immutable)`); continue; }
        if (mut === MUTABILITY.USE_TRACKED) { blocked.push(`${key}(use_tracked base)`); continue; }
        if (!desc) { blocked.push(`${key}(not in schema)`); continue; }
        applyFieldValue(key, val, desc, state.values);
        changes.push(key);
    }
    if (blocked.length) console.warn(`[${MODULE_NAME}] PLAYER_UPDATE blocked: ${blocked.join(', ')}`);
    return changes;
}

// ── ATTR_CHANGE ───────────────────────────────────────────────────────────────

function applyAttrChange(raw) {
    const fields  = parseFields(raw);
    const state   = getCharState();
    const schema  = state.schema?.fields || {};
    const changes = [], blocked = [];
    const reason  = fields.reason;
    if (!reason) {
        console.warn(`[${MODULE_NAME}] ATTR_CHANGE missing reason`);
        return { changes: [], blocked: ['no reason'], reason: null };
    }
    for (const [key, val] of Object.entries(fields)) {
        if (key === 'reason') continue;
        if (SYS_PROTECTED.has(key)) { blocked.push(key); continue; }
        const desc = schema[key];
        const mut  = desc ? getMutability(desc) : null;
        if (mut !== MUTABILITY.GM_EVENT) { blocked.push(`${key}(${mut || 'unknown'})`); continue; }
        const oldVal = state.values[key];
        applyFieldValue(key, val, desc, state.values);
        state.attr_change_log.push({
            field: key, old_value: oldVal, new_value: state.values[key],
            reason, timestamp: new Date().toISOString(),
        });
        changes.push({ key, oldVal, newVal: state.values[key] });
    }
    if (blocked.length) console.warn(`[${MODULE_NAME}] ATTR_CHANGE blocked: ${blocked.join(', ')}`);
    return { changes, blocked, reason };
}

// ── WORLD_TIME ────────────────────────────────────────────────────────────────

async function applyWorldTime(raw, settings) {
    const fields    = parseFields(raw);
    const state     = getCharState();
    const isResting = (fields.resting || '').toLowerCase() === 'true';

    if (fields.datetime) state.world_time.display = fields.datetime;
    const minutes = parseElapsedMinutes(fields.elapsed || '');
    state.world_time.elapsed_minutes = minutes;

    const playerRegenChanged = applyRegen(state.schema?.fields || {}, state.values, minutes, isResting);
    const playerPromotions   = checkPromotions(state.schema?.fields || {}, state.values);
    const npcPromotions      = [];

    if (settings.campaignLorebook && minutes > 0) {
        const { loadWorldInfo } = SillyTavern.getContext();
        const worldData = await loadWorldInfo(settings.campaignLorebook);
        if (worldData?.entries) {
            const npcCores = Object.values(worldData.entries)
                .filter(e => e.extensions?.type === 'NPC_CORE' && e.extensions?.npc_schema);
            for (const core of npcCores) {
                const npcName      = core.comment.replace('[NPC] ', '');
                const schema       = core.extensions.npc_schema;
                const keys         = core.key;
                if (!Object.values(schema.fields).some(d => d.regen?.rate)) continue;
                const currentValues = parseNpcCurrentValues(worldData, npcName);
                const regenChanged  = applyRegen(schema.fields, currentValues, minutes, isResting);
                const promos        = checkPromotions(schema.fields, currentValues);
                if (regenChanged || promos.length) {
                    const dynFields = core.extensions.dynamic_fields ?? [];
                    await rebuildNpcStateEntry(npcName, dynFields, currentValues, schema, keys, settings);
                    await rebuildNpcProgressionEntry(npcName, schema, currentValues, keys, settings);
                    for (const p of promos) {
                        npcPromotions.push({ npc: npcName, ...p });
                        await processNpcMemoryDirect(npcName, 'episodic',
                            `Skill gain: ${schema.fields[p.key]?.label || p.key}`, `${p.reason}.`,
                            [npcName.toLowerCase(), 'skill gain'], settings);
                    }
                }
            }
        }
    }

    return { playerRegenChanged, playerPromotions, npcPromotions, minutes };
}
