# PLAYER_SHEET Block Reference

The `PLAYER_SHEET` block defines your character AND how the status panel
displays them. The schema section tells the extension what every field is,
how to render it, and what the GM is allowed to update.

Paste a filled-in block into chat at the start of a campaign.
The extension strips it from the visible chat automatically.

---

## Schema field types

| type | Renders as | Use for |
|---|---|---|
| `bar` | Fill bar with current/max | HP, MP, stamina, hunger, sanity |
| `value` | Attribute chip (number) | STR, DEX, level, armour |
| `pool` | Row of pip dots | Spell slots, ki points, fate tokens |
| `list` | Pills (conditions) or dot-separated text | Conditions, inventory |
| `text` | Inline label + value | Any freeform string, datetime |

## Regen conditions
| condition | When regen applies |
|---|---|
| `always` | Every WORLD_TIME advance |
| `resting` | Only when WORLD_TIME block includes `resting: true` |
| `never` | No auto-regen (use 0 or omit regen block entirely) |

## gm_mutable
Set `gm_mutable: true` on any field the GM is allowed to update via
`PLAYER_UPDATE` blocks. Fields with `gm_mutable: false` (or omitted) are
protected — the GM cannot overwrite them. Name, class, background, and
the schema itself are always protected regardless.

---

## Example 1 — D&D-style fantasy

```
[PLAYER_SHEET_BEGIN]
name: Mira Ashgate
class: Rogue
background: Former Guild Enforcer

schema:
  groups: vitals, attributes, resources, conditions, inventory
  field: hp
    label: HP
    type: bar
    group: vitals
    max_field: hp_max
    color: #7ec87e
    gm_mutable: true
    regen_rate: 0
    regen_unit: hour
    regen_condition: never
  field: hp_max
    label: HP Max
    type: value
    group: vitals
    gm_mutable: true
  field: str
    label: STR
    type: value
    group: attributes
    gm_mutable: false
  field: dex
    label: DEX
    type: value
    group: attributes
    gm_mutable: false
  field: con
    label: CON
    type: value
    group: attributes
    gm_mutable: false
  field: int
    label: INT
    type: value
    group: attributes
    gm_mutable: false
  field: wis
    label: WIS
    type: value
    group: attributes
    gm_mutable: false
  field: cha
    label: CHA
    type: value
    group: attributes
    gm_mutable: false
  field: spell_slots_1
    label: Spell Slots I
    type: pool
    group: resources
    max_field: spell_slots_1_max
    color: #8080e0
    gm_mutable: true
  field: spell_slots_1_max
    label: Slots I Max
    type: value
    group: resources
    gm_mutable: false
  field: ki
    label: Ki
    type: pool
    group: resources
    max_field: ki_max
    color: #e0d080
    gm_mutable: true
  field: ki_max
    label: Ki Max
    type: value
    group: resources
    gm_mutable: false
  field: conditions
    label: Conditions
    type: list
    group: conditions
    gm_mutable: true
  field: inventory
    label: Inventory
    type: list
    group: inventory
    gm_mutable: true

hp: 18
hp_max: 18
str: 10
dex: 16
con: 12
int: 14
wis: 11
cha: 13
spell_slots_1: 0
spell_slots_1_max: 0
ki: 0
ki_max: 0
conditions:
inventory: Shortsword; Lockpicks; Hooded cloak; 12 gold pieces
xp: 0
[PLAYER_SHEET_END]
```

---

## Example 2 — Survival horror (hunger, thirst, fatigue + time)

