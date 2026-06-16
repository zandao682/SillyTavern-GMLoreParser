/**
 * gm-lore-parser / modules/schema.js
 * Schema engine — field value application, use-tracked promotions,
 * regen calculation, and value summary building.
 * Used by both player sheet and NPC handlers.
 */

/** Apply a single field value update, respecting field type semantics. */
function applyFieldValue(key, val, desc, values) {
    const ft = desc?.type || 'value';
    if (ft === 'list') {
        const sep  = desc?.separator || ',';
        const ops  = val.split(sep).map(s => s.trim()).filter(Boolean);
        if (!Array.isArray(values[key])) values[key] = [];
        const hasPrefix = ops.some(o => o.startsWith('+') || o.startsWith('-'));
        if (hasPrefix) {
            for (const op of ops) {
                if (op.startsWith('+'))      { const i = op.slice(1).trim(); if (!values[key].includes(i)) values[key].push(i); }
                else if (op.startsWith('-')) { const i = op.slice(1).trim(); values[key] = values[key].filter(x => x !== i); }
            }
        } else {
            values[key] = ops;
        }
    } else if (ft === 'pool' || ft === 'bar') {
        // pools and bars (HP/stamina/warmth/MP) accept relative deltas: a leading
        // +/- adjusts the current value (floored at 0, capped at max_field); a bare
        // number sets it absolutely. Deltas are what a GM naturally writes for
        // damage/healing ("hp: -3"), and the most reliable thing a small model emits.
        const cur = parseInt(values[key]) || 0;
        values[key] = (typeof val === 'string' && (val.startsWith('+') || val.startsWith('-')))
            ? Math.max(0, cur + parseInt(val))
            : (parseInt(val) || 0);
        if (desc?.max_field && values[desc.max_field] !== undefined)
            values[key] = Math.min(values[key], parseInt(values[desc.max_field]) || Infinity);
    } else {
        const num = parseFloat(val);
        values[key] = isNaN(num) ? val : num;
    }
}

/**
 * Check all use_tracked fields in a schema and auto-promote any that
 * have hit their threshold. Returns array of promotion descriptors.
 */
function checkPromotions(schemaFields, values) {
    const promos = [];
    for (const [key, desc] of Object.entries(schemaFields)) {
        if (getMutability(desc) !== MUTABILITY.USE_TRACKED) continue;
        const uk   = `${key}_uses`;
        const thr  = desc.uses_threshold || 5;
        const gain = desc.uses_gain      || 1;
        const uses = parseInt(values[uk]) || 0;
        if (uses >= thr) {
            const ov = parseFloat(values[key]) || 0;
            const nv = ov + gain;
            values[key] = nv;
            values[uk]  = uses - thr;
            promos.push({ key, oldVal: ov, newVal: nv, reason: `Use-tracked: ${uses}/${thr}` });
        }
    }
    return promos;
}

/**
 * Apply passive regen to all fields with a regen_rate.
 * Returns true if any field changed.
 */
function applyRegen(schemaFields, values, elapsedMinutes, isResting) {
    if (elapsedMinutes <= 0) return false;
    let changed = false;
    for (const [key, desc] of Object.entries(schemaFields)) {
        const regen = desc.regen;
        if (!regen?.rate || regen.condition === 'never') continue;
        if (regen.condition === 'resting' && !isResting) continue;
        const rpm = regenPerMinute(desc);
        const cur = parseFloat(values[key]) || 0;
        let nv    = cur + rpm * elapsedMinutes;
        if (desc.max_field && values[desc.max_field] !== undefined)
            nv = Math.min(nv, parseFloat(values[desc.max_field]));
        nv = Math.max(0, nv);
        if (Math.abs(nv - cur) >= 0.01) {
            values[key] = (desc.type === 'value' || desc.type === 'bar') ? Math.round(nv) : nv;
            changed = true;
        }
    }
    return changed;
}

/** Ensure every System-Definition attribute the character actually has a value for
 *  has a panel field — so the def's `attributes:` list is the source of truth even
 *  when an entity block declared a field for only a subset. Missing attributes are
 *  added as gm_event value fields under the 'attributes' group (skipping any the
 *  entity has no value for, to avoid blank rows). Mutates and returns the schema. */
function augmentSchemaWithDefAttributes(schema, values) {
    if (!schema) return schema;
    const attrs = (typeof getAttributes === 'function') ? getAttributes() : [];
    if (!Array.isArray(attrs) || !attrs.length) return schema;
    schema.fields = schema.fields || {};
    schema.groups = schema.groups || [];
    const v = values || {};
    let added = false;
    for (const a of attrs) {
        if (!a.key || schema.fields[a.key]) continue;
        if (v[a.key] === undefined || v[a.key] === null || v[a.key] === '') continue;
        schema.fields[a.key] = {
            label: a.label || a.abbr || a.key, abbr: a.abbr || '', description: a.description || '',
            type: 'value', group: 'attributes', mutability: MUTABILITY.GM_EVENT,
        };
        added = true;
    }
    if (added && !schema.groups.includes('attributes')) schema.groups.push('attributes');
    return schema;
}

/** Build a plain-text summary of schema values (for context injection).
 *  Pass a falsy `header` to omit the leading title line (e.g. lorebook entries
 *  whose `comment` already titles them). */
function buildValueSummary(header, schema, values, excludeKeys) {
    const lines = header ? [header] : [];
    const sf    = schema.fields || {};
    const skip  = excludeKeys instanceof Set ? excludeKeys : null;
    const grouped = {};
    for (const [key, desc] of Object.entries(sf)) {
        if (isMaxFieldOf(key, sf) || isUsesCounterOf(key, sf)) continue;
        if (skip && skip.has(key)) continue;
        const g = desc.group || 'other';
        if (!grouped[g]) grouped[g] = [];
        grouped[g].push([key, desc]);
    }
    const allGroups = [
        ...(schema.groups || []),
        ...Object.keys(grouped).filter(g => !(schema.groups || []).includes(g)),
    ];
    for (const g of allGroups) {
        const fields = grouped[g]; if (!fields?.length) continue;
        const parts = [];
        for (const [key, desc] of fields) {
            const val = values[key];
            if (val === undefined || val === null || val === '') continue;
            const label      = desc.label || key;
            const usesSuffix = getMutability(desc) === MUTABILITY.USE_TRACKED
                ? ` (${parseInt(values[`${key}_uses`]) || 0}/${desc.uses_threshold || '?'}↑)` : '';
            if (Array.isArray(val)) {
                if (val.length) parts.push(`${label}: ${val.join(', ')}`);
            } else if (desc.max_field && values[desc.max_field] !== undefined) {
                parts.push(`${label}: ${val}/${values[desc.max_field]}${usesSuffix}`);
            } else {
                parts.push(`${label}: ${val}${usesSuffix}`);
            }
        }
        if (parts.length) lines.push(`${g}: ${parts.join(' | ')}`);
    }
    return lines.join('\n');
}
