/**
 * gm-lore-parser / modules/lore.js
 * Lorebook entry writers for all lore block types:
 * NPC (+ NPC_UPDATE, NPC_ATTR_CHANGE, NPC_MEMORY), Item (+ ITEM_UPDATE),
 * Bestiary, and generic lore (Location, Faction, Rule, Event).
 */

// ── NPC ───────────────────────────────────────────────────────────────────────

async function processNpcBlock(fields, settings) {
    if (!fields.name) return false;
    const name          = fields.name;
    const dynamicFields = fields.dynamic_fields
        ? fields.dynamic_fields.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
        : ['attitude', 'location', 'condition', 'relationship_to_party', 'notes'];
    const keys   = fields.keywords ? fields.keywords.split(',').map(k => k.trim()).filter(Boolean) : [name.toLowerCase()];
    const schema = parseSchema(fields._raw || '');
    const hasSchema = Object.keys(schema.fields).length > 0;

    // Core entry (immutable characteristics)
    const coreLines  = [`[NPC] ${name}`];
    const skipInCore = new Set([...LORE_META, ...dynamicFields, 'schema', '_raw']);
    const schemaKeys = new Set(Object.keys(schema.fields));
    for (const [k, v] of Object.entries(fields))
        if (!skipInCore.has(k) && !schemaKeys.has(k)) coreLines.push(`${k.replace(/_/g, ' ')}: ${v}`);
    coreLines.push(`[Core — immutable. See [NPC:State]${hasSchema ? ' and [NPC:Progression]' : ''} for dynamic data.]`);

    await upsertEntry(settings.campaignLorebook, {
        ...entryBase(`[NPC] ${name}`, keys, coreLines.join('\n'), settings.loreOrder, settings, {
            type: 'NPC_CORE', dynamic_fields: dynamicFields,
            npc_schema: hasSchema ? schema : null, npc_slug: slugify(name),
        }),
    });

    // State entry (dynamic fields + gm_mutable schema fields)
    await rebuildNpcStateEntry(name, dynamicFields, fields, schema, keys, settings);

    // Progression entry (schema-driven stat block)
    if (hasSchema) {
        const initValues = {};
        for (const key of Object.keys(schema.fields))
            if (fields[key] !== undefined) { const n = parseFloat(fields[key]); initValues[key] = isNaN(n) ? fields[key] : n; }
        await rebuildNpcProgressionEntry(name, schema, initValues, keys, settings);
    }
    return true;
}

async function rebuildNpcStateEntry(name, dynamicFields, currentValues, schema, keys, settings) {
    const lines = [`[NPC:State] ${name}`];
    const schemaGmMutable = Object.entries(schema?.fields || {})
        .filter(([, d]) => getMutability(d) === MUTABILITY.GM_MUTABLE);
    for (const f of dynamicFields)
        if (currentValues[f] !== undefined && currentValues[f] !== '') lines.push(`${f.replace(/_/g, ' ')}: ${currentValues[f]}`);
    for (const [key, desc] of schemaGmMutable) {
        if (currentValues[key] !== undefined) {
            const label = desc.label || key;
            const val   = currentValues[key];
            const maxF  = desc.max_field;
            lines.push(maxF && currentValues[maxF] !== undefined ? `${label}: ${val}/${currentValues[maxF]}` : `${label}: ${val}`);
        }
    }
    await upsertEntry(settings.campaignLorebook, {
        ...entryBase(`[NPC:State] ${name}`, keys, lines.join('\n'), settings.loreOrder + 1, settings, { type: 'NPC_STATE' }),
    });
}

async function rebuildNpcProgressionEntry(name, schema, values, keys, settings) {
    const content = buildValueSummary(`[NPC:Progression] ${name}`, schema, values);
    await upsertEntry(settings.campaignLorebook, {
        ...entryBase(`[NPC:Progression] ${name}`, keys, content, settings.loreOrder + 2, settings, { type: 'NPC_PROGRESSION' }),
    });
}