```
[PLAYER_SHEET_BEGIN]
name: Yael Voss
class: Civilian
background: Field Medic

schema:
  groups: vitals, survival, attributes, status, world
  field: hp
    label: Health
    type: bar
    group: vitals
    max_field: hp_max
    color: #7ec87e
    gm_mutable: true
    regen_rate: 2
    regen_unit: hour
    regen_condition: resting
  field: hp_max
    label: Health Max
    type: value
    group: vitals
    gm_mutable: false
  field: sanity
    label: Sanity
    type: bar
    group: vitals
    max_field: sanity_max
    color: #9b8fd6
    gm_mutable: true
    regen_rate: 0
    regen_unit: hour
    regen_condition: never
  field: sanity_max
    label: Sanity Max
    type: value
    group: vitals
    gm_mutable: false
  field: hunger
    label: Hunger
    type: bar
    group: survival
    max_field: hunger_max
    color: #d0a060
    gm_mutable: true
    regen_rate: -5
    regen_unit: hour
    regen_condition: always
  field: hunger_max
    label: Hunger Max
    type: value
    group: survival
    gm_mutable: false
  field: thirst
    label: Thirst
    type: bar
    group: survival
    max_field: thirst_max
    color: #60a0d0
    gm_mutable: true
    regen_rate: -8
    regen_unit: hour
    regen_condition: always
  field: thirst_max
    label: Thirst Max
    type: value
    group: survival
    gm_mutable: false
  field: fatigue
    label: Fatigue
    type: bar
    group: survival
    max_field: fatigue_max
    color: #c08060
    gm_mutable: true
    regen_rate: -3
    regen_unit: hour
    regen_condition: always
  field: fatigue_max
    label: Fatigue Max
    type: value
    group: survival
    gm_mutable: false
  field: perception
    label: PER
    type: value
    group: attributes
    gm_mutable: false
  field: endurance
    label: END
    type: value
    group: attributes
    gm_mutable: false
  field: medicine
    label: MED
    type: value
    group: attributes
    gm_mutable: false
  field: conditions
    label: Conditions
    type: list
    group: status
    gm_mutable: true
  field: inventory
    label: Inventory
    type: list
    group: status
    gm_mutable: true
  field: current_time
    label: Time
    type: text
    group: world
    gm_mutable: true

hp: 20
hp_max: 20
sanity: 15
sanity_max: 20
hunger: 80
hunger_max: 100
thirst: 80
thirst_max: 100
fatigue: 80
fatigue_max: 100
perception: 12
endurance: 10
medicine: 14
conditions:
inventory: First aid kit; Flashlight; 3 ration bars; Water bottle (1L); Notebook
current_time: Day 1, 08:00
[PLAYER_SHEET_END]
```

---

## Example 3 — Anime action (no survival, focus on pools and resources)

```
[PLAYER_SHEET_BEGIN]
name: Kazuma Rei
class: Elemental Striker
background: Academy Dropout

schema:
  groups: vitals, power, attributes, status
  field: hp
    label: Vitality
    type: bar
    group: vitals
    max_field: hp_max
    color: #e07070
    gm_mutable: true
    regen_rate: 10
    regen_unit: hour
    regen_condition: resting
  field: hp_max
    label: Vitality Max
    type: value
    group: vitals
    gm_mutable: false
  field: ki
    label: Ki
    type: bar
    group: power
    max_field: ki_max
    color: #e0d040
    gm_mutable: true
    regen_rate: 15
    regen_unit: hour
    regen_condition: always
  field: ki_max
    label: Ki Max
    type: value
    group: power
    gm_mutable: false
  field: technique_slots
    label: Techniques
    type: pool
    group: power
    max_field: technique_slots_max
    color: #d080e0
    gm_mutable: true
  field: technique_slots_max
    label: Tech Max
    type: value
    group: power
    gm_mutable: false
  field: power_rank
    label: PWR
    type: value
    group: attributes
    gm_mutable: false
  field: speed_rank
    label: SPD
    type: value
    group: attributes
    gm_mutable: false
  field: resolve_rank
    label: RES
    type: value
    group: attributes
    gm_mutable: false
  field: conditions
    label: Status
    type: list
    group: status
    gm_mutable: true
  field: inventory
    label: Items
    type: list
    group: status
    gm_mutable: true

hp: 35
hp_max: 35
ki: 40
ki_max: 40
technique_slots: 3
technique_slots_max: 3
power_rank: 14
speed_rank: 16
resolve_rank: 12
conditions:
inventory: Training gi; Communication crystal; 200 credits
[PLAYER_SHEET_END]
```

---

## WORLD_TIME block reference

The GM emits this when in-world time advances. The extension updates the
displayed time, then applies regen to all fields with regen rules.

```
[WORLD_TIME_BEGIN]
datetime: Day 4, 14:32, Month of Embers
elapsed: 2h 15m
resting: false
[WORLD_TIME_END]
```

**`elapsed` formats accepted:**
`2h 30m` | `90m` | `1 day 4h` | `45 minutes` | `3 days`

**`resting: true`** — triggers regen on fields with `regen_condition: resting`.
Fields with `regen_condition: always` regen regardless.

