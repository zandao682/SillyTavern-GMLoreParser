# Test Plan — gm-lore-parser

A comprehensive **manual** test plan, run by hand in SillyTavern using the **Test Harness** card (`test-harness-card.json`). Nothing here is automated — the extension only runs inside SillyTavern. The narrative header is now built into gm-lore-parser (the former standalone `gm-narrative-header` extension is deprecated and must be disabled/removed, or headers double-prepend).

> Testing **The Architect** (the system-designer card) and the **GM cards it produces** is a separate plan: [`ARCHITECT-TESTING.md`](ARCHITECT-TESTING.md). This file covers the extension itself.

---

## 1. Purpose & scope

Exercise every block type, `#` command, System-Definition section, status-panel section, context-injection path, lorebook side effect, the party/scene rosters, GM behavioral directives, the always-on lorebook audit, and the built-in narrative-header tokens — plus cross-cutting behavior (feature gating, persistence, formula safety) and regression/edge cases.

## 2. Prerequisites / setup

| # | Step | Verify |
|---|------|--------|
| P1 | Install gm-lore-parser under `…/extensions/third-party/`, reload ST. **Disable/remove the standalone gm-narrative-header** if present. | Console: `[gm-lore-parser] v0.0.20 loaded…` listing modules incl. `telemetry, scene, header`; its drawer appears under Extensions; no `[gm-narrative-header]` active-load line. |
| P2 | World Info → create lorebook **`harness-campaign`** (empty). | Appears in World Info. |
| P3 | gm-lore-parser settings → **Campaign Lorebook = `harness-campaign`**. | Persists across reload. |
| P4 | gm-lore-parser settings: Enabled ✔, Hide raw blocks ✔, Toasts ✔, Intercept # commands ✔, Inject into context ✔, Inject resolution ✔, all panels ✔, Scan user messages ✘. | Checkboxes match. |
| P5 | Import **`test-harness-card.json`** (Characters → Import). Start a new chat with it. | Greeting menu shows. |
| P6 | Ensure `harness-campaign` is active for this chat (World Info → active, or rely on auto-link). | Lorebook in chat's active set. |
| P7 | gm-lore-parser settings → **Narrative Header** sub-section: Enabled ✔, Show on every message ✔, Use `[HEADER_FORMAT]` block ✔, separator `---`, manual format blank. Scene panel ✔, Party panel ✔. | Persists across reload. |

> **Critical:** Most lore blocks and SYSTEM_DEF persistence **no-op without a campaign lorebook** (`index.js` gates `LORE_BLOCKS`/`UPDATE_BLOCKS` on `settings.campaignLorebook`). Always run **SD-01 first** — nearly everything reads `getSystemDef()` and feature gating.

## 3. Conventions