async function processNpcUpdate(raw, settings) {
    const fields = parseFields(raw);
    const name   = fields.name;
    if (!name) { console.warn(`[${MODULE_NAME}] NPC_UPDATE missing name`); return false; }

    const { loadWorldInfo } = SillyTavern.getContext();
    const worldData = await loadWorldInfo(settings.campaignLorebook);
    if (!worldData?.entries) return false;

    const coreEntry = Object.values(worldData.entries).find(e => e.comment === `[NPC] ${name}`);
    if (!coreEntry) { console.warn(`[${MODULE_NAME}] NPC_UPDATE: no core for "${name}"`); return false; }

    const dynamicFields = coreEntry.extensions?.dynamic_fields ?? ['attitude', 'location', 'condition', 'notes'];
    const schema        = coreEntry.extensions?.npc_schema ?? { fields: {}, groups: [] };
    const keys          = coreEntry.key;
    const currentValues = parseNpcCurrentValues(worldData, name);
    const changes = [], blocked = [];

    for (const [key, val] of Object.entries(fields)) {
        if (key === 'name') continue;
        const desc = schema.fields[key];
        const mut  = desc ? getMutability(desc) : null;
        if (desc) {
            if (mut === MUTABILITY.GM_MUTABLE)   { applyFieldValue(key, val, desc, currentValues); changes.push(key); }
            else if (mut === MUTABILITY.USE_TRACKED) blocked.push(`${key}(use_tracked base)`);
            else if (mut === MUTABILITY.GM_EVENT)    blocked.push(`${key}(gm_event)`);
            else blocked.push(`${key}(immutable)`);
        } else if (key.endsWith('_uses') && schema.fields[key.slice(0, -5)]) {
            if (getMutability(schema.fields[key.slice(0, -5)]) === MUTABILITY.USE_TRACKED) {
                const cur = parseInt(currentValues[key]) || 0;
                currentValues[key] = val.startsWith('+') ? cur + parseInt(val) : (parseInt(val) || 0);
                changes.push(key);
            }
        } else if (dynamicFields.includes(key)) {
            currentValues[key] = val; changes.push(key);
        } else {
            blocked.push(`${key}(not in schema or dynamic_fields)`);
        }
    }
    if (blocked.length) console.warn(`[${MODULE_NAME}] NPC_UPDATE blocked: ${blocked.join(', ')}`);
    if (!changes.length) return false;

    const promotions = checkPromotions(schema.fields, currentValues);
    if (promotions.length) {
        for (const p of promotions)
            await processNpcMemoryDirect(name, 'episodic',
                `Skill gain: ${schema.fields[p.key]?.label || p.key}`, `${p.reason}.`,
                [name.toLowerCase(), 'skill gain'], settings);
    }
    await rebuildNpcStateEntry(name, dynamicFields, currentValues, schema, keys, settings);
    if (Object.keys(schema.fields).length > 0)
        await rebuildNpcProgressionEntry(name, schema, currentValues, keys, settings);
    return { changed: changes.length > 0, promotions };
}

async function processNpcAttrChange(raw, settings) {
    const fields = parseFields(raw);
    const name   = fields.name;
    const reason = fields.reason;
    if (!name || !reason) return false;

    const { loadWorldInfo } = SillyTavern.getContext();
    const worldData = await loadWorldInfo(settings.campaignLorebook);
    if (!worldData?.entries) return false;

    const coreEntry = Object.values(worldData.entries).find(e => e.comment === `[NPC] ${name}`);
    if (!coreEntry?.extensions?.npc_schema) return false;

    const schema        = coreEntry.extensions.npc_schema;
    const keys          = coreEntry.key;
    const dynamicFields = coreEntry.extensions?.dynamic_fields ?? [];
    const currentValues = parseNpcCurrentValues(worldData, name);
    const changes = [], blocked = [];

    for (const [key, val] of Object.entries(fields)) {
        if (key === 'name' || key === 'reason') continue;
        const desc = schema.fields[key];
        const mut  = desc ? getMutability(desc) : null;
        if (mut !== MUTABILITY.GM_EVENT) { blocked.push(`${key}(${mut || 'unknown'})`); continue; }
        const oldVal = currentValues[key];
        applyFieldValue(key, val, desc, currentValues);
        changes.push({ key, oldVal, newVal: currentValues[key] });
    }
    if (blocked.length) console.warn(`[${MODULE_NAME}] NPC_ATTR_CHANGE blocked: ${blocked.join(', ')}`);
    if (!changes.length) return false;

    const summary = changes.map(c => `${schema.fields[c.key]?.label || c.key}: ${c.oldVal}→${c.newVal}`).join(', ');
    await processNpcMemoryDirect(name, 'episodic', `Milestone: ${reason}`, `${reason}. Changes: ${summary}.`,
        [name.toLowerCase(), 'milestone'], settings);
    await rebuildNpcStateEntry(name, dynamicFields, currentValues, schema, keys, settings);
    await rebuildNpcProgressionEntry(name, schema, currentValues, keys, settings);
    return { changes, reason };
}

