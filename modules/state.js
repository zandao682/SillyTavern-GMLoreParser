/**
 * gm-lore-parser / modules/state.js
 * Block registries, constants, settings defaults, state accessors.
 */

// ── Block registries ─────────────────────────────────────────────────────────

var MUTABILITY = Object.freeze({
    IMMUTABLE:   'immutable',
    GM_MUTABLE:  'gm_mutable',
    GM_EVENT:    'gm_event',
    USE_TRACKED: 'use_tracked',
});

var DEFAULT_TIER_NAMES = [
    'Novice', 'Apprentice', 'Adept', 'Expert',
    'Master', 'Grandmaster', 'Saint', 'God',
];

var RANK_LADDER = ['F', 'E', 'D', 'C', 'B', 'A', 'S', 'SS', 'SSS'];

var LORE_BLOCKS = {
    LOCATION: { begin: '[LOCATION_BEGIN]', end: '[LOCATION_END]', label: 'Location' },
    FACTION:  { begin: '[FACTION_BEGIN]',  end: '[FACTION_END]',  label: 'Faction'  },
    ITEM:     { begin: '[ITEM_BEGIN]',     end: '[ITEM_END]',     label: 'Item'     },
    RULE:     { begin: '[RULE_BEGIN]',     end: '[RULE_END]',     label: 'Rule'     },
    EVENT:    { begin: '[EVENT_BEGIN]',    end: '[EVENT_END]',    label: 'Event'    },
    QUEST:    { begin: '[QUEST_BEGIN]',    end: '[QUEST_END]',    label: 'Quest'    },
};

var UPDATE_BLOCKS = {
    ITEM_UPDATE:        { begin: '[ITEM_UPDATE_BEGIN]',        end: '[ITEM_UPDATE_END]'        },
    QUEST_UPDATE:       { begin: '[QUEST_UPDATE_BEGIN]',       end: '[QUEST_UPDATE_END]'       },
    FACTION_UPDATE:     { begin: '[FACTION_UPDATE_BEGIN]',     end: '[FACTION_UPDATE_END]'     },
    WORLD_EVENT_UPDATE: { begin: '[WORLD_EVENT_UPDATE_BEGIN]', end: '[WORLD_EVENT_UPDATE_END]' },
    LOCATION_MEMORY:    { begin: '[LOCATION_MEMORY_BEGIN]',    end: '[LOCATION_MEMORY_END]'    },
};

