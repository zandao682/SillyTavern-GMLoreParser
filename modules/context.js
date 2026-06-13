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
    const resolutionText = getSettings().injectResolution !== false ? buildResolutionContextString(getSystemDef()) : '';
    const header        = `[Character: ${state.name}${state.class_ ? ` | ${state.class_}` : ''}${state.background ? ` | ${state.background}` : ''}]`;
    const charText      = buildValueSummary(header, state.schema || { fields: {}, groups: [] }, state.values || {});
    const capabilityText = featureOn('capabilities') ? buildCapabilityContextString(state.capabilities || {}) : '';
    const domainText    = featureOn('domains')     ? buildDomainContextString(state.domains) : '';
    const timeText      = state.world_time?.display ? `Time: ${state.world_time.display}` : '';
    const questText     = featureOn('quests')      ? buildQuestContextString(state.quests || {}) : '';
    const repText       = featureOn('reputation')  ? buildFactionContextString(state.factions || {}, state.reputation || {}) : '';
    const eventsText    = featureOn('world_events') ? buildWorldEventsContextString(state.world_events || []) : '';
    const currencyText  = featureOn('currency')    ? buildCurrencyContextString(state.currency || {}) : '';
    const rankText      = featureOn('ranks')       ? buildRankContextString(state.adventurer_rank) : '';
    const companionText = featureOn('companions')  ? buildCompanionContextString(state.companions || {}) : '';
    const needsText     = featureOn('needs')       ? buildNeedsContextString(state.needs || {}) : '';  // only injects when below warn threshold
    const inventoryText = featureOn('equipment') ? buildInventoryContextString(state) : '';
    return [resolutionText, charText, capabilityText, domainText, timeText, questText, repText, eventsText, currencyText, rankText, companionText, inventoryText, needsText].filter(Boolean).join('\n');
}

function injectCharacterContext() {
    const s = getSettings();
    if (!s.injectIntoContext) return;
    const text = buildContextString(getCharState());
    if (!text) return;
    SillyTavern.getContext().setExtensionPrompt?.(MODULE_NAME + '_char', text, 1, s.contextDepth);
}
