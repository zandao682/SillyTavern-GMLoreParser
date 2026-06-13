# GM Lore Parser

A SillyTavern extension that automates campaign record-keeping for AI-run tabletop RPGs. The GM (or the Architect that designs a game) emits structured blocks at the end of messages; the extension parses them and maintains the ruleset, character/NPC/companion state, lorebooks, abilities, world time, and more — automatically.

**Version:** 9.0.0
**Requires:** SillyTavern 1.12.0+

---

## What's new in v9

v9 is a system-agnostic rebuild. Nothing about any one game is hardcoded:

- **System Definition** — a single `[SYSTEM_DEF]` block defines the ruleset: which subsystems exist, the attribute list, derived-stat formulas, progression model, optional classes, reputation scale/tiers, skill model, rank ladder, needs, item conditions, and loyalty. It is stored in the campaign lorebook and drives every other module. With no definition present, sensible defaults apply.
- **Unified entities** — Player, NPC, Companion, and Creature share **one** stat-block engine. A single `[ENTITY]` family of blocks (with a `type:` field) replaces the old per-type blocks; the type drives the follow-on behavior (NPC memory lorebooks, companion loyalty/AP, player change-log, immutable creature templates).
- **Unified abilities** — Boons, Titles, innate/racial Passives, and Evolution traits are now one `[ABILITY]` concept with a `category:`.
- **Optional everything** — Levels, XP, classes, AP, leveled skills, reputation, needs, and the other subsystems are all opt-in. A classless, levelless, skill-based system is fully supported.

---

## Module architecture

The extension is a single entry point (`index.js`) that loads `modules/` in order:

```
state · utils · lorebook · system · schema · entity · skills · domain ·
lore · sheet · creation · quests · reputation · events · currency ·
abilities · needs · commands · panel · context
```

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
[SYSTEM_DEF_END]
```

**Every section is optional** and merges over the built-in defaults:

- `features:` — a comma list of the **enabled** subsystems. Anything omitted is disabled: its blocks no-op, its panel section hides, its context injection is suppressed, and its `#commands` report nothing. Omit the whole section to keep all features on.
- `progression:` — `levels:false`/`xp:false` produce a levelless / XP-less system. `level` is exposed to formulas only when `levels:true`.
- `identity:` — declared identity fields beyond the always-present `name` (e.g. class/background/race). A classless system simply omits `class`.
- `classes:` — an optional catalogue. Each `option:` is a build template (attribute modifiers + granted skills/abilities). The same shape, via `category`, can hold races/backgrounds/origins. Selecting one during creation applies its modifiers and grants.
- `attributes:` / `derived:` — `key | label | abbr` rows and `key = formula -> target[, also…]` rows. Formulas may reference any attribute (by key or abbr) and declared `variables`, and are evaluated with a strict arithmetic-only whitelist (no code execution).
- `reputation:` / `loyalty:` — custom `scale: min-max`, `initial`, and tier names.
- `skills:` — `enabled`/`leveled` toggles, tier names, `levels_per_tier`, and the `pp_per_level` / `score` formulas.
- `needs:`, `item_conditions:`, `rank_ladder:` — life-sim thresholds, durability bands, and the rank progression.

Item-box, instances/dungeons, and death/resurrection are intentionally **not** tracked subsystems — they are GM narrative (item storage uses the `inventory` list, instances use `WORLD_EVENT`, death is HP→0 prose).

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
- **Lore** — `[LOCATION_BEGIN]`, `[RULE_BEGIN]`, `[EVENT_BEGIN]`.
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
| `#needs` | Life-simulation meters |
| `#inspect [target]` | Inspect a target by Awareness tier |
| `#help` | Command list |

---

## Status panel

A live, schema-driven panel renders above the chat input: identity + active title, grouped fields (bars/values/pools/lists), and collapsible sections for needs, skills, domains, quests, reputation, world events, currency & companions, and abilities & titles. During an active creation session it shows the creation step checklist instead. Disabled features and empty sections are hidden.

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
| Scan / lore / rule order | 4 / 100 / 50 | Lorebook scan depth and entry ordering |

---

## License

AGPLv3
