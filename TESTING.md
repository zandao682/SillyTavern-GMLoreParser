# Test Plan — gm-lore-parser

A comprehensive **manual** test plan, run by hand in SillyTavern using the **Test Harness** card (`test-harness-card.json`). Nothing here is automated — the extension only runs inside SillyTavern. The narrative header is now built into gm-lore-parser (the former standalone `gm-narrative-header` extension is deprecated and must be disabled/removed, or headers double-prepend).

---

## 1. Purpose & scope

Exercise every block type, `#` command, System-Definition section, status-panel section, context-injection path, lorebook side effect, the party/scene rosters, GM behavioral directives, the always-on lorebook audit, and the built-in narrative-header tokens — plus cross-cutting behavior (feature gating, persistence, formula safety) and regression/edge cases.

## 2. Prerequisites / setup

| # | Step | Verify |
|---|------|--------|
| P1 | Install gm-lore-parser under `…/extensions/third-party/`, reload ST. **Disable/remove the standalone gm-narrative-header** if present. | Console: `[gm-lore-parser] v0.0.11 loaded…` listing modules incl. `scene, header`; its drawer appears under Extensions; no `[gm-narrative-header]` active-load line. |
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
| ENT-04 | SD-01, `emit: entity npc` ("Garrick Stone") | `emit: entity_update npc "Garrick Stone" attitude:Wary` | `[NPC:State] Garrick Stone` updated; `[NPC] Garrick Stone` (core) unchanged; `[NPC:Progression] Garrick Stone` reflects schema. |
| ENT-EVT-01 | ENT-01 | `emit: entity_event player` (with reason) | gm_event field changes; an entry appears in `attr_change_log` (inspect via console `getCharState()`). |
| ENT-MEM-01 | ENT-04 | `emit: entity_memory` | Per-NPC lorebook `npc-garrick-stone` created + linked; a `[Memory] Garrick Stone — …` entry added. |

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
| POS-BOX-01 | SD with `inventory.item_box:true` | `emit: item_box_update` | `#itembox` lists "Sword of Embers (Worn)", "Healing Draught". |
| POS-ITEM-01 | SD-01 | `emit: item` | `[Item] The Silthorn Compass` entry; condition label derived from durability (85→Good). |
| LOC-01 | SD-01 | `emit: location "Thornwall Keep"` then `emit: location_memory "Thornwall Keep"` | `[Location] Thornwall Keep` entry; auto-creates + links `location-thornwall-keep`; a `[Memory] …` entry added there. |

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
| XC-CONST-01 | After SD-01 + SD-DIR-01 + PTY-01 + SCN-01 + an NPC with a core memory, inspect `harness-campaign` | **Exactly** these entries are `constant:true`: `[System Definition]`, `[GM Directives]`, `[Scene]`, `[Party]`, and NPC **core** memories. Everything else (`[System Rule]`, items, locations, factions, quests, world events, capabilities, episodic memories, NPC state/progression) is keyword-triggered (`constant:false`). |
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

---

## 8. Teardown

Delete `harness-campaign`, `harness-campaign-plot`, and any `location-*` / `npc-*` lorebooks; delete the harness chat; disable the extension if moving on.

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
| CHAR_CREATE begin/step/finalize | CC-01, CC-02 |
| CARD_OUTPUT / COMMAND_RESPONSE | OUT-01, OUT-02, CMD-01 |
| HEADER_FORMAT | HDR-01…HDR-06, HDR-DUP-01 |

**Commands → test IDs:** `#status/#character`→CMD-01; `#vitals`→TIM-01; `#skills`→CAP-PRG-01; `#inventory/#bag`→ENT-01; `#equipment`→POS-01; `#itembox`→POS-BOX-01; `#domain`→DOM-01; `#time`→TIM-01; `#quests`→QST-01; `#rep/#reputation`→REP-02; `#factions`→REP-01; `#events`→EVT-01; `#locations`→LOC-01; `#currency/#wallet`→ECO-01; `#rank`→PRG-01; `#companions`→`emit: entity companion`+`#companions`; `#legion/#hierarchy`→REG-08; `#boons`→CAP-01; `#titles`→CAP-02; `#abilities`→CAP-EVO-01; `#needs`→NDS-01; `#inspect`→INS-01; `#system/#ruleset`→SD-01; `#help`→CMD-help-01; custom/alias→CMD-02; `#party`→CMD-PTY-01; `#scene/#present`→CMD-PTY-01. (`#<category>s` commands are def-derived — see CAP-01/02.)

**System-Def sections → test IDs:** features→XC-GATE-01; identity/progression→REG-05; creation→CC-01; classes→`emit: system_def` w/ classes (CLS); attributes/derived/variables→XC-FORMULA-01/REG-04; reputation→REP-01; capabilities/progressions→CAP-PRG-01/SD-PROG-01; rank_ladder→PRG-01; needs→NDS-02; item_conditions→POS-ITEM-01/REG-11; loyalty→companion tests; resolution→XC-RES-01; rules/emit_rule_entries→SD-RULE-01/02; quests/world_events/factions/companions/capabilities vocab→QST-01/EVT-01/REP-01/REG-08/CAP-01; inventory→POS-BOX-01; equipment→POS-01; locations(+instances)→LOC-01; commands→CMD-02; presentation→XC-PRES-01.

**Header tokens → test IDs:** identity/`{rank}`→HDR-02/05; `{field}/{field_max}/{field_regen}/{field_pct}`→HDR-02/05; `{time}/{date}`→HDR-02; `{conditions}`→HDR-02; `{inventory_count}/{inventory_max}`→HDR-05; `{active_title}/{titles}/{boons}/{abilities}`→HDR-05 (resolve against `state.capabilities`); `{currency}/{currency:denom}`→HDR-05; `{reputation:Faction}`→HDR-05; `{skill_score:Skill}`→HDR-05 (reads the capability's precomputed `prog.score`); `{party}/{scene}`→HDR-05; `{xp_next}`→HDR-05.

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

The block catalogue inside `test-harness-card.json` duplicates the live protocol; if the extension protocol changes, regenerate the catalogue (canonical templates: `system-designer-card.json`). The harness stamps `protocol_version 0.0.11`.
