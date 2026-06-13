/**
 * gm-lore-parser / modules/progression.js
 * Entity / character advancement: adventurer & creature rank ladders and XP
 * awards. Rank ladders come from the active System Definition (getRankLadder()).
 *
 *   [RANK_CHANGE_BEGIN] … [RANK_CHANGE_END]   type: adventurer|creature, name, rank, reason, rank_ladder?
 *   [XP_AWARD_BEGIN] … [XP_AWARD_END]         amount, reason, modifier?
 */

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
        // Creature rank is an attribute on a companion entity record.
        const targetName = fields.name || 'creature';
        const slug       = slugify(targetName);
        if (!state.companions[slug]) {
            state.companions[slug] = { name: targetName, type: 'Creature', rank: getRankLadder()[0], control_cost: 0, loyalty: (getSystemDef().loyalty?.initial ?? 50), status: (getSystemDef().companions?.default_status || 'Active'), notes: '', history: [] };
        }
        const comp       = state.companions[slug];
        const prevRank   = comp.rank || getRankLadder()[0];
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

    if (!state.xp_total) state.xp_total = 0;
    state.xp_total += awarded;

    // Mirror onto the player's XP field as named by the System Definition
    // (def.progression.xp_field; default 'xp'), only if that field exists.
    const xpField = getSystemDef().progression?.xp_field || 'xp';
    if (state.values && state.values[xpField] !== undefined) {
        state.values[xpField] = (state.values[xpField] || 0) + awarded;
    }
    console.log(`[${MODULE_NAME}] XP award: +${awarded}${modifier !== 1 ? ` (×${modifier})` : ''} — total: ${state.xp_total}`);
    return true;
}

// ── Context string ────────────────────────────────────────────────────────────

function buildRankContextString(adventurer_rank) {
    return adventurer_rank?.rank ? `[Rank] ${adventurer_rank.rank}` : '';
}

// ── Panel HTML ────────────────────────────────────────────────────────────────

function buildRankPanel(adventurer_rank) {
    if (!adventurer_rank?.rank) return '';
    const ladder = adventurer_rank.rank_ladder || getRankLadder();
    const idx    = ladder.indexOf(adventurer_rank.rank);
    const pct    = idx >= 0 ? Math.round((idx / (ladder.length - 1)) * 100) : 0;
    return `<div class="glp-section"><div class="glp-section-title">Rank</div>
        <div class="glp-rank-row">
            <span class="glp-rank-label">${adventurer_rank.rank}</span>
            <div class="glp-rank-bar-wrap"><div class="glp-rank-bar" style="width:${pct}%"></div></div>
        </div></div>`;
}

// ── Command ───────────────────────────────────────────────────────────────────

function cmdRank(state) {
    const ar = state.adventurer_rank;
    if (!ar?.rank) return '[Rank]\nNo rank recorded.';
    const lines = [`[Rank] ${ar.rank}`];
    if (ar.quest_count) lines.push(`  Quest count: ${ar.quest_count}`);
    if (ar.history?.length) lines.push(`  Last change: ${ar.history[ar.history.length - 1].reason || 'Unknown'}`);
    return lines.join('\n');
}
