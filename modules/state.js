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
};

var SHEET_BLOCKS = {
    // ── Unified entities (player / npc / companion / creature) ──────────────────
    ENTITY:        { begin: '[ENTITY_BEGIN]',        end: '[ENTITY_END]'        },
    ENTITY_UPDATE: { begin: '[ENTITY_UPDATE_BEGIN]', end: '[ENTITY_UPDATE_END]' },
    ENTITY_EVENT:  { begin: '[ENTITY_EVENT_BEGIN]',  end: '[ENTITY_EVENT_END]'  },
    ENTITY_MEMORY: { begin: '[ENTITY_MEMORY_BEGIN]', end: '[ENTITY_MEMORY_END]' },
    // ── Abilities (boon / title / passive / trait / evolution) ──────────────────
    ABILITY:           { begin: '[ABILITY_BEGIN]',          end: '[ABILITY_END]'           },
    WORLD_TIME:        { begin: '[WORLD_TIME_BEGIN]',        end: '[WORLD_TIME_END]'        },
    SKILL_UPDATE:      { begin: '[SKILL_UPDATE_BEGIN]',      end: '[SKILL_UPDATE_END]'      },
    SKILL_SYSTEM:      { begin: '[SKILL_SYSTEM_BEGIN]',      end: '[SKILL_SYSTEM_END]'      },
    DOMAIN_UPDATE:     { begin: '[DOMAIN_UPDATE_BEGIN]',     end: '[DOMAIN_UPDATE_END]'     },
    REPUTATION_UPDATE: { begin: '[REPUTATION_UPDATE_BEGIN]', end: '[REPUTATION_UPDATE_END]' },
    WORLD_EVENT:       { begin: '[WORLD_EVENT_BEGIN]',       end: '[WORLD_EVENT_END]'       },
    PLOT_ENTRY:        { begin: '[PLOT_ENTRY_BEGIN]',        end: '[PLOT_ENTRY_END]'        },
    CURRENCY_UPDATE:   { begin: '[CURRENCY_UPDATE_BEGIN]',   end: '[CURRENCY_UPDATE_END]'   },
    RANK_CHANGE:       { begin: '[RANK_CHANGE_BEGIN]',       end: '[RANK_CHANGE_END]'       },
    XP_AWARD:          { begin: '[XP_AWARD_BEGIN]',          end: '[XP_AWARD_END]'          },
    COMMAND_RESPONSE:  { begin: '[COMMAND_RESPONSE_BEGIN]',  end: '[COMMAND_RESPONSE_END]'  },
    CARD_OUTPUT:       { begin: '[CARD_OUTPUT_BEGIN]',       end: '[CARD_OUTPUT_END]'       },
    // ── Character creation session ────────────────────────────────────────────
    CHAR_CREATE_BEGIN:    { begin: '[CHAR_CREATE_BEGIN]',    end: '[CHAR_CREATE_END]'    },
    CHAR_CREATE_STEP:     { begin: '[CHAR_CREATE_STEP_BEGIN]', end: '[CHAR_CREATE_STEP_END]' },
    CHAR_CREATE_FINALIZE: { begin: '[CHAR_CREATE_FINALIZE_BEGIN]', end: '[CHAR_CREATE_FINALIZE_END]' },
    // ── Life simulation ───────────────────────────────────────────────────────
    NEEDS_SYSTEM: { begin: '[NEEDS_SYSTEM_BEGIN]', end: '[NEEDS_SYSTEM_END]' },
    NEEDS_UPDATE: { begin: '[NEEDS_UPDATE_BEGIN]', end: '[NEEDS_UPDATE_END]' },
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
    // ── v3 additions ──────────────────────────────────────────────────────
    quests: {},           // slug → { title, rank, category, status, objectives[], rewards, notes, history[] }
    factions: {},         // slug → { name, type, goals, leadership, resources, attitude_to_party, keywords[], notes, history[] }
    reputation: {},       // slug → { name, standing, tier, tier_labels[], history[] }
    world_events: [],     // [{ id, title, date, location, description, consequences, status, resolution }]
    currency: {},         // denomination → amount   e.g. { copper: 0, silver: 0, gold: 0 }
    companions: {},       // slug → { name, type, control_cost, loyalty, status, notes, ap_unspent, ap_total, attributes, role }
    adventurer_rank: { rank: 'F', rank_ladder: null, quest_count: 0, history: [] },
    // ── v4 additions ──────────────────────────────────────────────────────
    abilities: [],        // [{ id, name, category, activation, description, effects, entity_slug, active, stat_changes, keywords[] }]
    needs: {},            // meter_name → { value, max, label, warn_threshold, critical_threshold }
    char_creation: {      // interactive creation session
        active: false,
        steps_completed: [],
        draft: {},
    },
    // ── v5 additions ──────────────────────────────────────────────────────
    system_def: null,     // active ruleset (see modules/system.js); null → DEFAULT_SYSTEM_DEF
    schema_version: 5,
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
    if (!s.skill_system)     s.skill_system     = structuredClone(DEFAULT_CHAR_STATE.skill_system);
    if (!s.domains)          s.domains          = {};
    // v3 migration
    if (!s.quests)           s.quests           = {};
    if (!s.factions)         s.factions         = {};
    if (!s.reputation)       s.reputation       = {};
    if (!s.world_events)     s.world_events     = [];
    if (!s.currency)         s.currency         = {};
    if (!s.companions)       s.companions       = {};
    if (!s.adventurer_rank)  s.adventurer_rank  = structuredClone(DEFAULT_CHAR_STATE.adventurer_rank);
    // v4 migration
    if (!s.abilities)        s.abilities        = [];
    if (!s.needs)            s.needs            = {};
    if (!s.char_creation)    s.char_creation    = structuredClone(DEFAULT_CHAR_STATE.char_creation);
    // per-companion v4 fields
    for (const c of Object.values(s.companions || {})) {
        if (c.ap_unspent  === undefined) c.ap_unspent  = 0;
        if (c.ap_total    === undefined) c.ap_total    = 0;
        if (!c.attributes)               c.attributes  = {};
        if (!c.role)                     c.role        = 'standard';
    }
    // v5 migration
    if (s.system_def === undefined) s.system_def = null;
    if (!s.abilities) s.abilities = [];
    // Fold any pre-v5 boons/titles into the unified abilities list
    for (const b of (s.boons || []))
        s.abilities.push({ id: `boon:player:${(b.name||'').toLowerCase().replace(/\s+/g,'-')}`, name: b.name, category: 'boon',
            activation: b.activation || 'always', description: b.description || '', effects: b.effects || '',
            entity_slug: 'player', active: true, stat_changes: '', keywords: b.keywords || [b.name] });
    for (const t of (s.titles || []))
        s.abilities.push({ id: `title:player:${(t.name||'').toLowerCase().replace(/\s+/g,'-')}`, name: t.name, category: 'title',
            activation: 'always', description: t.description || '', effects: '', entity_slug: 'player',
            active: !!t.active, stat_changes: '', keywords: t.keywords || [t.name] });
    delete s.boons; delete s.titles;
    if (!s.schema_version || s.schema_version < 5) s.schema_version = 5;
    return s;
}

async function saveCharState() {
    await SillyTavern.getContext().saveMetadata();
}