Negative `regen_rate` values (like hunger and thirst) decrease the field
over time, capped at 0. Positive values increase, capped at max.

---

## PLAYER_UPDATE block reference

GM emits this when stats change. Only `gm_mutable: true` fields are applied.

```
[PLAYER_UPDATE_BEGIN]
hp: 14
conditions: +Poisoned, -Stunned
inventory: -Lockpicks; +Iron key (cell block B)
ki: 32
[PLAYER_UPDATE_END]
```

`+` prefix adds to a list. `-` prefix removes. No prefix = full replace.
Numeric fields are always full replacement (GM calculates the new total).

---

## Mutability modes reference

| Mode | Schema key | Writable via | Use for |
|---|---|---|---|
| `immutable` | `mutability: immutable` | Nothing — locked forever | Race, species, origin traits |
| `gm_mutable` | `mutability: gm_mutable` | `PLAYER_UPDATE` | HP, MP, conditions, inventory, pools, XP |
| `gm_event` | `mutability: gm_event` | `ATTR_CHANGE` only (requires `reason`) | STR/DEX on level-up, skill ranks on milestone |
| `use_tracked` | `mutability: use_tracked` | Auto-promotes when `{key}_uses` hits `uses_threshold` | Skills/stats that grow through repeated use |

Legacy `gm_mutable: true` maps to `gm_mutable`. `gm_mutable: false` maps to `immutable`.

---

## ATTR_CHANGE block reference

Used by the GM to modify `gm_event` fields. Rejected if `reason` is missing.
Logged to the character's `attr_change_log` in chatMetadata.

```
[ATTR_CHANGE_BEGIN]
reason: Level 3 — Fighter attribute bonus
str: 18
con: 14
[ATTR_CHANGE_END]
```

```
[ATTR_CHANGE_BEGIN]
reason: Milestone — survived the Ashveil curse
willpower: 7
[ATTR_CHANGE_END]
```

The GM card's system prompt should specify exactly when ATTR_CHANGE is appropriate
for a given system (on level-up, on milestone, on narrative event, etc.).

---

## Example 4 — Level-up system (gm_event attributes)

Attributes set at character creation, modified only on level-up grants.
Skills are gm_mutable (trained normally). Level and XP track progression.

```
[PLAYER_SHEET_BEGIN]
name: Aldric Holt
class: Warrior
background: Mercenary Captain

schema:
  groups: vitals, attributes, skills, progression, status
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
  field: str
    label: STR
    type: value
    group: attributes
    color: #e08060
    mutability: gm_event
  field: dex
    label: DEX
    type: value
    group: attributes
    color: #60d0a0
    mutability: gm_event
  field: con
    label: CON
    type: value
    group: attributes
    color: #d06060
    mutability: gm_event
  field: int
    label: INT
    type: value
    group: attributes
    color: #6080e0
    mutability: gm_event
  field: athletics
    label: Athletics
    type: value
    group: skills
    mutability: gm_mutable
  field: intimidation
    label: Intimidation
    type: value
    group: skills
    mutability: gm_mutable
  field: survival
    label: Survival
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

hp: 28
hp_max: 28
str: 16
dex: 12
con: 14
int: 10
athletics: 4
intimidation: 3
survival: 2
level: 1
xp: 0
conditions:
inventory: Longsword; Shield; Chain mail; Rations (3); 40 gold
[PLAYER_SHEET_END]
```

When the warrior hits level 2, the GM emits:
```
[ATTR_CHANGE_BEGIN]
reason: Level 2 — Warrior Constitution bonus
con: 16
hp_max: 32
level: 2
[ATTR_CHANGE_END]
```

---

## Example 5 — Use-tracked skill growth (levelless system)

No levels. Attributes grow by using them. Skills have use counters.
Base attributes are immutable. Skills promote automatically.