async function processNpcMemory(raw, settings) {
    const fields  = parseFields(raw);
    const npcName = fields.npc || fields.name;
    if (!npcName) return false;
    const memType  = (fields.type || 'episodic').toLowerCase();
    const isCore   = memType === 'core';
    const title    = fields.title || '';
    const content  = fields.content || fields.memory || '';
    const keywords = fields.keywords
        ? fields.keywords.split(',').map(k => k.trim()).filter(Boolean)
        : isCore ? [] : [npcName.toLowerCase()];
    return processNpcMemoryDirect(npcName, memType, title, content, keywords, settings);
}

async function processNpcMemoryDirect(npcName, memType, title, content, keywords, settings) {
    const isCore = memType === 'core';
    const lb     = `npc-${slugify(npcName)}`;
    await loadOrCreateLorebook(lb);
    await linkToChat(lb);
    const entry = {
        comment:    `[Memory] ${npcName} — ${title || content.slice(0, 40)}`,
        key:        keywords, keysecondary: [],
        content:    `[${npcName} — ${isCore ? 'Core Memory' : 'Memory'}]\n${content}`,
        constant:   isCore, selective: false, selectiveLogic: 0,
        order:      isCore ? 1 : 50, depth: settings.defaultScanDepth,
        disable:    false, addMemo: true,
        memo:       `${isCore ? 'Core' : 'Episodic'} memory — gm-lore-parser v${VERSION}`,
        position:   0, role: null,
        extensions: { gm_lore_parser: true, type: 'NPC_MEMORY', npc: npcName, memory_type: memType },
    };
    return upsertEntry(lb, entry);
}

function parseNpcCurrentValues(worldData, npcName) {
    const values = {};
    for (const comment of [`[NPC:State] ${npcName}`, `[NPC:Progression] ${npcName}`]) {
        const entry = Object.values(worldData.entries).find(e => e.comment === comment);
        if (!entry) continue;
        for (const line of entry.content.split('\n')) {
            if (line.startsWith('[')) continue;
            const colon = line.indexOf(':'); if (colon === -1) continue;
            const k   = line.slice(0, colon).trim().toLowerCase().replace(/\s+/g, '_');
            const raw = line.slice(colon + 1).trim();
            const slashIdx = raw.indexOf('/');
            if (slashIdx !== -1 && !isNaN(parseFloat(raw.slice(0, slashIdx))))
                values[k] = parseFloat(raw.slice(0, slashIdx));
            else { const num = parseFloat(raw); values[k] = isNaN(num) ? raw : num; }
        }
    }
    return values;
}

// ── Item ──────────────────────────────────────────────────────────────────────

function itemConditionLabel(dur, durMax) {
    if (!durMax || durMax <= 0) return null;
    const pct = (dur / durMax) * 100;
    return (ITEM_CONDITIONS.find(c => pct >= c.min) || ITEM_CONDITIONS.at(-1)).label;
}

async function processItemBlock(fields, settings) {
    if (!fields.name) return false;
    const name          = fields.name;
    const mutableFields = fields.mutable_fields
        ? fields.mutable_fields.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
        : [];
    const keys  = fields.keywords ? fields.keywords.split(',').map(k => k.trim()).filter(Boolean) : [name.toLowerCase()];
    const lines = [`[Item] ${name}`];
    if (fields.durability && fields.durability_max) {
        const c = itemConditionLabel(parseFloat(fields.durability), parseFloat(fields.durability_max));
        if (c) lines.push(`condition: ${c}`);
    }
    for (const [k, v] of Object.entries(fields)) if (!LORE_META.has(k)) lines.push(`${k.replace(/_/g, ' ')}: ${v}`);
    if (mutableFields.length) lines.push(`[Mutable: ${mutableFields.join(', ')}]`);
    return upsertEntry(settings.campaignLorebook, {
        ...entryBase(`[Item] ${name}`, keys, lines.join('\n'), settings.loreOrder, settings, { type: 'ITEM', mutable_fields: mutableFields }),
    });
}

