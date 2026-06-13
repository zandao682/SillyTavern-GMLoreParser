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
    NPC:      { begin: '[NPC_BEGIN]',      end: '[NPC_END]',      label: 'NPC'      },
    LOCATION: { begin: '[LOCATION_BEGIN]', end: '[LOCATION_END]', label: 'Location' },
    FACTION:  { begin: '[FACTION_BEGIN]',  end: '[FACTION_END]',  label: 'Faction'  },
    ITEM:     { begin: '[ITEM_BEGIN]',     end: '[ITEM_END]',     label: 'Item'     },
    BESTIARY: { begin: '[BESTIARY_BEGIN]', end: '[BESTIARY_END]', label: 'Bestiary' },
    RULE:     { begin: '[RULE_BEGIN]',     end: '[RULE_END]',     label: 'Rule'     },
    EVENT:    { begin: '[EVENT_BEGIN]',    end: '[EVENT_END]',    label: 'Event'    },
};

var UPDATE_BLOCKS = {
    NPC_UPDATE:      { begin: '[NPC_UPDATE_BEGIN]',      end: '[NPC_UPDATE_END]'      },
    NPC_ATTR_CHANGE: { begin: '[NPC_ATTR_CHANGE_BEGIN]', end: '[NPC_ATTR_CHANGE_END]' },
    NPC_MEMORY:      { begin: '[NPC_MEMORY_BEGIN]',      end: '[NPC_MEMORY_END]'      },
    ITEM_UPDATE:     { begin: '[ITEM_UPDATE_BEGIN]',     end: '[ITEM_UPDATE_END]'     },
};

var SHEET_BLOCKS = {
    PLAYER_SHEET:    { begin: '[PLAYER_SHEET_BEGIN]',    end: '[PLAYER_SHEET_END]'    },
    PLAYER_UPDATE:   { begin: '[PLAYER_UPDATE_BEGIN]',   end: '[PLAYER_UPDATE_END]'   },
    ATTR_CHANGE:     { begin: '[ATTR_CHANGE_BEGIN]',     end: '[ATTR_CHANGE_END]'     },
    WORLD_TIME:      { begin: '[WORLD_TIME_BEGIN]',      end: '[WORLD_TIME_END]'      },
    SKILL_UPDATE:    { begin: '[SKILL_UPDATE_BEGIN]',    end: '[SKILL_UPDATE_END]'    },
    SKILL_SYSTEM:    { begin: '[SKILL_SYSTEM_BEGIN]',    end: '[SKILL_SYSTEM_END]'    },
    DOMAIN_UPDATE:   { begin: '[DOMAIN_UPDATE_BEGIN]',   end: '[DOMAIN_UPDATE_END]'   },
    COMMAND_RESPONSE:{ begin: '[COMMAND_RESPONSE_BEGIN]',end: '[COMMAND_RESPONSE_END]'},
    CARD_OUTPUT:     { begin: '[CARD_OUTPUT_BEGIN]',     end: '[CARD_OUTPUT_END]'     },
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
    interceptCommands: true,
});

var DEFAULT_CHAR_STATE = Object.freeze({
    name: '', class_: '', background: '',
    schema: { fields: {}, groups: [] },
    values: {},
    world_time: { display: '', elapsed_minutes: 0 },
    attr_change_log: [],
    skill_system: {
        mode: 'use_tracked',
        tier_names: null,
        levels_per_tier: 10,
        pp_per_level_formula: '100 * tier_rank',
        score_formula: '10 + total_levels * 2.5',
        skills: {},
        branch_unlocks: [],
    },
    domains: {},
    schema_version: 2,
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
    if (!s.skill_system)    s.skill_system    = structuredClone(DEFAULT_CHAR_STATE.skill_system);
    if (!s.domains)         s.domains         = {};
    return s;
}

async function saveCharState() {
    await SillyTavern.getContext().saveMetadata();
}
