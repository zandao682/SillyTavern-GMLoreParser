# GM Lore Parser

A SillyTavern extension that automates campaign record-keeping for AI-run tabletop RPG games. The GM outputs structured blocks; the extension reads them and maintains lorebooks, character state, NPC progression, and world time automatically.

**Version:** 6.0.0  
**Requires:** SillyTavern 1.12.0+

---

## What it does

**Lore pipeline** — The GM appends structured blocks to messages. The extension parses them and writes keyword-triggered lorebook entries to a campaign-specific lorebook. Entries are created on first appearance and updated in place on subsequent appearances.

**Character sheet** — Player character state (stats, conditions, inventory, resources) is stored per-chat and displayed as a live status panel above the chat input. The same state is injected into the model's context before each generation. The GM can update mutable fields; protected fields are enforced at the code level regardless of what the model outputs.

**NPC progression** — Significant NPCs carry full field schemas, mirroring the player character system. They have their own HP, skills, and attributes that can grow through use or milestone events. Time-based regen applies to NPCs automatically on WORLD_TIME blocks.

**World time** — A WORLD_TIME block advances the in-world clock, applies resource regen to both the player and all significant NPCs, and checks use-tracked skill promotion thresholds. The GM does not calculate recovery manually.

---

## Companion cards

| Card | Purpose |
|---|---|
| **The Game Master** | Runs campaigns. Knows the full block protocol. Manages NPC growth. |
| **The Architect** | Designs new game systems. Produces importable GM cards and lorebooks. |

---

## Installation

Copy this folder into:
```
data/<your-user>/extensions/third-party/gm-lore-parser
```
Restart SillyTavern. Settings appear under **Extensions → GM Lore Parser**.

---

## Campaign setup

1. Create a dedicated lorebook in **World Info** (e.g. `campaign-ironveil`)
2. Link it to the GM card (Character panel → globe icon) **and** to the active chat
3. In extension settings, select it as **Campaign Lorebook**
4. At session start, paste a filled `[PLAYER_SHEET_BEGIN]` block into chat

---

## Block reference

All blocks are emitted by the GM at the **end** of messages — never mid-narration. The extension strips them from the visible chat after processing (configurable).

---

### Lore blocks → campaign lorebook

#### NPC

Significant NPCs include a `schema:` section defining field types and mutability. Minor NPCs omit the schema. The extension writes up to three lorebook entries per significant NPC:

- `[NPC] Name` — static core (immutable fields)
- `[NPC:State] Name` — dynamic state + mutable stat values (rebuilt on each NPC_UPDATE)
- `[NPC:Progression] Name` — compact summary of all schema field values (rebuilt on NPC_UPDATE and WORLD_TIME)

All three share the NPC's keywords and inject together when the NPC is mentioned.

```
[NPC_BEGIN]
name: Aldric Holt
race: Human
role: Freelance sword-for-hire
appearance: Mid-thirties, square jaw, greying temples
origin: Former city guard, dishonourably discharged
defining_trait: Pragmatic loyalty
dynamic_fields: attitude, location, condition, relationship_to_party, notes

schema:
  groups: vitals, combat, skills, progression
  field: hp
    label: HP
    type: bar
    group: vitals
    max_field: hp_max
    color: #c07060
    mutability: gm_mutable
    regen_rate: 2
    regen_unit: hour
    regen_condition: resting
  field: hp_max
    label: HP Max
    type: value
    group: vitals
    mutability: gm_event
  field: blade
    label: Blade
    type: value
    group: skills
    mutability: use_tracked
    uses_threshold: 6
    uses_gain: 1
  field: blade_uses
    label: Blade Uses
    type: value
    group: skills
    mutability: gm_mutable
  field: level
    label: Level
    type: value
    group: progression
    mutability: gm_event
  field: xp
    label: XP
    type: value
    group: progression
    mutability: gm_mutable

attitude: Wary
location: The Broken Lantern, Millhaven
condition: Healthy
relationship_to_party: Strangers

hp: 24
hp_max: 24
blade: 4
blade_uses: 0
level: 2
xp: 0

keywords: Aldric, Aldric Holt, sword-for-hire
[NPC_END]
```