var SHEET_BLOCKS = {
    // ── Unified entities (player / npc / companion / creature) ──────────────────
    ENTITY:        { begin: '[ENTITY_BEGIN]',        end: '[ENTITY_END]'        },
    ENTITY_UPDATE: { begin: '[ENTITY_UPDATE_BEGIN]', end: '[ENTITY_UPDATE_END]' },
    ENTITY_EVENT:  { begin: '[ENTITY_EVENT_BEGIN]',  end: '[ENTITY_EVENT_END]'  },
    ENTITY_MEMORY: { begin: '[ENTITY_MEMORY_BEGIN]', end: '[ENTITY_MEMORY_END]' },
    // ── Capabilities (boon/title/passive/trait/evolution/skill — static or progressing) ──
    CAPABILITY:        { begin: '[CAPABILITY_BEGIN]',        end: '[CAPABILITY_END]'        },
    CAPABILITY_UPDATE: { begin: '[CAPABILITY_UPDATE_BEGIN]', end: '[CAPABILITY_UPDATE_END]' },
    WORLD_TIME:        { begin: '[WORLD_TIME_BEGIN]',        end: '[WORLD_TIME_END]'        },
    DOMAIN_UPDATE:     { begin: '[DOMAIN_UPDATE_BEGIN]',     end: '[DOMAIN_UPDATE_END]'     },
    REPUTATION_UPDATE: { begin: '[REPUTATION_UPDATE_BEGIN]', end: '[REPUTATION_UPDATE_END]' },
    WORLD_EVENT:       { begin: '[WORLD_EVENT_BEGIN]',       end: '[WORLD_EVENT_END]'       },
    PLOT_ENTRY:        { begin: '[PLOT_ENTRY_BEGIN]',        end: '[PLOT_ENTRY_END]'        },
    CURRENCY_UPDATE:   { begin: '[CURRENCY_UPDATE_BEGIN]',   end: '[CURRENCY_UPDATE_END]'   },
    RANK_CHANGE:       { begin: '[RANK_CHANGE_BEGIN]',       end: '[RANK_CHANGE_END]'       },
    XP_AWARD:          { begin: '[XP_AWARD_BEGIN]',          end: '[XP_AWARD_END]'          },
    COMMAND_RESPONSE:  { begin: '[COMMAND_RESPONSE_BEGIN]',  end: '[COMMAND_RESPONSE_END]'  },
    CARD_OUTPUT:       { begin: '[CARD_OUTPUT_BEGIN]',       end: '[CARD_OUTPUT_END]'       },
    // ── Chunked card assembly (build a produced GM card across messages) ────────
    CARD_BEGIN:      { begin: '[CARD_BEGIN]',            end: '[CARD_END]'            },
    CARD_FIELD:      { begin: '[CARD_FIELD_BEGIN]',      end: '[CARD_FIELD_END]'      },
    CARD_BOOK_ENTRY: { begin: '[CARD_BOOK_ENTRY_BEGIN]', end: '[CARD_BOOK_ENTRY_END]' },
    CARD_FINALIZE:   { begin: '[CARD_FINALIZE_BEGIN]',   end: '[CARD_FINALIZE_END]'   },
    // ── Character creation session ────────────────────────────────────────────
    CHAR_CREATE_BEGIN:    { begin: '[CHAR_CREATE_BEGIN]',    end: '[CHAR_CREATE_END]'    },
    CHAR_CREATE_STEP:     { begin: '[CHAR_CREATE_STEP_BEGIN]', end: '[CHAR_CREATE_STEP_END]' },
    CHAR_CREATE_FINALIZE: { begin: '[CHAR_CREATE_FINALIZE_BEGIN]', end: '[CHAR_CREATE_FINALIZE_END]' },
    // ── Party & scene rosters (who travels with the player / who is present) ────
    PARTY_UPDATE: { begin: '[PARTY_UPDATE_BEGIN]', end: '[PARTY_UPDATE_END]' },
    SCENE_UPDATE: { begin: '[SCENE_UPDATE_BEGIN]', end: '[SCENE_UPDATE_END]' },
    // ── Narrative header (merged from gm-narrative-header) ──────────────────────
    HEADER_FORMAT: { begin: '[HEADER_FORMAT_BEGIN]', end: '[HEADER_FORMAT_END]' },
    // ── Life simulation ───────────────────────────────────────────────────────
    NEEDS_SYSTEM: { begin: '[NEEDS_SYSTEM_BEGIN]', end: '[NEEDS_SYSTEM_END]' },
    NEEDS_UPDATE: { begin: '[NEEDS_UPDATE_BEGIN]', end: '[NEEDS_UPDATE_END]' },
    // ── Possessions ─────────────────────────────────────────────────────────────
    ITEM_BOX_UPDATE: { begin: '[ITEM_BOX_UPDATE_BEGIN]', end: '[ITEM_BOX_UPDATE_END]' },
    // ── System definition (ruleset) ─────────────────────────────────────────────
    SYSTEM_DEF:   { begin: '[SYSTEM_DEF_BEGIN]',   end: '[SYSTEM_DEF_END]'   },
};

// Fields that carry metadata about the lorebook entry itself (not game data)
var LORE_META     = new Set(['name','keywords','trigger_keywords','dynamic_fields','mutable_fields']);
// Fields the extension owns — never touched by GM update blocks
var SYS_PROTECTED = new Set(['name','class','background','schema','schema_version']);

var ITEM_CONDITIONS = [
    { label:'Pristine', min:90 }, { label:'Good',    min:70 },
    { label:'Worn',     min:50 }, { label:'Damaged', min:25 },
    { label:'Broken',   min:0  },
];

// ── Defaults ─────────────────────────────────────────────────────────────────

