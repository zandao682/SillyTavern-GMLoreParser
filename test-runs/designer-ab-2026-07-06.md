# Designer A/B — The Architect vs. The Forge

## Run header

| Field | Value |
|---|---|
| Extension version | `0.0.19` |
| Cards | `system-designer-card.json` (**The Architect**, ~32k system_prompt) · `system-forge-card.json` (**The Forge**, ~3.4k system_prompt) |
| Date (UTC) | 2026-07-06 |
| Model | `gemma-4-e4b` (local, textgenerationwebui, text-completion) |
| Instruct template | Gemma 4 (ON) |
| Goal | Determine which designer emits cleaner card-assembly blocks on the small local model |

This run is a **smoke of The Forge** + the decisive finding about run conditions. A full head-to-head across all 17 stages for both cards is the user-driven step; the procedure is at the bottom.

## The decisive variable — immersive global System Prompt (P2.5)

The single largest factor was **not** the card. SillyTavern's global **System Prompt** was **enabled** with the immersive preset (*"Write at least one paragraph… Be descriptive and immersive… vivid details… high degree of complexity and burstiness"*). Prepended on top of either designer card, it:
- suppressed block emission entirely (the model guided/narrated instead of emitting), and
- injected a repeated self-authored `KEYSTONE: … / Description: …` prose preamble on every turn.

**Disabling it** (`Advanced Formatting → System Prompt` off) removed the preamble and unblocked emission. **Conclusion: for either designer on a small model, the immersive global System Prompt must be OFF.** This is documented as P2.5 in ARCHITECT-TESTING.md; this run confirms it dominates card choice.

## The Forge — observed behavior

**Conditions A — immersive prompt ON (invalid):**
- Followed the staged flow correctly (confirmed framing → advanced one stage at a time → asked one focused question), **but never emitted a block**; each reply carried the immersive `KEYSTONE:`/`Description:` preamble.
- When explicitly pushed to emit, produced a **malformed pseudo-block** (`Key:`/`Comment:`/`Content:` prose lines and `[/SYSTEM_DEF]` instead of `[SYSTEM_DEF_END]`, no `[CARD_BEGIN]` wrapper).

**Conditions B — immersive prompt OFF (valid):**
- Preamble gone; clean, focused staged guidance (correct stage tracking, confirms, one question per turn — no runaway "I'll design the whole thing" narration).
- On an explicit emit instruction it emitted a **perfect literal block**:
  ```
  [CARD_BEGIN]
  name: Emberhold GM
  [CARD_END]
  ```
  → extension opened the draft (`card_draft.active = true`, `name = "Emberhold GM"`).
- Next turn emitted a valid `[CARD_FIELD_BEGIN] key: system_prompt append: true … [CARD_FIELD_END]` → extension appended it (`draft.data.system_prompt` = clean `"## System Definition\nEmberhold is a grim, low-magic survival RPG…"`, 342 chars). Correct, on-brief content.

| Check | Result |
|---|---|
| Staged guidance (one question, confirm, correct order) | ✅ clean |
| Runaway narration / "design everything at once" | ✅ none |
| `[CARD_BEGIN]` literal + extension opens draft | ✅ (conditions B, on emit push) |
| `[CARD_FIELD]` literal + extension buffers field | ✅ (conditions B) |
| Emits **without** an explicit push | ⚠️ tends to stay in "guide" mode (see tuning note) |
| Malformed block under immersive prompt | ❌ (conditions A — expected; immersive prompt is the cause) |

## Findings