#### NPC_UPDATE — routine NPC changes

Updates `dynamic_fields` (attitude, location, etc.) and `gm_mutable` schema fields (hp, xp). Also accepts `{skill}_uses` counters for use_tracked fields. Rejects gm_event and immutable fields with a console warning.

After every update, the extension checks whether any use_tracked skill has hit its `uses_threshold`. If so it auto-promotes the attribute, resets the counter (carrying any remainder), fires a toast notification, and writes an episodic NPC memory.

```
[NPC_UPDATE_BEGIN]
name: Aldric Holt
hp: 18
attitude: Cautiously positive
relationship_to_party: Allies of convenience
blade_uses: +3
xp: 150
[NPC_UPDATE_END]
```

#### NPC_ATTR_CHANGE — milestone attribute changes

Only writes `gm_event` fields. Requires a `reason` field — the entire block is rejected if reason is absent. Every accepted change is logged to the NPC's memory lorebook automatically as an episodic memory.

```
[NPC_ATTR_CHANGE_BEGIN]
name: Aldric Holt
reason: Survived the Siege of Millhaven — veteran's growth
str: 15
hp_max: 28
level: 3
[NPC_ATTR_CHANGE_END]
```

#### NPC_MEMORY — NPC memory lorebook entries

Creates entries in a per-NPC lorebook (`npc-{slug}`). The lorebook is created automatically if it doesn't exist and linked to the current chat immediately.

`type: core` — constant entry (always injected when NPC is active). Use for defining secrets, core motivations, fundamental truths about the character.

`type: episodic` — keyword-triggered entry (order 50). Use for specific past events, promises, debts, relationships that should surface when contextually relevant.

```
[NPC_MEMORY_BEGIN]
npc: Aldric Holt
type: core
title: Why Aldric left the guard
content: Aldric was ordered to cut down unarmed protesters during the Millhaven grain riots. He refused, disarmed the officer who gave the order, and walked out. He has never spoken of it but it defines every decision he makes about authority.
[NPC_MEMORY_END]
```

```
[NPC_MEMORY_BEGIN]
npc: Aldric Holt
type: episodic
title: Warned the party about the ambush
content: On Night 4, Aldric quietly warned the party about a Thornfield Guild ambush waiting outside the inn, at significant personal risk. He asked for nothing but clearly expects it to be remembered.
keywords: ambush warning, Thornfield, night four, Aldric warning, inn warning
[NPC_MEMORY_END]
```

#### LOCATION

```
[LOCATION_BEGIN]
name: The Ashveil Ruins
region: Northern Reach
description: Collapsed mage tower, three floors accessible, two submerged
notable_features: Echo-wraith hauntings at night, sealed vault on B2
danger_level: High
current_state: Partially explored by party (Session 4)
keywords: Ashveil, Ashveil Ruins, ruins, Northern Reach, mage tower
[LOCATION_END]
```

#### FACTION

```
[FACTION_BEGIN]
name: Thornfield Guild
type: Criminal trade organisation
goals: Control river commerce from Millhaven to the coast
leadership: Guildmaster Vex Anora (identity unknown to most)
resources: Bribes, smuggled alchemicals, two patrol ships
attitude_to_party: Hostile — party disrupted operations
keywords: Thornfield, Thornfield Guild, guild, smugglers
[FACTION_END]
```

#### ITEM

Declare `mutable_fields` for anything that degrades or is consumed. The extension derives a condition label (Pristine / Good / Worn / Damaged / Broken) automatically from durability percentage when `durability` and `durability_max` are both present.

