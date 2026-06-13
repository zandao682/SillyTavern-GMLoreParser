/**
 * gm-lore-parser / modules/currency.js
 * Handles: Currency, Adventurer/Creature rank tracking, Companion management
 *          (loyalty / control limit / role / AP point-buy), and XP awards.
 *          Companions are authored via [ENTITY type:companion]; applyCompanionUpdate
 *          is the companion-rules layer the entity core delegates to.
 *
 *   [CURRENCY_UPDATE_BEGIN] … [CURRENCY_UPDATE_END]   gold: +10 / silver: -5 (delta or abs)
 *   [RANK_CHANGE_BEGIN] … [RANK_CHANGE_END]           type: adventurer|creature, rank, reason
 *   [XP_AWARD_BEGIN] … [XP_AWARD_END]                 amount, reason, modifier
 *
 *   Companion (via [ENTITY type:companion] / [ENTITY_UPDATE type:companion]):
 *     name, type, control_cost, loyalty, status, role, notes,
 *     ap_award: N, attribute_allocate: might:5, agility:3
 *     (a companion may also carry a `schema:` for the shared stat-block engine)
 */

// ── Currency ──────────────────────────────────────────────────────────────────

function applyCurrencyUpdate(raw) {
    const fields = parseFields(raw);
    const state  = getCharState();

    for (const [denom, rawVal] of Object.entries(fields)) {
        const str = String(rawVal).trim();
        const isDelta = str.startsWith('+') || str.startsWith('-');
        const num = parseFloat(str.replace(/[^0-9.\-+]/g, ''));
        if (isNaN(num)) continue;

        if (!(denom in state.currency)) state.currency[denom] = 0;
        state.currency[denom] = isDelta
            ? state.currency[denom] + num
            : num;
        state.currency[denom] = Math.max(0, state.currency[denom]);
    }
    console.log(`[${MODULE_NAME}] Currency updated:`, JSON.stringify(state.currency));
    return true;
}

// ── Rank change ───────────────────────────────────────────────────────────────

function applyRankChange(raw) {
    const fields = parseFields(raw);
    if (!fields.rank) { console.warn(`[${MODULE_NAME}] RANK_CHANGE missing rank`); return false; }

    const state = getCharState();
    const type  = (fields.type || 'adventurer').toLowerCase();

    if (type === 'adventurer') {
        const ar = state.adventurer_rank;
        if (fields.rank_ladder) {
            ar.rank_ladder = fields.rank_ladder.split(',').map(r => r.trim()).filter(Boolean);
        }
        const ladder      = ar.rank_ladder || getRankLadder();
        const prevRank    = ar.rank;
        ar.rank           = fields.rank.trim().toUpperCase();
        const rankIdx     = ladder.indexOf(ar.rank);
        const prevIdx     = ladder.indexOf(prevRank);
        const questsDelta = rankIdx > prevIdx ? (rankIdx - prevIdx) : 0;
        ar.quest_count   += questsDelta;
        ar.history.push({ from: prevRank, to: ar.rank, reason: fields.reason || '' });
        console.log(`[${MODULE_NAME}] Adventurer rank: ${prevRank} → ${ar.rank}`);

    } else if (type === 'creature') {
        // Creatures can be NPCs or the PC's creature companion
        const targetName = fields.name || 'creature';
        const slug       = slugify(targetName);
        if (!state.companions[slug]) {
            state.companions[slug] = { name: targetName, type: 'Creature', rank: getRankLadder()[0], control_cost: 0, loyalty: (getSystemDef().loyalty?.initial ?? 50), status: 'Active', notes: '', history: [] };
        }
        const comp       = state.companions[slug];
        const prevRank   = comp.rank || 'F';
        comp.rank        = fields.rank.trim().toUpperCase();
        if (!comp.history) comp.history = [];
        comp.history.push({ from: prevRank, to: comp.rank, reason: fields.reason || '' });
        console.log(`[${MODULE_NAME}] Creature rank (${targetName}): ${prevRank} → ${comp.rank}`);
    }
    return true;
}

// ── XP award ─────────────────────────────────────────────────────────────────

function applyXpAward(raw) {
    const fields   = parseFields(raw);
    const amount   = parseFloat(fields.amount || '0');
    const modifier = parseFloat(fields.modifier || '1');
    if (isNaN(amount)) return false;

    const state    = getCharState();
    const awarded  = Math.round(amount * modifier);

    // XP lives in values (handled by schema), but we also track total separately
    if (!state.xp_total) state.xp_total = 0;
    state.xp_total += awarded;

    // If the schema has an xp field, update it
    const xpKey = Object.keys(state.values || {}).find(k => /^xp$/i.test(k));
    if (xpKey !== undefined) {
        state.values[xpKey] = (state.values[xpKey] || 0) + awarded;
    }
    console.log(`[${MODULE_NAME}] XP award: +${awarded}${modifier !== 1 ? ` (×${modifier})` : ''} — total: ${state.xp_total}`);
    return true;
}