```
[PLAYER_SHEET_BEGIN]
name: Sera Nightfall
class: Wanderer
background: Disgraced Noble

schema:
  groups: vitals, core_attributes, skills, status
  field: hp
    label: Wounds
    type: bar
    group: vitals
    max_field: hp_max
    color: #d06060
    mutability: gm_mutable
    regen_rate: 1
    regen_unit: hour
    regen_condition: resting
  field: hp_max
    label: Wound Cap
    type: value
    group: vitals
    mutability: immutable
  field: physique
    label: PHY
    type: value
    group: core_attributes
    mutability: immutable
  field: reflex
    label: REF
    type: value
    group: core_attributes
    mutability: immutable
  field: wits
    label: WIT
    type: value
    group: core_attributes
    mutability: immutable
  field: presence
    label: PRE
    type: value
    group: core_attributes
    mutability: immutable
  field: blade
    label: Blade
    type: value
    group: skills
    color: #e08060
    mutability: use_tracked
    uses_threshold: 5
    uses_gain: 1
  field: blade_uses
    label: Blade Uses
    type: value
    group: skills
    mutability: gm_mutable
  field: stealth
    label: Stealth
    type: value
    group: skills
    color: #6080a0
    mutability: use_tracked
    uses_threshold: 4
    uses_gain: 1
  field: stealth_uses
    label: Stealth Uses
    type: value
    group: skills
    mutability: gm_mutable
  field: persuasion
    label: Persuasion
    type: value
    group: skills
    color: #d0a040
    mutability: use_tracked
    uses_threshold: 6
    uses_gain: 1
  field: persuasion_uses
    label: Persuasion Uses
    type: value
    group: skills
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

hp: 12
hp_max: 12
physique: 8
reflex: 11
wits: 10
presence: 13
blade: 3
blade_uses: 0
stealth: 4
stealth_uses: 0
persuasion: 2
persuasion_uses: 0
conditions:
inventory: Rapier; Nobleman's signet (false); Travelling cloak; 8 silver
[PLAYER_SHEET_END]
```

After a combat where Sera used her blade heavily, the GM emits:
```
[PLAYER_UPDATE_BEGIN]
hp: 8
conditions: +Bruised
blade_uses: 3
[PLAYER_UPDATE_END]
```

Later, after more fights bring blade_uses to 5, the extension automatically
promotes `blade` from 3 to 4, resets `blade_uses` to 0, shows a toast
notification, and logs the promotion to the attr_change_log.

---

## NPC block reference (v5)

### NPC_BEGIN — creates static core + optional initial state

```
[NPC_BEGIN]
name: Serath Veln
race: Half-elf
role: Innkeeper, The Broken Lantern, Millhaven
traits: Gruff, evasive, loyal to old debts
appearance: Tall, scarred left forearm, perpetually tired eyes
secrets: Owes three years' taxes to the Thornfield Guild
dynamic_fields: attitude, location, condition, relationship_to_party, notes
attitude: Suspicious
location: Behind the bar, Broken Lantern
condition: Tired but alert
relationship_to_party: Stranger — no established trust
keywords: Serath, Serath Veln, innkeeper, Broken Lantern, Millhaven inn
[NPC_END]
```

`dynamic_fields` declares which fields the GM can update via NPC_UPDATE.
Everything else becomes static core — immutable after first write.
Initial values for dynamic fields (like `attitude: Suspicious`) are written
to the companion `[NPC:State]` entry immediately.

### NPC_UPDATE — updates only dynamic_fields

```
[NPC_UPDATE_BEGIN]
name: Serath Veln
attitude: Cautiously helpful
relationship_to_party: Owes party a debt — helped them escape the Thornfield ambush
notes: Now aware the party knows about his tax debt. Nervous but cooperative.
[NPC_UPDATE_END]
```

Blocked fields (not in `dynamic_fields`) are silently rejected with a console warning.

### NPC_MEMORY — creates entry in per-NPC lorebook

Core memories are constant (always injected when NPC lorebook is active).
Episodic memories are keyword-triggered.

```
[NPC_MEMORY_BEGIN]
npc: Serath Veln
type: core
title: Serath's defining secret
content: Serath Veln witnessed Guildmaster Vex Anora murder a city inspector three years ago. The Guild has owned his silence ever since, collecting it as unpaid taxes. He is terrified of the Guild and will never speak of this unprompted — but the fear shows in small ways when the Guild is mentioned.
[NPC_MEMORY_END]
```

```
[NPC_MEMORY_BEGIN]
npc: Serath Veln
type: episodic
title: The Thornfield ambush warning
content: Serath quietly warned the party about the Thornfield Guild ambush waiting outside the inn on Night 4, at significant personal risk. He asked for nothing in return but clearly expected them to remember it.
keywords: ambush, Thornfield warning, inn warning, night four, Serath warning
[NPC_MEMORY_END]
```

The extension auto-creates `npc-serath-veln` lorebook and links it to the
current chat. Core memories are constant (order 1). Episodic memories only
inject when their keywords appear in recent messages (order 50).

