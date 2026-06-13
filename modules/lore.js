/**
 * gm-lore-parser / modules/lore.js
 * NPC lorebook storage internals (core/state/progression rebuild + memory) reused
 * by the unified entity core, the Item handlers (+ ITEM_UPDATE), and generic lore
 * (Location, Rule, Event). NPCs/creatures are authored via [ENTITY type:npc|creature];
 * their update/event logic lives in modules/entity.js.
 */

// ── NPC ───────────────────────────────────────────────────────────────────────

async function processNpcBlock(fields, settings) {
    if (!fields.name) return false;
    const name          = fields.name;
    const dynamicFields = fields.dynamic_fields
        ? fields.dynamic_fields.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
        : ['attitude', 'location', 'condition', 'relationship_to_party', 'notes'];
    const keys   = fields.keywords ? normalizeKeys(fields.keywords.split(',')) : expandNameKeys(name);
    const schema = fields._inherited_schema || parseSchema(fields._raw || '');
    const hasSchema = Object.keys(schema.fields).length > 0;

    // Core entry (immutable characteristics). The comment titles the entry, so the
    // content carries only the data (no redundant header line); internal keys skipped.
    const coreLines  = [];
    const skipInCore = new Set([...LORE_META, ...dynamicFields, 'schema', 'type', 'from_template']);
    const schemaKeys = new Set(Object.keys(schema.fields));
    for (const [k, v] of Object.entries(fields))
        if (!skipInCore.has(k) && !schemaKeys.has(k) && !k.startsWith('_')) coreLines.push(`${k.replace(/_/g, ' ')}: ${v}`);
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
    const lines = [];
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
    const content = buildValueSummary('', schema, values);
    await upsertEntry(settings.campaignLorebook, {
        ...entryBase(`[NPC:Progression] ${name}`, keys, content, settings.loreOrder + 2, settings, { type: 'NPC_PROGRESSION' }),
    });
}

// NPC update/event logic now lives in the unified entity core (modules/entity.js):
// npcEntityUpdate / npcEntityEvent build a lorebook handle and call the shared
// entityApplyUpdate / entityApplyEvent ops, then commit via the rebuild helpers
// below. processNpcBlock (above) and the rebuild/parse helpers remain here as the
// NPC storage internals those wrappers reuse.

async function processNpcMemory(raw, settings) {
    const fields  = parseFields(raw);
    const npcName = fields.npc || fields.name;
    if (!npcName) return false;
    const memType  = (fields.type || 'episodic').toLowerCase();
    const isCore   = memType === 'core';
    const title    = fields.title || '';
    const content  = fields.content || fields.memory || '';
    const keywords = fields.keywords
        ? normalizeKeys(fields.keywords.split(','))
        : isCore ? [] : expandNameKeys(npcName);
    return processNpcMemoryDirect(npcName, memType, title, content, keywords, settings);
}

/** Write a memory entry into a per-subject history lorebook (`<prefix>-<slug>`).
 *  Used for NPC histories (prefix 'npc') and location histories (prefix 'location'). */
async function writeSubjectMemory(subjectName, prefix, memType, title, content, keywords, settings) {
    const isCore = memType === 'core';
    const lb     = `${prefix}-${slugify(subjectName)}`;
    await loadOrCreateLorebook(lb);
    await linkToChat(lb);
    const entry = {
        comment:    `[Memory] ${subjectName} — ${title || content.slice(0, 40)}`,
        key:        keywords, keysecondary: [],
        content:    content,
        constant:   isCore, selective: false, selectiveLogic: 0,
        order:      isCore ? 1 : 50, depth: settings.defaultScanDepth,
        disable:    false, addMemo: true,
        memo:       `${isCore ? 'Core' : 'Episodic'} memory — gm-lore-parser v${VERSION}`,
        position:   0, role: null,
        extensions: { gm_lore_parser: true, type: `${prefix.toUpperCase()}_MEMORY`, subject: subjectName, memory_type: memType },
    };
    return upsertEntry(lb, entry);
}

/** NPC memory — thin wrapper over the generic subject-memory writer. */
async function processNpcMemoryDirect(npcName, memType, title, content, keywords, settings) {
    return writeSubjectMemory(npcName, 'npc', memType, title, content, keywords, settings);
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
    const pct   = (dur / durMax) * 100;
    const conds = getItemConditions();
    return (conds.find(c => pct >= c.min) || conds.at(-1)).label;
}

