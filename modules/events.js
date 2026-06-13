/**
 * gm-lore-parser / modules/events.js
 * World Events + Plot Lorebook
 *
 * Block protocol:
 *   [WORLD_EVENT_BEGIN] … [WORLD_EVENT_END]
 *     title:        The Siege of Thornwall
 *     date:         Day 14, Third Age
 *     location:     Thornwall Keep
 *     description:  Imperial forces lay siege…
 *     consequences: Trade route to the north cut off
 *     status:       Ongoing   (Ongoing | Resolved | Averted)
 *
 *   [WORLD_EVENT_UPDATE_BEGIN] … [WORLD_EVENT_UPDATE_END]
 *     title:        The Siege of Thornwall
 *     status:       Resolved
 *     resolution:   Defenders held; emperor retreated
 *
 *   [PLOT_ENTRY_BEGIN] … [PLOT_ENTRY_END]
 *     title:        The Stolen Crown
 *     type:         Ongoing | Historical | Rumour
 *     summary:      Someone stole the Veridia Crown during the coronation…
 *     keywords:     stolen crown, coronation, thief
 */

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeEventId(title) {
    return `evt_${slugify(title)}_${Date.now ? '' : Math.floor(Math.random() * 1e6)}${slugify(title)}`.slice(0, 48);
}

// ── WORLD_EVENT_BEGIN handler ─────────────────────────────────────────────────

async function applyWorldEventBlock(raw, settings) {
    const fields = parseFields(raw);
    if (!fields.title) { console.warn(`[${MODULE_NAME}] WORLD_EVENT missing title`); return false; }

    const state = getCharState();
    const existing = state.world_events.find(e => slugify(e.title) === slugify(fields.title));

    const event = existing || {
        id:           `evt_${slugify(fields.title)}`,
        title:        fields.title,
        date:         fields.date         || '',
        location:     fields.location     || '',
        description:  fields.description  || '',
        consequences: fields.consequences || '',
        status:       fields.status       || 'Ongoing',
        resolution:   '',
    };

    if (!existing) {
        state.world_events.push(event);
    } else {
        // Merge — only overwrite if field provided
        if (fields.date)         event.date         = fields.date;
        if (fields.location)     event.location     = fields.location;
        if (fields.description)  event.description  = fields.description;
        if (fields.consequences) event.consequences = fields.consequences;
        if (fields.status)       event.status       = fields.status;
    }

    // Write to lorebook
    if (settings.campaignLorebook) {
        const keywords = [fields.title.toLowerCase(), ...(fields.location ? [fields.location.toLowerCase()] : [])];
        await upsertEntry(settings.campaignLorebook, {
            ...entryBase(`[World Event] ${event.title}`, keywords, buildEventLoreContent(event), settings.loreOrder, settings, { type: 'WORLD_EVENT', id: event.id }),
        });
    }
    console.log(`[${MODULE_NAME}] World event: "${event.title}" (${event.status})`);
    return true;
}

// ── WORLD_EVENT_UPDATE handler ────────────────────────────────────────────────

async function applyWorldEventUpdate(raw, settings) {
    const fields = parseFields(raw);
    if (!fields.title) { console.warn(`[${MODULE_NAME}] WORLD_EVENT_UPDATE missing title`); return false; }

    const state = getCharState();
    const event = state.world_events.find(e => slugify(e.title) === slugify(fields.title));
    if (!event) {
        console.warn(`[${MODULE_NAME}] WORLD_EVENT_UPDATE: unknown event "${fields.title}", creating.`);
        return applyWorldEventBlock(raw, settings);
    }

    if (fields.status)     event.status     = fields.status;
    if (fields.resolution) event.resolution = fields.resolution;
    if (fields.date)       event.date       = fields.date;

    if (settings.campaignLorebook) {
        const keywords = [event.title.toLowerCase()];
        await upsertEntry(settings.campaignLorebook, {
            ...entryBase(`[World Event] ${event.title}`, keywords, buildEventLoreContent(event), settings.loreOrder, settings, { type: 'WORLD_EVENT', id: event.id }),
        });
    }
    console.log(`[${MODULE_NAME}] World event updated: "${event.title}" → ${event.status}`);
    return true;
}

// ── PLOT_ENTRY handler ────────────────────────────────────────────────────────

