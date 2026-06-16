/**
 * gm-lore-parser / modules/context.js
 * Injects the current character state into the model's context
 * via SillyTavern's setExtensionPrompt API (Author's Note position).
 */

function buildContextString(state) {
    // During active character creation, inject draft context instead of full sheet
    if (state.char_creation?.active) {
        return buildCreationContextString(state.char_creation) || null;
    }

    if (!state.name) return null;
    const s = getSettings();
    const resolutionText = s.injectResolution !== false ? buildResolutionContextString(getSystemDef()) : '';
    const header        = `[Character: ${state.name}${state.class_ ? ` | ${state.class_}` : ''}${state.background ? ` | ${state.background}` : ''}]`;
    const schemaObj     = state.schema || { fields: {}, groups: [] };
    const timeText      = state.world_time?.display ? `Time: ${state.world_time.display}` : '';
    const needsText     = featureOn('needs') ? buildNeedsContextString(state.needs || {}) : '';  // only injects when below warn threshold

    // ── Legacy monolithic mode: everything always-on (tieredContext off) ──────────
    if (s.tieredContext === false) {
        const charText       = buildValueSummary(header, schemaObj, state.values || {});
        const capabilityText = featureOn('capabilities') ? buildCapabilityContextString(state.capabilities || {}) : '';
        const domainText    = featureOn('domains')     ? buildDomainContextString(state.domains) : '';
        const questText     = featureOn('quests')      ? buildQuestContextString(state.quests || {}) : '';
        const repText       = featureOn('reputation')  ? buildFactionContextString(state.factions || {}, state.reputation || {}) : '';
        const eventsText    = featureOn('world_events') ? buildWorldEventsContextString(state.world_events || []) : '';
        const currencyText  = featureOn('currency')    ? buildCurrencyContextString(state.currency || {}) : '';
        const rankText      = featureOn('ranks')       ? buildRankContextString(state.adventurer_rank) : '';
        const companionText = featureOn('companions')  ? buildCompanionContextString(state.companions || {}) : '';
        const inventoryText = featureOn('equipment')   ? buildInventoryContextString(state) : '';
        return [resolutionText, charText, capabilityText, domainText, timeText, questText, repText, eventsText, currencyText, rankText, companionText, inventoryText, needsText].filter(Boolean).join('\n') || null;
    }

    // ── Tiered mode (default): lean always-on core. Detail (skills, possessions,
    //    domains) moves to keyword-triggered [Player:*] entries; quests/factions/
    //    world-events surface via their own existing entries. See rebuildPlayerLoreEntries. ──
    // Possession-type schema fields (inventory/gear/…) are dropped from the core sheet —
    // they belong to the on-demand [Player:Possessions] entry.
    const coreText  = buildValueSummary(header, schemaObj, state.values || {}, _possessionFieldKeySet(schemaObj));
    const titleText = featureOn('capabilities') ? buildActiveTitleContextString(state.capabilities || {}) : '';
    const rankText  = featureOn('ranks')        ? buildRankContextString(state.adventurer_rank) : '';
    return [resolutionText, coreText, titleText, timeText, rankText, needsText].filter(Boolean).join('\n') || null;
}

// Schema fields that represent possessions (moved off the lean core into [Player:Possessions]).
var _POSSESSION_FIELD_RE = /^(inventory|items|equipment|gear|possessions|backpack|belongings|loot)$/i;
function _possessionFieldKeys(schema) {
    return Object.keys(schema?.fields || {}).filter(k => _POSSESSION_FIELD_RE.test(k));
}
function _possessionFieldKeySet(schema) { return new Set(_possessionFieldKeys(schema)); }
/** Render the possession schema fields' values (the actual item lists) for the on-demand entry. */
function _possessionSummary(state) {
    const sf = state.schema?.fields || {}, v = state.values || {};
    const lines = [];
    for (const k of _possessionFieldKeys(state.schema)) {
        const val = v[k];
        if (val === undefined || val === null || val === '') continue;
        lines.push(`${sf[k]?.label || k}: ${Array.isArray(val) ? val.join(', ') : val}`);
    }
    return lines.join('\n');
}

