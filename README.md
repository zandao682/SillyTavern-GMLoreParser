# GM Lore Parser

A SillyTavern extension that automates campaign record-keeping for AI-run tabletop RPGs. The GM (or the Architect that designs a game) emits structured blocks at the end of messages; the extension parses them and maintains the ruleset, character/NPC/companion state, lorebooks, capabilities, world time, and more — automatically.

**Version:** 0.0.20 (beta)
**Requires:** SillyTavern 1.12.0+

It is system-agnostic: a single `[SYSTEM_DEF]` block defines the ruleset (which subsystems exist, attributes, derived-stat formulas, progression model, optional classes, reputation/skill/needs settings, conflict resolution, and more). Player, NPC, Companion, and Creature share one stat-block engine via the unified `[ENTITY]` family; Boons/Titles/Passives/Evolution/Skills are one `[CAPABILITY]` concept with configurable progression. Levels, XP, classes, capabilities, reputation, needs, and the other subsystems are all opt-in — a classless, levelless, skill-based system is fully supported.

---

## Module architecture

The extension is a single entry point (`index.js`) that loads `modules/` in order:

```
state · utils · telemetry · lorebook · system · schema · entity · scene ·
progression · inventory · capabilities · domain · lore · sheet · creation ·
quests · reputation · events · currency · needs · header ·
commands · panel · context · tools
```

Companions (loyalty / control / AP / legion) are a `type:` of the unified engine in `entity.js`; party/scene rosters live in `scene.js`; rank ladders + XP in `progression.js`; equipment slots / inventory model / item box in `inventory.js`; `currency.js` is pure wealth; the in-narrative status header is `header.js` (merged from the former standalone `gm-narrative-header` extension).

To add a block type: register its tags in `modules/state.js`, write a handler in the relevant module, and dispatch it in `index.js` `onMessageReceived`.

---

## Installation

Copy this folder into:
```
data/<your-user>/extensions/third-party/gm-lore-parser
```
Restart SillyTavern. Settings appear under **Extensions → GM Lore Parser**.

---

## Campaign setup

1. Create a dedicated lorebook in **World Info** (e.g. `campaign-ironveil`).
2. Link it to the GM card and to the active chat, and select it as **Campaign Lorebook** in extension settings.
3. At the start of a campaign, the GM emits a `[SYSTEM_DEF]` block (written to the campaign lorebook as a constant `[System Definition]` entry).
4. Begin character creation in-chat (the GM emits `[CHAR_CREATE_BEGIN]` … `[CHAR_CREATE_FINALIZE]`), or provide a player `[ENTITY type:player]` block directly.

The system definition is cached per chat and re-hydrated from the lorebook on chat load, so it is portable and survives reloads.

---

## The System Definition

```
[SYSTEM_DEF_BEGIN]
name: Veridia

features: capabilities, ranks, reputation, currency, needs, companions, party, scene, domains, quests, world_events

identity:
  class | Class
  background | Background

progression:
  levels: true
  level_field: level
  level_start: 1
  xp: true
  xp_field: xp
  leveling: xp           # xp | milestone | none

creation:
  method: point_buy      # point_buy | array | freeform
  ap_pool: 100

classes:
  enabled: true
  option: Spellblade | class
    description: A warrior-mage hybrid
    attribute_mods: intellect:+5, might:+2
    grants_skills: Swordsmanship, Arcane Theory
    grants_abilities: Mana Font

attributes:
  fortitude | Fortitude | FOR | Physical toughness, health, and endurance.
  might | Might | MGT | Raw physical power — melee force and feats of strength.
  intellect | Intellect | INT | Reasoning, knowledge, and arcane aptitude.
  resolve | Resolve | RES | Willpower and mental fortitude.
  agility | Agility | AGI | Speed, balance, and finesse.

derived:
  hp = (fortitude*5)+(might*2)+(level*10) -> hp, hp_max
  mp = (intellect*3)+(resolve*3)+(level*5) -> mp, mp_max
  vigor = (might*3)+(agility*3)+(level*5) -> vigor, vigor_max

variables:
  level | 1

reputation:
  scale: 0-100
  initial: 50
  tiers: Hostile, Cold, Neutral, Friendly, Allied, Sworn

capabilities:
  categories: boon, title, passive, trait, evolution, skill
  default_category: boon
  exclusive_category: title
  category_progression: skill:veridia_pp
  inspect_capability: awareness
  require_granted: false
progressions:
  profile: veridia_pp | points_tiers
    tier_names: Novice, Apprentice, Adept, Expert, Master, Grandmaster, Saint, God
    levels_per_tier: 10
    cost_formula: 100 * tier_rank
    score_formula: 10 + total_levels * 2.5
  profile: simple_level | counter
    score_formula: skill_level

rank_ladder: F, E, D, C, B, A, S, SS, SSS

needs:
  warn: 30
  critical: 10

item_conditions:
  Pristine: 90
  Good: 70
  Worn: 50
  Damaged: 25
  Broken: 0

loyalty:
  scale: 0-100
  initial: 50

resolution:
  mechanic: d20 + modifier vs. DC
  difficulty: Easy 10 / Medium 15 / Hard 20 / Very Hard 25
  crit: Nat 20 success; nat 1 failure

quests:
  categories: Main, Side, Personal, Guild
  statuses: Active, Paused, Completed, Failed
world_events:
  statuses: Ongoing, Averted, Resolved
factions:
  attitudes: Unknown, Hostile, Wary, Neutral, Cordial, Allied
  default_attitude: Unknown
companions:
  roles: standard, lieutenant
  lieutenant_role: lieutenant
  statuses: Active, Inactive, Dismissed, Dead

rules:
  rule: resolution
    keywords: parry, riposte
    content: Override prose for the [System Rule] Resolution entry.

emit_directives: true                         # emit the constant [GM Directives] entry (default true)
directives:
  disable: player_agency                      # drop a built-in directive by id
  knowledge_scoping: Characters know only what they have personally seen or been told.
  custom_grit: Wounds linger; healing is slow and costs resources.

inventory:
  model: slots            # freeform | slots | weight
  capacity: 30
  unit: slots
  item_box: true
equipment:
  enabled: true
  slot: head | Head
  slot: main_hand | Main Hand
  slot: body | Body

locations:
  types: Settlement, Wilderness, Dungeon, Landmark, Instance
  create_history_lorebook: true
  instance.enabled: true
  instance.types: Solo, Party, Raid

commands:
  command: Party
    triggers: #party, #companions
    view: companions
  command: Wounds
    triggers: #wounds
    template: HP {hp}/{hp_max} — {conditions}
[SYSTEM_DEF_END]
```