---

## Item block reference (v5)

### ITEM_BEGIN — creates item with declared mutable fields

```
[ITEM_BEGIN]
name: The Silthorn Compass
type: Magical navigation device
properties: Points to nearest active gate rather than magnetic north
history: Stolen from the Archivist of Vel-Doran, generation unknown
current_holder: Mira Ashgate (party)
durability: 85
durability_max: 100
charges: 12
charges_max: 20
mutable_fields: durability, charges, current_holder
keywords: Silthorn Compass, compass, gate compass, Vel-Doran artefact
[ITEM_END]
```

The `condition` label (Pristine/Good/Worn/Damaged/Broken) is derived
automatically from `durability / durability_max` percentage.

Non-durability items just omit those fields:
```
[ITEM_BEGIN]
name: Mira's Lockpick Set
type: Tool
quality: Master-crafted
mutable_fields: current_holder
keywords: lockpicks, Mira's lockpicks
[ITEM_END]
```

### ITEM_UPDATE — updates only mutable_fields

```
[ITEM_UPDATE_BEGIN]
name: The Silthorn Compass
durability: 62
charges: 8
[ITEM_UPDATE_END]
```

Condition label recalculates automatically (62/100 = 62% → Worn).

---

## Bestiary block reference (v5)

Completely immutable. Never write a second BESTIARY block for the same creature.
Use range syntax for variable stats. Use `_per_level` suffix for scaling.

```
[BESTIARY_BEGIN]
name: Echo-Wraith
type: Undead spirit
origin: Failed binding ritual, Ashveil Ruins
hp: 18-28
armour: 0
attack_bonus: 3-5
damage: 1d6+2
speed: hover 30ft
special: Incorporeal (non-magical weapons deal half damage); Echo Scream (DC 14 WIS save or frightened 1 round)
weakness: Radiant damage; Loud sustained noise disrupts movement
hp_per_level: 6
attack_bonus_per_level: 1
senses: Blindsight 60ft, immune to darkness
keywords: Echo-Wraith, echo wraith, wraith, Ashveil undead
[BESTIARY_END]
```

The lorebook entry shows ranges as-written. The `_per_level` fields appear
under a `Scaling:` section so the GM can calculate stats for higher-level
encounters without a separate entry per tier.

---

## NPC with full schema (v6)

Significant NPCs can carry a full schema block in `NPC_BEGIN`, giving them
the same progression machinery as the player. The schema is stored in the
core lorebook entry's extensions blob (not injected into context) and used
by the extension whenever NPC_UPDATE, NPC_ATTR_CHANGE, or WORLD_TIME runs.

Three lorebook entries are created per significant NPC:
- `[NPC] Name` — immutable core (race, origin, appearance, fixed traits)
- `[NPC:State] Name` — mutable state (attitude, location) + gm_mutable schema values
- `[NPC:Progression] Name` — compact summary of all schema field values

All three share the NPC's keywords and inject together when the NPC is mentioned.

### Example — Recurring adventurer NPC

```
[NPC_BEGIN]
name: Aldric Holt
race: Human
role: Freelance sword-for-hire
appearance: Mid-thirties, square jaw, greying temples. Moves like someone who's survived by being careful.
origin: Former city guard, dishonourably discharged after refusing an order to kill civilians
defining_trait: Pragmatic loyalty — won't break a contract but won't follow orders that cross a line
dynamic_fields: attitude, location, current_contract, condition, relationship_to_party, notes

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
  field: str
    label: STR
    type: value
    group: combat
    mutability: gm_event
  field: dex
    label: DEX
    type: value
    group: combat
    mutability: gm_event
  field: blade
    label: Blade
    type: value
    group: skills
    color: #d08040
    mutability: use_tracked
    uses_threshold: 6
    uses_gain: 1
  field: blade_uses
    label: Blade Uses
    type: value
    group: skills
    mutability: gm_mutable
  field: tactics
    label: Tactics
    type: value
    group: skills
    color: #6090c0
    mutability: use_tracked
    uses_threshold: 5
    uses_gain: 1
  field: tactics_uses
    label: Tactics Uses
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

attitude: Neutral — assessing the party
location: The Broken Lantern, Millhaven
current_contract: None
condition: Healthy
relationship_to_party: Stranger — encountered in the inn
notes: Was watching the party's table for most of the evening

hp: 24
hp_max: 24
str: 14
dex: 13
blade: 4
blade_uses: 0
tactics: 3
tactics_uses: 0
level: 2
xp: 0

keywords: Aldric, Aldric Holt, sword-for-hire, freelance, grey temples
[NPC_END]
```

