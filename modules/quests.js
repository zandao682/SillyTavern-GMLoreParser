/**
 * gm-lore-parser / modules/quests.js
 * Quest system — tracks quests in chatMetadata and writes
 * lorebook entries so the GM can reference them.
 *
 * Block protocol:
 *   [QUEST_BEGIN] … [QUEST_END]          — declare / register a quest
 *   [QUEST_UPDATE_BEGIN] … [QUEST_UPDATE_END] — update status / objectives
 */

// ── Helpers ───────────────────────────────────────────────────────────────────

function questCfg() {
    const q = getSystemDef().quests || {};
    return {
        statuses:         q.statuses         || ['Active', 'Paused', 'Completed', 'Failed'],
        default_category: q.default_category || 'Side',
        default_status:   q.default_status   || 'Active',
    };
}

/** Parse the objectives: multi-line field into an array of { text, done } objects. */
function parseObjectives(raw) {
    const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
    return lines.map(line => {
        // Accept "1. Scout the camp (incomplete)" or "- Scout the camp" etc.
        const done = /\(complete\)/i.test(line) || /^\[x\]/i.test(line);
        const text = line.replace(/^\d+\.\s*/, '').replace(/\(complete\)/i, '').replace(/\(incomplete\)/i, '').replace(/^\[.\]\s*/, '').trim();
        return { text, done };
    });
}

/** Build a plain-text quest entry for the lorebook. */
function buildQuestLoreContent(quest) {
    const lines = [`[Quest] ${quest.title}`];
    if (quest.rank)     lines.push(`Rank: ${quest.rank}`);
    if (quest.category) lines.push(`Category: ${quest.category}`);
    lines.push(`Status: ${quest.status}`);
    if (quest.description) lines.push(`Description: ${quest.description}`);
    if (quest.objectives?.length) {
        lines.push('Objectives:');
        for (const [i, obj] of quest.objectives.entries())
            lines.push(`  ${i + 1}. [${obj.done ? 'X' : ' '}] ${obj.text}`);
    }
    if (quest.rewards) lines.push(`Rewards: ${quest.rewards}`);
    if (quest.notes)   lines.push(`Notes: ${quest.notes}`);
    return lines.join('\n');
}

// ── QUEST_BEGIN handler ───────────────────────────────────────────────────────

async function processQuestBlock(fields, settings) {
    if (!fields.name && !fields.title) return false;
    const title    = fields.title || fields.name;
    const slug     = slugify(title);
    const state    = getCharState();
    const keywords = fields.keywords
        ? fields.keywords.split(',').map(k => k.trim()).filter(Boolean)
        : [title.toLowerCase(), ...(fields.rank ? [fields.rank.toLowerCase() + '-rank quest'] : [])];

    const quest = {
        title,
        rank:        fields.rank      || '',
        category:    fields.category  || questCfg().default_category,
        status:      fields.status    || questCfg().default_status,
        description: fields.description || fields.summary || '',
        objectives:  fields.objectives ? parseObjectives(fields.objectives) : [],
        rewards:     fields.rewards   || '',
        notes:       fields.notes     || '',
        history:     [],
        keywords,
    };
    state.quests[slug] = quest;

    if (settings.campaignLorebook) {
        await upsertEntry(settings.campaignLorebook, {
            ...entryBase(`[Quest] ${title}`, keywords,
                buildQuestLoreContent(quest), settings.loreOrder, settings, { type: 'QUEST', slug }),
        });
    }
    console.log(`[${MODULE_NAME}] Quest registered: "${title}" (${quest.status})`);
    return true;
}

// ── QUEST_UPDATE handler ──────────────────────────────────────────────────────

