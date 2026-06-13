# GM Lore Parser

A SillyTavern extension that automates campaign record-keeping for AI-run tabletop RPGs. The GM (or the Architect that designs a game) emits structured blocks at the end of messages; the extension parses them and maintains the ruleset, character/NPC/companion state, lorebooks, abilities, world time, and more — automatically.

**Version:** 0.0.9 (beta)
**Requires:** SillyTavern 1.12.0+

It is system-agnostic: a single `[SYSTEM_DEF]` block defines the ruleset (which subsystems exist, attributes, derived-stat formulas, progression model, optional classes, reputation/skill/needs settings, conflict resolution, and more). Player, NPC, Companion, and Creature share one stat-block engine via the unified `[ENTITY]` family; Boons/Titles/Passives/Evolution are one `[ABILITY]` concept. Levels, XP, classes, skills, reputation, needs, and the other subsystems are all opt-in — a classless, levelless, skill-based system is fully supported.

---

## Module architecture

The extension is a single entry point (`index.js`) that loads `modules/` in order:

```
state · utils · lorebook · system · schema · entity · companions ·
progression · inventory · skills · domain · lore · sheet · creation ·
quests · reputation · events · currency · abilities · needs ·
commands · panel · context
```

Companions (loyalty / control / AP / legion) live in `companions.js` as a companion entity-type module; rank ladders + XP in `progression.js`; equipment slots / inventory model / item box in `inventory.js`. `currency.js` is pure wealth.

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

features: skills, ranks, reputation, currency, needs, companions, domains, quests, abilities, world_events

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
  fortitude | Fortitude | FOR
  might | Might | MGT
  intellect | Intellect | INT
  resolve | Resolve | RES
  agility | Agility | AGI

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

skills:
  enabled: true
  leveled: true
  tiers: Novice, Apprentice, Adept, Expert, Master, Grandmaster, Saint, God
  levels_per_tier: 10
  pp_per_level: 100 * tier_rank
  score: 10 + total_levels * 2.5

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
abilities:
  categories: boon, title, passive, trait, evolution
  exclusive_category: title

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

- `features:` — a comma list of the **enabled** subsystems (skills, ranks, reputation, currency, needs, companions, domains, quests, abilities, world_events, equipment). Anything omitted is disabled: its blocks no-op, its panel section hides, its context injection is suppressed, and its commands drop out. Omit the whole section to keep all features on.
- `progression:` — `levels:false`/`xp:false` produce a levelless / XP-less system. `level` is exposed to formulas only when `levels:true`.
- `identity:` / `classes:` — declared identity fields (class/background/race) and an optional class catalogue (modifiers + granted skills/abilities; same shape serves races/backgrounds).
- `attributes:` / `derived:` — `key | label | abbr` rows and `key = formula -> target[, also…]` rows, evaluated with a strict arithmetic-only whitelist (no code execution).
- `reputation:` / `loyalty:` — custom `scale: min-max`, `initial`, and tier names.
- `skills:` — `enabled`/`leveled` toggles, tier names, `levels_per_tier`, `pp_per_level` / `score` formulas.
- `resolution:` — documents how checks are resolved (d20 vs DC, d100 roll-under, dice pool, 2d6+mod, …). The extension never rolls; this is injected into context so the GM resolves checks consistently.
- **Vocabularies** — `quests`, `world_events`, `factions`, `companions`, `abilities` let a system rename statuses/categories/roles/attitudes and their defaults.
- **Possessions** — `inventory` (model `freeform`/`slots`/`weight` + `capacity`/`unit`, optional `item_box`) and `equipment` (system-defined `slot:` set, gated by `features.equipment`).
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