async function processItemUpdate(raw, settings) {
    const fields = parseFields(raw);
    const name   = fields.name; if (!name) return false;
    const { loadWorldInfo, saveWorldInfo } = SillyTavern.getContext();
    const worldData  = await loadWorldInfo(settings.campaignLorebook); if (!worldData?.entries) return false;
    const itemEntry  = Object.values(worldData.entries).find(e => e.comment === `[Item] ${name}`); if (!itemEntry) return false;
    const mutableFields = itemEntry.extensions?.mutable_fields ?? [];
    const cur = {};
    for (const line of itemEntry.content.split('\n')) {
        if (line.startsWith('[')) continue;
        const colon = line.indexOf(':'); if (colon === -1) continue;
        cur[line.slice(0, colon).trim().toLowerCase().replace(/\s+/g, '_')] = line.slice(colon + 1).trim();
    }
    const blocked = [], accepted = [];
    for (const [key, val] of Object.entries(fields)) {
        if (key === 'name') continue;
        if (mutableFields.includes(key)) { cur[key] = val; accepted.push(key); }
        else blocked.push(key);
    }
    if (blocked.length) console.warn(`[${MODULE_NAME}] ITEM_UPDATE blocked: ${blocked.join(', ')}`);
    if (!accepted.length) return false;
    if (cur.durability && cur.durability_max) {
        const c = itemConditionLabel(parseFloat(cur.durability), parseFloat(cur.durability_max));
        if (c) cur.condition = c;
    }
    const newLines = [`[Item] ${name}`];
    for (const [k, v] of Object.entries(cur)) if (k !== 'name') newLines.push(`${k.replace(/_/g, ' ')}: ${v}`);
    if (mutableFields.length) newLines.push(`[Mutable: ${mutableFields.join(', ')}]`);
    itemEntry.content = newLines.join('\n');
    itemEntry.memo    = `Item updated — gm-lore-parser v${VERSION}`;
    await saveWorldInfo(settings.campaignLorebook, worldData);
    return true;
}

// ── Bestiary ──────────────────────────────────────────────────────────────────

async function processBestiaryBlock(fields, settings) {
    const name = fields.name || `Creature ${Date.now()}`;
    const keys = fields.keywords ? fields.keywords.split(',').map(k => k.trim()).filter(Boolean) : [name.toLowerCase()];
    const coreLines = [`[Bestiary] ${name}`], scalingLines = [];
    for (const [k, v] of Object.entries(fields)) {
        if (LORE_META.has(k)) continue;
        if (k.endsWith('_per_level'))
            scalingLines.push(`  ${k.replace(/_per_level$/, '').replace(/_/g, ' ')} +${v} per level`);
        else
            coreLines.push(`${k.replace(/_/g, ' ')}: ${v}${/^\d+\s*(?:-|to)\s*\d+$/.test(String(v).trim()) ? ' (range)' : ''}`);
    }
    if (scalingLines.length) { coreLines.push('Scaling:'); coreLines.push(...scalingLines); }
    coreLines.push('[Immutable — never rewrite this entry for the same creature]');
    return upsertEntry(settings.campaignLorebook, {
        ...entryBase(`[Bestiary] ${name}`, keys, coreLines.join('\n'), settings.loreOrder, settings, { type: 'BESTIARY', immutable: true }),
    });
}

// ── Generic lore (Location, Faction, Rule, Event) ────────────────────────────

async function processGenericLore(type, cfg, fields, settings) {
    if (!fields.name && type !== 'EVENT') return false;
    const name  = fields.name || `Event ${Date.now()}`;
    const keyFd = type === 'RULE' ? 'trigger_keywords' : 'keywords';
    const keys  = fields[keyFd]
        ? fields[keyFd].split(',').map(k => k.trim()).filter(Boolean)
        : [name.toLowerCase()];
    const lines = [`[${cfg.label}] ${name}`];
    for (const [k, v] of Object.entries(fields)) if (!LORE_META.has(k)) lines.push(`${k.replace(/_/g, ' ')}: ${v}`);
    return upsertEntry(settings.campaignLorebook, {
        ...entryBase(`[${cfg.label}] ${name}`, keys, lines.join('\n'),
            type === 'RULE' ? settings.ruleOrder : settings.loreOrder, settings, { type: cfg.label }),
    });
}