```
[ITEM_BEGIN]
name: The Silthorn Compass
type: Magical navigation device
properties: Points to nearest active gate rather than magnetic north
history: Stolen from the Archivist of Vel-Doran
current_holder: Party (Mira's pack)
durability: 85
durability_max: 100
charges: 12
charges_max: 20
mutable_fields: durability, charges, current_holder
keywords: Silthorn Compass, compass, gate compass
[ITEM_END]
```

#### ITEM_UPDATE

Only updates fields listed in `mutable_fields`. Condition label recalculates automatically if durability changes.

```
[ITEM_UPDATE_BEGIN]
name: The Silthorn Compass
durability: 62
charges: 8
[ITEM_UPDATE_END]
```

#### BESTIARY

Completely immutable once written — never re-emit for the same creature type. Use range syntax for variable stats. Use `_per_level` suffix for scaling values; these appear under a `[Scaling]` section in the lorebook entry.

```
[BESTIARY_BEGIN]
name: Echo-Wraith
type: Undead spirit
hp: 18-28
armour: 0
attack_bonus: 3-5
damage: 1d6+2
special: Incorporeal (non-magical weapons half damage); Echo Scream (DC 14 WIS or frightened)
weakness: Radiant damage; sustained loud noise
hp_per_level: 6
attack_bonus_per_level: 1
keywords: Echo-Wraith, wraith, Ashveil undead
[BESTIARY_END]
```

#### RULE

`trigger_keywords` must be specific — they should only fire when that mechanic is mechanically relevant. Avoid generic triggers like `combat` or `action`.

```
[RULE_BEGIN]
name: Initiative
trigger_keywords: initiative, who goes first, turn order, combat starts, surprised
content: Roll 1d20 + DEX modifier. Highest total acts first. Ties broken by DEX. Surprised creatures lose their first turn and cannot react.
[RULE_END]
```

#### EVENT

```
[EVENT_BEGIN]
name: The Burning of Aldgate Bridge
date_in_world: Night 4, Month of Embers, Year 412
participants: Party, Harrow Company, unknown arsonist
summary: Bridge destroyed to slow Harrow pursuit. Three soldiers drowned.
consequences: Harrow Company now actively hostile. Millhaven guard questioning locals.
keywords: Aldgate Bridge, bridge burning, Harrow pursuit, Month of Embers
[EVENT_END]
```

---

### Character sheet blocks

#### PLAYER_SHEET — player-authored, set once

Defines character identity AND the display schema for the status panel. The schema section (indented under `schema:`) describes every field — its display type, panel group, mutability mode, and regen rules. The values section (flat key: value lines) provides starting numbers.

```
[PLAYER_SHEET_BEGIN]
name: Mira Ashgate
class: Rogue
background: Former Guild Enforcer

schema:
  groups: vitals, attributes, resources, status
  field: hp
    label: HP
    type: bar
    group: vitals
    max_field: hp_max
    color: #7ec87e
    mutability: gm_mutable
    regen_rate: 0
    regen_unit: hour
    regen_condition: never
  field: hp_max
    label: HP Max
    type: value
    group: vitals
    mutability: gm_event
  field: dex
    label: DEX
    type: value
    group: attributes
    mutability: gm_event
  field: blade
    label: Blade
    type: value
    group: resources
    mutability: use_tracked
    uses_threshold: 5
    uses_gain: 1
  field: blade_uses
    label: Blade Uses
    type: value
    group: resources
    mutability: gm_mutable
  field: conditions
    label: Conditions
    type: list
    group: status
    mutability: gm_mutable
  field: inventory
    label: Inventory
    type: list
    group: status
    mutability: gm_mutable

hp: 18
hp_max: 18
dex: 16
blade: 3
blade_uses: 0
conditions:
inventory: Shortsword; Lockpicks; Hooded cloak; 12 gold
[PLAYER_SHEET_END]
```

See `player-sheet-examples.md` for complete examples covering survival horror, anime action, level-up systems, and levelless use-tracked systems.