1. **The Forge works** on the local model: it produces literal, valid card-assembly blocks that the extension captures — *once the immersive global System Prompt is off*. The ~3.4k prompt (vs the Architect's ~32k) gave noticeably tighter, better-tracked staged guidance and eliminated the runaway-narration failure mode.
2. **Environment beats card.** The immersive global System Prompt was the dominant blocker for *both* cards. Neither designer emits reliably with it on; both improve sharply with it off. The Forge's `creator_notes` and the README/ARCHITECT-TESTING A/B note now call this out first.
3. **Tuning opportunity (candidate v2 of The Forge):** on this model The Forge stays in "Guide" mode unless explicitly told to emit — it confirms and advances but skips the loop's emit step. Recommended refinement: make loop step 4 more forceful (e.g. "**every** turn ends with exactly one emitted block; if you asked a question last turn and it was answered, emit that stage's block **before** asking the next"), and/or add a short "if unsure, emit the current stage's block now" default. Cheap to iterate since the always-on prompt is small.

## Full A/B procedure (to complete head-to-head)
1. Local model; **immersive global System Prompt OFF**; import both cards (The Forge auto-imported this run).
2. Run the **same Emberhold brief** (ARCHITECT-TESTING.md §3) twice — once per card — pacing one stage at a time.
3. Score per card: (a) block fidelity (literal `[..._BEGIN]` vs markdown/pseudo-block/narration), (b) narration-instead-of-emit incidents, (c) stage adherence / state drift, (d) `[CARD_FINALIZE]` passes the completeness gate first try, (e) produced-card validity (`JSON.parse`, required fields, `[SYSTEM_DEF]` parses, ≥1 non-empty entry).
4. Append the Architect column to this file; declare the winner for this model.

## Iteration 2 — "block-first" rewrite (works with the immersive prompt ON)

The user asked The Forge to emit reliably **with** the immersive System Prompt on, noting that cards like *The System — Veridia* emit structured blocks alongside prose. The lesson from Veridia was mis-applied at first: Veridia mandates its status block at the **start** of every message ("Begin EVERY message with the status header"), so it prints *before* the model builds prose momentum. The Forge's first cut put the block **last** ("nothing after the final `[..._END]`") — with an immersive "write a paragraph" prompt active, gemma writes the paragraph and never reaches the trailing block.

**Change:** flipped The Forge to **block-first** — every reply LEADS with exactly one literal card block, then the guidance prose follows (Veridia's status-header pattern). Also: **open the card on turn one** (`[CARD_BEGIN]` as soon as a name exists) so there is always a concrete block to lead with, and the buffer is open before any field/entry. Updated `system_prompt`, `personality`, `post_history_instructions`, `first_mes`, `mes_example`, and the `[Forge] Output Protocol` entry accordingly.

**Result — immersive global System Prompt ON, local gemma, 3 consecutive turns, all captured:**

| Turn | Input | The Forge output (block-first) | Extension state |
|---|---|---|---|
| 1 | name + framing | leads with `[CARD_BEGIN]\nname: Emberhold GM\n[CARD_END]`, then immersive prose + next question | `card_draft.active = true`, name "Emberhold GM" |
| 2 | world premise | leads with a `[CARD_FIELD]` (Tone/Premise), then prose | `draft.system_prompt` = 294 ch (World Context captured) |
| 3 | attributes/skills/features | leads with a `[CARD_FIELD]` append (System Definition), then prose | `draft.system_prompt` = 795 ch (attributes, d100 resolution, skills, enabled features) |

Every turn emitted a literal, well-formed block that the extension processed — **with the immersive prompt active** — and the prose still satisfied the immersive style. No `Key:`/`Content:` pseudo-blocks, no `[/SYSTEM_DEF]`, no markdown-heading blocks. (`hideBlocks` strips the leading block from the visible message, so the block lives in `card_draft`, not the rendered text — verify via `chatMetadata['gm-lore-parser'].card_draft`.)

**Conclusion.** Block-first is the fix. The Forge now emits card-assembly blocks reliably **alongside** prose under an immersive System Prompt, matching the Veridia behavior the user pointed to — no need to disable the global prompt. Minor cosmetic residue observed (a duplicated `## Tone / Premise` heading inside one field body) — harmless system_prompt text, candidate for a future polish. The Architect column of the full head-to-head remains the user-driven step.

## Iteration 3 — full run to `[CARD_FINALIZE]` + produced-card block discipline

Drove The Forge (immersive prompt ON) from a fresh chat through the required card pieces, then finalized. Model-driven results:

| Piece | How | Captured in `card_draft` |
|---|---|---|
| `[CARD_BEGIN] name: Emberhold GM` | turn 1, block-first | `draft.name = "Emberhold GM"` |
| `[CARD_FIELD] system_prompt` | model, block-first | 406 ch |
| `[CARD_BOOK_ENTRY] [Rule] Resolution Mechanic` | model, block-first | 1 entry |
| `[CARD_FIELD] first_mes` (ends with `[CHAR_CREATE_BEGIN]`) | model | 418 ch |
| `[CARD_FIELD] post_history_instructions` (BLOCK DISCIPLINE) | model (2nd try, after it first mis-copied The Forge's own loop rules) | 586 ch |

**Two failure modes found at finalize (both real, both now mitigated):**
1. **A stray second `[CARD_BEGIN]` wipes the draft.** While nudging finalize, the model emitted extra `[CARD_BEGIN]` lines ("Emberhold GM (Finalized)"); each one re-opens the buffer and **discards all accumulated fields/entries** (confirmed in console: "Card assembly opened" mid-run, then finalize blocked as "missing everything"). This is inherent to `applyCardBegin` (open = reset).
2. **The content-free `[CARD_FINALIZE]` block is the one block a small model won't emit under an immersive prompt** — it treats it as a topic to narrate ("the build stands complete!") rather than output, and history poisoning compounds it across retries.

**Finalize verified via the real pipeline (deterministic injection).** Rebuilt the draft cleanly and fed each block through the extension's `MESSAGE_RECEIVED` handler (same path a model emission takes), then `[CARD_FINALIZE]`. Result: the gate **passed**, the draft closed, and a valid card **downloaded**:
- `spec: "chara_card_v2"`, `name: "Emberhold GM"`; fields: `system_prompt`, `first_mes`, `post_history_instructions`, `character_version`, `character_book`.
- `character_book`: `[Rule] Resolution` + keystone `[System Definition]` (contains the literal `[SYSTEM_DEF_BEGIN]…[SYSTEM_DEF_END]` + `[HEADER_FORMAT]`).
- **Block-discipline lesson present in the produced card** — `post_history_instructions` and `system_prompt` both carry the "emit the matching gm-lore-parser block in literal tags, block-first, even under immersive narration" instruction, so a GM played from this card is told to print its state blocks the same way.

**Hardening applied to The Forge (v-current)** so the model-driven finalize is reliable:
- **"Emit `[CARD_BEGIN]` EXACTLY ONCE — a second one wipes the card."** Added to `system_prompt`, the Output-Protocol entry, and the finalize template.
- **Finalize framed as a normal block-first output:** "your block for the finalize turn IS `[CARD_FINALIZE_BEGIN][CARD_FINALIZE_END]` — no fields, no prose padding, never a second `[CARD_BEGIN]`."

**Conclusion.** The Forge's produced card assembles into a valid, gate-passing GM card, and the block-first lesson is now inherited by the systems it creates. The two finalize edge cases (single-`[CARD_BEGIN]`, content-free finalize block) are addressed in the card prompt; the extension's completeness gate remains the backstop that made a broken card impossible throughout.

## Iteration 4 — clean model-driven finalize (hardened card, immersive ON)

Re-ran end-to-end on the **hardened** Forge, fresh chat, immersive System Prompt **ON**, one block per turn:

| Turn | Request | Result |
|---|---|---|
| 1 | name + framing | `[CARD_BEGIN] name: Emberhold GM` (block-first); draft open |
| 2 | system definition | `[CARD_FIELD] system_prompt` (516 ch) |
| 3 | resolution rule | `[CARD_BOOK_ENTRY] [Rule] Resolution Mechanics` |
| 4 | opening | `[CARD_FIELD] first_mes` (376 ch, ends `[CHAR_CREATE_BEGIN]`) |
| 5 | post_history | `[CARD_FIELD] post_history_instructions` with BLOCK DISCIPLINE — **correct on the first try this run** |
| 6 | "finalize the card now" | **model emitted `[CARD_FINALIZE]` itself** → draft closed, card **downloaded** |

- **The finalize block is now self-emitted.** On a single plain "finalize" request the model produced the finalize block (block-first; stripped from the visible message by `hideBlocks`, proven by `card_draft.active → false` + one download). The earlier narrate-instead-of-emit stall did not recur.
- **The single-`[CARD_BEGIN]` hardening held** — no stray re-open across all six turns, so nothing wiped the draft.
- Produced card: valid `chara_card_v2`, `name "Emberhold GM"`, all six data fields, `[Rule] Resolution` entry, and BLOCK DISCIPLINE in `post_history_instructions`. (This abbreviated run skipped Stage 8/15, so it omits the keystone `[System Definition]` entry and the system_prompt copy of block-discipline — both are produced when those stages are run, as verified in Iteration 3.)

**Net:** with the hardened card, The Forge now runs a full design end-to-end on the local model under an immersive System Prompt and **finalizes on its own**, producing a valid, gate-passing GM card that carries the block-discipline lesson forward.

## Iteration 5 — natural-language run (no "emit X" instructions), immersive ON

Ran The Forge as a real user would: describe the game, answer its questions in plain English, never tell it which block to emit. First pass exposed two gaps; both were fixed in the card and re-run.

**First natural pass (pre-fix):**
- ✅ Opened the card from a plain description ("I want to build a game called Emberhold…"), drove the stages itself, and emitted `system_prompt` fields **block-first** across turns from natural answers.
- ❌ The keystone `[System Definition]` entry was written as **markdown prose** ("**Core Mechanics:** * Attributes…"), not the literal `[SYSTEM_DEF]` block — so its ruleset would not hydrate.
- ❌ On "go ahead and build me the card," it **narrated "the card is now ready to import" without emitting** `first_mes`, `post_history_instructions`, or `[CARD_FINALIZE]` — nothing downloaded.

**Two card fixes applied:**
1. **Keystone must be literal.** system_prompt + Stage-8 template now stress that the `[System Definition]` entry content is the LITERAL `[SYSTEM_DEF_BEGIN]…[SYSTEM_DEF_END]` block, "never a prose 'Core Mechanics' write-up — prose loads nothing."
2. **"Build it" means emit + finalize.** system_prompt + finalize section now state: on "build it / we're done," first emit any MISSING required piece (first_mes, post_history, the keystone entry) one per reply, THEN `[CARD_FINALIZE]`; "the card is ready ONLY after `[CARD_FINALIZE]` downloads it — never just because you say so."

**Second natural pass (post-fix):**
- ✅ On "build me the card," it **stopped claiming false completion** and began emitting the missing pieces (`first_mes`, then `post_history_instructions`), one per reply.
- ✅ On "keep going and finalize it," it emitted the `[System Definition]` entry **and `[CARD_FINALIZE]` itself** → draft closed, **card downloaded** — entirely from natural language.
- ✅ The keystone entry is now the **literal `[SYSTEM_DEF_BEGIN]` block** (fix 1 held), with `features` and `derived` present.
- ⚠️ Residual (now FIXED in the extension): the model wrote the attribute lines inline (`attributes|Brawn|BRN|…`) instead of the `attributes:` + indented `key | Label | ABBR` sub-format. Rather than only tightening the template, the **`[SYSTEM_DEF]` parser was made format-tolerant** (`_groupSections` + the attributes parser in `modules/system.js`): it now routes pipe-prefixed inline rows (`attributes|…`, `derived|…`) into their section and accepts keyless `Label | ABBR | desc` attribute rows (deriving the machine key from the label), while the canonical indented form still parses unchanged. **Verified live** on the exact block the model produced — all four attributes, features, and the derived `health = (brawn*4)+(spirit*2)` all hydrate. So both styles work regardless of how a model reshapes the block. (Still-open polish, template side: the entry sometimes omits `[HEADER_FORMAT]`, and block-discipline didn't land in `post_history` on this particular pass — minor.)

**Net:** with the two fixes, The Forge now runs **end-to-end on pure natural language** under an immersive System Prompt — opens the card, drives its own stages, emits blocks block-first, and **finalizes on its own into a downloadable card whose keystone carries the literal `[SYSTEM_DEF]` block**. Remaining rough edges are internal-format nuances, not flow failures, and the completeness gate remains the backstop.

## Iteration 6 — user's real design run: four issues found + fixed

A full natural design session (sci-fi "Ashford" system) surfaced four concrete problems, diagnosed from the chat log:

1. **System name ignored.** {{user}} said "a game in the Ashford system"; The Forge named it **"Emberhold"** and kept it — copying the name baked into `mes_example`. **Root cause:** small models lift concrete values out of the examples. **Fix (card):** added a **"USE {{user}}'S ANSWERS — never the examples' values"** section to `system_prompt`, and changed the `mes_example`/templates to neutral placeholders ("Aetheria") with an explicit "these are format only; use {{user}}'s real name — if unstated, ASK, don't default."
2. **Resolution never asked; d100 assumed.** {{user}} implied GM-discretion-by-attribute; The Forge silently baked in **"d100 resolution."** **Fix (card):** Stage 3 is now a **REQUIRED ask** ("NEVER assume d100 or any default"; GM-discretion is a valid answer to capture), reinforced in the design order.
3. **No time/calendar stage.** The design order had none. **Fix (card):** added **Stage 13b — Time & Calendar** (ask how in-world time advances; emit a `[Rule] Time` entry) to the order + a `[Template]` entry.
4. **Stray `[CARD_BEGIN]` before finalize wiped the whole draft** → nothing generated (confirmed: draft ended empty). **Fix (extension — the robust one):** `applyCardBegin` now treats a `[CARD_BEGIN]` on an **already-open** draft as a **rename only** — it keeps every accumulated field/entry instead of resetting. **Verified live:** after building a draft (name + system_prompt + `[Rule] Resolution`), a second `[CARD_BEGIN] name: … (Final)` left the field + entry intact and only updated the name (`preserved: true`). The exact failure that lost the card is now impossible; the prompt-side "emit CARD_BEGIN once" guidance remains as a first line of defense.

Fixes 1–3 are prompt-side (best-effort on a 4B model); fix 4 is in code (guaranteed). Docs: What's-New + `TESTING.md` CARDBLD-10 (repeat-begin preserves draft).

**Confirmation run — natural "Duskmoor" gothic-horror session (immersive ON):**
- ✅ **Name respected.** Given "a system called Duskmoor," the card finalized as **"Duskmoor GM"** (console: `Card assembly finalized: "Duskmoor GM"`) — never the example's placeholder. Fix #1 holds.
- ✅ **Card generated + no draft wipe.** The draft carried through to finalize intact; the produced card's keystone entry contained the **literal `[SYSTEM_DEF]` block** (so, unlike the lost run, **no** "no [System Definition] entry" warning). The `CARD_BEGIN on an open draft — kept N field(s)` log confirms the rename-preserve fix firing. Fix #4 holds.
- ❌→fixed **Resolution still defaulted to d100** this run, because the `mes_example` still *contained* "d100" as a copyable value. **Follow-up fix:** removed **every** occurrence of "d100" from the card — the example now demonstrates a distinctive dice-pool, and the anti-default guidance no longer names d100 (which was itself priming the model). d100 now appears nowhere in the card.
- ⚠️ **Time:** the session captured the time concern when raised but was short-circuited to finalize before reaching Stage 13b, so the "asks about time unprompted" path wasn't walk-tested — the stage + template are in place.

**Net after this round:** name and card-generation are confirmed reliable on the local model under an immersive prompt; the d100 resolution bleed is addressed at its source (removed from the card); time coverage is added structurally. The remaining softness is inherent to a 4B model skipping/short-cutting stages — the completeness gate + the code-side draft-preservation guarantee a *valid* card regardless.

## Environment note
Iteration 1 toggled the global System Prompt OFF then restored it to ON. Iterations 2–6 ran with it **ON** (validating block-first under the real condition); the immersive prompt was briefly toggled OFF only for the content-free finalize attempt, then restored to ON (as originally found). Finalize was completed via deterministic block injection through the extension's real handler. Server not restarted; nothing committed.
