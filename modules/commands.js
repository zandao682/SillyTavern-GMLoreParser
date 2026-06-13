/**
 * gm-lore-parser / modules/commands.js
 * # command interceptor — answers queries from local chatMetadata without
 * calling the language model.
 *
 * Commands are a VIEW_REGISTRY of stable view-ids (each mapped to a handler, an
 * optional gating feature, default triggers, and a help label). The ACTIVE command
 * set is derived from the registry, with views whose feature is disabled dropped.
 *
 * A system can reshape the set via the System Definition `commands:` section:
 *   - rename / alias a built-in view (triggers + view)
 *   - add a custom command that renders a {token} template against character state
 * When `def.commands` is present it fully defines the set (plus always-on
 * status/vitals/system/help). See renderStateTemplate for the template tokens.
 */

// ── View registry ──────────────────────────────────────────────────────────────
// handler(state, arg) → string. feature: gating feature (null = always available).

var VIEW_REGISTRY = {
    status:     { handler: cmdStatus,     feature: null,          triggers: ['#status', '#character'], label: 'Full character sheet' },
    vitals:     { handler: cmdVitals,     feature: null,          triggers: ['#vitals'],               label: 'HP/MP/resources with regen' },
    skills:     { handler: cmdSkills,     feature: 'skills',      triggers: ['#skills'],               label: 'Skill list with tiers and PP' },
    inventory:  { handler: cmdInventory,  feature: null,          triggers: ['#inventory', '#bag'],    label: 'Inventory list' },
    equipment:  { handler: (s) => cmdEquipment(s),  feature: 'equipment', triggers: ['#equipment'],    label: 'Equipped items by slot' },
    itembox:    { handler: (s) => cmdItemBox(s),    feature: null, triggers: ['#itembox'],             label: 'Item box contents' },
    domain:     { handler: cmdDomain,     feature: 'domains',     triggers: ['#domain'],               label: 'Domain statistics' },
    time:       { handler: cmdTime,       feature: null,          triggers: ['#time'],                 label: 'Current in-world time' },
    quests:     { handler: (s) => cmdQuests(s),     feature: 'quests',     triggers: ['#quests'],       label: 'Quest tracker' },
    rep:        { handler: (s) => cmdReputation(s), feature: 'reputation', triggers: ['#rep', '#reputation'], label: 'Faction reputation standings' },
    factions:   { handler: (s) => cmdFactions(s),   feature: 'reputation', triggers: ['#factions'],     label: 'Full faction roster with lore' },
    events:     { handler: (s) => cmdEvents(s),     feature: 'world_events', triggers: ['#events'],     label: 'World events log' },
    locations:  { handler: (s) => cmdLocations(s),  feature: null,         triggers: ['#locations'],    label: 'Location types & info' },
    currency:   { handler: (s) => cmdCurrency(s),   feature: 'currency',   triggers: ['#currency', '#gold'], label: 'Wallet and denominations' },
    rank:       { handler: (s) => cmdRank(s),       feature: 'ranks',      triggers: ['#rank'],         label: 'Guild / adventurer rank' },
    companions: { handler: (s, a) => cmdCompanions(s, a), feature: 'companions', triggers: ['#companions'], arg: true, label: 'Companion roster (optional name filter)' },
    legion:     { handler: (s) => cmdLegion(s),     feature: 'companions', triggers: ['#legion', '#hierarchy'], label: 'Command delegation tree' },
    boons:      { handler: (s) => cmdBoons(s),      feature: 'abilities',  triggers: ['#boons'],        label: 'Awarded boons' },
    titles:     { handler: (s) => cmdTitles(s),     feature: 'abilities',  triggers: ['#titles'],       label: 'Earned titles (★ = active)' },
    abilities:  { handler: (s) => cmdAbilities(s),  feature: 'abilities',  triggers: ['#abilities'],    label: 'All abilities by category' },
    needs:      { handler: (s) => cmdNeeds(s),      feature: 'needs',      triggers: ['#needs'],        label: 'Life-simulation needs meters' },
    inspect:    { handler: (s, a) => cmdInspect(s, a), feature: null,      triggers: ['#inspect'], arg: true, label: 'Inspect a target by awareness tier' },
    system:     { handler: (s) => cmdSystem(s),     feature: null,         triggers: ['#system', '#ruleset'], label: 'System definition & resolution' },
    help:       { handler: () => cmdHelp(),         feature: null,         triggers: ['#help'],         label: 'This list' },
};

// Always available regardless of def.commands or feature gating.
var ALWAYS_VIEWS = ['status', 'vitals', 'system', 'help'];

/** Build the active { trigger → {handler, arg} } map plus a help list, per the
 *  active System Definition. Recomputed each call (cheap; getSystemDef is cached). */
function buildActiveCommands() {
    const def  = getSystemDef();
    const map  = {};
    const help = [];

    const addView = (viewId, triggers, label) => {
        const v = VIEW_REGISTRY[viewId];
        if (!v) return;
        if (v.feature && !featureOn(v.feature) && !ALWAYS_VIEWS.includes(viewId)) return;
        const trigs = (triggers && triggers.length ? triggers : v.triggers).map(t => t.toLowerCase());
        for (const t of trigs) map[t] = { handler: v.handler, arg: v.arg };
        help.push(`${trigs.join(' / ')}${v.arg ? ' [arg]' : ''} — ${label || v.label}`);
    };

    if (Array.isArray(def.commands) && def.commands.length) {
        // System-defined set: each entry aliases a view or defines a template command.
        for (const c of def.commands) {
            if (c.view && VIEW_REGISTRY[c.view]) addView(c.view, c.triggers, c.label);
            else if (c.template) {
                for (const t of c.triggers.map(x => x.toLowerCase()))
                    map[t] = { handler: (s) => renderStateTemplate(c.template, s), arg: false };
                help.push(`${c.triggers.join(' / ')} — ${c.label || 'custom'}`);
            }
        }
        // Ensure always-on views exist even if the system omitted them.
        for (const v of ALWAYS_VIEWS) if (!def.commands.some(c => c.view === v)) addView(v);
    } else {
        // Default: every registry view under its default triggers, feature-gated.
        for (const viewId of Object.keys(VIEW_REGISTRY)) addView(viewId);
    }
    return { map, help };
}

