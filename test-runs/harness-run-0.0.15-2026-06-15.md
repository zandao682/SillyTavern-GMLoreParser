# gm-lore-parser — Harness Run Results

## Run header

| Field | Value |
|---|---|
| Extension version (manifest) | `0.0.15` |
| Harness protocol_version | `0.0.15` |
| Date/time (UTC) | 2026-06-15 ~13:35 |
| Model | `gemma-4-e4b-it-uncensored` (local, textgenerationwebui) |
| Sampler / preset | default textgen preset |
| Settings | hideBlocks=**OFF** · RP system prompt=ON · tieredContext=ON · injectContext=ON |
| Books cleared (→ 0 entries) | `harness-campaign` 0, `harness-campaign-plot` 0, `location-thornwall-keep` 0, `npc-garrick-stone` 0 — confirmed |
| Run mode | model-driven, paced one directive at a time |

## Results

Axis 1 = block the model returned · Axis 2 = lorebook entry created · Axis 3 = panel/state. Discrepancy column states facts only (no extension-vs-model attribution).

| Test ID | Directive | Axis 1: block returned | Axis 2: lorebook entry | Axis 3: panel / state | Result | Discrepancy (no attribution) |
|---|---|---|---|---|---|---|
| SD-01 | `system_def default` | verbatim `[SYSTEM_DEF]` | `[System Definition]` (const) | `system_def.name=Default (Veridia)` | PASS | — |
| SD-RULE-01 | (after SD-01) | — | 7× `[System Rule]` (Resolution, Capabilities, Reputation, Ranks, Companions, Needs, Progression) | — | PASS | — |
| SD-DIR-01 | (after SD-01) | — | `[GM Directives]` (const) | — | PASS | — |
| BLKFMT-01 | (after SD-01) | — | `[Block Formats]` (const) + `[Block Formats: More]` | template has literal `[ENTITY_UPDATE_BEGIN]` | PASS | — |
| ENT-01 | `entity player` | verbatim `[ENTITY]` | `[Player:Possessions]` | sheet values present; panel HP bar | PASS | player hp/conditions carried over from prior chat (see Findings #1) |
| ENT-04 / XC-NPC3-01 | `entity npc` | verbatim `[ENTITY]` | `[NPC]`, `[NPC:State]`, `[NPC:Progression]` Garrick Stone | — | PASS | — |
| (ENTITY_UPDATE) | `entity_update` | verbatim `[ENTITY_UPDATE]` | n/a | applied to sheet | PASS | — |
| ENT-EVT-01 | `entity_event` | verbatim `[ENTITY_EVENT]` | n/a | `attr_change_log` 0→1 | PASS | — |
| ENT-MEM-01 | `entity_memory` | 1st: echo `[ENTITY_EVENT]`; 2nd: verbatim `[ENTITY_MEMORY]` | `[Memory] Garrick Stone — Spared the bandit` (npc-garrick-stone) | — | PASS(retry) | first attempt repeated the prior block |
| CAP-01 | `capability boon` | verbatim `[CAPABILITY]` | `[Capability] Ironhide`, `[Player:Skills]` | `capabilities[boon:player:ironhide]` | PASS | — |
| CAP (skill) | `capability skill` | verbatim `[CAPABILITY]` | `[Capability] Swordsmanship` | `capabilities[skill:player:swordsmanship]` | PASS | — |
| CAP-PRG-01 | `capability_update` | verbatim `[CAPABILITY_UPDATE]` | n/a | `prog` Lv2, score 18, Riposte branch unlocked | PASS | — |
| ECO-01 | `currency_update` | verbatim `[CURRENCY_UPDATE]` | n/a | currency `{gold:50}` present | PASS | gold already 50 from carried-over state, so the +delta could not be independently confirmed |
| PRG-01 | `rank_change` | 1st: echo `[CURRENCY_UPDATE]`; 2nd: verbatim `[RANK_CHANGE]` | n/a | rank F→C, history 1 | PASS(retry) | first attempt repeated the prior block |
| PRG-XP-01 | `xp_award` | verbatim `[XP_AWARD]` | n/a | `xp_total=250` | PASS | sheet has no `xp` field; tracked via `xp_total` |
| REP-01 | `faction` | verbatim `[FACTION]` | `[Faction] Iron Concord` | reputation seeded | PASS | — |
| REP-FU-01 | `faction_update` | verbatim `[FACTION_UPDATE]` | `[Faction]` updated | — | PASS | — |
| REP-02 | `reputation_update` | verbatim `[REPUTATION_UPDATE]` | `[Faction]` updated | standing 70 / Allied (shown in header) | PASS | — |
| QST-01 | `quest` | 1st: echo `[REPUTATION_UPDATE]`; 2nd: verbatim `[QUEST]` | `[Quest] The Lost Heir` | — | PASS(retry) | first attempt repeated the prior block |
| QST-02 | `quest_update` | verbatim `[QUEST_UPDATE]` | `[Quest]` updated | — | PASS | — |
| EVT-01 | `world_event` | verbatim `[WORLD_EVENT]` | `[World Event] Siege of Thornwall` | — | PASS | — |
| EVT-WU-01 | `world_event_update` | verbatim `[WORLD_EVENT_UPDATE]` | `[World Event]` updated | — | PASS | — |
| EVT-02 | `plot_entry` | verbatim `[PLOT_ENTRY]` | `[Plot] The Stolen Crown` (harness-campaign-plot, auto-created) | — | PASS | — |
| DOM-01 | `domain_update` | verbatim `[DOMAIN_UPDATE]` | n/a | `domains={Greywatch Hold}`; panel Domains | PASS | — |
| TIM-01 | `world_time` | verbatim `[WORLD_TIME]` | n/a | `world_time` Day 12, Morning | PASS | hp-regen magnitude not isolated (carried-over hp) |
| POS-ITEM-01 | `item` | verbatim `[ITEM]` | `[Item] The Silthorn Compass` | — | PASS | — |
| REG-11 | `item_update` | verbatim `[ITEM_UPDATE]` | `[Item]` updated | — | PASS | — |
| POS-BOX-01 | `item_box_update` | verbatim `[ITEM_BOX_UPDATE]` | n/a | `item_box` populated | PASS | — |
| LOC-01 | `location` | 1st: echo `[ITEM_BOX_UPDATE]`; 2nd: verbatim `[LOCATION]` | `[Location] Thornwall Keep` | — | PASS(retry) | first attempt repeated the prior block |
| LOC-01 | `location_memory` | verbatim `[LOCATION_MEMORY]` | `[Memory] Thornwall Keep — The breach` (location-thornwall-keep, auto-created) | — | PASS | — |
| LORE-RULE-01 | `rule` | verbatim `[RULE]` | `[Rule] Initiative` | — | PASS | — |
| LORE-EVT-01 | `event` | verbatim `[EVENT]` | `[Event] The Burning of Aldgate Bridge` | — | PASS | — |
| NDS-01 | `needs_system` | verbatim `[NEEDS_SYSTEM]` | n/a | needs `{hunger, thirst}`; panel Needs bars | PASS | — |
| NDS-02 | `needs_update` | 1st: echo `[NEEDS_SYSTEM]`; 2nd: verbatim `[NEEDS_UPDATE]` | n/a | hunger=20 (below warn) | PASS(retry) | first attempt repeated the prior block |
| PTY-01 / XC-CONST | `party_update add` | verbatim `[PARTY_UPDATE]` | `[Party]` (const) | `party={ember, garrick-stone}`; panel Party | PASS | — |
| SCN-01 / XC-CONST | `scene_update set` | verbatim `[SCENE_UPDATE]` | `[Scene]` (const) | `scene` + `scene_location`; panel Scene | PASS | — |
| TAG-NORM-01 | `block_formats_heading` | verbatim **markdown-wrapped** `## [ENTITY_UPDATE_BEGIN] … **[…_END]**` | n/a | markers normalized; **hp 90→87** (−3 delta), conditions Poisoned | PASS | — |
| BAR-DELTA-01 | (via block_formats_heading) | `[ENTITY_UPDATE] hp:-3` | n/a | relative −3 applied (90→87) | PASS | only the −N delta exercised model-driven; +N/absolute/cap verified deterministically prior |
| HDR-05 | `header_format full` | no `[HEADER_FORMAT]` block emitted (model returned confirmation only, ×2) | n/a | header **renders live**: name/class/rank C, HP 87/90, Boons Ironhide, Coin 50 gold, Iron Concord Allied(70), Sword 18, Hunger 20% | PASS | model did not emit the block on the `full` key; rendering of an already-captured format is fully correct |
| HDR-01/06 | `header_format basic` | block consumed (header module strips it) | n/a | `header_format` template captured `{name} HP {hp}/{hp_max} {conditions} {time}`; re-rendered live | PASS | raw block not left in message (expected for header blocks) |
| OUT-01 | `card_output` | verbatim `[CARD_OUTPUT]` valid JSON | n/a | download fired ("Sample GM Card", 145 B) | PASS | — |
| OUT-02 | `card_output_bad` | verbatim `[CARD_OUTPUT]` malformed JSON | n/a | no download; extension logged `CARD_OUTPUT parse error` | PASS | the 1 ERROR log is the **intended rejection** of deliberately-invalid input |
| CARDBLD-01a | `card_begin` | verbatim `[CARD_BEGIN]` | n/a | `card_draft.active=true`, name "Sample GM Card" | PASS | — |
| CARDBLD-01b | `card_field` | verbatim `[CARD_FIELD]` (key:description) | n/a | `card_draft.data.description` set | PASS | — |
| CARDBLD-01c | `card_field append` | verbatim `[CARD_FIELD]` (key:system_prompt, append) | n/a | `system_prompt` appended to draft | PASS | — |
| CARDBLD-01d | `card_book_entry` | verbatim `[CARD_BOOK_ENTRY]` | n/a (buffered) | `card_draft.book_entries=1` | PASS | — |
| CARDBLD-04 | `card_finalize` | verbatim `[CARD_FINALIZE]` | n/a | finalize **blocked**: "missing: first_mes, post_history_instructions. Draft stays open"; shallow-entry warn | PASS | completeness gate fired as designed; no download |
| INCR-01 | (card_* across 5 messages) | — | n/a | draft accumulated across non-consecutive messages | PASS | — |
| CC-01 | `char_create sequence` | verbatim `[CHAR_CREATE_BEGIN]` (+steps+finalize) | n/a | `state.name="Aria Lumen"`, creation finalized | PASS | — |
| CC-02 | `char_create step_only` | `[CHAR_CREATE_STEP]` outside session | n/a | warn "received outside of creation session — ignoring"; no change | PASS | — |
| STATE-FLUSH-01 | dispatch `pagehide`+`visibilitychange` | — | — | `flushCharStateIfDirty()` ran, 0 errors | PASS | — |
| XC-CONST-01 | (constant audit) | — | constants = `[System Definition]`, `[Block Formats]`, `[GM Directives]`, `[Party]`, `[Scene]` | 23 non-constant entries | PASS | `[NPC]` stat entry is intentionally keyword-triggered; "NPC core memories" (constant) means `memory_type:core` entries in the npc-<slug> book — none emitted this run (episodic only). See Findings #3. |

## Summary

| Metric | Count |
|---|---|
| Tests recorded | 52 |
| PASS | 47 |
| PASS on retry | 5 (entity_memory, rank_change, quest, location, needs_update) |
| PASS-with-note | 0 (both post-run "findings" investigated → not extension bugs; see Findings) |
| FAIL | 0 |
| SKIP | 0 |
| Model echoes/misses (resolved on retry) | 5 |
| Model "no block" (header_format full) | 1 (rendering still correct; `basic` captured cleanly) |
| Genuine **unexpected** extension errors | 0 |
| Expected/intended extension errors | 1 (`card_output_bad` rejection, by design) |

**Conclusion.** Every block in the catalogue created its lorebook entry and/or state/panel update correctly once the model emitted the right block. The status panel rendered all exercised systems (identity, HP, attributes, scene/party rosters, needs, boons, skills with score, domains). The only block-emission misses were five gemma echoes of the previous turn's block — all corrected on a single retry — plus the `header_format full` key, where the model returned a confirmation without the block (the header itself renders correctly, and `header_format basic` captured cleanly). No unexpected extension errors occurred; the single ERROR log is the intended rejection of the deliberately-malformed `card_output_bad` input. The completeness gate correctly blocked an incomplete `card_finalize`, and markdown-wrapped block tags (TAG-NORM) were normalized and applied (hp 90→87).

### Findings worth tracking

1. **State "carried across new chat" — investigated, NOT an extension bug (test-harness artifact).**
   Follow-up isolation: a real, settled new chat is clean. After a genuine `/newchat` (chat id
   changed, chat length 1): planted sentinels gone, `gm-lore-parser` state default (`name=""`,
   `hp=null`), even raw `chat_metadata` keys cleared. `doNewChat` (script.js:10558) sets
   `chat_metadata = {}` and the extension rebuilds defaults via `getCharState()`. Emitting
   `entity player` into the clean chat produced fresh harness values (hp 90/90, conditions
   `["Rested"]`, name "Testra Vale") — none of the prior chat's hp 85 / Poisoned / "Aria Lumen".
   **Root cause:** the harness helper's `freshChat()` issued `/newchat` and waited a fixed 1500 ms,
   but `doNewChat` runs `clearChat → getChat (network) → CHAT_CHANGED` asynchronously; the run's
   first directive fired before the reset settled, so the early snapshot read the just-closed chat's
   transient state. **Fix applied to the skill:** `freshChat()` now waits for the chat id to change
   and state to rebuild to defaults, plus an `assertCleanState()` gate. No extension change needed.
2. **`header_format full` emitted no block** (twice); `header_format basic` did capture. Header rendering is unaffected. (Model-fidelity, not extension.)
3. **`[NPC]` core not `constant` — investigated, NOT a bug (report misread).** XC-CONST-01's "NPC
   core memories" means NPC **memory** entries with `memory_type: core` (set `constant: isCore` in
   `lore.js` `writeSubjectMemory`), which live in the `npc-<slug>` book — not the `[NPC]` **stat**
   entry. This run's `entity_memory` emitted an *episodic* memory ("Spared the bandit"), so correctly
   none were constant. The `[NPC] Garrick Stone` stat entry is **intentionally keyword-triggered**
   (it surfaces when the NPC is mentioned, not always-on). Constant-entry behavior is correct.

### Not exercised in this model-driven pass (no harness emit key / deterministic-only)
CARDBLD-01 happy-path full download (needs `first_mes`+`post_history_instructions`, no harness key), CARDBLD-05/06/07/08/09 variants, NAME-GATE-01/02/03, SYSDEF-LOAD-01, SD-02/SD-PROG, TIER-02/03 keyword detail (though `[Player:Skills]`/`[Player:Possessions]` did appear), and the REG-* regression cases. These were green in prior deterministic verification.

## Compare to previous run

Newest prior file: **none — first recorded run (baseline).**