var DEFAULT_SETTINGS = Object.freeze({
    enabled: true, campaignLorebook: '', hideBlocks: true,
    scanUserMessages: false, notifyOnSave: true,
    ruleOrder: 50, loreOrder: 100, defaultScanDepth: 4,
    showStatusPanel: true, injectIntoContext: true, contextDepth: 1,
    showSkillPanel: true, showDomainPanel: true,
    showQuestPanel: true, showRepPanel: true,
    showEventsPanel: true, showCurrencyPanel: true,
    showBoonPanel: true, showNeedsPanel: true,
    interceptCommands: true, plotLorebook: '',
    injectResolution: true,
    tieredContext: true,      // lean always-on core + keyword-triggered [Player:*] detail (off = legacy monolithic injection)
    pinPanel: false,          // keep the GM State drawer locked open
    showPartyPanel: true, showScenePanel: true,
    // ── Narrative header (merged from gm-narrative-header) ──────────────────
    headerEnabled: true, headerUseFormatBlock: true, headerManualFormat: '',
    headerSeparator: '---', headerShowOnEveryMsg: true,
    // ── 0.0.17 additions ─────────────────────────────────────────────────────
    enrichMemories: false,     // summarize the recent scene into [Memory] bodies (quiet-prompt)
    enrichMemoryWindow: 10,    // trailing chat messages fed to the memory summarizer
    useFunctionTools: false,   // register block tools on chat-completion backends (inert on text-completion)
    // ── 0.0.19 additions — autonomous memory capture ───────────────────────────
    // Auto-create [Memory] entries from the transcript even when the model emits no
    // [ENTITY_MEMORY]/[LOCATION_MEMORY] block. Master switch + per-trigger flags; all
    // default OFF so the text-completion path is unchanged unless opted in. Each auto
    // memory is a personaless side-generation (reuses the enrichment summarizer) and
    // writes NOTHING on failure (no terse stub). Marked extensions.auto:true.
    autoMemory: false,              // master enable (all triggers below are no-ops when off)
    autoMemoryOnSceneExit: true,    // when a named subject leaves the scene → episodic memory of their time on-screen
    autoMemoryOnLocationChange: true, // when the scene location changes → episodic memory for the previous location
    autoMemoryPeriodic: false,      // every N GM turns → episodic memory of the current scene
    autoMemoryEveryNMessages: 20,   // cadence for the periodic trigger
    autoMemoryOnChatAway: true,     // on chat change → flush a memory for still-present subjects
    autoMemoryMinMessages: 4,       // skip a trigger unless ≥ this many messages accrued in the window
});

var DEFAULT_CHAR_STATE = Object.freeze({
    name: '', class_: '', background: '',
    schema: { fields: {}, groups: [] },
    values: {},
    world_time: { display: '', elapsed_minutes: 0 },
    attr_change_log: [],
    capabilities: {},     // id → unified capability record (see modules/capabilities.js)
    domains: {},
    // ── v3 additions ──────────────────────────────────────────────────────
    quests: {},           // slug → { title, rank, category, status, objectives[], rewards, notes, history[] }
    factions: {},         // slug → { name, type, goals, leadership, resources, attitude_to_party, keywords[], notes, history[] }
    reputation: {},       // slug → { name, standing, tier, tier_labels[], history[] }
    world_events: [],     // [{ id, title, date, location, description, consequences, status, resolution }]
    currency: {},         // denomination → amount   e.g. { copper: 0, silver: 0, gold: 0 }
    companions: {},       // slug → { name, type, control_cost, loyalty, status, notes, ap_unspent, ap_total, attributes, role }
    party: {},            // slug → { slug, name, role, note, ref }  — lightweight roster (who travels with the player)
    scene: {},            // slug → { slug, name, role, note, ref }  — who is present in the current scene
    scene_location: '',   // optional current-scene location label
    adventurer_rank: { rank: 'F', rank_ladder: null, quest_count: 0, history: [] },
    // ── v4 additions ──────────────────────────────────────────────────────
    needs: {},            // meter_name → { value, max, label, warn_threshold, critical_threshold }
    char_creation: {      // interactive creation session
        active: false,
        steps_completed: [],
        draft: {},
    },
    // ── v5 additions ──────────────────────────────────────────────────────
    system_def: null,     // active ruleset (see modules/system.js); null → DEFAULT_SYSTEM_DEF
    equipment: {},        // slot_key → item name   (see modules/inventory.js)
    item_box: [],         // [{ item, condition }]  optional extradimensional container
    // ── v7 additions ──────────────────────────────────────────────────────
    header_format: '',    // captured [HEADER_FORMAT] template (merged narrative header)
    // ── v8 additions ──────────────────────────────────────────────────────
    card_draft: {         // chunked produced-card assembly (Architect Stage 9)
        active: false,
        name: '',
        data: {},         // accumulated chara_card_v2 data fields (system_prompt, first_mes, …)
        book_entries: [], // accumulated character_book entries
    },
    schema_version: 8,
});

