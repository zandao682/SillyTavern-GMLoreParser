/**
 * gm-lore-parser / modules/panel.js
 * Status panel — HTML rendering for the live character state widget
 * shown above the chat input.
 */

// ── Field renderers ───────────────────────────────────────────────────────────

function renderField(key, descriptor, values) {
    const val    = values[key];
    const label  = descriptor.label || key;
    const color  = descriptor.color || 'var(--SmartThemeQuoteColor, #9b8fd6)';
    const mut    = getMutability(descriptor);
    const usesKey = `${key}_uses`;
    const usesVal = parseInt(values[usesKey]) || 0;
    const usesThr = descriptor.uses_threshold || 0;
    const usesInd = mut === MUTABILITY.USE_TRACKED && usesThr > 0
        ? `<span class="glp-uses-progress" title="${usesVal}/${usesThr} uses">${usesVal}/${usesThr}↑</span>` : '';
    const evBadge = mut === MUTABILITY.GM_EVENT
        ? `<span class="glp-event-badge" title="milestone/level-up">★</span>` : '';
    const rpm         = regenPerMinute(descriptor);
    const regenDisplay = rpm && descriptor.regen
        ? `<span class="glp-regen-rate">${formatRegenDisplay(rpm)}</span>` : '';

    switch (descriptor.type) {
        case 'bar': {
            const cur = parseFloat(val) || 0;
            const max = descriptor.max_field ? (parseFloat(values[descriptor.max_field]) || 0) : cur;
            const pct = max > 0 ? Math.max(0, Math.min(100, (cur / max) * 100)) : 0;
            const _pcfg = presentationCfg();
            const d   = pct <= _pcfg.bar_danger_pct ? 'glp-danger' : pct <= _pcfg.bar_warn_pct ? 'glp-warning' : '';
            return `<div class="glp-field-bar ${d}">
                <div class="glp-field-bar-header">
                    <span class="glp-field-label">${label}${evBadge}</span>
                    <span class="glp-field-bar-val" style="color:${color}">${cur}${max !== cur ? `/${max}` : ''} ${regenDisplay}</span>
                </div>
                <div class="glp-bar-track"><div class="glp-bar-fill" style="width:${pct}%;background:${color}"></div></div>
            </div>`;
        }
        case 'pool': {
            const cur  = parseInt(val) || 0;
            const max  = descriptor.max_field ? (parseInt(values[descriptor.max_field]) || cur) : cur;
            const pips = Array.from({ length: Math.min(max, presentationCfg().max_pips) }, (_, i) =>
                `<span class="glp-pip ${i < cur ? 'glp-pip-full' : 'glp-pip-empty'}" style="${i < cur ? `background:${color}` : ''}"></span>`
            ).join('');
            return `<div class="glp-field-pool">
                <span class="glp-field-label">${label}${evBadge}</span>
                <span class="glp-pool-pips">${pips}</span>
                <span class="glp-pool-count" style="color:${color}">${cur}/${max}${regenDisplay}</span>
            </div>`;
        }
        case 'list': {
            const items = Array.isArray(val) ? val : (val ? String(val).split(',').map(s => s.trim()) : []);
            if (!items.length) return '';
            const inner = key === 'conditions'
                ? items.map(c => `<span class="glp-condition-pill">${c}</span>`).join('')
                : `<span class="glp-list-items">${items.join(' · ')}</span>`;
            return `<div class="glp-field-list"><span class="glp-field-label">${label}</span><div class="glp-list-content">${inner}</div></div>`;
        }
        case 'text':
            if (val === undefined || val === null || val === '') return '';
            return `<div class="glp-field-text"><span class="glp-field-label">${label}</span><span class="glp-field-text-val">${val}</span></div>`;
        default:
            if (val === undefined || val === null || val === '') return '';
            return `<div class="glp-field-value">
                <span class="glp-field-label">${label}${evBadge}</span>
                <span class="glp-field-value-val" style="color:${color}">${val}</span>
                ${usesInd}
            </div>`;
    }
}

// ── Sub-panel builders ────────────────────────────────────────────────────────

function buildDomainPanelHTML(domains) {
    if (!domains || !Object.keys(domains).length) return '';
    return Object.entries(domains).map(([name, domain]) => `
        <div class="glp-domain-section">
            <div class="glp-domain-name">${name}</div>
            ${Object.entries(domain.stats).map(([k, v]) =>
                `<div class="glp-domain-stat"><span class="glp-field-label">${k.replace(/_/g, ' ')}</span><span class="glp-domain-val">${v}</span></div>`
            ).join('')}
            ${domain.last_turn ? `<div class="glp-domain-turn">Last turn: ${domain.last_turn}</div>` : ''}
        </div>`
    ).join('');
}

// ── Main panel ────────────────────────────────────────────────────────────────

