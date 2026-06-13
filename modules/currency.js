/**
 * gm-lore-parser / modules/currency.js
 * Handles: Currency, Adventurer/Creature rank tracking, Companion management,
 *          XP awards, and Evolution events.
 *
 * Block protocol:
 *
 *   [CURRENCY_UPDATE_BEGIN] … [CURRENCY_UPDATE_END]
 *     gold: +10
 *     silver: -5
 *     copper: +300
 *     (any denomination name is supported; value is a delta or abs)
 *
 *   [RANK_CHANGE_BEGIN] … [RANK_CHANGE_END]
 *     type:    adventurer | creature   (default: adventurer)
 *     name:    <character/creature name, defaults to PC>
 *     rank:    B
 *     reason:  Completed third B-rank quest
 *     rank_ladder: F,E,D,C,B,A,S,SS,SSS  (optional override, comma-separated)
 *
 *   [XP_AWARD_BEGIN] … [XP_AWARD_END]
 *     amount:  250
 *     reason:  Defeated the Forest Golem
 *     modifier: 1.5   (multiplier, optional)
 *
 *   [COMPANION_UPDATE_BEGIN] … [COMPANION_UPDATE_END]
 *     name:          Ember the Fox
 *     type:          Familiar
 *     control_cost:  1
 *     loyalty:       85
 *     status:        Active | Dismissed | Lost
 *     notes:         Burned three bandits
 *
 *   [EVOLUTION_BEGIN] … [EVOLUTION_END]
 *     name:         The Ember Awakening
 *     trigger:      Reached 1000 total Vigor damage dealt
 *     description:  Ember's fur ignites permanently…
 *     new_traits:   Fire Aura, Heat Resistance
 *     stat_changes: MGT +5, RES +3
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
        const ladder      = ar.rank_ladder || RANK_LADDER;
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
            state.companions[slug] = { name: targetName, type: 'Creature', rank: 'F', control_cost: 0, loyalty: 50, status: 'Active', notes: '', history: [] };
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
    const fields = parseFields(raw);
    if (!fields.name) { console.warn(`[${MODULE_NAME}] COMPANION_UPDATE missing name`); return false; }

    const slug  = slugify(fields.name);
    const state = getCharState();

    if (!state.companions[slug]) {
        state.companions[slug] = { name: fields.name, type: '', control_cost: 0, loyalty: 50, status: 'Active', notes: '', history: [] };
    }
    const comp = state.companions[slug];

    if (fields.type)         comp.type         = fields.type;
    if (fields.control_cost) comp.control_cost  = parseInt(fields.control_cost) || comp.control_cost;
    if (fields.loyalty)      comp.loyalty       = parseInt(fields.loyalty)      || comp.loyalty;
    if (fields.status)       comp.status        = fields.status;
    if (fields.notes)        comp.notes         = fields.notes;

    comp.loyalty = Math.max(0, Math.min(100, comp.loyalty));

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

function buildCompanionContent(comp) {
    const lines = [`[Companion] ${comp.name}`];
    if (comp.type)         lines.push(`Type: ${comp.type}`);
    lines.push(`Status: ${comp.status}`);
    lines.push(`Loyalty: ${comp.loyalty}/100`);
    if (comp.control_cost) lines.push(`Control Cost: ${comp.control_cost}`);
    if (comp.rank)         lines.push(`Rank: ${comp.rank}`);
    if (comp.notes)        lines.push(`Notes: ${comp.notes}`);
    return lines.join('\n');
}

// ── Evolution ─────────────────────────────────────────────────────────────────

async function applyEvolution(raw, settings) {
    const fields = parseFields(raw);
    if (!fields.name) { console.warn(`[${MODULE_NAME}] EVOLUTION missing name`); return false; }

    const state = getCharState();
    if (!state.evolutions) state.evolutions = [];

    const evo = {
        name:        fields.name,
        trigger:     fields.trigger     || '',
        description: fields.description || '',
        new_traits:  fields.new_traits  ? fields.new_traits.split(',').map(t => t.trim()) : [],
        stat_changes: fields.stat_changes || '',
    };
    state.evolutions.push(evo);

    // Evolutions can also update lorebook — log as a character history entry
    if (settings.campaignLorebook) {
        const keywords = [fields.name.toLowerCase(), 'evolution', 'transformation'];
        const content  = [
            `[Evolution] ${evo.name}`,
            evo.trigger     ? `Trigger: ${evo.trigger}`          : '',
            evo.description ? `Description: ${evo.description}`  : '',
            evo.new_traits.length ? `New traits: ${evo.new_traits.join(', ')}` : '',
            evo.stat_changes ? `Stat changes: ${evo.stat_changes}` : '',
        ].filter(Boolean).join('\n');
        await upsertEntry(settings.campaignLorebook, {
            ...entryBase(`[Evolution] ${evo.name}`, keywords, content, settings.loreOrder, settings, { type: 'EVOLUTION' }),
        });
    }
    console.log(`[${MODULE_NAME}] Evolution: "${evo.name}"`);
    return true;
}

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
    for (const c of active) {
        const rankStr = c.rank ? ` [${c.rank}]` : '';
        lines.push(`  ${c.name}${rankStr} — Loyalty: ${c.loyalty}/100`);
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
        const ladder = adventurer_rank.rank_ladder || RANK_LADDER;
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
                <div class="glp-loyalty-bar-wrap"><div class="glp-loyalty-bar" style="width:${c.loyalty}%"></div></div>
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

function cmdCompanions(state) {
    const comps = Object.values(state.companions || {});
    if (!comps.length) return '[Companions]\nNo companions recorded.';
    const lines = ['[Companions]'];
    for (const c of comps) {
        const rankStr = c.rank ? ` [${c.rank}]` : '';
        lines.push(`  ${c.name}${rankStr} (${c.status}) — Loyalty: ${c.loyalty}/100`);
        if (c.notes) lines.push(`    ${c.notes}`);
    }
    return lines.join('\n');
}