#### Field mutability modes

| Mode | Schema key | Writable via | Use for |
|---|---|---|---|
| `immutable` | `mutability: immutable` | Nothing after PLAYER_SHEET | Race, species, fixed origin |
| `gm_mutable` | `mutability: gm_mutable` | PLAYER_UPDATE | HP, conditions, inventory, pools, XP |
| `gm_event` | `mutability: gm_event` | ATTR_CHANGE (requires reason) | Base attributes, HP_max, level |
| `use_tracked` | `mutability: use_tracked` | Auto-promotes when `{key}_uses` hits threshold | Skills that grow through practice |

Name, class, background, and the schema itself are always protected regardless of any setting.

#### PLAYER_UPDATE — GM routine updates

Only writes `gm_mutable` fields. Rejects `gm_event`, `immutable`, and `use_tracked` base fields with a console warning.

`+`/`-` prefix adds or removes from list fields (conditions, inventory). No prefix replaces the list. Numeric fields are always full replacement — the GM calculates the new total.

```
[PLAYER_UPDATE_BEGIN]
hp: 11
conditions: +Poisoned, -Stunned
inventory: -Lockpicks; +Iron key (cell block B)
xp: 350
[PLAYER_UPDATE_END]
```

#### ATTR_CHANGE — deliberate attribute changes

Only writes `gm_event` fields. Requires `reason` — the entire block is rejected without it. Every change is logged to `attr_change_log` in chatMetadata with timestamp and reason.

```
[ATTR_CHANGE_BEGIN]
reason: Level 3 — Rogue attribute bonus
dex: 18
hp_max: 22
[ATTR_CHANGE_END]
```

#### WORLD_TIME — in-world clock advancement

Emitted by the GM after any scene-level time passage. Not for round-by-round combat — only meaningful scene transitions.

On receipt, the extension:
1. Updates the displayed world time
2. Applies regen to all `gm_mutable` player fields with regen rules
3. Applies regen to all significant NPCs with schemas that have regen fields
4. Checks use_tracked promotion thresholds for both player and NPCs
5. Auto-writes NPC memory entries for any promotions that fire
6. Rebuilds affected NPC State and Progression lorebook entries

The GM does not calculate any recovery manually.

```
[WORLD_TIME_BEGIN]
datetime: Day 12, Morning, Month of Embers
elapsed: 8h
resting: true
[WORLD_TIME_END]
```

**elapsed formats accepted:** `2h 30m` · `1 day` · `3 days` · `45 minutes` · `90m` · `1 day 4h`

**resting: true** triggers fields with `regen_condition: resting`. Fields with `regen_condition: always` regen regardless. Negative `regen_rate` values deplete over time (hunger, thirst, fatigue).

#### CARD_OUTPUT — System Designer only

Emitted by The Architect card at Stage 9. The extension auto-downloads it as a `.json` file ready to import into SillyTavern.

```
[CARD_OUTPUT_BEGIN]
{ ... complete GM card JSON ... }
[CARD_OUTPUT_END]
```

---

## Status panel

A live character panel renders above the chat input whenever a character sheet is loaded. Layout is fully schema-driven — the panel renders whatever groups and fields the schema defines.

**Field renderers:**

| type | Renders as |
|---|---|
| `bar` | Fill bar with current/max label. Colour-codes at ≤50% (warning) and ≤25% (pulsing critical). |
| `value` | Attribute chip. `★` badge on `gm_event` fields. Use-tracked fields show `N/threshold↑` progress. |
| `pool` | Row of pip dots, filled/empty. |
| `list` | Pill badges for conditions; dot-separated text for inventory. |
| `text` | Inline label + value (used for world time display). |

The same state is injected into the model's context via `setExtensionPrompt` (Author's Note position) before each generation, in a compact multi-line format the model can read efficiently.

---

## NPC memory lorebooks

