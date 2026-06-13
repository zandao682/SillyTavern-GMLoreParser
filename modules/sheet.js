/**
 * gm-lore-parser / modules/sheet.js
 * Player stat-block seeding (applyPlayerSheet) + WORLD_TIME. The player's
 * create/update/event flow runs through the unified entity core (modules/entity.js);
 * applyPlayerSheet is the shared seeding helper it and character creation reuse.
 */

// ── Player stat-block seeding (used by playerEntityBegin + creation) ──────────

function applyPlayerSheet(raw) {
    const state  = getCharState();
    const fields = parseFlatFields(raw);   // top-level only — ignore schema descriptors
    if (fields.name)       state.name       = fields.name;
    if (fields.class)      state.class_     = fields.class;
    if (fields.background) state.background = fields.background;

    const ps = parseSchema(raw);
    if (Object.keys(ps.fields).length > 0) state.schema = ps;

    const reserved = new Set(['name', 'class', 'background', 'schema', 'schema_version', 'type', 'from_template']);
    for (const [key, val] of Object.entries(fields)) {
        if (reserved.has(key)) continue;
        if (key === 'inventory')   state.values.inventory   = val.split(';').map(s => s.trim()).filter(Boolean);
        else if (key === 'conditions') state.values.conditions = val.split(',').map(s => s.trim()).filter(Boolean);
        else { const num = parseFloat(val); state.values[key] = isNaN(num) ? val : num; }
    }
}

// Player update/event (PLAYER_UPDATE / ATTR_CHANGE) are now handled by the unified
// entity core (modules/entity.js): playerEntityUpdate / playerEntityEvent call the
// shared entityApplyUpdate / entityApplyEvent with the player handle + playerLogSink.
// applyPlayerSheet (above) remains — it is reused by playerEntityBegin and the
// character-creation flow.

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
