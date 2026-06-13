/**
 * gm-lore-parser / modules/commands.js
 * # command interceptor — answers queries from local chatMetadata
 * without calling the language model.
 *
 * To add a new command: add an entry to KNOWN_COMMANDS mapping
 * the command string to a handler function(state) → string.
 */

var KNOWN_COMMANDS = {
    '#status':    cmdStatus,
    '#character': cmdStatus,
    '#vitals':    cmdVitals,
    '#skills':    cmdSkills,
    '#inventory': cmdInventory,
    '#bag':       cmdInventory,
    '#domain':    cmdDomain,
    '#time':      cmdTime,
    '#help':      cmdHelp,
};

// ── Command handlers ──────────────────────────────────────────────────────────

function cmdStatus(state) {
    const v  = state.values;
    const sf = state.schema?.fields || {};
    const lines = [`[Character: ${state.name}]`];
    if (state.class_)     lines.push(`Class: ${state.class_}`);
    if (state.background) lines.push(`Background: ${state.background}`);

    const grouped = {};
    for (const [key, desc] of Object.entries(sf)) {
        if (isMaxFieldOf(key, sf) || isUsesCounterOf(key, sf)) continue;
        const g = desc.group || 'other';
        if (!grouped[g]) grouped[g] = [];
        grouped[g].push([key, desc]);
    }
    const allGroups = [
        ...(state.schema?.groups || []),
        ...Object.keys(grouped).filter(g => !(state.schema?.groups || []).includes(g)),
    ];
    for (const g of allGroups) {
        if (!grouped[g]?.length) continue;
        lines.push(`\n${g.toUpperCase()}`);
        for (const [key, desc] of grouped[g]) {
            const val = v[key]; if (val === undefined || val === null || val === '') continue;
            const label    = desc.label || key;
            const rpm      = regenPerMinute(desc);
            const regenStr = rpm && desc.regen ? ` (${formatRegenDisplay(rpm)})` : '';
            if (Array.isArray(val))
                lines.push(`  ${label}: ${val.join(', ')}`);
            else if (desc.max_field && v[desc.max_field] !== undefined)
                lines.push(`  ${label}: ${val}/${v[desc.max_field]}${regenStr}`);
            else
                lines.push(`  ${label}: ${val}${regenStr}`);
        }
    }
    return lines.join('\n');
}

function cmdVitals(state) {
    const v    = state.values;
    const sf   = state.schema?.fields || {};
    const vitals = ['hp', 'mp', 'vigor', 'stamina', 'mana', 'vitality'];
    const lines = ['[Vitals]'];
    for (const [key, desc] of Object.entries(sf)) {
        if (!vitals.includes(key) && desc.group !== 'vitals') continue;
        if (isMaxFieldOf(key, sf)) continue;
        const val = v[key]; if (val === undefined) continue;
        const rpm      = regenPerMinute(desc);
        const regenStr = rpm ? ` ${formatRegenDisplay(rpm)}` : '';
        const maxStr   = desc.max_field && v[desc.max_field] !== undefined ? `/${v[desc.max_field]}` : '';
        lines.push(`  ${desc.label || key}: ${val}${maxStr}${regenStr}`);
    }
    if (state.world_time?.display) lines.push(`  Time: ${state.world_time.display}`);
    return lines.join('\n');
}

function cmdSkills(state) {
    const ss = state.skill_system;
    if (!ss || !Object.keys(ss.skills).length) return '[Skills]\nNo skills recorded yet.';
    const tierNames = getTierNames(ss);
    const lines = ['[Skills]'];
    for (const [, skill] of Object.entries(ss.skills)) {
        const tier = tierNames[skill.tier_idx] || `Tier ${skill.tier_idx + 1}`;
        if (ss.mode === 'pp') {
            const score = calcSkillScore(ss, skill);
            lines.push(`  ${skill.name}: ${tier} Lv${skill.level} | PP ${skill.pp}/${skill.pp_needed} | Score ${score}`);
        } else {
            lines.push(`  ${skill.name}: Lv${skill.level} (${skill.pp || 0}/${skill.pp_needed || 0})`);
        }
    }
    if (ss.branch_unlocks.length) {
        lines.push('\n[Branch Skills Unlocked]');
        for (const b of ss.branch_unlocks) lines.push(`  [${b.branch}] (${b.skill})`);
    }
    return lines.join('\n');
}

function cmdInventory(state) {
    const inv = state.values?.inventory;
    if (!inv || !inv.length) return '[Inventory]\nEmpty.';
    return '[Inventory]\n' + inv.map((item, i) => `  ${i + 1}. ${item}`).join('\n');
}

function cmdDomain(state) {
    if (!Object.keys(state.domains || {}).length) return '[Domain]\nNo domain established.';
    return buildDomainContextString(state.domains);
}

function cmdTime(state) {
    return state.world_time?.display ? `[Time] ${state.world_time.display}` : '[Time] Unknown';
}

function cmdHelp() {
    return [
        '[Commands]',
        '#status / #character — Full character sheet',
        '#vitals              — HP/MP/resources with regen rates',
        '#skills              — Skill list with tiers and PP',
        '#inventory / #bag   — Inventory list',
        '#domain             — Domain statistics',
        '#time               — Current in-world time',
        '#help               — This list',
    ].join('\n');
}

// ── Interceptor ───────────────────────────────────────────────────────────────

/** Returns an answer string if the message is a known command, else null. */
function tryHandleCommand(messageText) {
    if (!messageText?.trim().startsWith('#')) return null;
    const cmd     = messageText.trim().split(/\s/)[0].toLowerCase();
    const handler = KNOWN_COMMANDS[cmd];
    if (!handler) return null;
    return handler(getCharState());
}

/** Render a command response as a temporary block in the chat DOM. */
function injectCommandResponse(response, messageId) {
    const $placeholder = $(`<div class="mes glp-cmd-response">
        <div class="mes_block">
            <div class="mes_text"><pre class="glp-cmd-pre">${response.replace(/</g, '&lt;')}</pre></div>
        </div>
    </div>`);
    $(`#chat .mes[mesid="${messageId}"]`).after($placeholder);
    setTimeout(() => $placeholder.fadeOut(400, () => $placeholder.remove()), 60000);
}
