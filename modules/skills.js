/**
 * gm-lore-parser / modules/skills.js
 * Skill system — PP mode (multi-tier) and use_tracked mode.
 * Handles SKILL_SYSTEM config and SKILL_UPDATE blocks.
 */

// ── Config ────────────────────────────────────────────────────────────────────

/** Parse and apply a SKILL_SYSTEM config block to the character state. */
function applySkillSystemConfig(raw) {
    const fields = parseFields(raw);
    const state  = getCharState();
    const ss     = state.skill_system;
    if (fields.mode)            ss.mode                 = fields.mode;
    if (fields.levels_per_tier) ss.levels_per_tier      = parseInt(fields.levels_per_tier) || 10;
    if (fields.score_formula)   ss.score_formula        = fields.score_formula;
    if (fields.tiers)           ss.tier_names           = fields.tiers.split(',').map(s => s.trim()).filter(Boolean);
    if (fields.pp_per_level)    ss.pp_per_level_formula = fields.pp_per_level;
    console.log(`[${MODULE_NAME}] Skill system configured: mode=${ss.mode}`);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getTierNames(ss) {
    return ss.tier_names || getSystemDef().skills?.tier_names || DEFAULT_TIER_NAMES;
}

/** PP cost for one level within a given tier index (0-based). */
function ppPerLevel(ss, tierIdx) {
    if (ss.mode !== 'pp') return ss.uses_threshold || 5;
    const tierRank = tierIdx + 1;
    const formula  = ss.pp_per_level_formula || getSystemDef().skills?.pp_per_level_formula;
    return Math.max(1, Math.round(evalFormula(formula, { tier_rank: tierRank }, 100 * tierRank)));
}

/** Get or lazily-create a skill entry. */
function getOrInitSkill(ss, skillKey, skillName, governing) {
    if (!ss.skills[skillKey]) {
        ss.skills[skillKey] = {
            name:         skillName || skillKey,
            governing:    governing || '',
            tier_idx:     0,
            level:        0,
            pp:           0,
            pp_needed:    ppPerLevel(ss, 0),
            // Novice Lv0 counts as 1 for level-cap formula
            total_levels: ss.mode === 'pp' ? 1 : 0,
        };
    }
    return ss.skills[skillKey];
}

/** Sum of all skill level contributions across the skill system. */
function recalcTotalLevels(ss) {
    let total = 0;
    for (const sk of Object.values(ss.skills)) {
        total += ss.mode === 'pp'
            ? sk.tier_idx * ss.levels_per_tier + sk.level + 1
            : (sk.level || 0);
    }
    return total;
}

/** Compute the check score for a single skill. */
function calcSkillScore(ss, skill) {
    const totalLevels = recalcTotalLevels(ss);
    const skillLevel  = skill.tier_idx * ss.levels_per_tier + skill.level;
    const formula     = ss.score_formula || getSystemDef().skills?.score_formula;
    return Math.round(evalFormula(formula, { total_levels: totalLevels, skill_level: skillLevel }, 10));
}

// ── SKILL_UPDATE handler ──────────────────────────────────────────────────────

/**
 * Apply a SKILL_UPDATE block.
 * Supports multiple skill/pp pairs in one block.
 * Returns an array of notification objects.
 *
 * Block format:
 *   skill: Swordsmanship
 *   pp: 25
 *   governing: AGI, MGT
 *   branch: Parry, Dual Wielding
 *   skill: Awareness      ← start another skill
 *   pp: 10
 */
function applySkillUpdate(raw) {
    const state         = getCharState();
    const ss            = state.skill_system;
    const notifications = [];

    // Split into per-skill chunks
    const skillUpdates = [];
    let current = null;
    for (const line of raw.split('\n')) {
        const colon = line.indexOf(':'); if (colon === -1) continue;
        const key   = line.slice(0, colon).trim().toLowerCase();
        const val   = line.slice(colon + 1).trim();
        if (key === 'skill') {
            if (current) skillUpdates.push(current);
            current = { name: val, pp: 0, governing: '', branches: [] };
        } else if (current) {
            if (key === 'pp')       current.pp        = parseInt(val) || 0;
            if (key === 'governing') current.governing = val;
            if (key === 'branch')   current.branches  = val.split(',').map(s => s.trim()).filter(Boolean);
        }
    }
    if (current) skillUpdates.push(current);

    for (const upd of skillUpdates) {
        const skillKey = slugify(upd.name);
        const skill    = getOrInitSkill(ss, skillKey, upd.name, upd.governing);
        if (upd.governing && !skill.governing) skill.governing = upd.governing;

        // Register any newly unlocked branch skills
        for (const branch of upd.branches) {
            if (!ss.branch_unlocks.find(b => b.skill === skillKey && b.branch === branch)) {
                ss.branch_unlocks.push({
                    skill: skillKey, branch,
                    tier_idx: skill.tier_idx, level: skill.level,
                    unlocked_at: new Date().toISOString(),
                });
                notifications.push({ type: 'branch', msg: `${skill.name}: [${branch}] unlocked!` });
            }
        }

        if (ss.mode !== 'pp' || upd.pp <= 0) continue;

        skill.pp += upd.pp;
        let advanced = false;

        while (skill.pp >= skill.pp_needed) {
            skill.pp    -= skill.pp_needed;
            skill.level += 1;
            skill.total_levels = skill.tier_idx * ss.levels_per_tier + skill.level + 1;
            advanced = true;

            if (skill.level >= ss.levels_per_tier) {
                const tierNames   = getTierNames(ss);
                const nextTierIdx = skill.tier_idx + 1;
                if (nextTierIdx < tierNames.length) {
                    const oldTier = tierNames[skill.tier_idx];
                    const newTier = tierNames[nextTierIdx];
                    skill.tier_idx  = nextTierIdx;
                    skill.level     = 0;
                    skill.pp_needed = ppPerLevel(ss, nextTierIdx);
                    notifications.push({ type: 'tier', msg: `${skill.name}: Advanced to ${newTier}!` });
                    console.log(`[${MODULE_NAME}] Skill tier: ${skill.name} ${oldTier}→${newTier}`);
                } else {
                    skill.level = ss.levels_per_tier;
                    skill.pp    = 0;
                    notifications.push({ type: 'tier', msg: `${skill.name}: Maximum mastery achieved!` });
                }
            } else {
                const tierNames = getTierNames(ss);
                notifications.push({ type: 'level', msg: `${skill.name}: ${tierNames[skill.tier_idx]} Lv${skill.level}` });
            }
        }

        if (advanced) skill.pp_needed = ppPerLevel(ss, skill.tier_idx);
    }

    return notifications;
}

// ── Context string ────────────────────────────────────────────────────────────

function buildSkillContextString(ss) {
    if (!ss || !Object.keys(ss.skills).length) return '';
    const tierNames = getTierNames(ss);
    const lines = ['[Skills]'];
    for (const [, skill] of Object.entries(ss.skills)) {
        const tier = tierNames[skill.tier_idx] || `Tier ${skill.tier_idx + 1}`;
        if (ss.mode === 'pp') {
            const score = calcSkillScore(ss, skill);
            lines.push(`${skill.name}: ${tier} Lv${skill.level} | PP ${skill.pp}/${skill.pp_needed} | Score ${score}`);
        } else {
            lines.push(`${skill.name}: Lv${skill.level} (${skill.pp || 0}/${skill.pp_needed || 0} uses)`);
        }
    }
    return lines.join('\n');
}
