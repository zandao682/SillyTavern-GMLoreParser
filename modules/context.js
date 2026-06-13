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
    const header        = `[Character: ${state.name}${state.class_ ? ` | ${state.class_}` : ''}${state.background ? ` | ${state.background}` : ''}]`;
    const charText      = buildValueSummary(header, state.schema || { fields: {}, groups: [] }, state.values || {});
    const skillText     = featureOn('skills')      ? buildSkillContextString(state.skill_system) : '';
    const domainText    = featureOn('domains')     ? buildDomainContextString(state.domains) : '';
    const timeText      = state.world_time?.display ? `Time: ${state.world_time.display}` : '';
    const questText     = featureOn('quests')      ? buildQuestContextString(state.quests || {}) : '';
    const repText       = featureOn('reputation')  ? buildFactionContextString(state.factions || {}, state.reputation || {}) : '';
    const eventsText    = featureOn('world_events') ? buildWorldEventsContextString(state.world_events || []) : '';
    const currencyText  = featureOn('currency')    ? buildCurrencyContextString(state.currency || {}, state.adventurer_rank) : '';
    const companionText = featureOn('companions')  ? buildCompanionContextString(state.companions || {}) : '';
    const abilityText   = featureOn('abilities')   ? buildAbilityContextString(state.abilities || []) : '';
    const needsText     = featureOn('needs')       ? buildNeedsContextString(state.needs || {}) : '';  // only injects when below warn threshold
    return [charText, skillText, domainText, timeText, questText, repText, eventsText, currencyText, companionText, abilityText, needsText].filter(Boolean).join('\n');
}

function injectCharacterContext() {
    const s = getSettings();
    if (!s.injectIntoContext) return;
    const text = buildContextString(getCharState());
    if (!text) return;
    SillyTavern.getContext().setExtensionPrompt?.(MODULE_NAME + '_char', text, 1, s.contextDepth);
}