- **Test ID:** `AREA-NN` (e.g. `SD-01`, `ENT-03`, `XC-GATE-02`, `HDR-04`, `REG-05`).
- **Action:** the harness directive to type (e.g. `emit: entity player`), a `#command`, or a settings change. The harness reply carries the block — **blocks are only parsed in AI messages**, never in your own.
- **Observable result types:** status-panel change · lorebook entry created/updated (identified by its `comment`, e.g. `[NPC:State] Garrick Stone`) · `#`command output · context injection (inspect via ST's "show raw prompt"/prompt inspector) · toast text · file download · DOM strip (raw block vanishes from the rendered message).
- Each test: **ID · Precondition · Action · Expected**.

---

## 4. Ordered run

### 4.1 Ruleset bring-up
| ID | Precondition | Action | Expected |
|----|----|----|----|
| SD-01 | P1–P6 | `emit: system_def default` | Toast "entry saved"; lorebook gains a **constant** entry `[System Definition]` whose content lists `Features: …`, `Attributes: …`, `Resolution: d20 + modifier vs. DC`. `chatMetadata['gm-lore-parser'].system_def.name === 'Default (Veridia)'`. |
| SD-02 | SD-01 | `emit: system_def minimal_skill` | `[System Definition]` entry upserted (same comment); summary shows `Progression: levelless`, only `Features: capabilities`. Reputation/currency/etc. blocks now no-op (see XC-GATE). |
| SD-RULE-01 | SD-01 | After `emit: system_def default`, inspect `harness-campaign` | Keyword-triggered (NON-constant) `[System Rule]` entries exist (Resolution, Capabilities, Reputation, Ranks, Companions, Needs, Progression). Each entry's `key` list is derived from the def's vocabulary (e.g. Capabilities keys include the category names + tier names `novice…god`; Reputation keys include `hostile…sworn`). The always-on `[System Definition]` summary stays terse (no full difficulty table). |
| SD-RULE-02 | SD-RULE-01 | `emit: system_def minimal_skill` (reputation/ranks off) | `[System Rule] Reputation` and `[System Rule] Ranks` are pruned from the lorebook; Capabilities + Progression rules remain. |
| SD-PROG-01 | P1–P6 | `emit: system_def custom_progression` (a profile of `type: counter` mapped to the skill category), then `emit: capability skill "Tracking"` + `emit: capability_update "Tracking" level:3` | Tracking advances as a flat counter to Lv3 (no PP/tiers); a static `none` capability declared alongside never changes level/score. |
| SD-DIR-01 | SD-01 | After `emit: system_def default`, inspect `harness-campaign` | A **constant** `[GM Directives]` entry exists with the four default directives as terse bullets (knowledge-scoping, no-auto-bond, player-can-fail, player-agency). Keys `gm directives`, `directives`. |
| SD-DIR-02 | P1–P6 | `emit: system_def` with a `directives:` section that sets `disable: player_agency` and overrides `knowledge_scoping:` | `[GM Directives]` re-emitted: player_agency bullet gone, knowledge_scoping shows the new text; `emit_directives: false` would suppress the entry entirely. |

### 4.2 Character creation
| ID | Precondition | Action | Expected |
|----|----|----|----|
| CC-01 | SD-01 | `emit: char_create sequence` | While active: creation panel "Creating: Aria Lumen" with ✓ steps; context injects `[Character Creation — In Progress]`. After finalize: normal sheet, `state.name` set, derived hp/mp/vigor present & non-zero, gold + inventory populated. |
| CC-02 | SD-01, no session | `emit: char_create step_only` | No change; console warns "CHAR_CREATE_STEP received outside of creation session — ignoring." |

### 4.3 Entities
| ID | Precondition | Action | Expected |
|----|----|----|----|
| ENT-01 | SD-01 | `emit: entity player` | Panel renders the sheet (HP bar, conditions pills, inventory split on `;`); derived stats fill unset targets; context shows `[Character: …]` + value summary. |
| ENT-ATTR-01 | SD-01 (def has 5 attributes) | `emit: entity player` whose `schema:` declares fields for only 2 attributes but sets values for all 5 | All 5 attributes show in the panel + value summary — the 3 undeclared ones are backfilled from the def's `attributes:` as `gm_event` fields (def is source of truth). An attribute with no value is not shown (no blank row). |
| ENT-04 | SD-01, `emit: entity npc` ("Garrick Stone") | `emit: entity_update npc "Garrick Stone" attitude:Wary` | `[NPC:State] Garrick Stone` updated; `[NPC] Garrick Stone` (core) unchanged; `[NPC:Progression] Garrick Stone` reflects schema. |
| ENT-EVT-01 | ENT-01 | `emit: entity_event player` (with reason) | gm_event field changes; an entry appears in `attr_change_log` (inspect via console `getCharState()`). |
| ENT-MEM-01 | ENT-04 | `emit: entity_memory` | Campaign-scoped per-NPC lorebook `harness-campaign-npc-garrick-stone` created + linked; a `[Memory] Garrick Stone — …` entry added. The entry is **keyword-triggered** on the NPC name (`constant:false`) for an *episodic* memory; a `memory_type: core` memory is also `constant:false` but `order:1` (ranks first) — neither is always-on. |
| ENT-MEM-02 | ENT-04 | `emit: entity_memory` with `memory_type: core` | Same book; the core memory entry has `constant:false`, `order:1`, and keys = the NPC name (`expandNameKeys`) — it loads only when "Garrick Stone" is referenced (narration, or the constant `[Scene]`/`[Party]` entry naming him → recursive scan), NOT in every prompt. |
| ENT-MEM-SCOPE-01 | two campaigns | Set Campaign Lorebook `camp-a`, `emit: entity npc "Garrick Stone"` + `entity_memory`; switch Campaign Lorebook to `camp-b`, repeat | Two distinct books `camp-a-npc-garrick-stone` and `camp-b-npc-garrick-stone` — no shared `npc-garrick-stone`; memories do not bleed between campaigns. |

### 4.4 Capabilities (static)
| ID | Precondition | Action | Expected |
|----|----|----|----|
| CAP-01 | SD-01, ENT-01 | `emit: capability boon` | Capabilities panel lists "Ironhide"; `[Capability] Ironhide` entry; `#boons` shows it. |
| CAP-02 | CAP-01 | `emit: capability title "Dragonslayer"` then `emit: capability title "Lord of Ash"` | Only the latter is `active` (★); `#titles` shows one ★, one ○; `{active_title}` = "Lord of Ash". |
| CAP-EVO-01 | ENT-01 (with might/fortitude) | `emit: capability evolution` | `stat_changes` applied as a logged event (might +2, fortitude +1); `#abilities` lists the static capabilities. |

### 4.5 Capabilities (progressing)
| ID | Precondition | Action | Expected |
|----|----|----|----|
| CAP-PRG-01 | SD-01 | `emit: capability skill "Swordsmanship"` then `emit: capability_update "Swordsmanship" points:250` | `#skills` shows `Swordsmanship: Novice/Apprentice Lv… \| PP …/… \| Score …` (veridia_pp profile); tier/level toasts; branch "Riposte" unlock toast. `{skill_score:Swordsmanship}` resolves to `prog.score`. |
| CAP-PRG-02 | SD-PROG-01 (custom_progression def) | `emit: capability_update "Tracking" level:3` | Flat-counter advance to Lv3, no tiers; panel/`#skills` show the level without a PP bar. |
| CAP-LAZY-01 | SD-01 | `emit: capability_update "Alchemy" points:120` (no prior declaration) | Capability lazily created under the first progressing category and advanced; appears in `#skills`. |
| CAP-BACKFILL-01 (0.0.20) | a capability exists in state but its `[Capability] <name>` lorebook entry is **missing** (e.g. it was created before the Campaign Lorebook was set, or the entry was deleted) | trigger a player rebuild (any capability change / chat reload) | `backfillCapabilityEntries` (called from `rebuildPlayerLoreEntries`) recreates the missing `[Capability] <name>` entry — panel click-to-view finds it again. Only missing entries are written (present ones untouched). The narrator already saw the capability via the bundled `[Player:Skills]` entry regardless. **Verified live 0.0.20.** |

### 4.6 Progression & economy
| ID | Precondition | Action | Expected |
|----|----|----|----|
| ECO-01 | SD-01 | `emit: currency_update` | Currency panel: gold +50, silver clamped ≥0; `#currency` / `#wallet` reflects totals. |
| PRG-01 | SD-01 | `emit: rank_change adventurer` | `#rank` shows C; rank panel bar advances; history F→C. |
| PRG-XP-01 | SD-01, ENT-01 with `xp` field | `emit: xp_award` | `xp` value increases by 250; `state.xp_total` tracked. |

### 4.7 Reputation & factions
| ID | Precondition | Action | Expected |
|----|----|----|----|
| REP-01 | SD-01 | `emit: faction "Iron Concord"` | `[Faction] Iron Concord` entry; reputation auto-seeded at 50 → Neutral tier; rep panel bar ~50%. |
| REP-02 | REP-01 | `emit: reputation_update "Iron Concord" change:+20 reason:"Saved the caravan"` | Same combined entry updated; standing 70, tier up; `#rep` shows new tier + last reason. |
| REP-FU-01 | REP-01 | `emit: faction_update` | Mutable lore fields update on the same `[Faction]` entry. |

### 4.8 Quests
| ID | Precondition | Action | Expected |
|----|----|----|----|
| QST-01 | SD-01 | `emit: quest "The Lost Heir"` | `[Quest] The Lost Heir` entry; quest panel Active `0/2`; context `[Active Quests]`. |
| QST-02 | QST-01 | `emit: quest_update "The Lost Heir" objective_1:complete` | Entry rewritten; objective 1 `[X]`. |

### 4.9 World events & plot
| ID | Precondition | Action | Expected |
|----|----|----|----|
| EVT-01 | SD-01 | `emit: world_event` | `[World Event] Siege of Thornwall` entry; events panel Ongoing; context `[Ongoing World Events]`. |
| EVT-WU-01 | EVT-01 | `emit: world_event_update` | Status → Resolved; panel/entry updated. |
| EVT-02 | SD-01 (plot lorebook blank) | `emit: plot_entry` | Auto-creates + links `harness-campaign-plot`; adds `[Plot] The Stolen Crown`. |

### 4.10 World time & regen
| ID | Precondition | Action | Expected |
|----|----|----|----|
| TIM-01 | ENT-01 (hp below max, hp has `regen_rate:5 regen_unit:hour`) | `emit: world_time` (elapsed 2h, resting) | HP rises ~10 (clamped at max); `#vitals` reflects it; world-time display updates. |
| TIM-02 | A use_tracked field near threshold, or a schema-bearing NPC with regen | `emit: world_time elapsed:"1 day"` | Use-tracked promotion toast (player); NPC regen rebuilds `[NPC:State]`/`[NPC:Progression]` and writes a per-NPC episodic memory on promotion. |

### 4.11 Needs
| ID | Precondition | Action | Expected |
|----|----|----|----|
| NDS-01 | SD-01 | `emit: needs_system` | Needs panel two full bars; `#needs` ASCII bars at 100%; **no** needs context injection (above warn). |
| NDS-02 | NDS-01 | `emit: needs_update` (hunger −80 → 20) | Bar turns warn color; context now injects `[Needs — Attention Required] Hunger: 20/100 (20%) [LOW]`. |

### 4.12 Possessions & locations
| ID | Precondition | Action | Expected |
|----|----|----|----|
| POS-01 | SD with `equipment.enabled`, slots; player exists | `emit: entity_update player equip:"main_hand=Iron Sword"` | `state.equipment.main_hand` set; `#equipment` shows it; context `[Equipped] Main Hand: Iron Sword`. |
| POS-BOX-01 | SD with `inventory.item_box:true` (Veridia default) | `emit: item_box_update` | `#itembox` lists "Sword of Embers (Worn)", "Healing Draught"; the box also shows in the panel's Equipment & Inventory section + `[Player:Possessions]`. |
| POS-BOX-02 | SD with an `inventory:` section that omits `item_box` | `emit: item_box_update` | **Rejected** — nothing stored; `#itembox` says "This system has no item box." (no invisible storage). |
| POS-ITEM-01 | SD-01 | `emit: item` | `[Item] The Silthorn Compass` entry; condition label derived from durability (85→Good). |
| LOC-01 | SD-01 | `emit: location "Thornwall Keep"` then `emit: location_memory "Thornwall Keep"` | `[Location] Thornwall Keep` entry; auto-creates + links campaign-scoped `harness-campaign-location-thornwall-keep`; a `[Memory] …` entry added there (keyword-triggered on the location name). |

### 4.13 Domains
| ID | Precondition | Action | Expected |
|----|----|----|----|
| DOM-01 | SD-01 | `emit: domain_update` | Domain panel shows Greywatch Hold stats; `#domain` reflects them. |

### 4.13b Party & scene rosters
| ID | Precondition | Action | Expected |
|----|----|----|----|
| PTY-01 | SD-01 | `emit: party_update add` (Ember, Garrick Stone) | `chatMetadata['gm-lore-parser'].party` has both members; a **constant** `[Party]` entry (keys `party`/`the party`/`group`) lists them terse (name — role); Party panel section shows them. |
| PTY-02 | PTY-01 | `emit: party_update remove` ("Garrick Stone") | Garrick removed from `state.party` and the `[Party]` entry; Ember remains. |
| PTY-03 | PTY-01 | `emit: party_update clear` | `state.party` empty; `[Party]` entry content = "Travelling alone."; panel section hides. |
| SCN-01 | SD-01 | `emit: scene_update set` (location + two members) | `state.scene` has both, `state.scene_location` set; a **constant** `[Scene]` entry (keys `scene`/`present`/`here`) shows `Location: …` + members; Scene panel section shows them. |
| SCN-02 | SCN-01 | `emit: scene_update enter` ("Marshal Vane") then `emit: scene_update exit` ("Ember") | Vane added, Ember removed in `state.scene` and the `[Scene]` entry; location unchanged. |
| SCN-03 | SCN-01 | `emit: scene_update location` (new place) | `state.scene_location` updated; `[Scene]` entry's Location line changes; roster unchanged. |
| SCN-04 | SCN-01 | `emit: scene_update clear` | `state.scene` empty, location cleared; `[Scene]` content = "No other characters present." |
| PSC-LINK-01 | `emit: entity companion` ("Ember"), then PTY-01 | In the Party panel, the "Ember" row is clickable (`.glp-member`); clicking opens Ember's `[Companion]`/`[NPC]` lore popup. A member with no matching record is plain text. |

### 4.14 Generic lore
| ID | Precondition | Action | Expected |
|----|----|----|----|
| LORE-RULE-01 | SD-01 | `emit: rule` | `[Rule] Initiative` entry (keyword-triggered, rule order). |
| LORE-EVT-01 | SD-01 | `emit: event` | `[Event] The Burning of Aldgate Bridge` entry. |

### 4.15 Commands
| ID | Precondition | Action | Expected |
|----|----|----|----|
| CMD-01 | ENT-01 | type `#status` | Transient `glp-cmd-response` block (fades ~60 s) shows the sheet; **no** model call. |
| CMD-help-01 | SD-01 | type `#help` | Lists only active (feature-enabled) commands. |
| CMD-02 | `emit: system_def custom_commands`, then type `#wounds` | Renders `HP <cur>/<max> — <conditions>` via the template; `#party` aliases the companions view; built-ins `#status/#vitals/#system/#help` still present. |
| INS-01 | EVT-01/QST-01 exist | type `#inspect Thornwall` | Returns hints referencing matching events/quests. If the player has the `def.capabilities.inspect_capability` (default "awareness"), a `<Name> tier: …` line gates detail; with no such capability (or `inspect_capability` unset) the tier line is omitted and hints show ungated. |
| CMD-PTY-01 | PTY-01 | type `#party` | Lists the party roster locally (no model call). `#scene` / `#present` lists who is present + location. Both drop from `#help` when their feature is off. |

### 4.16 Output / misc
| ID | Precondition | Action | Expected |
|----|----|----|----|
| OUT-01 | any | `emit: card_output` | Browser downloads `<name>.json`; toast `Card "…" downloaded`. |
| OUT-02 | any | `emit: card_output_bad` | Error toast "Card JSON invalid"; no download. |
| CARDBLD-01 | any | in order: `emit: card_begin` → `emit: card_field` → `emit: card_field append` → `emit: card_book_entry` → `emit: card_finalize` | On finalize a **valid V2 card JSON downloads** (toast "Card … assembled & downloaded (N lore entries)"). The appended field is concatenated; the book entry is in `data.character_book.entries`; `data.character_version` is stamped; `chatMetadata['gm-lore-parser'].card_draft.active` resets to false. |
| CARDBLD-02 | fresh chat, **no** prior `card_begin` | `emit: card_field` (then `card_book_entry`, `card_finalize`) | Each is **ignored** — console warns "outside an active card assembly"; nothing buffered, no download. |
| CARDBLD-03 | any | `emit: card_output` (one-shot) | The one-shot path **still** downloads a complete card (back-compat with capable models). |
| CARDBLD-04 | active `card_begin` + only `system_prompt` set (no `first_mes`/`post_history`/entries) | `emit: card_finalize` | Finalize is **blocked** — warning toast "Card not finalized — still missing: first_mes, post_history_instructions, character_book entry"; `card_draft.active` stays **true**; nothing downloads. After emitting the missing fields + one `card_book_entry`, a second `card_finalize` **succeeds**. |
| CARDBLD-05 | active draft with all required fields, then **two** `card_book_entry` blocks sharing the same `comment` (or same `keys`) | `emit: card_finalize` | Card downloads with the duplicate **collapsed to one** entry (the longer-content copy kept); info toast "Removed 1 duplicate lore entry…"; console logs the drop. Entries whose content is `<120` chars are logged as shallow (not dropped). |
| CARDBLD-06 | active draft, `system_prompt` set | `card_field` with an **unrecognized key** (e.g. `key: entity_protocol`) | The stray key is **not** added to `card_draft.data`; its body is appended to `system_prompt` as a titled section (`## Entity Protocol\n<body>`); console warns "unrecognized key … folded into system_prompt". So a model that fragments the system_prompt into section-named fields still produces a complete `system_prompt` (and can finalize). |
| CARDBLD-07 | any | a `card_begin`/`card_finalize` sequence **wrapped in a ```` ```text ```` code fence** | Blocks still parse — the fence marker lines are stripped before extraction; the card assembles. |
| CARDBLD-08 | active draft | `card_book_entry` with **no blank line** between the `keys/comment/...` header and the content | The content is still captured as the entry body (lenient header/body split), not lost to an empty body. |
| CARDBLD-09 | active draft with required fields + one good entry, plus a `card_book_entry` whose **content is empty** | `card_finalize` | The empty entry is **dropped** (console warn "empty content"); the card downloads with only the real entries. If *all* entries are empty they're all dropped → finalize is blocked by the completeness gate (no broken hollow card). |
| CARDBLD-10 | an **already-open** draft with ≥1 field + ≥1 entry | a **second** `card_begin` (e.g. `name: <System> GM (Final)`) | The draft is **NOT reset** — all accumulated `data` fields + `book_entries` are kept; only `draft.name` updates to the new name (console: "CARD_BEGIN on an open draft — kept N field(s)…"). Prevents a stray re-open (common right before finalize on small models) from silently discarding the whole card. Only a `card_begin` on an **inactive** draft starts empty. **Verified live 0.0.19.** |
| SYSDEF-LOAD-01 | a `[System Definition]` lore entry whose **content** is a `[SYSTEM_DEF]` text block (campaign lorebook OR the active card's `character_book`); `state.system_def` cleared | trigger `loadSystemDefFromLorebook` (any message / chat change) | `state.system_def` hydrates from the text block (name/features/resolution parsed); a `[HEADER_FORMAT]` block in the same content seeds `state.header_format`. No `[SYSTEM_DEF]` emission required. |
| SYSDEF-FMT-01 | a `[SYSTEM_DEF]` block written in the **inline pipe-prefixed** style some models emit — rows like `attributes\|Brawn\|BRN\|desc`, `features\|capabilities, reputation`, `derived\|health = (brawn*4)+(spirit*2) -> health, health_max` (no `attributes:` header, no indentation) | parse via `parseSystemDef` | Parses equivalently to the canonical indented form: all attributes hydrate (key derived from the label for keyless `Label\|ABBR\|desc` rows), features + derived formulas resolve. **Verified live 0.0.19.** The canonical `attributes:` + indented `key \| Label \| ABBR \| desc` form still parses unchanged (no regression). Tolerance lives in `_groupSections` + the attributes parser (`modules/system.js`). |
| SCHEMA-FMT-01 | an entity/char_create `schema:` block written in a reshaped style: **inline pipe rows** (`field\|hp\|HP\|bar\|vitals\|gm_mutable`) OR **un-indented** `field:`/`label:`/`type:`/`group:` descriptor lines (no indentation under `schema:`) | parse via `parseSchema` | Parses equivalently to the canonical indented `field: hp` + indented descriptors: each field's `label`/`type`/`group`/`mutability` resolve; `groups:` is read. **Verified live 0.0.19.** Canonical indented form unchanged (no regression); a following non-indented, non-schema top-level line (e.g. `hp: 90`, `name: Aria`) still ends the schema section and is **not** consumed as a field. Tolerance lives in `parseSchema` (`modules/utils.js`). |
| NAME-GATE-01 | active draft with all required fields + a real entry, but `[CARD_BEGIN]` had **no name** (or `name: The Architect` = the active character) and no `[System Definition]` entry to derive from | `card_finalize` | Finalize is **blocked** (toast lists "a system name (emit [CARD_BEGIN] name: <System> GM)"); `card_draft.active` stays **true**; nothing downloads. Set a real name (`card_field key:name`, or `card_begin name:`) and finalize → downloads with `data.name == "<System> GM"`. |
| NAME-GATE-02 | active draft, required fields + a `[System Definition]` entry whose `[SYSTEM_DEF]` has `name: Emberhold`, but `[CARD_BEGIN]` name missing/blank | `card_finalize` | Name is **derived** from the entry → `data.name == "Emberhold GM"` (the produced card never imports under the designer's name). |
| NAME-GATE-03 | active draft, required fields + a real entry, but **no `[System Definition]` entry** present | `card_finalize` | Card still downloads (gate doesn't block on this), but a **warning toast** notes the produced card won't hydrate its ruleset on load. |
| INCR-01 | `card_begin` then `card_field`/`card_book_entry` blocks spread across **several separate messages** with unrelated narration between them | (final) `card_finalize` | The draft accumulates across all messages (persists in `chatMetadata`); the card assembles normally — incremental, non-consecutive emission works. |
| BLKFMT-01 | a System Definition loaded (campaign lorebook set) | inspect the campaign lorebook entries | A **constant** `[Block Formats]` entry exists (content has a literal `[ENTITY_UPDATE_BEGIN]`), and a keyword-triggered `[Block Formats: More]` entry exists whose templates are **feature-gated** (e.g. a `[CURRENCY_UPDATE]` template only when `currency` is on; `[ITEM_BOX_UPDATE]` only when `inventory.item_box`). Turning a feature off and reloading prunes its template. |
| TAG-NORM-01 | any | `emit: block_formats_heading` (a block tag wrapped as `## [ENTITY_UPDATE_BEGIN]` / `**[ENTITY_UPDATE_END]**`) | The markdown markers are normalized away before extraction; the `[ENTITY_UPDATE]` parses and the player's HP/conditions change (the heading-wrapped tag is NOT ignored). |
| TAG-NORM-02 (0.0.20) | a message whose block is closed with an **XML-style closer** — `[SCENE_UPDATE_BEGIN]…[/SCENE_UPDATE_BEGIN]` (or `[/SCENE_UPDATE_END]`) instead of `[SCENE_UPDATE_END]` | process the message | `_normalizeBlockTags` rewrites `[/X_BEGIN]`/`[/X_END]` → `[X_END]`, so `extractBlocks` finds a complete block and the scene/party (or any) update **applies** — previously the wrong closer silently dropped the whole block. Correct tags are untouched (no regression). **Verified live 0.0.20** (`[/PARTY_UPDATE_BEGIN]` → block extracted). |
| STATE-FLUSH-01 | a state mutation just applied (`window.__glpStateDirty` may be set mid-save) | dispatch a `pagehide` event (or set `visibilityState=hidden`) | `flushCharStateIfDirty()` fires a `saveMetadata()` if dirty; no error. Normal case: dirty is already false (per-message save flushed it), so it's a no-op — confirm no exception. |
| BAR-DELTA-01 | player with a `bar` field `hp` = 20 (max 20) | `[ENTITY_UPDATE] type: player, hp: -3` then later `hp: +5` then `hp: 12` | First → 17 (relative −3, floored at 0); then → 20 (relative +5, capped at max 20); then → 12 (bare number = absolute). A `value`-type field stays full-replacement (no delta). |

### 4.17 Tiered context (lean core + keyword-triggered player detail)
| ID | Precondition | Action | Expected |
|----|----|----|----|
| TIER-01 | SD-01, ENT-01, `tieredContext` on | inspect injected context (raw prompt) | The always-on `[Character: …]` block has identity + schema sheet + active title + rank + time + (warn-gated needs) and **no longer** lists the full skill set, inventory/equipment, currency, quests, factions, world events, or companions. |
| TIER-02 | SD-01, `emit: capability skill "Swordsmanship"` + `capability_update` | inspect `harness-campaign` | A keyword-triggered (`constant:false`) `[Player:Skills]` entry exists; its `key` list includes generic skill words, the category names, AND `swordsmanship`. Mentioning "swordsmanship" in chat surfaces it. |
| TIER-03 | ENT-01 (inventory set) + `emit: currency_update` + an equip | inspect `harness-campaign` | A `[Player:Possessions]` entry (`constant:false`) holds inventory + equipped + item-box + currency; keys include item names, equipped item names, and denomination names. |
| TIER-04 | QST-01 + REP-01 done | inspect `harness-campaign` | Quests/factions still surface via their own `[Quest]`/`[Faction]` entries; they are **not** duplicated into `[Player:*]`. |
| TIER-05 | TIER-02/03 | add an inventory item via `[ENTITY_UPDATE]`; then remove all capabilities | `[Player:Possessions]` rebuilds with the new item; `[Player:Skills]` is pruned (deleted) once no capabilities remain. |
| TIER-06 | TIER-01 | toggle **Tiered context** OFF in settings | Injected context reverts to the full monolithic sheet (skills/inventory/etc. inline); all `[Player:Skills]`/`[Player:Possessions]`/`[Player:Domains]` entries are removed from the lorebook. Toggling back ON restores them. |
| TIER-REQ-01 | `emit: system_def` with `capabilities: require_granted: true` | `emit: capability_update "Unknown Skill" points:100` | Rejected — no capability created; toast/console "Unknown capability … must be granted". With `require_granted:false` (default), the same update lazy-creates the skill (current behavior). |

---

## 5. Cross-cutting

| ID | Action | Expected |
|----|----|----|
| XC-GATE-01 | `emit: system_def minimal_skill`, then `emit: currency_update` | Block **silently no-ops**; currency panel hidden; `#currency`/`#wallet` dropped from `#help`; context omits `[Currency]`. |
| XC-GATE-02 | reputation disabled → type `#rep` | No response (view not in active set; not always-on). |
| XC-PERSIST-01 | After SD-01 + ENT-01, switch chats and back | `onChatChanged` re-hydrates def from `[System Definition]`; panel + context rebuilt; sheet survives. |
| XC-PERSIST-02 | New chat, never emit SYSTEM_DEF, lorebook already has `[System Definition]` | `loadSystemDefFromLorebook` hydrates the def on first message/chat change. |
| XC-NPC3-01 | `emit: entity npc "Garrick Stone"` (schema + dynamic_fields) | Exactly three entries: `[NPC] Garrick Stone`, `[NPC:State] Garrick Stone`, `[NPC:Progression] Garrick Stone`. |
| XC-RES-01 | SD-01, ENT-01, inspect raw prompt | `[Resolution]` block is the **first** section of injected context. |
| XC-SEP-01 | ENT-01 (inventory `separator: ;`) | Inventory shows 3 items split on `;`, not commas. |
| XC-FORMULA-01 | SD-01, finalize/create a character | Derived hp/mp/vigor computed from formulas for **unset** targets; an explicitly-set value is not overwritten. |
| XC-PRES-01 | `emit: system_def presentation` (bar 60/30, max_pips 8, ascii 12, empty `--`), then ENT-01 + NDS | Bars recolor at the new thresholds; pools cap at 8 pips; `#needs` bars are 12 wide; empty lists show `--`. |
| XC-HIDE-01 | hideBlocks ON; any emitted block | Rendered message shows the confirmation line only; raw `[…_BEGIN]…[…_END]` stripped. |
| XC-PANEL-01 | Toggle "Reputation panel" OFF | That panel section disappears immediately; others remain. |
| XC-CONST-01 | After SD-01 + SD-DIR-01 + PTY-01 + SCN-01, inspect `harness-campaign` | **Exactly** these entries are `constant:true`: `[System Definition]`, `[GM Directives]`, `[Block Formats]`, `[Scene]`, `[Party]`. Everything else — `[System Rule]`, items, locations, factions, quests, world events, capabilities, NPC core/state/progression, **and ALL memories (core + episodic, in the per-subject books)** — is keyword-triggered (`constant:false`). (Changed in 0.0.16: NPC/location **core memories are no longer constant** — they're keyword-triggered on the subject name, `order:1` so they rank first when the subject is referenced.) |
| XC-SET-01 | scanUserMessages ON; type a **user** message containing `[CURRENCY_UPDATE…]` | Currency block in a user message is **not** processed (only player `[ENTITY_BEGIN]` + `#` commands are). Documents actual behavior — a deviation is a bug. |

---

## 6. Regression / edge

| ID | Action | Expected |
|----|----|----|
| REG-01 | `emit: entity_event no_reason` | Rejected (`{blocked:['no reason']}`); no change-log entry; console warns "ENTITY_EVENT missing reason". |
| REG-02 | `emit: entity_update player` targeting a gm_event/immutable field | Both blocked; console warns `blocked: <key>(gm_event), <key>(immutable)`; values unchanged. |
| REG-03 | capabilities disabled (a def whose `features:` omits `capabilities`) → `emit: capability boon` | Ignored; panel hidden; `#boons`/`#skills`/`#abilities` dropped; no capability lines in context. |
| REG-04 | `emit: system_def evil_formula`, then create a character | `FORMULA_SAFE_RE` rejects → derived hp falls back to 0; **no code executes** (no fetch). |
| REG-05 | `emit: system_def minimal_skill` then `emit: entity player` | No level/class referenced; formulas without `level` resolve; `#status` omits Class. |
| REG-06 | `emit: entity creature "Dire Wolf"`, then `emit: entity npc "Scarfang" from_template:"Dire Wolf" level:3` | NPC inherits template schema; ranges → midpoint; `_per_level` scaled by level 3; explicit fields override. |
| REG-07 | (= CAP-02) title exclusivity | Only one active title (exclusive_category) per owner. |
| REG-08 | Player `control_limit:5`; add companions whose total `control_cost` > 5 | Console warns `Control limit exceeded: <n>/5`; `#legion` shows the overage; companions still added (record-keeper). |
| REG-09 | (= NDS-01/02) needs warn-only injection | Above-warn never injected; below-warn injected with LOW/CRITICAL. |
| REG-10 | `emit: entity_update creature "Dire Wolf"` | Ignored; console warns "creatures are immutable templates — ignoring ENTITY_UPDATE". |
| REG-11 | `emit: item` (mutable_fields: durability,charges), then `emit: item_update` changing a non-mutable field | Non-mutable change blocked; durability/charges accepted; condition label recomputed. |
| REG-KEY-01 | `emit: quest "The Lost Heir"` (no explicit keywords) | `[Quest] The Lost Heir` entry's `key` list is `the lost heir` + the significant sub-phrase `lost heir` (via `expandNameKeys`); NO `"<rank>-rank quest"` key; no bare common words. Mentioning "lost heir" in chat surfaces the entry; an unrelated message does not. |
| REG-KEY-02 | `emit: world_event_update` on an existing event with a `location` | The rebuilt `[World Event]` entry keeps BOTH the title sub-keys and the location key (regression: location no longer dropped on update). |

---

## 7. Narrative header (built-in)

The header is built into gm-lore-parser (`modules/header.js`). Settings live in the gm-lore-parser **Narrative Header** sub-section; the captured format is stored on `getCharState().header_format`. The standalone gm-narrative-header is deprecated — confirm it is disabled (HDR-DUP-01).

| ID | Precondition | Action | Expected |
|----|----|----|----|
| HDR-01 | ENT-01 done; header enabled | `emit: header_format basic` | Block stripped; `getCharState().header_format` stored; the **next** GM message is prepended with the rendered header + `---`. |
| HDR-02 | HDR-01 | `emit: noop` (any GM message) | Header shows live values: name, `HP cur/max`, conditions or empty-label, time. |
| HDR-03 | Fresh chat, no parser state, header on, manual format set | any GM message | Tokens with no data resolve to **nothing** (never literal `{token}`); a line with only-empty tokens is dropped — graceful degradation. |
| HDR-04 | HDR-01; Show-on-every-message OFF | GM message with no HEADER_FORMAT block | Header **not** prepended; only block-bearing messages render it. |
| HDR-05 | Player + skills + faction + needs + party/scene exist | `emit: header_format full` | Every present token resolves to a live value (or empty → its line/segment drops); `{inventory_max}` uses `system_def.inventory.capacity` when set; `{party}`/`{scene}` resolve to member names. |
| HDR-06 | Use-`[HEADER_FORMAT]`-block OFF, manual format set | GM message | Manual format used instead of the captured block. |
| HDR-DUP-01 | Standalone gm-narrative-header **disabled** | `emit: header_format basic` then `emit: noop` | Header prepended exactly **once** (no double header). With the standalone still enabled it double-prepends — that confirms it must be removed. |
| HDR-EMPTY-01 (0.0.20) | a **full** format referencing capability/roster lists, on a character with **no** boons/abilities/titles/party (e.g. `Title: {active_title}   Boons: {boons}   Abilities: {abilities}` and `Party: {party}`) | render the header | Empty capability/roster tokens **drop their segment** — no `Boons: None` / `Party: None` placeholder; a line whose tokens are all empty is dropped entirely. `resolveHeaderToken('boons', <emptyState>) === ''` (not `'None'`). **Verified live 0.0.20.** |
| HDR-HIDE-01 (0.0.20) | header on; a `[HEADER_FORMAT]` block emitted | toggle **Hide blocks** off, then on | Off → the raw `[HEADER_FORMAT_BEGIN]…[END]` block **stays visible** in the message (below the rendered header + separator), like any other raw block. On → it's **stripped** (only the rendered header shows). **Verified live 0.0.20** via `applyNarrativeHeader`. |

---

## 8. Teardown

Delete `harness-campaign`, `harness-campaign-plot`, and any `harness-campaign-npc-*` / `harness-campaign-location-*` lorebooks (plus any legacy unscoped `npc-*` / `location-*` from pre-0.0.16 runs); delete the harness chat; disable the extension if moving on.

---

## 8b. v0.0.17 features — memory enrichment · semantic recall · function tools

These are **settings-driven**, not new blocks. Enable them in the gm-lore-parser settings panel.

### Memory enrichment (Stage 1) — `enrichMemories` / `enrichMemoryWindow`
Composes a richer `[Memory]` body by summarizing the recent transcript via a **personaless** side-generation (`generateRaw`, NOT `generateQuietPrompt` — the latter inherits the active character card's persona, so a block-emitting/styled GM card returns a formatted reply instead of a clean summary). Works on text- and chat-completion backends. Raw block text is the guaranteed fallback, and any stray block tag in the output is stripped. Implemented in `enrichMemoryContent()` + `writeSubjectMemory` (`modules/lore.js`).

| ID | Precondition | Action | Expected |
|----|----|----|----|
| ENRICH-01 | SD-01 + ENT-04 (an NPC exists); **Enrich memory content ON**; ≥2 prior chat messages | `emit: entity_memory` | The written `[Memory]` entry (in `…-npc-<slug>`) `content` is a 2–4 sentence prose summary drawn from the recent transcript (not the terse block text); the entry's `extensions.enriched === true`. Zero extension errors. |
| ENRICH-02 | **Enrich memory content OFF** (default) | `emit: entity_memory` | Behaves exactly as ≤0.0.16: `content` is the model's raw block text; `extensions.enriched === false`. |
| ENRICH-03 | Enrich ON but force a generation failure (e.g. disconnect the backend) | `emit: entity_memory` | Falls back to the raw block text (never empty, never throws); console warns "memory enrichment failed; using raw content". |
| ENRICH-04 | Enrich ON | `emit: location_memory` | Same enrichment path applies to location memories (shared `writeSubjectMemory` choke point). |
| ENRICH-05 | Enrich ON; the **active card is the block-emitting harness** | `emit: entity_memory` (fresh entry) | The written `content` is clean prose (e.g. "Garrick Stone let the wounded bandit go…"), **not** a re-emitted `[ENTITY_MEMORY_BEGIN]…[END]` block or a "Confirmation received…" line. Regression guard for the `generateRaw` (personaless) fix. **Verified live 0.0.17.** |

### Semantic recall (Stage 2) — built-in Vector Storage (config, not GLP code)
gm-lore-parser writes standard World Info entries; SillyTavern's Vectors extension ingests them when its World-Info vectorization is enabled. No GLP retrieval code — Vectors owns injection. Best paired with ENRICH (richer bodies embed better).

| ID | Precondition | Action | Expected |
|----|----|----|----|
| VEC-01 | Built-in **Vector Storage** enabled with **Vectorize all / World Info** (local `transformers` source ok); a GLP `[Memory]` entry exists in a **chat-linked** per-subject book (e.g. `…-npc-<slug>`) whose keys would NOT match the probe | Send a message that paraphrases the memory **only semantically** (no key/name overlap) | Vectors force-activates the GLP entry by meaning via `WORLDINFO_FORCE_ACTIVATE` (keyword triggering could not have fired). **Verified live 0.0.17** (paraphrase "a warrior showed clemency…" activated `[Memory] Garrick Stone — Spared the bandit`, keys `bandit/mercy`). Notes: (1) retrieval operates on **WI-active books** — GLP's per-subject memory/NPC/location books are chat-linked, but the main campaign book's constant entries are injected by GLP directly (not via the WI engine), so they aren't vectorized; (2) relevance quality depends on the embedding model + query, not GLP — a miss is a Vectors config/quality issue, not a GLP bug. |

### Chat-linking of generated lorebooks (0.0.17)
All campaign-generated lorebooks are auto-linked to the active chat so their entries are pulled by keyword World Info **and** Vector Storage. Implemented in `linkCampaignBooks()` (`modules/lorebook.js`), called from `onChatChanged` and the Campaign-Lorebook settings binding. Note: the campaign book's **constant** entries (`[System Definition]`/`[GM Directives]`/`[Scene]`/`[Party]`) only reach the model once the book is chat-linked — GLP injects only the player sheet via `setExtensionPrompt`, so there is no duplication.

| ID | Precondition | Action | Expected |
|----|----|----|----|
| LINK-01 | Campaign Lorebook set; a `…-plot` and `…-npc-*` book already exist | Start a **new chat** (or re-set the Campaign Lorebook) | `chatMetadata.world_info` includes the campaign book, the plot book, and every `…-npc-*` / `…-location-*` book. **Verified live 0.0.17** (`["harness-campaign","harness-campaign-plot","harness-campaign-npc-garrick-stone"]`). |
| LINK-02 | LINK-01 done | `emit: quest`, then mention the quest's keyword in a later message | The `[Quest]` entry (in the now-linked campaign book) triggers via keyword WI; no extension errors from the now-active constant entries. |

### Function tools (Stage 3) — `useFunctionTools` (chat-completion backends only)
Registers `glp_record_memory`, `glp_entity_update`, `glp_currency_update`, `glp_quest_update`, `glp_reputation_update` via `registerFunctionTool`; each routes into the existing block handler. Gated double: off by default, and `shouldRegister` re-checks the setting. Implemented in `modules/tools.js`.

| ID | Precondition | Action | Expected |
|----|----|----|----|
| TOOL-01 | **Local text-completion backend** (gemma); **Function tools ON** | inspect registered tools; run normal play | **No** GLP tools surface to the model (ST sends no tools on text-completion); the prose-block path is byte-for-byte unchanged. The local experience is unaffected. |
| TOOL-02 | A **chat-completion** backend (Claude/OpenAI/etc.); **Function tools ON** | Prompt a state change (e.g. "the player takes 5 damage") | Model calls `glp_entity_update`; the same state mutation lands as the equivalent `[ENTITY_UPDATE]` block would; panel/context update; no prose block required. |
| TOOL-03 | Function tools **OFF** (default) | any backend | No GLP tools registered (`window.__glpToolNames` empty); toggling ON then OFF registers then unregisters them. |
| TOOL-04 | Tools ON; model emits BOTH a tool call AND the equivalent prose block in one turn | observe | Idempotent upserts (memory) are fine; delta blocks may double-apply — current safeguard is the per-tool "use tool OR block, never both" instruction. (Automatic turn-level de-dup is future work — documented limitation.) |

---

## 8c. v0.0.18 fixes — char-creation grouping · per-chat player book · panel click-to-view

### Character-creation panel grouping — `CC-PANEL-01`
The finalized `char_create` sheet must group fields correctly with **no page refresh**. Fix lives in `augmentSchemaWithDefAttributes` (`modules/schema.js`, now also normalizes group + corrects existing mis-grouped fields) called at `applyCharCreateFinalize` (`modules/creation.js`).

| ID | Precondition | Action | Expected |
|----|----|----|----|
| CC-PANEL-01 | Campaign set; SD-01 done; drawer open | `emit: char_create sequence` (BEGIN → 2 steps → FINALIZE) | After FINALIZE (no reload): **HP** renders under a **Vitals** group (not with attributes, not in `Other`); **all** attributes present in the def (fortitude, might, intellect, resolve) render under an **Attributes** group with their values; nothing lands on the HP line. |
| CC-PANEL-02 | A character created by a pre-0.0.18 build whose HP/attributes sit in `Other` | Reload the page / switch to that chat | `onChatChanged`'s augment now **corrects** the existing fields: HP → Vitals, attributes → Attributes (previously only *missing* attributes were added; already-shown ones stayed in `Other`). |

### Dedicated per-chat player lorebook — `PLAYER-BOOK-01`
The tiered `[Player:*]` projections now write to `‹campaign›-player-‹chatid›` (`playerBookName`/`ensurePlayerBook` in `modules/lorebook.js`; `_upsertPlayerEntry` in `modules/context.js`), never the shared campaign book.

| ID | Precondition | Action | Expected |
|----|----|----|----|
| PLAYER-BOOK-01 | Tiered context ON; two chats **A** (PC "Aria") and **B** (PC "Testra") that both set `harness-campaign` | In A: create Aria + skills; in B: create Testra + skills | Each chat has its own `harness-campaign-player-‹chatid›` book holding **its** `[Player:Skills]` / `[Player:Possessions]` / `[Player:Domains]`; the two never overwrite each other; the shared `harness-campaign` book holds **no** `[Player:*]` entries. |
| PLAYER-BOOK-02 | A campaign book that still carries legacy `[Player:*]` entries from ≤0.0.17 | Trigger a player rebuild (e.g. capability change) | The legacy `[Player:*]` entries are **pruned** from the campaign book (one-time hygiene in `rebuildPlayerLoreEntries`); the current ones live only in the per-chat player book. |
| PLAYER-BOOK-03 | PLAYER-BOOK-01 done | Start a **new chat** on the same campaign | The new chat gets a **fresh** player book (new chatid) — no player-state bleed from the prior chat; the per-chat book is chat-linked automatically. |

### Panel click-to-view popups — `POPUP-01`
Every lorebook-backed panel row is clickable via one delegated handler on `.glp-lore-clickable` → `glpShowLorePopup(data-lore)` (`index.js`; helper in `modules/lorebook.js`).

| ID | Precondition | Action | Expected |
|----|----|----|----|
| POPUP-01 | Entries exist: a quest, an item-box item, an equipped item, a capability, a faction, a world event, a companion | Click each corresponding panel row | Each opens a popup showing that entry's `[Quest]` / `[Item]` / `[Capability]` / `[Faction]` / `[World Event]` / `[Companion]` content (searched across campaign, plot, and per-chat player books). |
| POPUP-02 | A panel row whose backing entry does not exist yet | Click it | Popup shows the graceful "No lore entry recorded yet." message — no error. |
| POPUP-03 | Carried-inventory pill and a party/scene member (existing popups) | Click each | Still work (item pill → `[Item]`; member → NPC/companion/creature entry via multi-candidate lookup) — no regression from the unified handler. |

---

## 9. Coverage matrix

**Blocks → test IDs**

| Block | Tests |
|----|----|
| SYSTEM_DEF | SD-01, SD-02, REG-04, XC-PRES-01 |
| ENTITY (player/npc/companion/creature) | ENT-01, ENT-04, COMP via `emit: entity companion`, REG-06, REG-10 |
| ENTITY_UPDATE | ENT-04, POS-01, REG-02, REG-10 |
| ENTITY_EVENT | ENT-EVT-01, REG-01 |
| ENTITY_MEMORY | ENT-MEM-01 |
| CAPABILITY ×6 | CAP-01, CAP-02, CAP-EVO-01, (passive/trait/skill via `emit: capability passive/trait/skill`) |
| CAPABILITY_UPDATE | CAP-PRG-01, CAP-PRG-02, CAP-LAZY-01 |
| Progression profiles / [System Rule] entries | SD-PROG-01, SD-RULE-01, SD-RULE-02 |
| FACTION / FACTION_UPDATE / REPUTATION_UPDATE | REP-01, REP-FU-01, REP-02 |
| QUEST / QUEST_UPDATE | QST-01, QST-02 |
| WORLD_EVENT / _UPDATE / PLOT_ENTRY | EVT-01, EVT-WU-01, EVT-02 |
| DOMAIN_UPDATE | DOM-01 |
| CURRENCY_UPDATE / RANK_CHANGE / XP_AWARD | ECO-01, PRG-01, PRG-XP-01 |
| WORLD_TIME | TIM-01, TIM-02 |
| ITEM / ITEM_UPDATE / ITEM_BOX_UPDATE | POS-ITEM-01, REG-11, POS-BOX-01 |
| LOCATION / LOCATION_MEMORY | LOC-01 |
| RULE / EVENT | LORE-RULE-01, LORE-EVT-01 |
| NEEDS_SYSTEM / NEEDS_UPDATE | NDS-01, NDS-02 |
| PARTY_UPDATE / SCENE_UPDATE | PTY-01…PTY-03, SCN-01…SCN-04, PSC-LINK-01 |
| GM Directives (`directives:` / `[GM Directives]`) | SD-DIR-01, SD-DIR-02 |
| Always-on audit (constant entries) | XC-CONST-01 |
| Tiered context ([Player:*] entries, require_granted) | TIER-01…TIER-06, TIER-REQ-01 |
| CHAR_CREATE begin/step/finalize | CC-01, CC-02 |
| CARD_OUTPUT / COMMAND_RESPONSE | OUT-01, OUT-02, CMD-01 |
| Chunked card assembly (CARD_BEGIN/FIELD/BOOK_ENTRY/FINALIZE) | CARDBLD-01, CARDBLD-02, CARDBLD-03 |
| Repeat CARD_BEGIN preserves the open draft (rename, not reset) | CARDBLD-10 |
| Finalize completeness gate + lore de-dup | CARDBLD-04, CARDBLD-05 |
| Unknown field key folded into system_prompt | CARDBLD-06 |
| Code-fence tolerance / lenient header-body / empty-entry drop | CARDBLD-07, CARDBLD-08, CARDBLD-09 |
| System def hydrated from a [System Definition] text block (lorebook or card book) | SYSDEF-LOAD-01 |
| [SYSTEM_DEF] format tolerance (canonical + inline pipe-prefixed / keyless attribute rows) | SYSDEF-FMT-01 |
| schema: format tolerance (canonical + inline pipe / un-indented descriptor rows) | SCHEMA-FMT-01 |
| Card naming gate (block empty/designer name; derive from [System Definition]) | NAME-GATE-01, NAME-GATE-02, NAME-GATE-03 |
| Incremental assembly across non-consecutive messages | INCR-01 |
| In-context block templates ([Block Formats], feature-gated) | BLKFMT-01 |
| Tolerant tag parse (markdown-wrapped tag; XML-style `[/X_BEGIN]` closer) | TAG-NORM-01, TAG-NORM-02 |
| Capability entry self-heal (backfill missing `[Capability]`) | CAP-BACKFILL-01 |
| State flush on tab hide/close | STATE-FLUSH-01 |
| HEADER_FORMAT | HDR-01…HDR-06, HDR-DUP-01 |
| Memory enrichment (0.0.17 setting) | ENRICH-01…ENRICH-04 |
| Semantic recall (Vector Storage config) | VEC-01 |
| Function tools (chat-completion backends) | TOOL-01…TOOL-04 |
| Autonomous memory capture (0.0.19) | AUTO-MEM-SCENE-01, AUTO-MEM-LOC-01, AUTO-MEM-PERIODIC-01, AUTO-MEM-AWAY-01, AUTO-MEM-OFF-01, AUTO-MEM-MIN-01, AUTO-MEM-EMPTY-01, AUTO-MEM-DEDUP-01, AUTO-MEM-PERSONA-01 |
| Always-on rules digest / full-rules toggle (0.0.20) | DIGEST-01…DIGEST-03 |
| 2nd-pass state extractor (off/fallback/always + profile + guard) | EXTRACT-01…EXTRACT-04, EXTRACT-GUARD-01 |
| Card-assembly auto-retry | CARDRETRY-01…CARDRETRY-03 |
| Token telemetry | TELEM-01…TELEM-03 |
| Settings pop-out / collapsible groups / `--glp-*` theming | POPOUT-01, POPOUT-02, THEME-01 |

**Commands → test IDs:** `#status/#character`→CMD-01; `#vitals`→TIM-01; `#skills`→CAP-PRG-01; `#inventory/#bag`→ENT-01; `#equipment`→POS-01; `#itembox`→POS-BOX-01; `#domain`→DOM-01; `#time`→TIM-01; `#quests`→QST-01; `#rep/#reputation`→REP-02; `#factions`→REP-01; `#events`→EVT-01; `#locations`→LOC-01; `#currency/#wallet`→ECO-01; `#rank`→PRG-01; `#companions`→`emit: entity companion`+`#companions`; `#legion/#hierarchy`→REG-08; `#boons`→CAP-01; `#titles`→CAP-02; `#abilities`→CAP-EVO-01; `#needs`→NDS-01; `#inspect`→INS-01; `#system/#ruleset`→SD-01; `#help`→CMD-help-01; custom/alias→CMD-02; `#party`→CMD-PTY-01; `#scene/#present`→CMD-PTY-01. (`#<category>s` commands are def-derived — see CAP-01/02.)

**System-Def sections → test IDs:** features→XC-GATE-01; identity/progression→REG-05; creation→CC-01; classes→`emit: system_def` w/ classes (CLS); attributes/derived/variables→XC-FORMULA-01/REG-04; reputation→REP-01; capabilities/progressions→CAP-PRG-01/SD-PROG-01; rank_ladder→PRG-01; needs→NDS-02; item_conditions→POS-ITEM-01/REG-11; loyalty→companion tests; resolution→XC-RES-01; rules/emit_rule_entries→SD-RULE-01/02; quests/world_events/factions/companions/capabilities vocab→QST-01/EVT-01/REP-01/REG-08/CAP-01; inventory→POS-BOX-01; equipment→POS-01; locations(+instances)→LOC-01; commands→CMD-02; presentation→XC-PRES-01.

**Header tokens → test IDs:** identity/`{rank}`→HDR-02/05; `{field}/{field_max}/{field_regen}/{field_pct}`→HDR-02/05; `{time}/{date}`→HDR-02; `{conditions}`→HDR-02; `{inventory_count}/{inventory_max}`→HDR-05; `{active_title}/{titles}/{boons}/{abilities}`→HDR-05 (resolve against `state.capabilities`); `{currency}/{currency:denom}`→HDR-05; `{reputation:Faction}`→HDR-05; `{skill_score:Skill}`→HDR-05 (reads the capability's precomputed `prog.score`); `{party}/{scene}`→HDR-05; `{xp_next}`→HDR-05.

---

## 8d. v0.0.19 — autonomous memory capture (`AUTO-MEM-*`)

Opt-in triggers that auto-create `[Memory]` entries from the transcript even when the model emits no memory block. Enable **Autonomous memory capture** (master `autoMemory`) plus the per-trigger flags in settings. Core: `autoWriteSubjectMemory` (`modules/lore.js`) reusing the personaless `glpSummarizeTranscript`; triggers in `applySceneUpdate`/`_fireSceneAutoMemory` (`modules/scene.js`) and `_glpAutoMemoryPeriodic`/`_glpCaptureSceneSnapshot`/`_glpFlushChatAwayMemory` (`index.js`). Writes to the subject's campaign-scoped book (`…-npc-<slug>` / `…-location-<slug>`), tagged `extensions.auto:true`.

| ID | Precondition | Action | Expected |
|----|----|----|----|
| AUTO-MEM-SCENE-01 | `autoMemory` + `autoMemoryOnSceneExit` ON; an NPC has been present in the scene for ≥ `autoMemoryMinMessages` GM turns (tracked via the member's `since_msg`) | `emit: scene_update` with `exit: <name>` (or a `set:` that drops them) | A new entry appears in `…-npc-<slug>` with `extensions.auto:true`, `reason:"scene-exit"`, `memory_type:"episodic"`; content is clean prose summarizing their time on-screen (no block tags). **Verified live 0.0.19.** |
| AUTO-MEM-LOC-01 | `autoMemory` + `autoMemoryOnLocationChange` ON; a `location` was set ≥ min messages ago | `emit: scene_update` with a new `location:` | Auto memory (`reason:"location-change"`) written to `…-location-<slug>` for the **previous** location. **Verified live 0.0.19.** |
| AUTO-MEM-PERIODIC-01 | `autoMemory` + `autoMemoryPeriodic` ON; `autoMemoryEveryNMessages = N` | Send N GM turns of ordinary play | On the Nth turn an episodic memory of the current scene is written (to the location book if a scene location is set, else per present subject, capped at 3); the turn counter resets. |
| AUTO-MEM-AWAY-01 | `autoMemory` + `autoMemoryOnChatAway` ON; a scene with present subjects | Switch to a different chat | The chat you left flushes an episodic memory for each still-present subject (and the location) from the captured snapshot — the summarizer runs off the snapshot transcript, since `ctx.chat` is already the new chat. |
| AUTO-MEM-OFF-01 | `autoMemory` **OFF** (default) | any of the above | **No** auto memory written; `autoWriteSubjectMemory` returns false immediately; no side-generation fires. **Verified live 0.0.19.** |
| AUTO-MEM-MIN-01 | `autoMemory` ON but the window has fewer than `autoMemoryMinMessages` new messages | trigger scene-exit right after entry | No write **and no generation** — the min-message guard short-circuits before spending a summarizer call. **Verified live 0.0.19.** |
| AUTO-MEM-EMPTY-01 | `autoMemory` ON; force the summarizer to return empty (or pass an empty window) | trigger | Writes **nothing** (no terse stub); `autoWriteSubjectMemory` returns false. **Verified live 0.0.19.** |
| AUTO-MEM-DEDUP-01 | An identical auto memory already exists for the subject | re-fire the same trigger with the same content | The duplicate is skipped (content-equality check on `extensions.auto` entries). |
| AUTO-MEM-PERSONA-01 | Active card is the block-emitting harness; `autoMemory` ON | any trigger | The written `content` is clean prose, **not** a re-emitted `[…_BEGIN]` block (guaranteed by the personaless `generateRaw` path + block-tag strip — same guard as ENRICH-05). |

> These reuse the enrichment summarizer, so ENRICH's caveats apply: quality depends on the backend model, and each capture is one extra short generation — hence all triggers default off and the min-message guard fires first. Auto and model-emitted memories can coexist for the same beat; `extensions.auto` + content de-dup mark/limit overlap (documented, like the tool-vs-block guidance).

---

## 8e. v0.0.20 — rules digest · 2nd-pass extractor · card auto-retry · telemetry · settings pop-out

All new behavior defaults **off/unchanged**. The extractor/card-retry/telemetry cases need a connected model (local gemma is fine); the digest and pop-out cases are deterministic.

### Always-on rules digest (`DIGEST-*`) — `alwaysOnRulesDigest` / `fullRulesAlwaysOn`
Derived in `buildSystemRulesDigest` (`modules/system.js`), appended to the constant `[System Definition]` entry in `saveSystemDef`.

| ID | Precondition | Action | Expected |
|----|----|----|----|
| DIGEST-01 | **Always-on rules digest ON** (default) | `emit: system_def default`, inspect the `[System Definition]` entry | Content ends with a `Rules digest (subsystem parameters):` block: a `Resolution:` line (mechanic + DC scale + crit), `Capabilities:` categories + `skill→veridia_pp` with the `veridia_pp` tier ladder (`Novice < … < God`), `Reputation: Hostile < … < Sworn (0–100, init 50)`, `Ranks: F < … < SSS`, `Needs: warn 30, critical 10`. **Verified live 0.0.20.** |
| DIGEST-02 | DIGEST-01 | toggle **Always-on rules digest OFF**, re-save the def (toggle fires a re-commit) | The `[System Definition]` entry reverts to the terse summary only (no `Rules digest` block); the keyword-triggered `[System Rule]` entries are unchanged. |
| DIGEST-03 | SD-01 | toggle **Full rules always-on ON**, re-save | The detailed `[System Rule]` entries (Resolution/Reputation/…) become `constant:true` (always-on); toggling it OFF and re-saving returns them to `constant:false` (keyword-triggered). |

### 2nd-pass state extractor (`EXTRACT-*`) — `stateExtractorMode` / `stateExtractorProfileId`
`runStateExtractorPass` + `runStateExtraction` (`index.js`); output flows through the shared `applyStateBlocks`. Console marker on a successful pass: `2nd-pass extractor applied blocks (sheet:…, lore:…)`.

| ID | Precondition | Action | Expected |
|----|----|----|----|
| EXTRACT-01 | **2nd-pass state extractor = Off** (default) | ordinary play | No extractor pass ever runs (no side generation, no console marker); single-model behavior is byte-for-byte unchanged. |
| EXTRACT-02 | mode = **Always**; player exists (`emit: entity player`, HP known) | send a GM turn whose prose describes a state change with **no block** (e.g. ask the narrator: "prose only, no blocks: Kael takes 8 damage") | The extractor runs (console marker), reads the prose + current state, emits an `[ENTITY_UPDATE]`, and HP drops accordingly. **Verified live 0.0.20** (extractor recovered `hp` from prose). ⚠ In *always* mode, if the narrator ALSO emits a block the delta double-applies — *always* is for a **pure-prose narrator**. |
| EXTRACT-03 | mode = **Fallback** | (a) a GM turn that **emits** a state block; (b) a GM turn that emits **only prose** | (a) extractor is **skipped** — narrator already covered it (no console marker, single application, no double-apply); (b) extractor **runs** and supplies the block from prose. **Verified live 0.0.20** (fallback correctly skipped on a block-bearing turn: HP moved once, no marker). |
| EXTRACT-04 | mode = fallback/always; **Extractor connection profile** set to a valid SillyTavern Connection Profile | trigger a pass | The extraction routes through `ConnectionManagerRequestService.sendRequest` (silent, no UI flicker); blank profile uses the narrator's model via `generateRaw`. Falls back to `generateRaw` if the service is unavailable; never throws. |
| EXTRACT-GUARD-01 | mode = always; force/leave `window.__glpStateExtracting = true` (simulating a prior hung extraction) | send a fresh GM turn | The next turn **clears the guard at entry** (`onMessageReceived`) so the extractor is not permanently wedged — it runs normally. (Self-heal fix; the guard relying only on `finally` could otherwise stick true if a `generateRaw` hung.) |

### Card-assembly auto-retry (`CARDRETRY-*`) — `cardAutoRetry` / `cardAutoRetryMax`
`autoCompleteCard` (`index.js`); shares the `_cardMissing` gate helper with `applyCardFinalize`.

| ID | Precondition | Action | Expected |
|----|----|----|----|
| CARDRETRY-01 | **Auto-complete card assembly ON** (default); active draft with `system_prompt` only (no first_mes/post_history/entry/name) | `emit: card_finalize` | Gate blocks, then a **headless `generateRaw`** fires for ONLY the missing blocks (console `card auto-retry N/M: applied K block(s)…`); if the model supplies them the card **finalizes and downloads**. Bounded by **Card auto-retry rounds** (default 2); stops early if a round applies nothing, then falls back to the manual-nudge toast. |
| CARDRETRY-02 | **Auto-complete card assembly OFF**; same blocked draft | `emit: card_finalize` | Legacy behavior — gate blocks with the "still missing…" toast; **no** auto-retry generation fires; draft stays open for a manual nudge. |
| CARDRETRY-03 | a draft that exhausted its retry budget | a **fresh** `emit: card_begin` (new card) | `draft.auto_retries` resets to 0 — the new card gets a full retry budget. |

### Token telemetry (`TELEM-*`) — `telemetryEnabled`
`modules/telemetry.js` (`glpRecordPass`/`glpProjectCost`/`glpTelemetrySummary`); instrumented at the extractor, memory enrich/auto-memory, and card-retry `generateRaw` sites. Probe: `window.glpTelemetry`.

| ID | Precondition | Action | Expected |
|----|----|----|----|
| TELEM-01 | **Measure side-generation token cost OFF** (default) | run a side-generation (e.g. an extractor turn) | `glpRecordPass` is a **no-op**; `window.glpTelemetry.summary()` = "No side-generations recorded yet."; the settings readout shows the off message. |
| TELEM-02 | telemetry **ON**; extractor Always (or Enrich on) | run one side-generation turn, then click **Refresh** (or call `window.glpTelemetry.summary()`) | Readout shows `N side-call(s) (extractor:…, memory:…) · in … / out … tok · ~$… (~$…/call)`. **Verified live 0.0.20** — a real extractor turn recorded `1 side-call (extractor:1) · in 954 / out 34 tok`. |
| TELEM-03 | TELEM-02 has data | click **Reset** (or `window.glpTelemetry.reset()`); also record a pass with backend-reported tokens | Reset returns the readout to empty; per-chat buckets are isolated (a different chatId accumulates separately); a backend usage figure overrides the char-based (~4 chars/token) estimate (`method:'backend'` vs `'estimate'`). |

### Settings organization & pop-out (`POPOUT-*`) — collapsible groups + the `--glp-*` themable palette
Settings render as `<details class="glp-settings-group">` groups; the pop-out moves `.inline-drawer-content` into a floating panel.

| ID | Precondition | Action | Expected |
|----|----|----|----|
| POPOUT-01 | GLP settings drawer **open** in Extensions | click the pop-out button (⧉) in the settings header | The settings detach into a **draggable float that shows all controls** — regression guard: the 0.0.20 collapsible `<details>` groups must NOT collapse the content to 0 width in the flex-row float (the group is `display:block`, and the popped content is `flex:1;min-width:0`). Close (×) returns them to the drawer. **Verified live 0.0.20** (620×788 content, all 33 rows / 7 groups visible, fits the 640px panel). |
| POPOUT-02 | settings drawer open | inspect the settings body | Seven collapsible groups render — **Panels · Narrative Header · Context & lore injection · Memory & tools · Autonomous memory capture · Advanced · About & changelog**. All groups default **collapsed** (only the master toggles above them show until expanded); clicking a group summary folds/unfolds its controls. |
| THEME-01 | any campaign with needs/reputation state | add `:root { --glp-crit:#ff3355; --glp-rep-hostile:#cc2222; }` to ST **Custom CSS** | The critical-need bar and Hostile reputation recolor to the overrides; unset `--glp-*` variables render the built-in fallbacks (panel colors are centralized in `style.css` as `var(--glp-…, <default>)`). |

---

## 10. Panel-state suite (`PANEL-*`)

Verifies the **status panel renders the correct state** for every section — not block parsing (that's §4), but the *rendered surface*: grouping, values, show/hide against settings + feature gates, empty/populated states, click-to-view wiring, and live refresh. **Mostly deterministic** — drive state via `emit:` or the block handlers, then assert on the panel builder's output; no model needed except where a section's state only arises from a model block.

**Tooling.** Inject `assets/panel-probe.js` (companion to `harness-helpers.js`) and call `window.__glp.panelProbe()`. It parses `buildStatusPanelHTML(getCharState(), getSettings())` into a detached DOM and returns a structured map:
```
{ mode: 'creation'|'empty'|'sheet',
  header: { name, sub, activeTitle, worldTime },
  groupLabels: [...], coreGroups: [{label, fields:[…]}],
  sections: { scene, party, capabilities, domains, quests, reputation, events,
              currency, rank, companions, inventory:{carried,equipment,itembox}, needs },
  clickables: [ '[Type] Name', … ], liveMounted }
```
Each section reports `{present, empty, count, rows, clickables}` (inventory reports `carried/equipment/itembox`). `window.__glp.expectSection(name, 'present'|'hidden'|N)` is a one-line assert. Section row selectors are **scoped to each section's panel** (scene/party members reuse `.glp-cap-row`, so unscoped counting would inflate Capabilities — the probe scopes to `.glp-scene-panel`/`.glp-party-panel` vs. `.glp-cap-cat`).

**Setup.** `G.setup()` then `emit: system_def default`, then the minimal blocks per case. A single fully-populated character (one `entity player`, a couple capabilities, a quest, a faction, a world event, an item + item-box entry, a needs system, currency, rank, a scene + party) lets one probe cover most `-01` cases at once; the `-02`/`-03` cases flip state/settings.

### Mode & core sheet
| ID | Precondition | Assert (`panelProbe()`) |
|----|----|----|
| PANEL-MODE-01 | `char_create` BEGIN sent, session active | `mode === 'creation'`; creation checklist rows present; no `.glp-group` sheet. |
| PANEL-MODE-02 | fresh chat, no character | `mode === 'empty'`; placeholder text present. |
| PANEL-MODE-03 | `entity player` applied | `mode === 'sheet'`; `header.name` set. |
| PANEL-CORE-01 | player with HP (bar) + attributes | `groupLabels` includes `vitals` and `attributes`; HP field under `vitals`, attributes under `attributes`; no field on the wrong group. (Panel counterpart to CC-PANEL-01, for a plain entity.) |
| PANEL-CORE-02 | schema has an `hp_max` (max_field) and a uses-counter | those keys do **not** appear as their own rows in `coreGroups`. |
| PANEL-CORE-03 | schema declares `groups: vitals, attributes` | `groupLabels` order === declared order. |
| PANEL-CORE-04 | a field with an unknown group | it renders in a trailing group (present in `groupLabels` after the declared ones), not dropped. |

### Header
| ID | Precondition | Assert |
|----|----|----|
| PANEL-HDR-01 | player with class + background | `header.sub` = "Class · Background". |
| PANEL-HDR-02 | an active exclusive-category (title) capability owned by player | `header.activeTitle` set; without one → null. |
| PANEL-HDR-03 | `world_time` applied | `header.worldTime` matches the display string. |

### Collapsible sections (each ×3)
For **each** of `scene, party, capabilities, domains, quests, reputation, events, currency, rank, companions, inventory, needs`:
| ID pattern | State | Assert |
|----|----|----|
| `PANEL-<SEC>-01` | section populated | `sections.<sec>.present === true` and `count`/rows match the emitted data (inventory: carried/equipment/itembox counts). |
| `PANEL-<SEC>-02` | section state empty | hidden (`present === false`) — except builders that emit an inline empty message (events/reputation) where `empty === true` + `emptyMsg` set. |
| `PANEL-<SEC>-03` | state present but gate off (`show<Sec>Panel=false` **or** the feature disabled in the System Definition) | `present === false`. |

Examples: `PANEL-QUESTS-01` (`emit: quest` → `sections.quests.count===1`, summary shows count); `PANEL-INV-01` (equipment + carried + item box populated → all three arrays non-empty); `PANEL-NEEDS-03` (`needs` feature off in def → section absent even with state).

### Live refresh
| ID | Action | Assert |
|----|----|----|
| PANEL-LIVE-01 | after `emit: currency_update` / `xp_award` / `entity_update` (HP delta) / `quest_update` | a fresh `panelProbe()` reflects the new value **without reload**; the mounted `#glp-status-panel` shows it too (`liveMounted` true after `refreshStatusPanel()`). |
| PANEL-LIVE-02 | switch to a different chat (`onChatChanged`) | probe of the new chat shows **no** rows from the prior character (no stale sections). |

### Click-to-view (v0.0.18)
| ID | Assert |
|----|----|
| PANEL-CLICK-01..07 | one per lorebook-backed section (quests, item box, equipment, capabilities, factions, events, companions): each populated row's `data-lore` (in `sections.<sec>.clickables` / global `clickables`) equals its `[Type] Name` comment. |
| PANEL-CLICK-EMPTY | `glpShowLorePopup('[Quest] __none__')` → popup body is the graceful "No lore entry recorded yet." |
| PANEL-CLICK-REG | carried-item pill (`.glp-inv-item[data-item]`) and party/scene member (`.glp-member[data-member]`) still route to their popups (no regression from the unified `.glp-lore-clickable` handler). |

### Gate sweep
| ID | Action | Assert |
|----|----|----|
| PANEL-GATE-01 | set every `show*Panel=false` | only header + core sheet + always-on Scene/Party remain present. |
| PANEL-GATE-02 | disable a feature in the def (`featureOn=false`) | its section absent even with `show*Panel=true` and state present. |

**Results doc.** The `/glp-test-harness` skill's **panel-only mode** runs this matrix and writes `test-runs/panel-run-<version>-<date>.md` — a table of every `PANEL-*` id with pass/fail + observed-vs-expected (axes: **section present · rows/values correct · gate honored**), for cross-version comparison. Exit criteria: every section correct populated / hidden-when-empty / hidden-when-gated / live-refresh, and correct click-to-view for the seven lorebook-backed sections, with zero console errors during render/refresh.

---

## Pitfalls (read before running)

1. **Lorebook prerequisite is silent** — without a Campaign Lorebook, lore blocks and SYSTEM_DEF persistence no-op. Do P2/P3, then SD-01.
2. **Feature-gating makes blocks vanish, not error** — once a `[SYSTEM_DEF]` lists `features:`, anything omitted is OFF and its blocks/panel/command/context disappear. Each gated test states its required feature.
3. **Block ordering/placement** — SYSTEM_DEF is processed first; blocks sit at the message tail; nothing after the final `[..._END]`. The harness enforces this.
4. **Only AI messages are parsed** — the harness must emit the block; pasting it yourself won't trigger handlers (XC-SET-01).
5. **Header needs lore-parser state in the same chat** — run header tests after ENT-01; otherwise tokens degrade.
6. **HEADER_FORMAT renders on the *next* GM message** — `emit: noop` generates one.
7. **Derived stats only fill unset/zero targets** — the harness leaves hp/mp/vigor blank deliberately.
8. **NPC values are reconstructed from lorebook text** — verify NPC tests via the three `[NPC…]` entries' content, not chatMetadata.

The block catalogue inside `test-harness-card.json` duplicates the live protocol; if the extension protocol changes, regenerate the catalogue (canonical templates: `system-designer-card.json`). The harness stamps `protocol_version 0.0.19`.