// ── State accessors ───────────────────────────────────────────────────────────

function getSettings() {
    const { extensionSettings } = SillyTavern.getContext();
    if (!extensionSettings[MODULE_NAME])
        extensionSettings[MODULE_NAME] = structuredClone(DEFAULT_SETTINGS);
    for (const [k, v] of Object.entries(DEFAULT_SETTINGS))
        if (!Object.hasOwn(extensionSettings[MODULE_NAME], k))
            extensionSettings[MODULE_NAME][k] = v;
    return extensionSettings[MODULE_NAME];
}

function getCharState() {
    const { chatMetadata } = SillyTavern.getContext();
    if (!chatMetadata[MODULE_NAME])
        chatMetadata[MODULE_NAME] = structuredClone(DEFAULT_CHAR_STATE);
    const s = chatMetadata[MODULE_NAME];
    if (!s.schema)          s.schema          = structuredClone(DEFAULT_CHAR_STATE.schema);
    if (!s.values)          s.values          = {};
    if (!s.world_time)      s.world_time      = structuredClone(DEFAULT_CHAR_STATE.world_time);
    if (!s.attr_change_log) s.attr_change_log = [];
    if (!s.domains)          s.domains          = {};
    if (!s.quests)           s.quests           = {};
    if (!s.factions)         s.factions         = {};
    if (!s.reputation)       s.reputation       = {};
    if (!s.world_events)     s.world_events     = [];
    if (!s.currency)         s.currency         = {};
    if (!s.companions)       s.companions       = {};
    if (!s.adventurer_rank)  s.adventurer_rank  = structuredClone(DEFAULT_CHAR_STATE.adventurer_rank);
    if (!s.needs)            s.needs            = {};
    if (!s.char_creation)    s.char_creation    = structuredClone(DEFAULT_CHAR_STATE.char_creation);
    if (s.system_def === undefined) s.system_def = null;
    if (!s.equipment) s.equipment = {};
    if (!s.item_box)  s.item_box  = [];
    if (!s.capabilities) s.capabilities = {};
    if (!s.party)  s.party  = {};
    if (!s.scene)  s.scene  = {};
    if (s.scene_location === undefined) s.scene_location = '';
    if (s.header_format === undefined)  s.header_format  = '';
    if (!s.card_draft) s.card_draft = structuredClone(DEFAULT_CHAR_STATE.card_draft);
    if (!s.schema_version || s.schema_version < 8) s.schema_version = 8;
    return s;
}

// Durability: state is written into the chat JSONL immediately on each call (awaited,
// not debounced). The dirty flag + flushCharStateIfDirty() (wired to pagehide /
// visibilitychange in index.js) cover the narrow window of an interrupted in-flight
// save; the debounced backstop re-flushes a save that ST skipped under save-contention.
async function saveCharState() {
    window.__glpStateDirty = true;
    try {
        await SillyTavern.getContext().saveMetadata();
        window.__glpStateDirty = false;
    } catch (e) {
        console.warn(`[${MODULE_NAME}] saveCharState failed (will retry via backstop):`, e);
    }
    try { SillyTavern.getContext().saveChatDebounced?.(); } catch { /* optional API */ }
}

/** Best-effort flush of unsaved state on tab hide/close (only fires if dirty). */
async function flushCharStateIfDirty() {
    if (!window.__glpStateDirty) return;
    try { await SillyTavern.getContext().saveMetadata(); window.__glpStateDirty = false; } catch { /* best effort */ }
}
