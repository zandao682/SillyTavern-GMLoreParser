/**
 * gm-lore-parser / modules/companions.js
 * Companion entity-type module (part of the entity layer). Companions are
 * entities authored via [ENTITY type:companion] / [ENTITY_UPDATE type:companion];
 * the unified entity core (modules/entity.js) delegates companion-specific rules
 * here: loyalty, control limit, role, AP point-buy, the legion/delegation tree,
 * and companion rendering (panel / context / #companions / #legion).
 *
 * Vocabularies (roles, statuses, defaults, the lieutenant role) come from the
 * active System Definition's `companions` section via companionCfg().
 */

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

// ── Companion update (companion-rules layer the entity core delegates to) ──────

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
        const keywords = [fields.name.toLowerCase(), `${fields.name.toLowerCase()} companion`];
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
    const lines = [`[Companion] ${comp.name}`];
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

// ── Context string ────────────────────────────────────────────────────────────

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

// ── Panel HTML ────────────────────────────────────────────────────────────────

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

// ── Commands ──────────────────────────────────────────────────────────────────

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