async function applyQuestUpdate(raw, settings) {
    const fields = parseFields(raw);
    const title  = fields.title || fields.name;
    if (!title) { console.warn(`[${MODULE_NAME}] QUEST_UPDATE missing title`); return false; }

    const slug  = slugify(title);
    const state = getCharState();
    if (!state.quests[slug]) {
        // Auto-create minimal quest if not yet registered
        state.quests[slug] = { title, rank: '', category: '', status: questCfg().default_status, objectives: [], rewards: '', notes: '', history: [] };
    }
    const quest = state.quests[slug];

    if (fields.status)  quest.status = fields.status;
    if (fields.rewards) quest.rewards = fields.rewards;
    if (fields.notes)   quest.notes  = fields.notes;
    if (fields.rank)    quest.rank   = fields.rank;

    // Update individual objectives: objective_1: complete / incomplete
    for (const [key, val] of Object.entries(fields)) {
        const m = key.match(/^objective[_\s](\d+)$/i);
        if (m) {
            const idx = parseInt(m[1]) - 1;
            if (quest.objectives[idx]) quest.objectives[idx].done = /complete/i.test(val) && !/incomplete/i.test(val);
        }
    }

    // History entry
    if (fields.notes) quest.history.push({ date: quest.notes, summary: fields.notes });

    if (settings.campaignLorebook) {
        await upsertEntry(settings.campaignLorebook, {
            ...entryBase(`[Quest] ${title}`, quest.keywords || [title.toLowerCase()],
                buildQuestLoreContent(quest), settings.loreOrder, settings, { type: 'QUEST', slug }),
        });
    }
    console.log(`[${MODULE_NAME}] Quest updated: "${title}" → ${quest.status}`);
    return true;
}

// ── Context string ────────────────────────────────────────────────────────────

function buildQuestContextString(quests) {
    const active = Object.values(quests).filter(q => q.status === questCfg().default_status);
    if (!active.length) return '';
    const lines = ['[Active Quests]'];
    for (const q of active) {
        const rankStr = q.rank ? ` [${q.rank}]` : '';
        lines.push(`  ${q.title}${rankStr} — ${q.description || q.status}`);
        const incomplete = q.objectives.filter(o => !o.done);
        if (incomplete.length) lines.push(`    Next: ${incomplete[0].text}`);
    }
    return lines.join('\n');
}

// ── Panel HTML ────────────────────────────────────────────────────────────────

function buildQuestPanelHTML(quests) {
    const all = Object.values(quests);
    if (!all.length) return '<div class="glp-panel-empty">No quests recorded.</div>';
    const order = questCfg().statuses;
    const rankOf = s => { const i = order.indexOf(s); return i === -1 ? 99 : i; };
    const sorted = [...all].sort((a, b) => rankOf(a.status) - rankOf(b.status));
    return sorted.map(q => {
        const statusClass = `glp-quest-${(q.status || 'active').toLowerCase()}`;
        const rankBadge   = q.rank ? `<span class="glp-rank-badge">${q.rank}</span>` : '';
        const objDone     = q.objectives.filter(o => o.done).length;
        const objTotal    = q.objectives.length;
        const objStr      = objTotal ? `<span class="glp-quest-obj">${objDone}/${objTotal}</span>` : '';
        return `<div class="glp-quest-row ${statusClass}">
            <span class="glp-quest-title">${q.title}</span>
            ${rankBadge}${objStr}
            <span class="glp-quest-status">${q.status}</span>
        </div>`;
    }).join('');
}

// ── Command ───────────────────────────────────────────────────────────────────

function cmdQuests(state) {
    const quests = state.quests || {};
    if (!Object.keys(quests).length) return '[Quests]\nNo quests recorded.';
    const lines = ['[Quests]'];
    const groups = {};
    for (const s of questCfg().statuses) groups[s] = [];
    groups.Other = [];
    for (const q of Object.values(quests)) (groups[q.status] || groups.Other).push(q);
    for (const [status, list] of Object.entries(groups)) {
        if (!list.length) continue;
        lines.push(`\n${status.toUpperCase()}`);
        for (const q of list) {
            const rankStr = q.rank ? ` [${q.rank}]` : '';
            lines.push(`  ${q.title}${rankStr}`);
            const incomplete = q.objectives.filter(o => !o.done);
            if (incomplete.length) lines.push(`    → ${incomplete[0].text}`);
        }
    }
    return lines.join('\n');
}