// ── Companion update ──────────────────────────────────────────────────────────

async function applyCompanionUpdate(raw, settings) {
    const fields = parseFlatFields(raw);   // top-level only (a companion may carry a schema)
    if (!fields.name) { console.warn(`[${MODULE_NAME}] ENTITY(companion) missing name`); return false; }

    const slug  = slugify(fields.name);
    const state = getCharState();

    if (!state.companions[slug]) {
        state.companions[slug] = { name: fields.name, type: '', control_cost: 0, loyalty: (getSystemDef().loyalty?.initial ?? 50), status: 'Active', notes: '', history: [] };
    }
    const comp = state.companions[slug];

    if (fields.type)         comp.type         = fields.type;
    if (fields.control_cost) comp.control_cost  = parseInt(fields.control_cost) || comp.control_cost;
    if (fields.loyalty)      comp.loyalty       = parseInt(fields.loyalty)      || comp.loyalty;
    if (fields.status)       comp.status        = fields.status;
    if (fields.notes)        comp.notes         = fields.notes;
    if (fields.role)         comp.role          = fields.role;

    // Ensure v4 AP fields exist
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
            // Fallback: "might:5,agility:3" style
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
        .filter(c => c.status === 'Active')
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

/** Max of the active loyalty scale (for display). */
function loyaltyScaleMax() { return getSystemDef().loyalty?.scale_max ?? 100; }
/** Normalize a loyalty value to a 0-100 percentage for bar widths. */
function loyaltyPct(v) {
    const loy  = getSystemDef().loyalty || { scale_min: 0, scale_max: 100 };
    const span = ((loy.scale_max ?? 100) - (loy.scale_min ?? 0)) || 1;
    return Math.max(0, Math.min(100, ((v - (loy.scale_min ?? 0)) / span) * 100));
}

function buildCompanionContent(comp) {
    const lines = [`[Companion] ${comp.name}`];
    if (comp.type)         lines.push(`Type: ${comp.type}`);
    lines.push(`Status: ${comp.status}`);
    lines.push(`Loyalty: ${comp.loyalty}/${loyaltyScaleMax()}`);
    if (comp.control_cost) lines.push(`Control Cost: ${comp.control_cost}`);
    if (comp.rank)         lines.push(`Rank: ${comp.rank}`);
    if (comp.role && comp.role !== 'standard') lines.push(`Role: ${comp.role}`);
    if (comp.attributes && Object.keys(comp.attributes).length)
        lines.push(`Attributes: ${Object.entries(comp.attributes).map(([k, v]) => `${k}:${v}`).join(', ')}`);
    // Shared stat block (companions may carry the same schema engine as any entity)
    if (comp.schema && Object.keys(comp.schema.fields || {}).length)
        lines.push(buildValueSummary('Stats', comp.schema, comp.values || {}).split('\n').slice(1).join('\n'));
    if (comp.notes)        lines.push(`Notes: ${comp.notes}`);
    return lines.join('\n');
}

// Evolution is now an ability category (modules/abilities.js): an
// [ABILITY category:evolution stat_changes:…] applies its stat changes to the
// owner via the player event path and records new traits as trait abilities.

// ── Context string ────────────────────────────────────────────────────────────

function buildCurrencyContextString(currency, adventurer_rank) {
    const parts = [];

    if (Object.keys(currency).length) {
        const coins = Object.entries(currency)
            .filter(([, v]) => v > 0)
            .map(([d, v]) => `${v} ${d}`)
            .join(', ');
        if (coins) parts.push(`[Currency] ${coins}`);
    }

    if (adventurer_rank?.rank) {
        parts.push(`[Guild Rank] ${adventurer_rank.rank}`);
    }

    return parts.join('\n');
}

function buildCompanionContextString(companions) {
    const active = Object.values(companions).filter(c => c.status === 'Active');
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

function buildCurrencyPanel(currency, adventurer_rank, companions) {
    const sections = [];

    // Currency
    const denomEntries = Object.entries(currency);
    if (denomEntries.length) {
        const rows = denomEntries.map(([d, v]) =>
            `<div class="glp-currency-row"><span class="glp-currency-denom">${d}</span><span class="glp-currency-val">${v}</span></div>`
        ).join('');
        sections.push(`<div class="glp-section"><div class="glp-section-title">Currency</div>${rows}</div>`);
    }

    // Guild rank
    if (adventurer_rank?.rank) {
        const ladder = adventurer_rank.rank_ladder || getRankLadder();
        const idx    = ladder.indexOf(adventurer_rank.rank);
        const pct    = idx >= 0 ? Math.round((idx / (ladder.length - 1)) * 100) : 0;
        sections.push(`<div class="glp-section"><div class="glp-section-title">Guild Rank</div>
            <div class="glp-rank-row">
                <span class="glp-rank-label">${adventurer_rank.rank}</span>
                <div class="glp-rank-bar-wrap"><div class="glp-rank-bar" style="width:${pct}%"></div></div>
            </div></div>`);
    }

    // Companions
    const activeComps = Object.values(companions).filter(c => c.status === 'Active');
    if (activeComps.length) {
        const rows = activeComps.map(c => {
            const rankBadge = c.rank ? `<span class="glp-rank-badge">${c.rank}</span>` : '';
            return `<div class="glp-companion-row">
                <span class="glp-companion-name">${c.name}</span>${rankBadge}
                <div class="glp-loyalty-bar-wrap"><div class="glp-loyalty-bar" style="width:${loyaltyPct(c.loyalty)}%"></div></div>
                <span class="glp-loyalty-val">${c.loyalty}</span>
            </div>`;
        }).join('');
        sections.push(`<div class="glp-section"><div class="glp-section-title">Companions</div>${rows}</div>`);
    }

    return sections.length ? sections.join('') : '<div class="glp-panel-empty">No currency, rank, or companions recorded.</div>';
}

// ── Commands ──────────────────────────────────────────────────────────────────

function cmdCurrency(state) {
    const c = state.currency || {};
    if (!Object.keys(c).length) return '[Currency]\nNo currency recorded.';
    return '[Currency]\n' + Object.entries(c).map(([d, v]) => `  ${d}: ${v}`).join('\n');
}

function cmdRank(state) {
    const ar = state.adventurer_rank;
    if (!ar?.rank) return '[Rank]\nNo rank recorded.';
    const lines = [`[Rank] ${ar.rank}`];
    if (ar.quest_count) lines.push(`  Quest count: ${ar.quest_count}`);
    if (ar.history?.length) lines.push(`  Last change: ${ar.history[ar.history.length - 1].reason || 'Unknown'}`);
    return lines.join('\n');
}

function cmdCompanions(state, filterName) {
    const comps = Object.values(state.companions || {});
    if (!comps.length) return '[Companions]\nNo companions recorded.';
    const target = filterName ? filterName.toLowerCase() : null;
    const filtered = target ? comps.filter(c => c.name.toLowerCase().includes(target)) : comps;
    if (!filtered.length) return `[Companions]\nNo companion matching "${filterName}" found.`;
    const lines = ['[Companions]'];
    for (const c of filtered) {
        const rankStr = c.rank ? ` [${c.rank}]` : '';
        lines.push(`  ${c.name}${rankStr} (${c.status}) — Loyalty: ${c.loyalty}/${loyaltyScaleMax()}`);
        if (c.role && c.role !== 'standard') lines.push(`    Role: ${c.role}`);
        if (c.ap_unspent || c.ap_total) lines.push(`    AP: ${c.ap_unspent} unspent / ${c.ap_total} total`);
        if (c.attributes && Object.keys(c.attributes).length)
            lines.push(`    Attributes: ${Object.entries(c.attributes).map(([k, v]) => `${k}:${v}`).join(', ')}`);
        if (c.notes) lines.push(`    ${c.notes}`);
    }
    return lines.join('\n');
}

function cmdLegion(state) {
    const comps = state.companions || {};
    const limit = state.values?.control_limit || state.values?.control_limit_max;
    const active = Object.values(comps).filter(c => c.status === 'Active');
    const usedSlots = active.reduce((sum, c) => sum + (parseInt(c.control_cost) || 0), 0);

    const lines = ['[Legion / Hierarchy]'];
    if (limit !== undefined) lines.push(`Control Limit: ${usedSlots}/${limit}`);

    // Separate lieutenants from standard minions
    const lieutenants = active.filter(c => c.role === 'lieutenant');
    const standards   = active.filter(c => c.role !== 'lieutenant');

    // Direct command (no lieutenant)
    const directMinions = standards.filter(c => !c.assigned_to);
    if (directMinions.length) {
        lines.push('\nDirect Command:');
        for (const c of directMinions) {
            const rankStr = c.rank ? ` [${c.rank}]` : '';
            lines.push(`  ○ ${c.name}${rankStr} — cost:${c.control_cost || 0} loyalty:${c.loyalty}`);
        }
    }

    // Lieutenant subtrees
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
