/**
 * gm-lore-parser / modules/context.js
 * Injects the current character state into the model's context
 * via SillyTavern's setExtensionPrompt API (Author's Note position).
 */

function buildContextString(state) {
    if (!state.name) return null;
    const header       = `[Character: ${state.name}${state.class_ ? ` | ${state.class_}` : ''}${state.background ? ` | ${state.background}` : ''}]`;
    const charText     = buildValueSummary(header, state.schema || { fields: {}, groups: [] }, state.values || {});
    const skillText    = buildSkillContextString(state.skill_system);
    const domainText   = buildDomainContextString(state.domains);
    const timeText     = state.world_time?.display ? `Time: ${state.world_time.display}` : '';
    const questText    = buildQuestContextString(state.quests || {});
    const repText      = buildFactionContextString(state.factions || {}, state.reputation || {});
    const eventsText   = buildWorldEventsContextString(state.world_events || []);
    const currencyText = buildCurrencyContextString(state.currency || {}, state.adventurer_rank);
    const companionText = buildCompanionContextString(state.companions || {});
    return [charText, skillText, domainText, timeText, questText, repText, eventsText, currencyText, companionText].filter(Boolean).join('\n');
}

function injectCharacterContext() {
    const s = getSettings();
    if (!s.injectIntoContext) return;
    const text = buildContextString(getCharState());
    if (!text) return;
    SillyTavern.getContext().setExtensionPrompt?.(MODULE_NAME + '_char', text, 1, s.contextDepth);
}