**Every section is optional** and merges over the built-in defaults:

- `features:` — a comma list of the **enabled** subsystems (capabilities, ranks, reputation, currency, needs, companions, party, scene, domains, quests, world_events, equipment). Anything omitted is disabled: its blocks no-op, its panel section hides, its context injection is suppressed, and its commands drop out. Omit the whole section to keep all features on.
- `progression:` — `levels:false`/`xp:false` produce a levelless / XP-less system. `level` is exposed to formulas only when `levels:true`.
- `identity:` / `classes:` — declared identity fields (class/background/race) and an optional class catalogue (modifiers + granted skills/abilities; same shape serves races/backgrounds).
- `attributes:` / `derived:` — `key | label | abbr | description` rows (the optional 4th field is the panel hover tooltip) and `key = formula -> target[, also…]` rows, evaluated with a strict arithmetic-only whitelist (no code execution). The attribute list is the source of truth for the player's stat panel (see *Attributes are def-driven* above).
- `reputation:` / `loyalty:` — custom `scale: min-max`, `initial`, and tier names.
- `capabilities:` — the unified boon/title/passive/trait/evolution/skill primitive. `categories` (the vocabulary), `default_category`, `exclusive_category` (one active at a time, e.g. title), `category_progression` (maps a category → a profile in `progressions:`), `inspect_capability` (the capability whose tier gates `#inspect` detail; set blank for no gating), and `require_granted` (when `true`, a `[CAPABILITY_UPDATE]` targeting a capability the player doesn't have is **rejected** instead of lazy-created — so progression only applies to skills the GM has actually granted; default `false`). A capability's **category** says *what* it is; its **progression** says *how* it advances — orthogonal.
- `progressions:` — named progression profiles a capability can reference. Each `profile: <id> | <type>` with `type ∈ none | counter | use_tracked | points_tiers | xp_levels | milestone` and optional `tier_names` / `levels_per_tier` / `cost_formula` / `score_formula`. The Veridia PP/tier model is the built-in `veridia_pp` profile — author your own for other systems.
- `resolution:` — documents how checks are resolved (d20 vs DC, d100 roll-under, dice pool, 2d6+mod, …). The extension never rolls; this is injected into context so the GM resolves checks consistently. The terse mechanic line is always-on; the full difficulty table moves to the keyword-triggered `[System Rule] Resolution` entry.
- `rules:` — optional per-rule overrides for the keyword-triggered `[System Rule]` entries. Each `rule: <id>` may set `keywords:` (added to the def-derived trigger words) and `content:` (replaces the derived prose). `emit_rule_entries: false` suppresses these entries entirely.
- `directives:` / `emit_directives:` — the always-on **GM behavioral directives** (realism guardrails). Four ship by default — `knowledge_scoping` (characters know only what they witnessed or were told), `no_auto_bond` (NPC attitudes are earned, not automatic), `player_can_fail` (the resolution mechanic is honored; success isn't guaranteed), `player_agency` (the GM never decides the PC's choices). The `directives:` section overrides a directive's text by id (`knowledge_scoping: <new text>`), adds a custom one (`<custom_id>: <text>`), or drops some with `disable: id1, id2`. They are emitted as a single constant `[GM Directives]` lorebook entry (always in context); `emit_directives: false` suppresses it. The Architect also embeds them in produced GM cards when the designed system calls for it.
- **Vocabularies** — `quests`, `world_events`, `factions`, `companions`, `capabilities` let a system rename statuses/categories/roles/attitudes and their defaults.
- **Possessions** — `inventory` (model `freeform`/`slots`/`weight` + `capacity`/`unit`, plus `item_box` — a second, condition-bearing container) and `equipment` (system-defined `slot:` set, gated by `features.equipment`). `item_box` is on in the Veridia default; a system that defines an `inventory:` section without it has no box, and `[ITEM_BOX_UPDATE]` is **rejected** there (no invisible storage).
- `locations:` — location `types`, whether discovery auto-creates a per-location history lorebook, and an optional `instances` subtype (only when `instance.enabled`).
- `commands:` — reshape the `#` command set: alias/rename a built-in `view`, or add a custom command whose `template` renders `{tokens}` against character state. When present it defines the active set (plus always-on `#status`/`#vitals`/`#system`/`#help`).
- `needs:`, `item_conditions:`, `rank_ladder:` — life-sim thresholds, durability bands, rank progression.
- `presentation:` — display tuning: `bar_warn_pct` / `bar_danger_pct` (status-bar color thresholds), `max_pips` (pool pip cap), `ascii_bar_width` (`#needs` meters), `empty_label` (text for empty lists).

Death/resurrection remains GM narrative (HP→0 prose). Instances are a **location subtype**, not a separate subsystem; the item box is just an optional second inventory with item conditions.

---

## Entities — one engine for player / NPC / companion / creature

All stat-bearing actors share the schema engine. The block `type:` selects storage and follow-on rules.

### `[ENTITY_BEGIN]` — define an entity

```
[ENTITY_BEGIN]
type: player              # player | npc | companion | creature
name: Mira Ashgate
class: Rogue
background: Former Guild Enforcer

schema:
  groups: vitals, attributes, status
  field: hp
    label: HP
    type: bar
    group: vitals
    max_field: hp_max
    mutability: gm_mutable
  field: hp_max
    label: HP Max
    type: value
    mutability: gm_event
  field: fortitude
    label: FOR
    type: value
    group: attributes
    mutability: gm_event
  field: blade
    label: Blade
    type: value
    mutability: use_tracked
    uses_threshold: 5

fortitude: 10
might: 8
level: 1
blade: 0
[ENTITY_END]
```

The `schema:` section defines every field — display type, panel group, mutability, regen, use-tracking. Flat `key: value` lines after it provide starting values. Derived stats (HP/MP/… per the system definition) are computed automatically for any target field present in the schema that isn't already set.

**Attributes are def-driven.** The System Definition's `attributes:` list is the source of truth for the player's stats: any attribute the player has a value for is shown in the panel even if the entity block didn't declare a `field:` for it (it's added automatically as a `gm_event` value field under the *attributes* group). So you only need to declare schema fields for non-attribute panel elements; the attribute set comes from the def.