**Per-type follow-on behavior**
- **player** — stored in chat metadata; shown in the status panel and injected into context. No lorebook entry.
- **npc** — written to the campaign lorebook as three entries: `[NPC] name` (immutable core), `[NPC:State] name` (dynamic + gm_mutable fields), `[NPC:Progression] name` (full stat summary). Gains a per-NPC memory lorebook when it earns memories or milestones.
- **companion** — stored in chat metadata with companion meta (loyalty / control cost / role / rank / AP) plus an optional shared stat block; summarized to one lorebook entry.
- **creature** — an **immutable template** (a bestiary entry). Supports stat ranges (`hp: 18-28`) and `_per_level` scaling. NPC/creature instances can inherit a template with `from_template: <name>` (ranges collapse to midpoint, scaling applies for the instance's level).

### `[ENTITY_UPDATE_BEGIN]` — routine (GM_MUTABLE) changes

```
[ENTITY_UPDATE_BEGIN]
type: player
hp: 11
conditions: +Poisoned, -Stunned
blade_uses: +3
[ENTITY_UPDATE_END]
```

Writes only `gm_mutable` fields (and, for NPCs, declared dynamic fields). `+`/`-` add/remove list items; numeric fields are full replacement. Use-tracked skills auto-promote when their `_uses` counter crosses the threshold. For companions, this block also carries meta and AP: `loyalty`, `control_cost`, `role`, `status`, `ap_award: N`, `attribute_allocate: might:5, agility:3`.

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

## Abilities — boons, titles, passives, traits, evolution

```
[ABILITY_BEGIN]
name: Ember Heart
category: boon              # boon | title | passive | trait | evolution
activation: on_use         # always | on_condition | on_use
description: Ignite your blade with divine fire
effects: +2 fire damage on hit
entity: <owner name>       # optional; defaults to the player
keywords: ember, fire blade
[ABILITY_END]
```

- **title** — set `active: true` to display it; only one title is active per owner at a time.
- **evolution** — `stat_changes: might:+5, resolve:+3` are applied to the owner as a logged milestone event (gm_event semantics).
- Racial/innate `passive` abilities are emitted during character creation in place of a free-text passives list.

---

## Other blocks (gated by `features`)

- **Skills** — `[SKILL_SYSTEM]` configures the model; `[SKILL_UPDATE]` awards PP and advances tiers. Tier names / formulas come from the system definition unless overridden here.
- **Reputation & factions** — `[FACTION_BEGIN]` / `[FACTION_UPDATE]` define lore; `[REPUTATION_UPDATE]` changes standing on the system's scale/tiers. Both feed one combined lorebook entry per faction.
- **Quests** — `[QUEST_BEGIN]` / `[QUEST_UPDATE]`.
- **World** — `[WORLD_EVENT]` / `[WORLD_EVENT_UPDATE]` / `[PLOT_ENTRY]`.
- **Domain** — `[DOMAIN_UPDATE]` for a domain/base management sub-game.
- **Currency & ranks** — `[CURRENCY_UPDATE]`, `[RANK_CHANGE]`, `[XP_AWARD]`.
- **Needs / life-sim** — `[NEEDS_SYSTEM]` configures meters; `[NEEDS_UPDATE]` changes them (context injection only fires when a need is at/under its warn threshold). Needs can also be modeled as schema fields with negative `regen_rate`.
- **World time** — `[WORLD_TIME]` advances the clock and applies resource regen + use-tracked checks to the player and all schema-bearing NPCs.
- **Item** — `[ITEM_BEGIN]` / `[ITEM_UPDATE]`; condition labels derive from the system's `item_conditions`.
- **Possessions** — equip/unequip via `[ENTITY_UPDATE]` (`equip: <slot>=<item>` / `unequip: <slot>`); `[ITEM_BOX_UPDATE]` (`add: <item> | <condition>` / `remove: <item>`) for the optional item box.
- **Locations** — `[LOCATION_BEGIN]` (type/description/region, optional `instance`/`instance_type`) auto-creates a `location-{slug}` history lorebook; `[LOCATION_MEMORY]` appends to it. `[RULE_BEGIN]`, `[EVENT_BEGIN]` are generic lore.
- **Designer** — `[CARD_OUTPUT]` (Architect only) downloads a generated GM card as JSON.

---

## Commands

Typed by the player; answered locally without calling the model.

| Command | Shows |
|---|---|
| `#status` / `#character` | Full character sheet |
| `#vitals` | HP/MP/resources with regen rates |
| `#skills` | Skill list with tiers and PP |
| `#inventory` / `#bag` | Inventory list |
| `#domain` | Domain statistics |
| `#time` | Current in-world time |
| `#quests` | Quest tracker |
| `#rep` / `#reputation` | Faction reputation standings |
| `#factions` | Full faction roster with lore |
| `#events` | World events log |
| `#currency` / `#gold` | Wallet and denominations |
| `#rank` | Guild / adventurer rank |
| `#companions [name]` | Companion roster (optional filter) |
| `#legion` / `#hierarchy` | Full command delegation tree |
| `#boons` / `#titles` / `#abilities` | Abilities by category |
| `#equipment` | Equipped items by slot |
| `#itembox` | Item box contents |
| `#needs` | Life-simulation meters |
| `#locations` | Location types & info |
| `#inspect [target]` | Inspect a target by Awareness tier |
| `#system` / `#ruleset` | System definition & resolution mechanic |
| `#help` | Command list |

**The command set is configurable.** The table above is just the default. The active set is:

- **Feature-gated** — a command whose subsystem is disabled in `features:` drops out of both the dispatcher and `#help` (e.g. no `#rank` when `ranks` is off). `#status`, `#vitals`, `#system`, and `#help` are always available.
- **Reshapeable via the System Definition `commands:` section** — you can rename/alias a built-in view, drop one (omit it), or add a custom command whose `template` renders `{token}`s of character state. When `commands:` is present it defines the active set (the four always-on commands aside); `#help` is generated from it.

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

A live, schema-driven panel renders above the chat input: identity + active title, grouped fields (bars/values/pools/lists), and collapsible sections for needs, skills, domains, quests, reputation, world events, currency, rank, companions, equipment & inventory, and abilities & titles. During an active creation session it shows the creation step checklist instead. Disabled features and empty sections are hidden.

---

## Lorebook architecture

| Lorebook | Created by | Contains |
|---|---|---|
| GM card embedded book | card author / Architect | Block-protocol reminder + system rules |
| Campaign lorebook | extension | `[System Definition]` (constant), NPC core/state/progression, creatures, factions+reputation, items, abilities, quests, world events, locations, rules, events |
| `npc-{slug}` lorebooks | extension (auto) | Per-NPC memories — core (constant) + episodic (keyword-triggered) |

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
| Panel toggles | on | Status / skills / domain / quests / reputation / events / currency / abilities / needs panels (a panel also hides when its feature is disabled in the system definition) |
| Inject into context | on | Character state in Author's Note position |
| Context injection depth | 1 | Messages from bottom where state injects |
| Inject resolution | on | Prepend the system's conflict-resolution mechanic to context |
| Scan / lore / rule order | 4 / 100 / 50 | Lorebook scan depth and entry ordering |

---

## Testing

A full manual test plan covering both extensions lives in [`TESTING.md`](TESTING.md). It is exercised with the **Test Harness** card (`test-harness-card.json`) — a deterministic block emitter: import it, type `emit: <block>` (e.g. `emit: entity player`) and the reply carries exactly that block so the parser processes it. `emit: scenario smoke` runs a one-turn end-to-end smoke check. Blocks are only parsed in AI messages, which is why the harness is a character card rather than copy-paste snippets.

---

## License

AGPLv3