### NPC_UPDATE — routine changes + use-counter increments

After a fight where Aldric fought alongside the party:
```
[NPC_UPDATE_BEGIN]
name: Aldric Holt
hp: 18
attitude: Cautiously positive — they handled themselves well
relationship_to_party: Allies of convenience
blade_uses: 3
tactics_uses: 2
xp: 150
[NPC_UPDATE_END]
```

The extension applies hp (gm_mutable), attitude and relationship (dynamic_fields),
blade_uses and tactics_uses (use_tracked counters), and xp (gm_mutable).
It checks whether blade_uses (3) or tactics_uses (2) have hit their thresholds (6/5).
Neither has yet — no promotion fires.

### NPC_ATTR_CHANGE — milestone-driven stat change

Several sessions later, Aldric survives a campaign-defining battle:
```
[NPC_ATTR_CHANGE_BEGIN]
name: Aldric Holt
reason: Survived the Siege of Millhaven — veteran's growth
str: 15
hp_max: 28
level: 3
[NPC_ATTR_CHANGE_END]
```

The extension:
- Verifies str, hp_max, level are all gm_event in Aldric's schema ✓
- Updates the Progression entry
- Automatically writes an episodic NPC memory to `npc-aldric-holt`:
  "Milestone: Survived the Siege of Millhaven — veteran's growth. str:14→15, hp_max:24→28, level:2→3."

### Use-tracked auto-promotion

After more encounters bring blade_uses to 6 (threshold):
The extension promotes Aldric's blade from 4→5, resets blade_uses to 0,
fires a toast notification, and writes an episodic memory:
"Aldric's Blade improved from 4 to 5 through repeated use."

### WORLD_TIME regen applies to NPCs too

When the GM advances time:
```
[WORLD_TIME_BEGIN]
datetime: Day 12, Morning, Month of Embers
elapsed: 8h
resting: true
[WORLD_TIME_END]
```

The extension iterates all campaign lorebook NPCs that have schemas with regen fields.
Aldric has `regen_rate: 2, regen_unit: hour, regen_condition: resting`.
8 hours resting → +16 HP, capped at hp_max (28). His State entry updates automatically.
No GM block needed.

---

## Veridia System — Complete Session Start Sequence

The following blocks configure a full Veridia campaign. Paste them into the first chat message with the GM card.

### Step 1: Configure skill system

```
[SKILL_SYSTEM_BEGIN]
mode: pp
levels_per_tier: 10
tiers: Novice, Apprentice, Adept, Expert, Master, Grandmaster, Saint, God
pp_per_level: 100 * tier_rank
score_formula: 10 + total_levels * 2.5
[SKILL_SYSTEM_END]
```

### Step 2: Character sheet