async function processItemBlock(fields, settings) {
    if (!fields.name) return false;
    const name          = fields.name;
    const mutableFields = fields.mutable_fields
        ? fields.mutable_fields.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
        : [];
    const keys  = fields.keywords ? normalizeKeys(fields.keywords.split(',')) : expandNameKeys(name);
    const lines = [];
    if (fields.durability && fields.durability_max) {
        const c = itemConditionLabel(parseFloat(fields.durability), parseFloat(fields.durability_max));
        if (c) lines.push(`condition: ${c}`);
    }
    for (const [k, v] of Object.entries(fields)) if (!LORE_META.has(k) && !k.startsWith('_')) lines.push(`${k.replace(/_/g, ' ')}: ${v}`);
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

// Bestiary entries are now "creature" entities (modules/entity.js creatureEntityBegin),
// stored as immutable templates that NPC/creature instances can inherit via from_template.

// ── Location (first-class lore type; instances optional) ──────────────────────

function locationsCfg() {
    const l = getSystemDef().locations || {};
    return {
        types: l.types || ['Settlement', 'Wilderness', 'Dungeon', 'Landmark', 'Instance'],
        create_history_lorebook: l.create_history_lorebook !== false,
        instances: { enabled: l.instances?.enabled === true, types: l.instances?.types || ['Solo', 'Party', 'Raid'] },
    };
}

async function processLocationBlock(fields, settings) {
    if (!fields.name) { console.warn(`[${MODULE_NAME}] LOCATION missing name`); return false; }
    const cfg   = locationsCfg();
    const name  = fields.name;
    const keys  = fields.keywords ? normalizeKeys(fields.keywords.split(',')) : expandNameKeys(name);

    const lines = [];
    if (fields.type)        lines.push(`Type: ${fields.type}`);
    if (fields.region)      lines.push(`Region: ${fields.region}`);
    if (fields.description) lines.push(`Description: ${fields.description}`);
    // Instance subtype — only honored when the system enables instances
    const isInstance = cfg.instances.enabled && (fields.instance === 'true' || fields.instance_type);
    if (isInstance) {
        lines.push('Instance: true');
        if (fields.instance_type) lines.push(`Instance type: ${fields.instance_type}`);
    }
    for (const [k, v] of Object.entries(fields))
        if (!LORE_META.has(k) && !k.startsWith('_') && !['type', 'region', 'description', 'instance', 'instance_type'].includes(k))
            lines.push(`${k.replace(/_/g, ' ')}: ${v}`);

    await upsertEntry(settings.campaignLorebook, {
        ...entryBase(`[Location] ${name}`, keys, lines.join('\n'), settings.loreOrder, settings,
            { type: 'LOCATION', slug: slugify(name), location_type: fields.type || '', instance: isInstance, instance_type: isInstance ? (fields.instance_type || '') : '' }),
    });

    // Auto-create a per-location history lorebook on discovery
    if (cfg.create_history_lorebook) {
        const lb = `location-${slugify(name)}`;
        await loadOrCreateLorebook(lb);
        await linkToChat(lb);
    }
    console.log(`[${MODULE_NAME}] Location: "${name}"${fields.type ? ` (${fields.type})` : ''}${isInstance ? ' [instance]' : ''}`);
    return true;
}

/** [LOCATION_MEMORY] — append to a location's history lorebook. */
async function processLocationMemory(raw, settings) {
    const fields = parseFields(raw);
    const name   = fields.location || fields.name;
    if (!name) { console.warn(`[${MODULE_NAME}] LOCATION_MEMORY missing location`); return false; }
    const memType  = (fields.type || 'episodic').toLowerCase();
    const title    = fields.title || '';
    const content  = fields.content || fields.memory || '';
    const keywords = fields.keywords ? normalizeKeys(fields.keywords.split(','))
                                     : (memType === 'core' ? [] : expandNameKeys(name));
    return writeSubjectMemory(name, 'location', memType, title, content, keywords, settings);
}

function cmdLocations(state) {
    // Locations live in the lorebook, not chat state; surface what we can from the campaign book is async,
    // so this lists the configured location types for reference.
    const cfg = locationsCfg();
    const lines = ['[Locations]', `Types: ${cfg.types.join(', ')}`];
    if (cfg.instances.enabled) lines.push(`Instance types: ${cfg.instances.types.join(', ')}`);
    lines.push('(Discovered locations are stored in the campaign lorebook and trigger by keyword.)');
    return lines.join('\n');
}

// ── Generic lore (Faction, Rule, Event) ──────────────────────────────────────

async function processGenericLore(type, cfg, fields, settings) {
    if (!fields.name && type !== 'EVENT') return false;
    const name  = fields.name || `Event ${Date.now()}`;
    const keyFd = type === 'RULE' ? 'trigger_keywords' : 'keywords';
    const keys  = fields[keyFd]
        ? normalizeKeys(fields[keyFd].split(','))
        : expandNameKeys(name);
    const lines = [];
    for (const [k, v] of Object.entries(fields)) if (!LORE_META.has(k) && !k.startsWith('_')) lines.push(`${k.replace(/_/g, ' ')}: ${v}`);
    return upsertEntry(settings.campaignLorebook, {
        ...entryBase(`[${cfg.label}] ${name}`, keys, lines.join('\n'),
            type === 'RULE' ? settings.ruleOrder : settings.loreOrder, settings, { type: cfg.label }),
    });
}