// ── Character-sheet views ──────────────────────────────────────────────────────

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

function cmdSystem(state) {
    const def = getSystemDef();
    const lines = [`[System: ${def.name}]`];
    lines.push(`Features: ${ALL_FEATURES.filter(f => featureOn(f)).join(', ') || 'none'}`);
    const r = def.resolution;
    if (r?.mechanic) {
        lines.push(`\n[Resolution]`, `  Mechanic: ${r.mechanic}`);
        if (r.difficulty) lines.push(`  Difficulty: ${r.difficulty}`);
        if (r.crit)       lines.push(`  Crits: ${r.crit}`);
    }
    return lines.join('\n');
}

function cmdHelp() {
    return ['[Commands]', ...buildActiveCommands().help].join('\n');
}

// ── Custom-command template renderer ────────────────────────────────────────────
// Resolves {tokens} against character state for system-defined commands.

function renderStateTemplate(format, state) {
    const v  = state.values || {};
    const sf = state.schema?.fields || {};
    const resolve = (token) => {
        const t = token.trim();
        if (t === 'name')       return state.name || '—';
        if (t === 'class')      return state.class_ || '—';
        if (t === 'background') return state.background || '—';
        if (t === 'rank')       return state.adventurer_rank?.rank || '—';
        if (t === 'time' || t === 'date') return state.world_time?.display || '—';
        if (t === 'conditions') return Array.isArray(v.conditions) && v.conditions.length ? v.conditions.join(', ') : presentationCfg().empty_label;
        if (t === 'currency')   { const c = state.currency || {}; const p = Object.entries(c).filter(([, n]) => n > 0).map(([d, n]) => `${n} ${d}`); return p.length ? p.join(', ') : '—'; }
        if (t === 'active_title') { const a = (state.abilities || []).find(x => x.category === (getSystemDef().abilities?.exclusive_category || 'title') && x.active); return a ? a.name : '—'; }
        if (t.startsWith('skill_score:')) {
            const ss = state.skill_system; if (!ss) return '?';
            const sk = ss.skills?.[t.slice(12).trim().toLowerCase().replace(/\s+/g, '-')];
            return sk ? calcSkillScore(ss, sk) : '?';
        }
        if (t.endsWith('_regen')) return formatRegenDisplay(regenPerMinute(sf[t.slice(0, -6)]));
        if (t.endsWith('_max')) {
            const base = t.slice(0, -4);
            if (v[t] !== undefined) return v[t];
            if (sf[base]?.max_field) return v[sf[base].max_field] ?? '?';
            if (state.needs?.[base]) return state.needs[base].max ?? '?';
            return '?';
        }
        if (v[t] !== undefined) return Array.isArray(v[t]) ? v[t].join(', ') : v[t];
        if (state.needs?.[t] !== undefined) return state.needs[t].value;
        return `{${t}}`;
    };
    return format.replace(/\{([^}]+)\}/g, (_, tok) => resolve(tok));
}

// ── Interceptor ───────────────────────────────────────────────────────────────

/** Returns an answer string if the message is a known command, else null. */
function tryHandleCommand(messageText) {
    if (!messageText?.trim().startsWith('#')) return null;
    const parts = messageText.trim().split(/\s+/);
    const cmd   = parts[0].toLowerCase();
    const arg   = parts.slice(1).join(' ') || undefined;
    const entry = buildActiveCommands().map[cmd];
    if (!entry) return null;
    return entry.handler(getCharState(), arg);
}

// ── #inspect ──────────────────────────────────────────────────────────────────

function cmdInspect(state, targetName) {
    if (!targetName) return '[Inspect]\nUsage: #inspect <target name>';

    const query = targetName.toLowerCase();
    const ss    = state.skill_system;

    let awareTier = 0;
    const awSkill = ss?.skills?.['awareness'] || ss?.skills?.['Awareness'];
    if (awSkill) awareTier = awSkill.tier_idx ?? 0;

    const hints = [];
    for (const ev of state.world_events || []) {
        if (ev.title?.toLowerCase().includes(query) || ev.description?.toLowerCase().includes(query))
            hints.push(`World event: ${ev.title}`);
    }
    for (const [, q] of Object.entries(state.quests || {})) {
        if (q.title?.toLowerCase().includes(query) || q.notes?.toLowerCase().includes(query))
            hints.push(`Quest link: ${q.title}`);
    }

    const tierLabel = (ss?.tier_names || getSystemDef().skills?.tier_names || DEFAULT_TIER_NAMES)[awareTier] || `Tier ${awareTier + 1}`;
    const lines = [`[Inspect: ${targetName}]`, `Awareness tier: ${tierLabel}`];
    if (!hints.length) {
        lines.push('No local data found. Ask the GM for more details.');
    } else {
        if (awareTier < 2) lines.push('(Limited awareness — only surface details visible)');
        lines.push(...hints);
    }
    return lines.join('\n');
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