async function processPlotEntry(raw, settings) {
    const fields = parseFields(raw);
    if (!fields.title) { console.warn(`[${MODULE_NAME}] PLOT_ENTRY missing title`); return false; }

    // Determine the plot lorebook name
    const plotBook = settings.plotLorebook
        || (settings.campaignLorebook ? `${settings.campaignLorebook}-plot` : null);
    if (!plotBook) { console.warn(`[${MODULE_NAME}] PLOT_ENTRY: no plotLorebook configured`); return false; }

    const keywords = fields.keywords
        ? fields.keywords.split(',').map(k => k.trim()).filter(Boolean)
        : [fields.title.toLowerCase()];

    const type    = fields.type || 'Ongoing';
    const summary = fields.summary || fields.description || '';
    const notes   = fields.notes || '';

    const content = [
        `[Plot] ${fields.title}`,
        `Type: ${type}`,
        summary ? `Summary: ${summary}` : '',
        notes   ? `Notes: ${notes}`     : '',
    ].filter(Boolean).join('\n');

    // loadOrCreateLorebook so the plot lorebook is auto-created
    const lb = await loadOrCreateLorebook(plotBook);
    await upsertEntry(lb.name || plotBook, {
        ...entryBase(`[Plot] ${fields.title}`, keywords, content, settings.loreOrder, settings, { type: 'PLOT', slug: slugify(fields.title) }),
    });
    console.log(`[${MODULE_NAME}] Plot entry: "${fields.title}" → ${plotBook}`);
    return true;
}

// ── Lorebook content ──────────────────────────────────────────────────────────

function buildEventLoreContent(event) {
    const lines = [`[World Event] ${event.title}`];
    if (event.date)     lines.push(`Date: ${event.date}`);
    if (event.location) lines.push(`Location: ${event.location}`);
    lines.push(`Status: ${event.status}`);
    if (event.description)  lines.push(`Description: ${event.description}`);
    if (event.consequences) lines.push(`Consequences: ${event.consequences}`);
    if (event.resolution)   lines.push(`Resolution: ${event.resolution}`);
    return lines.join('\n');
}

// ── Context string ────────────────────────────────────────────────────────────

function buildWorldEventsContextString(world_events) {
    const ongoing = world_events.filter(e => e.status === 'Ongoing');
    if (!ongoing.length) return '';
    const lines = ['[Ongoing World Events]'];
    for (const e of ongoing) {
        lines.push(`  ${e.title}${e.location ? ' (' + e.location + ')' : ''}: ${e.description}`);
        if (e.consequences) lines.push(`    Impact: ${e.consequences}`);
    }
    return lines.join('\n');
}

// ── Panel HTML ────────────────────────────────────────────────────────────────

function buildEventsPanel(world_events) {
    if (!world_events.length) return '<div class="glp-panel-empty">No world events recorded.</div>';
    const statusOrder = { Ongoing: 0, Averted: 1, Resolved: 2 };
    const sorted = [...world_events].sort((a, b) => (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9));
    return sorted.map(e => {
        const cls = `glp-event-${(e.status || 'ongoing').toLowerCase()}`;
        const loc = e.location ? ` <span class="glp-event-loc">${e.location}</span>` : '';
        return `<div class="glp-event-row ${cls}">
            <span class="glp-event-title">${e.title}</span>${loc}
            <span class="glp-event-status">${e.status}</span>
            ${e.description ? `<div class="glp-event-desc">${e.description}</div>` : ''}
        </div>`;
    }).join('');
}

// ── Command ───────────────────────────────────────────────────────────────────

function cmdEvents(state) {
    const events = state.world_events || [];
    if (!events.length) return '[World Events]\nNo world events recorded.';
    const lines = ['[World Events]'];
    const groups = { Ongoing: [], Averted: [], Resolved: [] };
    for (const e of events) (groups[e.status] || groups.Resolved).push(e);
    for (const [status, list] of Object.entries(groups)) {
        if (!list.length) continue;
        lines.push(`\n${status.toUpperCase()}`);
        for (const e of list) {
            lines.push(`  ${e.title}${e.location ? ' [' + e.location + ']' : ''}`);
            if (e.consequences) lines.push(`    → ${e.consequences}`);
        }
    }
    return lines.join('\n');
}