function injectCharacterContext() {
    const s   = getSettings();
    const ctx = SillyTavern.getContext();
    // ALWAYS (re)write the prompt — never early-return on empty/disabled. setExtensionPrompt
    // writes to ST's GLOBAL extension_prompts (not per-chat); returning early would leave a
    // previous chat's character sheet lingering there and leak it into the new chat's context
    // (cross-chat / cross-campaign). Writing '' clears the injection.
    const text = (s.injectIntoContext ? buildContextString(getCharState()) : '') || '';
    ctx.setExtensionPrompt?.(MODULE_NAME + '_char', text, 1, s.contextDepth);
}

// ── Keyword-triggered PLAYER detail entries ─────────────────────────────────────
// In tiered mode, the player's full skill list, possessions, and domains move out
// of the always-on context into lorebook entries that load only when the narrative
// references them (mirroring how NPCs surface). Quests/factions/world-events already
// have their own keyword-triggered entries, so they are simply dropped from the
// always-on core above (no duplicate [Player:*] entry is created for them).

async function _upsertPlayerEntry(settings, comment, keys, content, type) {
    const lb = settings.campaignLorebook;
    if (content && content.trim()) {
        await upsertEntry(lb, entryBase(comment, normalizeKeys(keys), content, settings.loreOrder, settings, { type }));
    } else {
        await removeEntriesByComment(lb, new Set(), type);   // hygiene: drop the entry when empty
    }
}

async function rebuildPlayerLoreEntries(settings) {
    if (!settings.campaignLorebook) return;
    if (settings.tieredContext === false) {                  // legacy mode keeps everything in always-on context — drop any [Player:*] entries
        for (const t of ['PLAYER_SKILLS', 'PLAYER_POSSESSIONS', 'PLAYER_DOMAINS'])
            await removeEntriesByComment(settings.campaignLorebook, new Set(), t);
        return;
    }
    const state = getCharState();
    if (state.char_creation?.active || !state.name) return;
    const def = getSystemDef();

    // [Player:Skills] — full capability list, bundled. Keyed on generic skill words,
    // the system's category names, and every capability's own name.
    if (featureOn('capabilities')) {
        const caps     = Object.values(state.capabilities || {}).filter(c => (c.entity_slug || 'player') === 'player');
        const catNames = def.capabilities?.categories || [];
        const keys     = [
            'skill', 'skills', 'ability', 'abilities', 'cast', 'casting', 'technique', 'spell', 'talent', 'power',
            ...catNames, ...catNames.map(c => `${c}s`),
            ...caps.map(c => c.name),
        ];
        await _upsertPlayerEntry(settings, '[Player:Skills]', keys, buildCapabilityContextString(state.capabilities || {}), 'PLAYER_SKILLS');
    }

    // [Player:Possessions] — the item lists (possession schema fields) + equipment/load +
    // item box + currency. The item lists are what the lean core dropped.
    if (featureOn('equipment') || featureOn('currency') || _possessionFieldKeys(state.schema).length) {
        const possText = _possessionSummary(state);
        const invText  = featureOn('equipment') ? buildInventoryContextString(state) : '';
        const curText  = featureOn('currency')  ? buildCurrencyContextString(state.currency || {}) : '';
        const items    = _possessionFieldKeys(state.schema).flatMap(k => Array.isArray(state.values?.[k]) ? state.values[k] : []);
        const equipped = Object.values(state.equipment || {});
        const boxItems = (state.item_box || []).map(b => b.item).filter(Boolean);
        const denoms   = Object.keys(state.currency || {});
        const keys     = [
            'inventory', 'pack', 'backpack', 'bag', 'gear', 'equipment', 'equip', 'equipped', 'wield', 'wielding',
            'wear', 'wearing', 'carry', 'carrying', 'item', 'items', 'loot', 'belongings',
            'coin', 'coins', 'gold', 'currency', 'money', 'purse', 'wallet', 'wealth',
            ...items, ...equipped, ...boxItems, ...denoms,
        ];
        await _upsertPlayerEntry(settings, '[Player:Possessions]', keys, [possText, invText, curText].filter(Boolean).join('\n'), 'PLAYER_POSSESSIONS');
    }

    // [Player:Domains] — sub-game stats.
    if (featureOn('domains')) {
        const names = Object.keys(state.domains || {}).map(k => k.replace(/_/g, ' '));
        const keys  = ['domain', 'domains', 'holding', 'realm', 'territory', ...names];
        await _upsertPlayerEntry(settings, '[Player:Domains]', keys, buildDomainContextString(state.domains), 'PLAYER_DOMAINS');
    }
}