When the first `NPC_MEMORY` block arrives for an NPC, the extension:
1. Creates `npc-{slug}` lorebook if it doesn't exist
2. Links it to the current chat automatically
3. Writes the memory as a lorebook entry

Core memories (order 1, constant) are always injected when that NPC is in scene. Episodic memories (order 50, keyword-triggered) only surface when their keywords appear in recent messages. This keeps token cost bounded — an NPC with 20 memories doesn't inject them all on every mention.

Use-tracked promotions and NPC_ATTR_CHANGE events are automatically logged as episodic memories, so NPC growth has a retrievable history.

---

## The Architect card

Guides you through designing a complete RPG system across nine stages:

1. **Tone & Premise** — genre, power scaling, constraints
2. **Core Resolution** — dice type, difficulty, crits
3. **Character Creation** — attributes, secondary stats, skills
4. **3.5 — Player Schema** — every field: type, mutability, regen
5. **Advancement** — what triggers it, what improves, which mutability mode
6. **NPC Schema Design** — which NPCs get schemas, what fields, what mutability
7. **Combat & Conflict** — initiative, damage, conditions, death
8. **GM Guidance** — encounter calibration, pacing, WORLD_TIME triggers
9. **Review & Output** — confirm then produce all files

**Stage 9 output:**
- CARD_OUTPUT block → auto-downloaded GM card JSON
- LOREBOOK_OUTPUT block → shown as code, imported manually via World Info → Import
- Player Sheet template → code block, player fills in and pastes at session start

**When using The Architect:** set Campaign Lorebook to blank in extension settings. The Architect produces its own output and does not write to a campaign lorebook.

---

## Lorebook architecture

| Lorebook | Created by | Contains |
|---|---|---|
| GM card embedded book | Card author (or Architect) | Block protocol reminder (constant), 10-15 system rules (keyword-triggered) |
| Campaign lorebook | gm-lore-parser extension | NPC core/state/progression, locations, factions, items, bestiary, rules, events |
| `npc-{slug}` lorebooks | gm-lore-parser extension (auto) | Per-NPC memories. Core = constant. Episodic = keyword-triggered. |

Rules travel with the GM card. Campaign lore lives in the campaign file. NPC memories live in their own files.

---

## Extension settings

| Setting | Default | Description |
|---|---|---|
| Enable GM Lore Parser | on | Master on/off switch |
| Campaign Lorebook | — | Target lorebook for all lore entries |
| Hide blocks in chat | on | Strip raw blocks from visible chat after processing |
| Show toast notifications | on | Brief notice on lorebook writes and stat changes |
| Scan user messages | off | Also parse lore blocks in player messages |
| Show status panel | on | Live character panel above chat input |
| Inject into context | on | Character state in Author's Note position |
| Context injection depth | 1 | Messages from bottom where state injects (0 = very bottom) |
| Lorebook scan depth | 4 | ST keyword scan depth for new lorebook entries |
| Lore entry order | 100 | Priority for NPC / Location / Faction / Item / Event entries |
| Rule entry order | 50 | Priority for Rule entries (lower = injected before other lore) |

---

## Block processing rules

- All blocks are processed in message order, top to bottom
- Lorebook entries are created on first appearance, updated in place on subsequent appearances (matched by comment field)
- PLAYER_UPDATE silently ignores `gm_event`, `immutable`, and `use_tracked` base fields — logs a console warning
- ATTR_CHANGE rejects the entire block if `reason` is missing
- NPC_ATTR_CHANGE rejects the entire block if `reason` is missing, and requires the NPC to have a schema
- BESTIARY entries are written once and never overwritten (immutable flag in extensions blob)
- NPC_UPDATE checks use_tracked promotion thresholds after every write; promotions fire automatically
- WORLD_TIME iterates all significant NPC schemas in the campaign lorebook; only NPCs with regen fields are processed (others skipped for performance)
- CARD_OUTPUT triggers an immediate browser download of the parsed JSON

---

## License

AGPLv3