function buildStatusPanelHTML(state) {
    // Show interactive creation panel when creation session is active
    if (state.char_creation?.active) {
        const creationHtml = buildCreationPanelHTML(state.char_creation);
        if (creationHtml) return `<div id="glp-status-panel" class="glp-status glp-creation-mode">${creationHtml}</div>`;
    }

    if (!state.name)
        return `<div id="glp-status-panel" class="glp-status-empty"><span>No character loaded. Provide a player [ENTITY_BEGIN] block or begin a character creation session to start.</span></div>`;

    const schema = state.schema?.fields || {};
    const groups = state.schema?.groups || [];
    const values = state.values || {};
    const grouped = {};
    for (const [key, desc] of Object.entries(schema)) {
        if (isMaxFieldOf(key, schema) || isUsesCounterOf(key, schema)) continue;
        const g = desc.group || 'other';
        if (!grouped[g]) grouped[g] = [];
        grouped[g].push([key, desc]);
    }
    const allGroups = [...groups, ...Object.keys(grouped).filter(g => !groups.includes(g))];
    const sections  = allGroups.filter(g => grouped[g]?.length).map(g => {
        const f = grouped[g].map(([k, d]) => renderField(k, d, values)).filter(Boolean).join('');
        return f ? `<div class="glp-group"><div class="glp-group-label">${g}</div><div class="glp-group-fields">${f}</div></div>` : '';
    }).join('');

    const timeDisplay = state.world_time?.display
        ? `<span class="glp-world-time">${state.world_time.display}</span>` : '';

    const settings     = getSettings();
    const _capHtml      = featureOn('capabilities') ? buildCapabilityPanelHTML(state.capabilities || {}, settings) : '';
    const capabilityHtml = _capHtml
        ? `<details class="glp-boon-details open"><summary>Capabilities</summary>
           <div class="glp-boon-panel">${_capHtml}</div></details>` : '';
    const domainHtml   = settings.showDomainPanel && featureOn('domains') && Object.keys(state.domains || {}).length
        ? `<details class="glp-domain-details"><summary>Domains</summary>
           <div class="glp-domain-panel">${buildDomainPanelHTML(state.domains)}</div></details>` : '';
    const questHtml    = settings.showQuestPanel && featureOn('quests') && Object.keys(state.quests || {}).length
        ? `<details class="glp-quest-details"><summary>Quests (${Object.keys(state.quests).length})</summary>
           <div class="glp-quest-panel">${buildQuestPanelHTML(state.quests)}</div></details>` : '';
    const repHtml      = settings.showRepPanel && featureOn('reputation') && Object.keys(state.reputation || {}).length
        ? `<details class="glp-rep-details"><summary>Reputation</summary>
           <div class="glp-rep-panel">${buildRepPanelHTML(state.factions || {}, state.reputation)}</div></details>` : '';
    const eventsHtml   = settings.showEventsPanel && featureOn('world_events') && (state.world_events || []).length
        ? `<details class="glp-events-details"><summary>World Events</summary>
           <div class="glp-events-panel">${buildEventsPanel(state.world_events)}</div></details>` : '';
    const currencyHtml = settings.showCurrencyPanel && featureOn('currency') && Object.keys(state.currency || {}).length
        ? `<details class="glp-currency-details"><summary>Currency</summary>
           <div class="glp-currency-panel">${buildCurrencyPanel(state.currency || {})}</div></details>` : '';
    const rankHtml = settings.showCurrencyPanel && featureOn('ranks') && state.adventurer_rank?.rank
        ? `<details class="glp-rank-details"><summary>Rank</summary>
           <div class="glp-rank-panel">${buildRankPanel(state.adventurer_rank)}</div></details>` : '';
    const companionHtml = settings.showCurrencyPanel && featureOn('companions') && Object.keys(state.companions || {}).length
        ? `<details class="glp-companion-details"><summary>Companions</summary>
           <div class="glp-companion-panel">${buildCompanionPanel(state.companions || {})}</div></details>` : '';
    const _invHtml = buildInventoryPanel(state);
    const inventoryHtml = _invHtml
        ? `<details class="glp-inventory-details"><summary>Equipment &amp; Inventory</summary>
           <div class="glp-inventory-panel">${_invHtml}</div></details>` : '';
    const needsHtml = settings.showNeedsPanel && featureOn('needs') && Object.keys(state.needs || {}).length
        ? `<details class="glp-needs-details open"><summary>Needs</summary>
           <div class="glp-needs-panel">${buildNeedsPanel(state.needs || {}, settings)}</div></details>` : '';

    // Active-title badge for header (exclusive capability category, e.g. title)
    const _exCat = getSystemDef().capabilities?.exclusive_category || 'title';
    const activeTitle = Object.values(state.capabilities || {}).find(c => c.category === _exCat && c.active && c.entity_slug === 'player');
    const titleBadge  = activeTitle ? `<span class="glp-active-title">${activeTitle.name}</span>` : '';

    return `<div id="glp-status-panel" class="glp-status">
        <div class="glp-status-header">
            <div class="glp-char-identity">
                <span class="glp-char-name">${state.name}</span>
                <span class="glp-char-sub">${[state.class_, state.background].filter(Boolean).join(' · ')}</span>
                ${titleBadge}
            </div>
            ${timeDisplay}
        </div>
        <div class="glp-groups-container">${sections || '<span class="glp-no-schema">Schema not defined.</span>'}</div>
        ${needsHtml}${capabilityHtml}${domainHtml}${questHtml}${repHtml}${eventsHtml}${currencyHtml}${rankHtml}${companionHtml}${inventoryHtml}
    </div>`;
}

function refreshStatusPanel() {
    if (!getSettings().showStatusPanel) { $('#glp-status-panel').remove(); return; }
    const html = buildStatusPanelHTML(getCharState());
    if ($('#glp-status-panel').length) $('#glp-status-panel').replaceWith(html);
    else $('#send_form').before(html);
}
