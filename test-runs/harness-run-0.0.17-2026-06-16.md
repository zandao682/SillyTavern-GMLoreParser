# gm-lore-parser — Harness Run Results

## Run header

| Field | Value |
|---|---|
| Extension version (manifest) | `0.0.17` |
| Harness protocol_version | `0.0.17` |
| Date/time (UTC) | 2026-06-16 |
| Model | `gemma-4-e4b-it-uncensored` (local, textgenerationwebui) |
| Sampler / preset | default textgen preset |
| Settings | hideBlocks=**OFF** · RP system prompt=**ON** · tieredContext=ON · injectContext=ON |
| Books cleared (→ 0 entries) | `harness-campaign`, `harness-campaign-plot`, `harness-campaign-npc-*`, `harness-campaign-location-*` — confirmed |
| Run mode | model-driven, paced one directive at a time (chat + local model, not deterministic injection) |

## Results — every block created its entry/state correctly; **zero model echoes**

| Batch | Directives | Outcome |
|---|---|---|
| A | system_def, entity player, entity npc, entity_update, entity_event, entity_memory | ✅ all 6 (11 def entries; `[Player:Possessions]`; 3× NPC; attr_log 0→1; `[Memory]` created) |
| B | capability boon/skill, capability_update, currency_update, rank_change, xp_award | ✅ all 6 (`[Capability]`×2 + `[Player:Skills]`; gold 50; rank F→C; xp_total 250→500) |
| C | faction, faction_update, reputation_update, quest, quest_update, world_event, world_event_update, plot_entry | ✅ all 8 (`[Faction] Iron Concord`, `[Quest] The Lost Heir`, `[World Event] Siege of Thornwall`, plot entry in `-plot`) |
| D | domain_update, world_time, item, item_update, item_box_update, location, location_memory | ✅ all 7 (`{Greywatch Hold}`, `Day 12, Morning`, `[Item] The Silthorn Compass`, item_box 2, `[Location] Thornwall Keep`, location-memory book auto-created) |
| E | rule, event, needs_system, needs_update, party_update, scene_update | ✅ all 6 (`[Rule] Initiative`, `[Event] The Burning of Aldgate Bridge`, needs `{hunger,thirst}`, `[Party]`/`[Scene]` constant, scene `{garrick-stone, ember}`) |
| F | block_formats_heading, header_format, card_output, card_output_bad, card_begin/field/append/book_entry/finalize, char_create sequence/step_only | ✅ all (see below) |

### Batch F highlights
- **TAG-NORM-01** ✅ — model emitted the markdown-wrapped `## [ENTITY_UPDATE_BEGIN]`; the normalizer parsed it and applied the delta (**hp 90→87**).
- **HEADER_FORMAT** ✅ — format captured (`header_format` set) and rendered live with all tokens (`Testra Vale | Warden | … Rank C | HP 87/90 | Boons: Ironhide`).
- **CARD_OUTPUT** ✅ (valid V2 JSON); **CARD_OUTPUT_BAD** ✅ — malformed JSON **rejected** with a `CARD_OUTPUT parse error` (the single ERROR of the run — *intended* rejection, not a fault).
- **Chunked card assembly** ✅ — `[CARD_BEGIN/FIELD/FIELD-append/BOOK_ENTRY]` buffered; `[CARD_FINALIZE]` correctly **blocked** by the completeness gate (missing first_mes/post_history, draft stays open) and flagged the shallow entry. Draft accumulated across 5 messages (INCR-01).
- **CHAR_CREATE sequence** ✅ (4 blocks, player → "Aria Lumen"); **step_only** ✅ (warned "received outside of creation session — ignoring").

### v0.0.17 features
- **LINK-01** ✅ — on the fresh chat, `chatMetadata.world_info` auto-included `harness-campaign`, `…-npc-garrick-stone`, `…-location-thornwall-keep`. **Gap found:** the `…-plot` book was **not** in the linked set (see Findings #1).
- **Function tools** ✅ — lifecycle off→5→off; `glp_currency_update` action routed into the handler (gold 50→65).
- **Memory enrichment** ✅ (content) — with enrich ON, the `[Memory]` body was clean 3-sentence prose ("Garrick let the wounded bandit go. He chose not to finish the injured assailant… an act of mercy."), **no block tags** (the generateRaw fix holds). **Bug found:** the `enriched` audit flag read `false` despite enriched content (see Findings #2).
- **Semantic recall (Vectors)** — not re-run this pass (verified live in the prior 0.0.16/0.0.17 session; the LINK prerequisite is satisfied so the mechanism applies).

## Summary

| Metric | Count |
|---|---|
| Directives exercised | ~44 across the §9 coverage matrix |
| Emitted correctly first attempt | **all** (0 model echoes — cleanest run recorded) |
| Created entry/state correctly | all |
| Genuine **unexpected** extension errors | **0** |
| Intended errors/warns | 1 ERROR (`card_output_bad`) + 3 WARNs (shallow-entry, finalize-gate, char-create-outside-session) |
| New bugs found | 2 (both minor/edge — see Findings) |

**Conclusion.** Under realistic conditions (RP system prompt ON, hide-blocks OFF, local gemma), every block in the catalogue emitted correctly and produced its lorebook entry and/or state/panel update, with no model echoes and zero unexpected extension errors. The completeness gate, shallow-entry detection, tolerant tag-normalization, and creation-session guard all behaved as designed. Two minor bugs surfaced (below); neither breaks a core feature.

### Findings (2 minor bugs — both FIXED + verified live this session)
1. **Plot book not chat-linked at creation.** `processPlotEntry` (`modules/events.js`) `loadOrCreateLorebook`s the `…-plot` book but never `linkToChat`d it — unlike the npc/location books. So a plot book created mid-chat only became WI-active on the *next* chat load. **Fixed:** added `await linkToChat(plotBook)` at plot-book creation. **Verified:** after deleting+unlinking the plot book then emitting `plot_entry`, `harness-campaign-plot` re-appeared in `chatMetadata.world_info` immediately (all 4 books linked).
2. **`enriched` audit flag stale on re-written memories.** `upsertEntry` (`modules/lorebook.js`) updated only `content/key/order/memo/constant` on the *update* path — not `extensions` — so `extensions.enriched` kept its old value when a same-comment memory was re-written. Content enrichment itself always worked; only the audit flag was stale. **Fixed:** merge `extensions` (`{...ex.extensions, ...entry.extensions}`) on the update path. **Verified:** re-emitting `entity_memory` with enrich ON now writes `enriched: true`.

Both fixes are `node --check` clean and are additional uncommitted changes on top of the committed 0.0.17 batch.

## Compare to previous run (`harness-run-0.0.15-2026-06-15.md`)
| Aspect | 0.0.15 run | This run (0.0.17) |
|---|---|---|
| Model echoes | 5 (resolved on retry) | **0** |
| Unexpected extension errors | 0 | 0 |
| New behaviors covered | — | memory enrichment content, function-tool routing, campaign auto-link |
| New bugs | — | 2 minor (plot-link, enriched-flag) |
No regressions vs. 0.0.15; all previously-passing blocks pass again.