**Per-type follow-on behavior**
- **player** — stored in chat metadata; shown in the status panel and injected into context. No lorebook entry.
- **npc** — written to the campaign lorebook as three entries: `[NPC] name` (immutable core), `[NPC:State] name` (dynamic + gm_mutable fields), `[NPC:Progression] name` (full stat summary). Gains a per-NPC memory lorebook when it earns memories or milestones.
- **companion** — stored in chat metadata with companion meta (loyalty / control cost / role / rank / AP) plus an optional shared stat block; summarized to one lorebook entry.
- **creature** — an **immutable template** (a bestiary entry). Supports stat ranges (`hp: 18-28`) and `_per_level` scaling. NPC/creature instances can inherit a template with `from_template: <name>` (ranges collapse to midpoint, scaling applies for the instance's level).

### `[ENTITY_UPDATE_BEGIN]` — routine (GM_MUTABLE) changes

```
[ENTITY_UPDATE_BEGIN]
type: player
hp: -3
conditions: +Poisoned, -Stunned
blade_uses: +3
[ENTITY_UPDATE_END]
```

Writes only `gm_mutable` fields (and, for NPCs, declared dynamic fields). For list fields, `+`/`-` add/remove items. **Bar and pool fields (HP, stamina, MP, …) accept a relative `+N`/`-N` delta — floored at 0 and capped at their `max_field` — or a bare absolute number** (so `hp: -3` loses 3, `hp: 20` sets it to 20). Plain `value` fields are full replacement. Use-tracked skills auto-promote when their `_uses` counter crosses the threshold. For companions, this block also carries meta and AP: `loyalty`, `control_cost`, `role`, `status`, `ap_award: N`, `attribute_allocate: might:5, agility:3`.

### `[ENTITY_EVENT_BEGIN]` — milestone (GM_EVENT) changes

```
[ENTITY_EVENT_BEGIN]
type: player
reason: Level 3 — attribute growth
fortitude: 12
hp_max: 30
[ENTITY_EVENT_END]
```

Writes only `gm_event` fields and **requires** a `reason` (the block is rejected without one). Player changes are logged to `attr_change_log`; NPC changes are written as an episodic memory.

### `[ENTITY_MEMORY_BEGIN]` — memory lorebook entry

```
[ENTITY_MEMORY_BEGIN]
type: npc
name: Aldric Holt
memory_type: core            # core (constant) | episodic (keyword-triggered)
title: Why Aldric left the guard
content: He refused an order to cut down protesters and walked out.
keywords: guard, protesters
[ENTITY_MEMORY_END]
```

### Field mutability

| Mode | Writable via | Use for |
|---|---|---|
| `immutable` | nothing after creation | race, fixed origin |
| `gm_mutable` | `[ENTITY_UPDATE]` | HP, conditions, inventory, pools, XP |
| `gm_event` | `[ENTITY_EVENT]` (requires reason) | base attributes, HP max, level |
| `use_tracked` | auto-promotes when `{field}_uses` hits the threshold | skills that grow through practice |

`name` and the schema itself are always protected.

---

## Capabilities — boons, titles, passives, traits, evolution, skills

One unified primitive. **Category** = what it is (vocabulary, exclusivity, default activation); **progression** = how it advances (a profile from `progressions:`). The two are orthogonal, so a system can make titles progress or skills static.

```
[CAPABILITY_BEGIN]
name: Ember Heart
category: boon              # from def.capabilities.categories (boon|title|passive|trait|evolution|skill)
progression: none          # optional; else def.capabilities.category_progression[category]
activation: on_use         # always | on_condition | on_use
description: Ignite your blade with divine fire
effects: +2 fire damage on hit
governing: might, resolve  # attributes a progressing capability draws on
entity: <owner name>       # optional; defaults to the player
keywords: ember, fire blade
[CAPABILITY_END]
```

- **title** (the `exclusive_category`) — set `active: true` to display it; only one is active per owner at a time.
- **evolution** — `stat_changes: might:+5, resolve:+3` are applied to the owner as a logged milestone event (gm_event semantics) on declaration.
- Racial/innate `passive` capabilities are emitted during character creation in place of a free-text passives list.
- **Progressing capabilities** (e.g. the `skill` category mapped to `veridia_pp`) advance via `[CAPABILITY_UPDATE]`:

```
[CAPABILITY_UPDATE_BEGIN]
capability: Swordsmanship   # repeat for several capabilities in one block
points: 250                 # awarded toward the next level (profile-dependent)
level: 3                    # OR set an absolute level (counter / milestone profiles)
governing: agility, might
branch: Riposte             # optional branch unlock
[CAPABILITY_UPDATE_END]
```

---

## Party & Scene rosters

Two lightweight, **always-on** membership lists — separate from the companions sub-game (which tracks loyalty/control/AP). **Party** = who is travelling with the player; **Scene** = who is physically present right now, plus an optional location. They persist in chat state and are surfaced as **constant** `[Party]` / `[Scene]` lorebook entries, so the GM never loses track of the cast across large context shifts. A roster member whose name matches a companion/NPC record links to it in the status panel.

```
[PARTY_UPDATE_BEGIN]
add: Ember | healer (childhood friend)   # repeatable; role/note optional
remove: Garrick Stone
clear: true
[PARTY_UPDATE_END]

[SCENE_UPDATE_BEGIN]
location: The Broken Tankard
set: Garrick Stone | barkeep, Ember | healer   # replace the whole present-roster
enter: Marshal Vane | Iron Concord officer     # add one (alias: add)
exit: Ember                                     # remove one (alias: remove)
clear: true                                     # clear roster + location
[SCENE_UPDATE_END]
```

Entries are kept terse (names + role) because they are always in context. View them with `#party` and `#scene` / `#present` (def-reshapeable like any other command). Gated by the `party` / `scene` features (both on by default).

---

## GM behavioral directives

Realism guardrails that survive long context. Configured in the System Definition's `directives:` / `emit_directives:` sections (see above) and emitted as a single constant `[GM Directives]` lorebook entry. They keep the GM honest: NPCs know only what they've witnessed, attitudes are earned rather than automatic, the player can genuinely fail, and the GM never seizes the PC's agency. The Architect embeds the same directives in the GM cards it produces when the designed system calls for them, so they are present whether or not the lorebook entry is.

---

## Other blocks (gated by `features`)

- **Capability progression** — `[CAPABILITY_UPDATE]` awards points / sets levels and advances tiers per the capability's progression profile (from `progressions:` in the system definition).
- **Reputation & factions** — `[FACTION_BEGIN]` / `[FACTION_UPDATE]` define lore; `[REPUTATION_UPDATE]` changes standing on the system's scale/tiers. Both feed one combined lorebook entry per faction.
- **Quests** — `[QUEST_BEGIN]` / `[QUEST_UPDATE]`.
- **World** — `[WORLD_EVENT]` / `[WORLD_EVENT_UPDATE]` / `[PLOT_ENTRY]`.
- **Domain** — `[DOMAIN_UPDATE]` for a domain/base management sub-game.
- **Currency & ranks** — `[CURRENCY_UPDATE]`, `[RANK_CHANGE]`, `[XP_AWARD]`.
- **Needs / life-sim** — `[NEEDS_SYSTEM]` configures meters; `[NEEDS_UPDATE]` changes them (context injection only fires when a need is at/under its warn threshold). Needs can also be modeled as schema fields with negative `regen_rate`.
- **World time** — `[WORLD_TIME]` advances the clock and applies resource regen + use-tracked checks to the player and all schema-bearing NPCs.
- **Item** — `[ITEM_BEGIN]` / `[ITEM_UPDATE]`; condition labels derive from the system's `item_conditions`.
- **Possessions** — equip/unequip via `[ENTITY_UPDATE]` (`equip: <slot>=<item>` / `unequip: <slot>`); `[ITEM_BOX_UPDATE]` (`add: <item> | <condition>` / `remove: <item>`) for the optional item box.
- **Locations** — `[LOCATION_BEGIN]` (type/description/region, optional `instance`/`instance_type`) auto-creates a campaign-scoped `{campaign}-location-{slug}` history lorebook; `[LOCATION_MEMORY]` appends to it. `[RULE_BEGIN]`, `[EVENT_BEGIN]` are generic lore.
- **Designer** — the Architect produces a GM card. One-shot `[CARD_OUTPUT]{json}[CARD_OUTPUT_END]` downloads a complete card, but the default is **chunked assembly** so small models can build it across messages: `[CARD_BEGIN]` (open buffer, with `name:`) → `[CARD_FIELD]` (set/append a `data` field — header `key:`/`append:`, blank line, then the verbatim value; the large `system_prompt` is built with `append: true`) → `[CARD_BOOK_ENTRY]` (append a `character_book` entry — header `keys:`/`comment:`/`constant:`/`order:`, blank line, content) → `[CARD_FINALIZE]` (the extension assembles the V2 card and downloads it). The buffer lives in `card_draft`; `CARD_FIELD`/`CARD_BOOK_ENTRY`/`CARD_FINALIZE` are ignored outside an active `[CARD_BEGIN]`. The draft **persists across the whole conversation** (no reset/timeout), so the Architect builds the card **incrementally** — opening `[CARD_BEGIN]` early and emitting one section per confirmed design stage, finalizing last. **Finalize is gated**: it is refused (with a toast, draft left open) until the card has a real **name** (from `[CARD_BEGIN] name:`, or derived from the `[System Definition]` entry — never blank or the designer character's name), `system_prompt`, `first_mes`, `post_history_instructions`, and at least one non-empty `character_book` entry — so a model that finalizes early or forgets the name can't produce a broken/mis-named card. On assembly, **exact-duplicate lore entries** (same comment or same key-set, e.g. a chatty model restating the protocol entry) are de-duped, keeping the richer copy; **empty-content entries are dropped** and very short ones logged as shallow. A `[CARD_FIELD]` whose `key:` isn't a recognized chara_card_v2 `data` field (e.g. a model that splits `system_prompt` into section-named fields like `entity_protocol` while continuing) is **folded into `system_prompt`** as a titled section rather than stranded. Block parsing also **tolerates markdown code fences** (small models often wrap output in ```` ``` ````) and a **missing blank line** between a block's header and its body. These keep a noisy small-model emission assembling into a valid card. When finalize is blocked, **card-assembly auto-retry** (below) can fetch the missing blocks automatically rather than waiting for a manual nudge.
- **System definition loading** — the ruleset does not have to be emitted from the GM's `first_mes`. The extension hydrates the `[System Definition]` from (in order) the campaign lorebook entry's structured `extensions.system_def`, a `[SYSTEM_DEF]` **text block in that entry's content**, or a `[System Definition]` entry in the **active card's embedded `character_book`** ([system.js](SillyTavern/public/scripts/extensions/third-party/SillyTavern-GMLoreParser/modules/system.js) `loadSystemDefFromLorebook`). A `[HEADER_FORMAT]` block in the same content seeds the status header. So a produced GM card can carry its ruleset (and header format) in a constant `[System Definition]` lore entry and keep `first_mes` as pure in-world intro prose — the GM still *re-emitting* `[SYSTEM_DEF]` at runtime also works (self-populating).

---

## Commands

Players type `#` commands that are answered locally, without calling the model. Commands are **not a fixed list** — they are a registry of **views** (each a small renderer over character state), and the active command set is *derived per System Definition*:

- **Each view has a default trigger, a gating feature, and a help label.** The triggers below are the built-in defaults, not hardcoded commands.
- **Feature-gated** — a view whose subsystem is disabled in `features:` drops out of both the dispatcher and `#help` (e.g. no rank view when `ranks` is off). Only `status`, `vitals`, `system`, and `help` are always available.
- **Capability views are def-derived** — one view per category declared in `def.capabilities`, so its default trigger follows the category name (a `boon` category → `#boons`, a `gift` category → `#gifts`), plus `#skills` (progressing) and `#abilities` (static). Renaming or adding a category automatically yields a sensibly-named command.
- **Reshapeable via the `commands:` section** — rename/alias a view's triggers, drop one (omit it), or add a custom command whose `template` renders `{token}`s of state. When `commands:` is present it defines the active set (the four always-on views aside); `#help` is generated from it.

**Built-in views and their default triggers** (everything here is an example of the defaults, all overridable):

| View | Default trigger(s) | Shows |
|---|---|---|
| status | `#status` / `#character` | Full character sheet |
| vitals | `#vitals` | HP/MP/resources with regen rates |
| inventory | `#inventory` / `#bag` | Inventory list |
| equipment | `#equipment` | Equipped items by slot |
| itembox | `#itembox` | Item box contents |
| domain | `#domain` | Domain statistics |
| time | `#time` | Current in-world time |
| quests | `#quests` | Quest tracker |
| rep / factions | `#rep` / `#reputation`, `#factions` | Reputation standings / faction roster |
| events | `#events` | World events log |
| currency | `#currency` / `#wallet` | Wallet and denominations |
| rank | `#rank` | Guild / adventurer rank |
| companions / legion | `#companions [name]`, `#legion` / `#hierarchy` | Roster / delegation tree |
| party | `#party` | Who is travelling with the player |
| scene | `#scene` / `#present` | Who is present now (+ location) |
| capability (per category) | `#<category>s` — e.g. `#boons`, `#titles` | One view per capability category (def-derived) |
| skills / abilities | `#skills`, `#abilities` | Progressing capabilities / static capabilities |
| needs | `#needs` | Life-simulation meters |
| locations | `#locations` | Location types & info |
| inspect | `#inspect [target]` | Inspect a target; detail optionally gated by `def.capabilities.inspect_capability` |
| system | `#system` / `#ruleset` | System definition & resolution mechanic |
| help | `#help` | The active command list |

Reshape the set in the System Definition — alias a built-in view, or add a template command:

```
commands:
  command: Party
    triggers: #party, #companions      # alias/rename the built-in companions view
    view: companions
  command: Wounds
    triggers: #wounds                  # a custom command
    template: HP {hp}/{hp_max} — {conditions}
```

Template tokens include `{name}` `{class}` `{rank}` `{field}` `{field_max}` `{field_regen}` `{conditions}` `{currency}` `{active_title}` `{skill_score:Name}` and any schema/needs field.

---

## Status panel

A live, schema-driven panel renders above the chat input: identity + active title, grouped fields (bars/values/pools/lists), and collapsible sections for **scene** and **party** rosters, needs, capabilities (static + progressing), domains, quests, reputation, world events, currency, rank, companions, and equipment & inventory. During an active creation session it shows the creation step checklist instead. Disabled features and empty sections are hidden. The panel lives in a pinnable top-bar left drawer.

Styling inherits SillyTavern's active theme via its `--SmartTheme*` variables. The panel's semantic state colors (need/loyalty ok·warn·crit, condition pills, the six reputation-tier colors) are centralized as **`--glp-*` CSS variables** with the built-in values as fallbacks, so a campaign or theme can recolor any of them from SillyTavern's **Custom CSS** without touching the extension, e.g. `:root { --glp-crit: #ff3355; --glp-rep-hostile: #cc2222; }`.

---

## Narrative header

A formatted status header can be prepended to each GM message, in-narrative (merged from the former standalone `gm-narrative-header` extension — that extension is now deprecated and should be disabled, or both will double-prepend). The format is authored once via a `[HEADER_FORMAT]` block (captured per chat) or typed into settings as a manual format:

```
[HEADER_FORMAT_BEGIN]
{name} | {class} | Rank {rank}
HP {hp}/{hp_max} ({hp_regen}/min)   MP {mp}/{mp_max}
Scene: {scene}   Party: {party}
Title: {active_title}   Coin: {currency}
[HEADER_FORMAT_END]
```

Tokens resolve against the live character state. **A token with no data resolves to nothing** (never a literal `{token}`) — this applies uniformly, including empty capability/roster lists (`{boons}`, `{abilities}`, `{titles}`, `{conditions}`, `{party}`, `{scene}`): they drop their segment rather than printing an empty-label placeholder, so the header only shows what the character actually has. A line whose tokens *all* resolve empty is dropped, and leftover artifacts (orphan `/`, empty `()`, stray separators) are tidied — so one-stat-per-line formats hide cleanly.

| Token | Resolves to |
|---|---|
| `{name}` `{class}` `{background}` `{rank}` | Identity fields |
| `{time}` / `{date}` | Current in-world time |
| `{conditions}` | Active conditions (or the empty label) |
| `{inventory_count}` `{inventory_max}` | Inventory size / capacity |
| `{active_title}` `{titles}` `{boons}` `{abilities}` | Capabilities by category |
| `{party}` `{scene}` | Roster member names |
| `{currency}` `{currency:gold}` | Wallet summary / one denomination |
| `{reputation:Name}` | A faction's tier + standing |
| `{skill_score:Name}` | A progressing capability's score |
| `{xp_next}` | XP to next level |
| `{<field>}` | Any schema/needs field value |
| `{<field>_max}` `{<field>_regen}` `{<field>_pct}` | A field's max / regen-per-min / percent-of-max |

Header settings: enable/disable, prefer the `[HEADER_FORMAT]` block vs. the manual format, the separator string between header and narrative, and whether to render on every message or only when a fresh format block arrives.

The raw `[HEADER_FORMAT]` spec block **respects the Hide-blocks setting** like any other block: with hide-blocks on it's stripped (the rendered header replaces it); with hide-blocks off the raw `[HEADER_FORMAT]` block stays visible in the message below the rendered header.

---

## Context injection — tiered (lean core + on-demand detail)

The player's state reaches the GM two ways, and by default it's **tiered** so the prompt only carries what's relevant:

- **Always-on core** (injected every turn via the Author's-Note position): identity, the schema sheet (vitals/attributes/conditions/status), active title, rank, world time, and any needs below their warn threshold. This is what the GM always needs.
- **On-demand detail** (keyword-triggered lorebook entries, loaded only when the narrative references them):
  - **`[Player:Skills]`** — the full capability/skill list with tiers/levels/scores. Keys: generic skill words, the system's category names, and every capability's own name. Mention a skill ("she draws on her *Swordsmanship*") and the entry loads, so the GM can confirm the player has it and at what level before resolving the action or applying progression.
  - **`[Player:Possessions]`** — inventory, equipped gear, item box, and currency. Keys: possession/wealth words plus each item, equipped item, and denomination name.
  - **`[Player:Domains]`** — domain sub-game stats (if the `domains` feature is on).
  - **Quests, factions, and world events** are *already* keyword-triggered (`[Quest]`/`[Faction]`/`[World Event]` entries), so they're simply dropped from the always-on core rather than duplicated.

These `[Player:*]` entries are `constant:false` (keyword-triggered) and rebuild automatically whenever the relevant state changes; empty ones are pruned. **Companions** are tiered the same way — their detail surfaces via their own name-keyed entry, and presence is signalled by the constant `[Party]`/`[Scene]` rosters.

Turn this off with **Tiered context** in settings to fall back to the legacy behavior (the entire sheet injected always-on, no `[Player:*]` entries).

### Block-emission reliability — `[Block Formats]`

To help smaller models emit the protocol blocks consistently (rather than rendering a tag as a markdown heading), the extension auto-generates, from the active System Definition, copyable **verbatim block templates** in context — the same pattern that makes hand-authored reference cards reliable:

- A compact **constant `[Block Formats]`** entry with the workhorse templates (`[ENTITY_UPDATE]`, `[ENTITY_EVENT]`, `[WORLD_TIME]`) always in context as a copy target.
- A **keyword-triggered `[Block Formats: More]`** entry with templates for the *other enabled* feature-blocks (`[CAPABILITY_UPDATE]`, `[REPUTATION_UPDATE]`, `[CURRENCY_UPDATE]`, `[NEEDS_UPDATE]`, `[PARTY_UPDATE]`/`[SCENE_UPDATE]`, `[ITEM_BOX_UPDATE]`, `[QUEST_UPDATE]`, `[RANK_CHANGE]`, `[ENTITY_MEMORY]`, …), surfaced on emission-intent keywords.

Both are feature-gated (only enabled blocks appear) and rebuilt whenever the def loads/changes. Separately, on the parsing side the extension **tolerates malformed block tags**: a tag wrapped in markdown (`## [ENTITY_UPDATE_BEGIN]`, `**[ENTITY_UPDATE_END]**`) is normalized back to the bare tag, and an **XML-style closer** — a small model ending a block with `[/SCENE_UPDATE_BEGIN]` (or `[/SCENE_UPDATE_END]`) instead of the required `[SCENE_UPDATE_END]` — is rewritten to the proper `_END` tag, so the block still extracts. (This one matters: a wrong closer silently drops the *entire* block, so it commonly broke party/scene updates.)

### Optional 2nd-pass state extractor (dual-model)

By default GLP is **single-model**: the GM emits `[...]` blocks inside its own reply and the extension parses them. A forceful immersive System Prompt can pull a small model toward pure prose, though — it narrates and drops the blocks, so state stops updating. The **state extractor** is an opt-in second pass that fixes this: after the GM's message, a **personaless side-generation** reads the narration + the current state and emits the update blocks the prose implies, which then flow through the **same handlers** as a directly-emitted block. Set under **2nd-pass state extractor** in settings:

- **Off** (default) — single-model; unchanged behavior.
- **Fallback** — the extractor runs **only when the GM's own message contained no state block** (the failure case). When the GM did emit blocks the extractor is skipped, so there's no double-application.
- **Always** — the extractor runs every GM turn. Pair this with a **pure-prose narrator** (a GM told *not* to emit blocks); if the narrator still emits blocks in *always* mode both passes apply and relative deltas (e.g. `hp: -3`) double up.

**Extractor connection profile** (optional) routes the extraction pass through a chosen SillyTavern **Connection Profile** — so a cheap/fast model can do the mechanical extraction while your main model narrates. Blank uses the same model as the narrator (via `generateRaw`). The extraction prompt is assembled from the current state summary + the `[Block Formats]` cheat-sheet + the GM's latest message. Everything is opt-in and never throws — on any failure the turn proceeds as if the extractor weren't there.

### Card-assembly auto-retry

When a `[CARD_FINALIZE]` is **blocked** by the completeness gate (a missing `system_prompt`/`first_mes`/`post_history_instructions`, no lore entry, or no name), the extension can **auto-complete** the card instead of waiting for you to nudge the model: it fires a focused, personaless `generateRaw` asking for **only** the missing `[CARD_*]` blocks, harvests them through the normal card handlers, and re-attempts finalize — bounded by **Card auto-retry rounds** (default 2) and stopping early if a round makes no progress. Controlled by **Auto-complete card assembly** (default on); when it still can't complete, it falls back to the manual-nudge toast. It's a "validate → feed the missing pieces back → retry" loop layered on top of GLP's tolerant block parsers.

### Player-state durability

Tracked character state (vitals, attributes, skills, inventory, factions, quests, party/scene, …) lives in the chat's metadata and is written into the chat file **immediately after every updating message** (an awaited save, not debounced) — so a refresh, tab close, or server restart resumes exactly where you left off. State is **per-chat** (each campaign is its own chat); the ruleset and header format re-hydrate from the card's `[System Definition]` entry when a chat loads. As belt-and-suspenders, the extension also flushes any unsaved change when the tab is hidden/closed and schedules a debounced backstop save, closing the sub-second window where an in-flight save could be interrupted.

---

## Always-on vs. keyword-triggered lorebook entries

Only a handful of entries are **constant** (always in context): `[System Definition]` (summary + rules digest), `[GM Directives]`, `[Block Formats]`, `[Scene]`, `[Party]`, and each NPC's **core** memories. Everything else is **keyword-triggered** so it loads only when relevant — the player's own `[Player:Skills]`/`[Player:Possessions]`/`[Player:Domains]` detail, items, locations, factions, quests, world events, capabilities, `[System Rule]` entries, episodic memories, and NPC state/progression. This keeps the always-on context small while the bulk of campaign lore (and the player's full kit) stays a keyword away.

### Always-on rules digest

The detailed mechanics live in **keyword-triggered** `[System Rule]` entries (loaded only when the narrative uses the system's vocabulary). To keep the GM aware of the *shape* of every subsystem from turn 1 — before any keyword fires — the constant `[System Definition]` entry also carries a compact **rules digest**: one line per enabled subsystem with the vocabulary the GM needs to narrate correctly, e.g.

```
Rules digest (subsystem parameters):
• Resolution: d20 + modifier vs. DC; DC Easy 10 / Medium 15 / Hard 20; crit Nat 20 success; nat 1 failure
• Capabilities: boon, title, passive, trait, evolution, skill; skill→veridia_pp
    veridia_pp (points_tiers): Novice < Apprentice < Adept < Expert < Master < Grandmaster < Saint < God
• Reputation: Hostile < Cold < Neutral < Friendly < Allied < Sworn (0–100, init 50)
• Ranks: F < E < D < C < B < A < S < SS < SSS
• Needs: warn 30, critical 10
```

It's derived from the same `[SYSTEM_DEF]` fields the `[System Rule]` entries use, so the tier names / scales / mechanic stay in sync. Controlled by **Always-on rules digest** (default on). A separate **Full rules always-on** toggle (default off) promotes the *complete* `[System Rule]` entries to constant for users who prefer the full detail always in context rather than keyword-gated — richer but heavier.

---

## Lorebook architecture

| Lorebook | Created by | Contains |
|---|---|---|
| GM card embedded book | card author / Architect | Block-protocol reminder + system rules |
| Campaign lorebook | extension | `[System Definition]` (summary + rules digest) / `[GM Directives]` / `[Block Formats]` / `[Scene]` / `[Party]` (constant), `[Player:Skills]` / `[Player:Possessions]` / `[Player:Domains]` (keyword-triggered player detail — now in the per-chat player book, see below), `[System Rule]` / `[Block Formats: More]` entries (keyword-triggered), NPC core/state/progression, creatures, factions+reputation, items, capabilities, quests, world events, locations, rules, events |
| `{campaign}-npc-{slug}` / `{campaign}-location-{slug}` lorebooks | extension (auto) | Per-subject memories — core + episodic, **both keyword-triggered** on the subject's name (core ranks first). Names are **campaign-scoped** (prefixed with the campaign lorebook) so two campaigns that share a subject name don't cross-contaminate. Falls back to the legacy unscoped `npc-{slug}` / `location-{slug}` when no campaign lorebook is set. |

> **Memory context economy.** A subject's memories enter context only when the subject is referenced — named in narration, or present via the constant `[Scene]`/`[Party]` entry (whose content names them → recursive scan). An off-screen NPC's core memories are **not** force-injected. Core memories are not `constant`; they simply rank above episodic when their subject triggers.
>
> **Upgrade note (0.0.16).** Side-book names are now campaign-scoped. Pre-0.0.16 unscoped books (`npc-{slug}`, `location-{slug}`) are **not** auto-migrated — the old shared name can't be attributed to a specific campaign. Single-campaign users can rename them to `{campaign}-npc-{slug}` to keep history; otherwise new scoped books are created going forward.

**Keyword triggering.** Keyword-triggered entries load into context only when the chat mentions one of their keys. The parser normalizes every key set (trim, lowercase, dedup) and, when you don't supply explicit `keywords:`, derives them from the entry's name via `expandNameKeys`: the full lowercased name plus a conservative significant sub-phrase (e.g. "The Lost Heir" also triggers on "lost heir"), never bare common words. `[System Rule]` entries derive their keys from the System Definition's own vocabulary (tier names, rank labels, attitudes, need meters, dice tokens…). When you do supply `keywords:`, give 2–5 specific, distinctive terms and avoid generic words, which over-trigger.

---

## Extension settings

| Setting | Default | Description |
|---|---|---|
| Enable GM Lore Parser | on | Master switch |
| Campaign Lorebook | — | Target lorebook for all entries and the system definition |
| Hide blocks in chat | on | Strip raw blocks from the visible message after processing |
| Show toast notifications | on | Notices on saves and stat changes |
| Scan user messages | off | Also parse blocks in player messages |
| Intercept # commands | on | Answer `#` commands locally |
| Panel toggles | on | Scene / party / status / capabilities (skill + boon sub-sections) / domain / quests / reputation / events / currency / needs panels (a panel also hides when its feature is disabled in the system definition) |
| Pin panel | off | Keep the status-panel drawer pinned open |
| Inject into context | on | Character state in Author's Note position |
| Context injection depth | 1 | Messages from bottom where state injects |
| Inject resolution | on | Prepend the system's conflict-resolution mechanic to context |
| Tiered context | on | Lean always-on core + keyword-triggered `[Player:*]` detail entries (off = legacy monolithic injection of the whole sheet) |
| Always-on rules digest | on | Append a compact per-subsystem digest (tier names / scales / mechanic / ladders) to the constant `[System Definition]` entry so the GM knows every rule's shape on turn 1 |
| Full rules always-on | off | Promote the detailed `[System Rule]` entries to constant (always-on) instead of keyword-triggered — richer but heavier context |
| Scan / lore / rule order | 4 / 100 / 50 | Lorebook scan depth and entry ordering |
| **Narrative header** | on | Prepend an in-narrative status header to GM messages |
| Use `[HEADER_FORMAT]` block | on | Prefer the captured format block over the manual format |
| Header separator | `---` | String placed between the header and the narrative |
| Show on every message | on | Render every message vs. only when a fresh format block arrives |
| Manual header format | — | Fallback format string when no block is captured |
| **Enrich memory content** | off | Summarize the recent scene into `[Memory]` bodies via a quiet side-prompt (raw block text is the fallback) — see below |
| Memory enrichment window | 10 | Trailing chat messages fed to the memory summarizer |
| **Function tools** | off | Register state-change tools for chat-completion backends (inert on text-completion) — see below |
| **Auto-complete card assembly** | on | On a blocked `[CARD_FINALIZE]`, headlessly fetch the missing `[CARD_*]` blocks and re-attempt (vs. waiting for a manual nudge) |
| Card auto-retry rounds | 2 | Max headless auto-retry rounds per card draft before falling back to the manual-nudge toast |
| **2nd-pass state extractor** | off | `off` / `fallback` (run only when the GM emitted no state block) / `always` (pure-prose narrator) — a personaless pass that emits state blocks from the GM's prose |
| Extractor connection profile | — | Optional SillyTavern Connection Profile for the extraction pass (blank = same model as the narrator) |
| **Measure side-generation token cost** | off | Accumulate per-chat token/cost for GLP's own model calls (extractor, memory summaries, card auto-retry) — see below |

Settings are organized into collapsible groups (Panels · Narrative Header · Context & lore injection · Memory & tools · Autonomous memory capture · Advanced · About & changelog); the pop-out button (⧉ in the header) detaches the panel into a draggable float.

---

## Memory enrichment, semantic recall & function tools (0.0.17)

Three optional, independent enhancements. All default **off** and all keep the local text-completion path unchanged.

**Memory enrichment.** With *Enrich memory content* on, when an `[ENTITY_MEMORY]`/`[LOCATION_MEMORY]` block is processed the extension composes the entry body by summarizing the last *N* chat messages (the *enrichment window*) involving the subject — a quiet side-generation on your active connection (works on any backend). The summarizer is constrained to the transcript (no invention), and if it fails or returns empty the model's **raw block text is used unchanged**. Enriched entries carry `extensions.enriched: true`. Trade-off: one extra short generation per memory, so it's opt-in.

**Chat-linking.** All lorebooks gm-lore-parser generates for a campaign — the campaign book, the `…-plot` book, and every per-subject `…-npc-*` / `…-location-*` memory book — are auto-linked to the active chat (on chat change and when the Campaign Lorebook is set), so their entries are pulled by both keyword World Info and Vector Storage. The campaign book's **constant** entries (`[System Definition]`, `[GM Directives]`, `[Scene]`, `[Party]`) only reach the model once the book is chat-linked; gm-lore-parser injects only the live player sheet via the Author's-Note slot, so there is no duplication.

**Semantic recall (Vector Storage).** gm-lore-parser writes standard World Info entries; SillyTavern's **built-in Vector Storage** can retrieve them *by meaning* rather than only by keyword. Enable Vector Storage and turn on **World-Info vectorization** against your Campaign Lorebook (the local `transformers` embedding source works offline). This complements — does not replace — keyword triggering, and works best with memory enrichment on (richer bodies embed better). No gm-lore-parser code owns retrieval; Vectors handles injection.

**Function tools (chat-completion backends).** With *Function tools* on, the extension registers `glp_record_memory`, `glp_entity_update`, `glp_currency_update`, `glp_quest_update`, and `glp_reputation_update` via SillyTavern's function-calling API. A capable model can call these structured tools instead of emitting prose `[BLOCK]` tags — more reliable than hoping a small model formats a literal block. Each tool routes into the same handler the block path uses. **This is inert on text-completion backends** (SillyTavern only surfaces tools where function-calling is supported), so the local-model prose-block path is unchanged. Use the tool *or* the equivalent block in a reply, never both (delta updates would otherwise double-apply).

---

## Token telemetry (0.0.20)

GLP is mostly single-model (the GM's own generation is SillyTavern's, not GLP's), but it makes its **own** model calls for side-tasks — the [2nd-pass state extractor](#optional-2nd-pass-state-extractor-dual-model), memory enrichment / autonomous-memory summaries, and [card-assembly auto-retry](#card-assembly-auto-retry). With **Measure side-generation token cost** on (default off), the extension accumulates the in/out token cost of those calls **per chat**, so you can see the overhead of the dual-model path — the "is it worth running the extractor on a paid API?" question. Estimates are char-based (~4 chars/token) unless the backend reports usage; each row notes which method was used.

The **Memory & tools** settings group shows a readout (`N side-calls (extractor:2, memory:1) · in … / out … tok · ~$…`) with **Refresh** and **Reset** buttons, and a reference cost projection (defaults ≈ a cheap flash-tier extractor). Storage is in-memory and resets on reload — this is measurement scaffolding, not shipped state. Console probe: `window.glpTelemetry.summary()` / `.cost()` / `.get()` / `.reset()`.

---

## Autonomous memory capture (0.0.19)

By default, `[Memory]` entries are only created when the model **emits** an
`[ENTITY_MEMORY]`/`[LOCATION_MEMORY]` block (memory *enrichment*, above, only improves
the body of a block the model already emitted). A model that never emits a memory block
therefore builds no history. **Autonomous memory capture** (all triggers **opt-in, default
off**) closes that gap by summarizing the transcript into a `[Memory]` on its own:

- **On scene exit** — when a named subject leaves the scene (a `SCENE_UPDATE` `exit`/`set`
  that drops them), write an episodic memory of *what happened while they were on-screen*
  (the window is tracked from when they entered).
- **On location change** — when the scene `location` changes, write an episodic memory for
  the location just left.
- **Periodic** — every *N* GM turns, write an episodic memory of the current scene (keyed
  to the scene location if set, else the present subjects).
- **On leaving the chat** — flush an episodic memory for still-present subjects (and the
  location) from the chat you're switching away from.

Each capture is a **personaless side-generation** (the same summarizer as enrichment, so
the active card's persona can't turn it into a re-emitted block), writes to the subject's
campaign-scoped per-subject book (`‹campaign›-npc-‹slug›` / `‹campaign›-location-‹slug›`),
and is tagged `extensions.auto: true`. Guards keep it cheap and safe: a **minimum-messages**
threshold skips a trigger with too little new material *before* spending a generation;
identical auto memories are **de-duplicated**; and on any failure or empty summary it writes
**nothing** (never a terse stub). Configure under **Autonomous memory capture** in settings.
Because everything defaults off, the local text-completion path is unchanged unless you opt in.

---

## Per-chat player book & panel click-to-view (0.0.18)

**Dedicated per-chat player lorebook.** The player's core sheet has always lived in
per-chat `chatMetadata` (no bleed). The tiered `[Player:Skills]` / `[Player:Possessions]`
/ `[Player:Domains]` projections, however, used to be written into the **shared campaign
book** — so two chats that shared one campaign book but played different characters
overwrote each other's player entries. Those projections now go to a **dedicated per-chat
book**, `‹campaign›-player-‹chatid›`, created and chat-linked on first use and cached in
per-chat state (so it survives chat renames). Legacy `[Player:*]` entries are auto-pruned
from the campaign book on the next rebuild. This closes the last cross-chat/cross-campaign
bleed vector for player state.

**Panel click-to-view.** Every status-panel row that is backed by a lorebook entry is now
clickable and opens that entry in a popup: quests (`[Quest]`), item-box and equipment items
(`[Item]`), capabilities/skills (`[Capability]`), factions (`[Faction]`), world events
(`[World Event]`), and companions (`[Companion]`) — alongside the existing carried-inventory
and party/scene-member popups. A row whose entry doesn't exist yet shows a graceful
"No lore entry recorded yet." message. All routes go through one delegated handler and one
lookup helper (`glpShowLorePopup`).

**Character-creation panel grouping.** When a `char_create` sequence finalizes, the sheet
now groups fields correctly immediately — HP (and any bar/pool vital) under **vitals**,
System-Definition attributes under **attributes** — without needing a page refresh, and
reloading an older character corrects any fields a previous schema left in the `Other`
catch-all.

---

## Testing

Two manual test plans live alongside the code:

- [`TESTING.md`](TESTING.md) — tests the **extension** (block parsing, panel, commands, tiered context) via the **Test Harness** card (`test-harness-card.json`), a deterministic block emitter: import it, type `emit: <block>` (e.g. `emit: entity player`) and the reply carries exactly that block so the parser processes it. `emit: scenario smoke` runs a one-turn end-to-end smoke check. Blocks are only parsed in AI messages, which is why the harness is a character card rather than copy-paste snippets.
- [`ARCHITECT-TESTING.md`](ARCHITECT-TESTING.md) — tests **The Architect** (`system-designer-card.json`, the staged system *designer*) and the **GM card it produces**: a reproducible "Emberhold" design brief drives the staged conversation, then the produced card/lorebook are structurally validated and **imported & played** to prove the designed system runs on the extension.

### Two designer cards (A/B)

There are **two** system-designer cards that emit the *same* card-assembly protocol; pick by your model:

- **The Architect** (`system-designer-card.json`) — the original, deeply staged designer. Excellent on frontier models; its ~32k-char always-on `system_prompt` and free-form 17-stage flow are hard for small local models (they narrate instead of emitting, or write `##` headings instead of literal `[...]` tags).
- **The Forge** (`system-forge-card.json`) — a from-scratch alternative **rebuilt for small local LLMs**. Same protocol and completeness gate, but a lean (~5k) always-on prompt and a **block-first** loop: every reply **leads with one literal card block** (the decision just made) and then the guidance prose — the Veridia "status-header" pattern, so the block survives even when an immersive "write a paragraph" System Prompt is active. The card opens on turn one (`[CARD_BEGIN]`), and the full per-stage template depth lives in **keyword-triggered lorebook entries** that page in only when each stage is reached. Verified live on local gemma **with the immersive System Prompt on**, emitting captured blocks across turns.

The Architect generally needs the immersive **global** System Prompt disabled while designing (a prose-roleplay note prepended on top overrides its structured output); The Forge is built to work **with it on**. See each card's `creator_notes`.

---

## License

AGPLv3