```
[PLAYER_SHEET_BEGIN]
name: Eam
class: Voidtouched Reincarnator
background: Soul from another world — arrived via Kairos

schema:
  groups: vitals, attributes, defense, needs, progression, status
  field: hp
    label: HP
    type: bar
    group: vitals
    max_field: hp_max
    color: #7ec87e
    mutability: gm_mutable
    regen_rate: 3
    regen_unit: minute
    regen_condition: always
  field: hp_max
    label: HP Max
    type: value
    group: vitals
    mutability: gm_event
  field: mp
    label: MP
    type: bar
    group: vitals
    max_field: mp_max
    color: #6080e0
    mutability: gm_mutable
    regen_rate: 20
    regen_unit: minute
    regen_condition: always
  field: mp_max
    label: MP Max
    type: value
    group: vitals
    mutability: gm_event
  field: vigor
    label: Vigor
    type: bar
    group: vitals
    max_field: vigor_max
    color: #e0a040
    mutability: gm_mutable
    regen_rate: 5
    regen_unit: minute
    regen_condition: always
  field: vigor_max
    label: Vigor Max
    type: value
    group: vitals
    mutability: gm_event
  field: mgt
    label: MGT
    type: value
    group: attributes
    mutability: gm_event
  field: agi
    label: AGI
    type: value
    group: attributes
    mutability: gm_event
  field: int
    label: INT
    type: value
    group: attributes
    mutability: gm_event
  field: wit
    label: WIT
    type: value
    group: attributes
    mutability: gm_event
  field: for
    label: FOR
    type: value
    group: attributes
    mutability: gm_event
  field: res
    label: RES
    type: value
    group: attributes
    mutability: gm_event
  field: per
    label: PER
    type: value
    group: attributes
    mutability: gm_event
  field: pre
    label: PRE
    type: value
    group: attributes
    mutability: gm_event
  field: pd
    label: PD
    type: value
    group: defense
    mutability: gm_mutable
  field: md
    label: MD
    type: value
    group: defense
    mutability: gm_mutable
  field: initiative
    label: Initiative
    type: value
    group: defense
    mutability: gm_mutable
  field: hunger
    label: Hunger
    type: bar
    group: needs
    max_field: hunger_max
    color: #d09040
    mutability: gm_mutable
    regen_rate: -0
    regen_unit: minute
    regen_condition: never
  field: hunger_max
    label: Hunger Max
    type: value
    group: needs
    mutability: immutable
  field: thirst
    label: Thirst
    type: bar
    group: needs
    max_field: thirst_max
    color: #4090d0
    mutability: gm_mutable
    regen_rate: -0
    regen_unit: minute
    regen_condition: never
  field: thirst_max
    label: Thirst Max
    type: value
    group: needs
    mutability: immutable
  field: fatigue
    label: Fatigue
    type: bar
    group: needs
    max_field: fatigue_max
    color: #c06060
    mutability: gm_mutable
    regen_rate: -0
    regen_unit: minute
    regen_condition: never
  field: fatigue_max
    label: Fatigue Max
    type: value
    group: needs
    mutability: immutable
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
  field: xp_next
    label: XP Next
    type: value
    group: progression
    mutability: gm_mutable
  field: guild_rank
    label: Guild Rank
    type: text
    group: progression
    mutability: gm_event
  field: creature_rank
    label: Creature Rank
    type: text
    group: progression
    mutability: gm_event
  field: ap_unspent
    label: AP (Unspent)
    type: value
    group: progression
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

hp: 125
hp_max: 125
mp: 297
mp_max: 320
vigor: 120
vigor_max: 125
mgt: 20
agi: 20
int: 55
wit: 55
for: 21
res: 20
per: 20
pre: 5
pd: 4
md: 4
initiative: 37
hunger: 88
hunger_max: 100
thirst: 88
thirst_max: 100
fatigue: 45
fatigue_max: 100
level: 1
xp: 100
xp_next: 1000
guild_rank: F
creature_rank: F
ap_unspent: 0
conditions:
inventory: Simple clothes; Short knife; Small leather pouch (10 slots); 50 Silver
[PLAYER_SHEET_END]
```

### Step 3: Define the narrative header format

```
[HEADER_FORMAT_BEGIN]
Name: {name}   Rank: {creature_rank} / Guild: {guild_rank}
Level: {level}   XP: {xp}/{xp_next}   AP: {ap_unspent} unspent
{time}
HP: {hp}/{hp_max} ({hp_regen}/min)   MP: {mp}/{mp_max} ({mp_regen}/min)   Vigor: {vigor}/{vigor_max} ({vigor_regen}/min)
Fatigue: {fatigue}%   Hunger: {hunger}%   Thirst: {thirst}%
Conditions: {conditions}   Inventory: {inventory_count}/10 slots
[HEADER_FORMAT_END]
```

### Example SKILL_UPDATE block (after a swordfight)

```
[SKILL_UPDATE_BEGIN]
skill: Swordsmanship
pp: 20
governing: AGI, MGT
skill: Awareness
pp: 10
governing: PER, WIT
[SKILL_UPDATE_END]
```

### Example SKILL_UPDATE with branch unlock

```
[SKILL_UPDATE_BEGIN]
skill: Swordsmanship
pp: 15
governing: AGI, MGT
branch: Parry
[SKILL_UPDATE_END]
```

### Example NPC_UPDATE after combat (significant NPC, Veridia-style)

```
[NPC_UPDATE_BEGIN]
name: Aldric Holt
hp: 18
attitude: Grudging respect — party proved capable
blade_uses: +3
xp: 150
notes: Took a cut across the shoulder from the goblin ambush. Still functional.
[NPC_UPDATE_END]
```
