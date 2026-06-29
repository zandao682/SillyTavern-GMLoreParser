/**
 * gm-lore-parser / modules/tools.js
 * Optional native function-calling surface (Stage 3).
 *
 * On chat-completion backends that support tool calls, the model can invoke these
 * structured tools instead of emitting prose [BLOCK] tags — far more reliable than
 * hoping a small model formats a literal block. Each tool builds the SAME raw block
 * text the prose path produces and routes it through the EXISTING handler, so behavior
 * is identical to the block path; then it runs the standard post-block refresh.
 *
 * Gating (double-inert by default):
 *   - Registered only when settings.useFunctionTools is on (default OFF).
 *   - Each tool's shouldRegister re-checks the setting, and SillyTavern itself only
 *     surfaces tools on backends that support function calling — so on the local
 *     text-completion model nothing is sent and the prose-block path is unchanged.
 *
 * Known limitation: if the model BOTH calls a tool AND prints the equivalent block in
 * one turn, idempotent upserts (memory) are fine but delta blocks (entity_update,
 * currency) would apply twice. Mitigation for now is instructional — every tool
 * description says to use the tool OR the block, never both. Automatic turn-level
 * de-dup is future work.
 */

function glpToolDefs() {
    const post = async () => {
        await saveCharState();
        refreshStatusPanel();
        injectCharacterContext();
        await rebuildPlayerLoreEntries(getSettings());
    };
    const guard = () => !!getSettings().useFunctionTools;
    const onceNote = ' Use this tool OR the equivalent block in your reply — never both.';

    return [
        {
            name: 'glp_record_memory',
            displayName: 'Record Memory',
            description: 'Record a durable memory about an NPC, companion, or location.' + onceNote,
            parameters: {
                $schema: 'http://json-schema.org/draft-04/schema#',
                type: 'object',
                properties: {
                    subject:     { type: 'string', description: 'Name of the NPC, companion, or location' },
                    entity_type: { type: 'string', enum: ['npc', 'companion', 'location'], description: 'What the subject is (default npc)' },
                    memory_type: { type: 'string', enum: ['episodic', 'core'], description: 'core = defining/permanent; episodic = a specific event (default episodic)' },
                    title:       { type: 'string', description: 'Short title for the memory' },
                    content:     { type: 'string', description: 'The memory text' },
                },
                required: ['subject', 'content'],
            },
            action: async (args) => {
                const a = args || {};
                const mt = a.memory_type || 'episodic';
                if ((a.entity_type || 'npc') === 'location') {
                    await processLocationMemory(`location: ${a.subject}\nmemory_type: ${mt}\ntitle: ${a.title || ''}\ncontent: ${a.content}`, getSettings());
                } else {
                    await onEntityMemory(`type: ${a.entity_type || 'npc'}\nname: ${a.subject}\nmemory_type: ${mt}\ntitle: ${a.title || ''}\ncontent: ${a.content}`, getSettings());
                }
                await post();
                return `Recorded ${mt} memory for ${a.subject}.`;
            },
            formatMessage: () => '',
            shouldRegister: guard,
        },
        {
            name: 'glp_entity_update',
            displayName: 'Update Entity',
            description: 'Apply mutable stat/condition changes to the player or an NPC/companion (e.g. hp: -5, conditions: Poisoned). Values support +N/-N deltas for pools/bars.' + onceNote,
            parameters: {
                $schema: 'http://json-schema.org/draft-04/schema#',
                type: 'object',
                properties: {
                    target:  { type: 'string', enum: ['player', 'npc', 'companion'], description: 'Whose sheet to update (default player)' },
                    name:    { type: 'string', description: 'Required when target is not player' },
                    changes: { type: 'object', description: 'field → value map, e.g. {"hp":"-5","conditions":"Poisoned"}', additionalProperties: { type: 'string' } },
                },
                required: ['changes'],
            },
            action: async (args) => {
                const a = args || {};
                const lines = [`type: ${a.target || 'player'}`];
                if (a.name) lines.push(`name: ${a.name}`);
                for (const [k, v] of Object.entries(a.changes || {})) lines.push(`${k}: ${v}`);
                await onEntityUpdate(lines.join('\n'), getSettings());
                await post();
                return `Updated ${a.target || 'player'}${a.name ? ` (${a.name})` : ''}.`;
            },
            formatMessage: () => '',
            shouldRegister: guard,
        },
        {
            name: 'glp_currency_update',
            displayName: 'Update Currency',
            description: 'Adjust the player\'s currency (e.g. gold: +50, silver: -5). Deltas use +N/-N.' + onceNote,
            parameters: {
                $schema: 'http://json-schema.org/draft-04/schema#',
                type: 'object',
                properties: {
                    changes: { type: 'object', description: 'denomination → delta, e.g. {"gold":"+50"}', additionalProperties: { type: 'string' } },
                },
                required: ['changes'],
            },
            action: async (args) => {
                const a = args || {};
                const lines = Object.entries(a.changes || {}).map(([k, v]) => `${k}: ${v}`);
                applyCurrencyUpdate(lines.join('\n'));
                await post();
                return 'Currency updated.';
            },
            formatMessage: () => '',
            shouldRegister: guard,
        },
        {
            name: 'glp_quest_update',
            displayName: 'Update Quest',
            description: 'Update a quest\'s status or complete an objective.' + onceNote,
            parameters: {
                $schema: 'http://json-schema.org/draft-04/schema#',
                type: 'object',
                properties: {
                    name:      { type: 'string', description: 'Quest title' },
                    status:    { type: 'string', description: 'New status (e.g. Active, Completed, Failed)' },
                    objective: { type: 'string', description: 'Objective key to mark complete, e.g. objective_1' },
                },
                required: ['name'],
            },
            action: async (args) => {
                const a = args || {};
                const lines = [`name: ${a.name}`];
                if (a.status) lines.push(`status: ${a.status}`);
                if (a.objective) lines.push(`${a.objective}: complete`);
                await applyQuestUpdate(lines.join('\n'), getSettings());
                await post();
                return `Quest "${a.name}" updated.`;
            },
            formatMessage: () => '',
            shouldRegister: guard,
        },
        {
            name: 'glp_reputation_update',
            displayName: 'Update Reputation',
            description: 'Change the party\'s standing with a faction.' + onceNote,
            parameters: {
                $schema: 'http://json-schema.org/draft-04/schema#',
                type: 'object',
                properties: {
                    faction: { type: 'string', description: 'Faction name' },
                    change:  { type: 'string', description: 'Signed delta, e.g. +20 or -10' },
                    reason:  { type: 'string', description: 'Why the standing changed' },
                },
                required: ['faction', 'change'],
            },
            action: async (args) => {
                const a = args || {};
                await applyReputationUpdate(`faction: ${a.faction}\nchange: ${a.change}\nreason: ${a.reason || ''}`, getSettings());
                await post();
                return `Reputation with ${a.faction} updated.`;
            },
            formatMessage: () => '',
            shouldRegister: guard,
        },
    ];
}

/** Register GLP block tools (idempotent — unregisters first). No-op if the host lacks the API. */
function registerGlpTools() {
    const ctx = SillyTavern.getContext();
    if (typeof ctx.registerFunctionTool !== 'function') return;
    unregisterGlpTools();
    const names = [];
    for (const def of glpToolDefs()) {
        try { ctx.registerFunctionTool(def); names.push(def.name); }
        catch (e) { console.warn(`[${MODULE_NAME}] registerFunctionTool failed for ${def.name}:`, e); }
    }
    window.__glpToolNames = names;
}

function unregisterGlpTools() {
    const ctx = SillyTavern.getContext();
    if (typeof ctx.unregisterFunctionTool !== 'function') return;
    for (const name of (window.__glpToolNames || [])) {
        try { ctx.unregisterFunctionTool(name); } catch (e) { /* ignore */ }
    }
    window.__glpToolNames = [];
}

/** Register or tear down based on the current setting. Safe to call repeatedly. */
function syncGlpTools() {
    if (getSettings().useFunctionTools) registerGlpTools();
    else unregisterGlpTools();
}
