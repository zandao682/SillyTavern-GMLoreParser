/**
 * gm-lore-parser / modules/inventory.js
 * Possessions: equipment slots, the inventory model (freeform / slots / weight),
 * and the optional item box. The extension is a record-keeper — it tracks and
 * displays load/slots and injects the model into context so the GM enforces it;
 * it does not auto-reject overweight or over-slot loads.
 *
 * Configured via the System Definition:
 *   inventory:  { model, capacity, unit, item_box }
 *   equipment:  { enabled, slots:[{key,label}] }   (gated by features.equipment)
 *
 * Inventory items live in the player schema list field `inventory`. Equipment is
 * a slot→item map (state.equipment). The item box is state.item_box[] of
 * { item, condition }. Equipment is set via [ENTITY_UPDATE] equip/unequip
 * directives (handled in entity.js); the item box via [ITEM_BOX_UPDATE].
 */

function inventoryCfg() {
    const i = getSystemDef().inventory || {};
    return {
        model:    i.model    || 'freeform',
        capacity: i.capacity ?? null,
        unit:     i.unit     || 'slots',
        item_box: i.item_box === true,
    };
}
function equipmentCfg() {
    const e = getSystemDef().equipment || {};
    return { enabled: e.enabled === true, slots: e.slots || [] };
}

// ── Equipment directives (called from the entity-update path) ──────────────────

/** Apply an equip/unequip directive. `equip` = "<slot>=<item>"; `unequip` = "<slot>". */
function applyEquipDirective(equipStr, unequipStr) {
    const state = getCharState();
    if (!state.equipment) state.equipment = {};
    let changed = false;
    if (equipStr) {
        for (const pair of String(equipStr).split(',')) {
            const eq = pair.indexOf('=');
            if (eq === -1) continue;
            const slot = pair.slice(0, eq).trim().toLowerCase().replace(/\s+/g, '_');
            const item = pair.slice(eq + 1).trim();
            if (slot) { state.equipment[slot] = item; changed = true; }
        }
    }
    if (unequipStr) {
        for (const slot of String(unequipStr).split(',').map(s => s.trim().toLowerCase().replace(/\s+/g, '_')).filter(Boolean)) {
            if (state.equipment[slot] !== undefined) { delete state.equipment[slot]; changed = true; }
        }
    }
    if (changed) console.log(`[${MODULE_NAME}] Equipment updated:`, JSON.stringify(state.equipment));
    return changed;
}

// ── Item box ───────────────────────────────────────────────────────────────────

/** [ITEM_BOX_UPDATE]  add: <item> | <condition>   /  remove: <item> */
function applyItemBoxUpdate(raw) {
    const state  = getCharState();
    if (!state.item_box) state.item_box = [];
    const fields = parseFields(raw);
    let changed  = false;

    if (fields.add) {
        for (const entry of fields.add.split(';').map(s => s.trim()).filter(Boolean)) {
            const [item, condition] = entry.split('|').map(s => s.trim());
            if (item) { state.item_box.push({ item, condition: condition || '' }); changed = true; }
        }
    }
    if (fields.remove) {
        for (const item of fields.remove.split(';').map(s => s.trim()).filter(Boolean)) {
            const idx = state.item_box.findIndex(e => e.item.toLowerCase() === item.toLowerCase());
            if (idx >= 0) { state.item_box.splice(idx, 1); changed = true; }
        }
    }
    if (changed) console.log(`[${MODULE_NAME}] Item box updated (${state.item_box.length} items).`);
    return changed;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/** A short "load" string per the inventory model, or '' for freeform. */
function inventoryLoadString(state) {
    const cfg = inventoryCfg();
    if (cfg.model === 'slots') {
        const count = Array.isArray(state.values?.inventory) ? state.values.inventory.length : 0;
        return `${count}${cfg.capacity ? '/' + cfg.capacity : ''} ${cfg.unit}`;
    }
    if (cfg.model === 'weight') {
        const carried = parseFloat(state.values?.carried_weight) || 0;
        return `${carried}${cfg.capacity ? '/' + cfg.capacity : ''} ${cfg.unit}`;
    }
    return '';
}

// ── Context string ─────────────────────────────────────────────────────────────

function buildInventoryContextString(state) {
    const eq  = equipmentCfg();
    const lines = [];
    if (eq.enabled && eq.slots.length) {
        const worn = eq.slots
            .map(s => state.equipment?.[s.key] ? `${s.label || s.key}: ${state.equipment[s.key]}` : null)
            .filter(Boolean);
        if (worn.length) lines.push('[Equipped] ' + worn.join(', '));
    }
    const load = inventoryLoadString(state);
    if (load) lines.push(`[Inventory] ${load}`);
    if (inventoryCfg().item_box && state.item_box?.length)
        lines.push(`[Item Box] ${state.item_box.length} items`);
    return lines.join('\n');
}

// ── Panel HTML ───────────────────────────────────────────────────────────────

function buildInventoryPanel(state) {
    const eq  = equipmentCfg();
    const sections = [];

    if (eq.enabled && eq.slots.length) {
        const rows = eq.slots.map(s => {
            const item = state.equipment?.[s.key];
            return `<div class="glp-equip-row"><span class="glp-equip-slot">${s.label || s.key}</span><span class="glp-equip-item">${item || '—'}</span></div>`;
        }).join('');
        sections.push(`<div class="glp-section"><div class="glp-section-title">Equipment</div>${rows}</div>`);
    }

    const load = inventoryLoadString(state);
    if (load)
        sections.push(`<div class="glp-section"><div class="glp-section-title">Load</div><div class="glp-inv-load">${load}</div></div>`);

    if (inventoryCfg().item_box && state.item_box?.length) {
        const rows = state.item_box.map(e =>
            `<div class="glp-itembox-row"><span>${e.item}</span>${e.condition ? `<span class="glp-itembox-cond">${e.condition}</span>` : ''}</div>`
        ).join('');
        sections.push(`<div class="glp-section"><div class="glp-section-title">Item Box</div>${rows}</div>`);
    }
    return sections.join('');
}

// ── Commands ───────────────────────────────────────────────────────────────────

function cmdEquipment(state) {
    const eq = equipmentCfg();
    if (!eq.enabled || !eq.slots.length) return '[Equipment]\nThis system has no equipment slots.';
    const lines = ['[Equipment]'];
    for (const s of eq.slots)
        lines.push(`  ${s.label || s.key}: ${state.equipment?.[s.key] || '—'}`);
    return lines.join('\n');
}

function cmdItemBox(state) {
    if (!inventoryCfg().item_box) return '[Item Box]\nThis system has no item box.';
    const box = state.item_box || [];
    if (!box.length) return '[Item Box]\nEmpty.';
    return '[Item Box]\n' + box.map((e, i) => `  ${i + 1}. ${e.item}${e.condition ? ` (${e.condition})` : ''}`).join('\n');
}
