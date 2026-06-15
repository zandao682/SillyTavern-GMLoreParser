# Test Plan — The Architect & the GM cards it produces

A **manual**, reproducible test plan for `system-designer-card.json` (**The Architect** — the staged RPG-system *designer*) and for the **GM character card it generates**. This is separate from [`TESTING.md`](TESTING.md), which tests the *extension's* block parsing via the harness. Here the unit under test is a conversational design agent plus its output contract, run by hand against a connected LLM.

The Architect is the most failure-prone artifact in the toolkit: a long multi-stage reasoning process that must end in a strict, machine-consumed output (`[CARD_OUTPUT]` + `[LOREBOOK_OUTPUT]`). A subtly malformed produced card breaks downstream play silently, so this plan validates **both** the design conversation and the artifact, then **imports the artifact and plays it** to prove the designed system actually runs.

---

## 1. Purpose & scope

- **Part A** — the Architect's staged conversation: that it asks each stage, one at a time, confirms before proceeding, honors content framing + realism directives, and never outputs early. Plus guardrail negatives (no retired blocks; no `level`/`xp`/`class` for a levelless system; etc.).
- **Part B** — structural validation of the produced GM card + lorebook JSON (valid V2, required `system_prompt` sections, `first_mes` contract, `character_book`, `post_history_instructions`).
- **Part C** — end-to-end: import the produced card + lorebook into SillyTavern, link the campaign lorebook, and play through `[SYSTEM_DEF]` emission, in-chat creation, and several of the **designed** system's blocks, confirming gm-lore-parser processes them.

Because the Architect is conversational, Part A acceptance is qualitative (judged against the expected checkpoint), while Parts B/C are mechanical (JSON parse, section greps, observable extension side effects).

## 2. Prerequisites / setup

| # | Step | Verify |
|---|------|--------|
| P1 | gm-lore-parser v0.0.14 installed and enabled. | Console: `[gm-lore-parser] v0.0.14 loaded…`. |
| P2 | A local LLM connected with a **correct instruct template** and an adequate response-token / context budget (card sections are emitted incrementally, but the keystone `[System Definition]` entry + `system_prompt` sections are long). | A test generation completes without truncation. |
| P2.5 | **Disable any immersive/roleplay global System Prompt** (Advanced Formatting → System Prompt) while designing. A prose-roleplay system note (e.g. the "Roleplay - Immersive" preset: *"write at least one paragraph… be descriptive and immersive…"*) is prepended on top of the Architect's own prompt and **overrides structured output** — the model writes narration *about* emitting blocks instead of emitting them. Use a neutral/empty System Prompt for the Architect; keep the roleplay one for actual play. | A design turn that should emit a card section (e.g. opening `[CARD_BEGIN]` at Stage 2, or the `[System Definition]` entry at Stage 8) emits real `[..._BEGIN]` tags, not prose like "I will now generate…". |
| P3 | Import `system-designer-card.json` (Characters → Import). Confirm `data.character_version` shows `0.0.14`. | Card present; version visible in card details. |
| P4 | Set the extension's **Campaign Lorebook to blank** while chatting with the Architect (it produces output, it must not write campaign lore). | No campaign lorebook selected. |
| P5 | Start a **new chat** with the Architect. | Greeting asks for content framing + the game feeling. |

> **Reproducibility:** drive the whole session with the **reference design brief** (§3). Feeding the same answers each run makes Part A checkpoints and Parts B/C assertions deterministic enough to compare across runs and models.

## 3. Reference design brief — "Emberhold"

**Talk to the Architect like a real person** — describe what you want in plain language; *it* is responsible for extracting the structured System Definition. Don't hand it `key | label | abbr` rows or feature lists. Use the natural-language lines below (paraphrase freely), and judge each stage against the **target the Architect should capture** (the acceptance reference at the end). Emberhold is deliberately **levelless/classless** to exercise the negative cases.

**Your lines (say these naturally, one reply per stage as it asks):**
- *(opening / content + feel)* "I want to build a grim, low-magic survival game — dark fantasy where the world is genuinely dangerous and you're never really safe. Keep anything sexual fade-to-black, and gore's fine but no torture-porn. And it really matters to me that the world feels real: people should only know what they've actually seen or been told, nobody should instantly like or trust me, I need to be able to actually fail, and you should never speak or act for my character."
- *(the system's shape)* "No levels and no classes — characters just get better at what they practice. I want skills, standing with factions, money, survival needs like hunger and fatigue, quests, gear with a stash for extra stuff, and a way to track who's travelling with me and who's in the current scene. Skip ranks, domain management, off-screen world events, and recruitable companions."
- *(attributes + health)* "Four stats: Brawn for strength and toughness, Agility for speed and finesse, Wits for perception and reaction, and Spirit for willpower and presence. Health should come from Brawn and Spirit — say four times Brawn plus twice Spirit."
- *(abilities)* "Abilities come in three flavours — boons, traits, and skills. Skills are the ones that improve, in tiers from Novice up to Master as you earn points. And don't let me get better at a skill I was never actually taught — I have to be granted it first."
- *(resolution)* "Checks are percentile roll-under: roll a d100 and get under your stat plus the relevant skill. 05 or lower is a critical success, 96 or higher is a fumble."
- *(gear)* "Inventory is weight-based — I can haul about 40 units. Give me a hidden stash for overflow gear. For worn equipment: a main hand, body armour, and a trinket slot."
- *(factions / reputation)* "Standing with factions runs 0 to 100, everyone starts a little cold around 30, and the tiers are Hated, Wary, Neutral, Trusted, Honored. There's one faction to begin with: The Ashen Pact, a secretive smuggler network run by a broker called Mother Quill — they're wary of me at first."
- *(survival)* "Two survival meters, hunger and fatigue — nudge me around 30 and it's critical by 10."
- *(creation + header + the rest)* "To make a character, let me spend points across the four stats, then pick one starting boon and one skill I'm trained in. For the on-screen status header, show my name, health and conditions on one line, then my coin and hunger percentage on the next. Use sensible defaults for anything else you need."
- *(Stage 16)* "Yep, that all matches what I want — go ahead and finalize it."

**Target the Architect should capture (acceptance reference — do NOT read this to it):**
- Content: mature, fade-to-black intimacy, no on-screen sexual content, non-gratuitous gore. Realism directives: all four ON; GM controls world only.
- Features: `capabilities, reputation, currency, needs, quests, equipment` (+ item_box), `party, scene`. NOT ranks/domains/world_events/companions. Progression: **levelless, no xp, no classes**.
- Attributes: `brawn/agility/wits/spirit` (with descriptions). Derived: `health = (brawn*4)+(spirit*2)` (no `level`).
- Capabilities: categories `boon, trait, skill`; `skill` → points-tiers (Novice…Master); **`require_granted: true`**.
- Resolution: d100 roll-under vs (attribute+skill); crit ≤05 / fumble ≥96.
- Inventory weight-based cap 40; **item_box on**; slots `main_hand, body, trinket`.
- Reputation 0–100, initial 30, tiers `Hated, Wary, Neutral, Trusted, Honored`. Faction: The Ashen Pact.
- Needs: hunger + fatigue, warn 30 / critical 10. Header: `{name} | {health}/{health_max} | {conditions}` / `Coin {currency} | Hunger {hunger_pct}%`.

## 4. Conventions

- **Test ID:** `AREA-NN` (`ARC-15`, `ARC-NEG-02`, `PCARD-03`, `E2E-BLK-02`).
- Part A **Action** = the **natural-language line you say** (use §3's conversational lines; paraphrase freely — never feed `key | label` rows or feature lists). **Expected** = what the Architect's *next* turn must do (it should extract the structured def from your prose). Judge against the expectation; a deviation is a finding.
- Parts B/C are checked against the **downloaded card JSON**, the **`[LOREBOOK_OUTPUT]` JSON**, and **observable extension state** (panel / lorebook entries / context).

---

## 5. Part A — Architect conversational tests (`ARC-*`)

| ID | Precondition | Action — say it naturally (§3 lines) | Expected (Architect's next turn) |
|----|----|----|----|
| ARC-00 | P1–P5 | (open chat) | **Stage 0 first**: asks PC-agency (recommends world-only), the **four GM realism directives** (offers to soften/drop/add), and hard/soft content limits + maturity. Does **not** jump to mechanics. |
| ARC-01 | ARC-00 answered | Content + directives + game feeling per brief | Confirms framing; moves to **Stage 1** (genre/mood, power scaling, world scope, magic/tech, solo/group). One stage only. |
| ARC-15 | ARC-01 | World per brief | **Stage 2 System Definition**: asks features allow-list, attributes (+ optional descriptions), **progression model (levels/xp/none)**, derived formulas, optional classes, and the per-feature settings (reputation/capabilities incl. **require_granted**/needs/item_conditions/loyalty). Once named, opens the card: emits `[CARD_BEGIN] name: <System> GM` and echoes the `[SYSTEM_DEF]` for confirmation. |
| ARC-16 | ARC-15 confirmed | Vocab/possessions/locations/commands per brief | **Stage 2a**: inventory model + **item_box**, equipment slots, optional location types/commands/vocabularies (folded into the def). |
| ARC-2 | ARC-16 | d100 roll-under per brief | **Stage 3**: captures the resolution mechanic, difficulty expression, crit/fumble → `resolution:` section; on confirm EMITS a `[Rule] Resolution` book entry. |
| ARC-3 | ARC-2 | accept | **Stage 4 / 4a / 4b**: attributes recap, the **player stat-block schema** (field types, mutability, groups), and the in-chat creation flow; EMITS the prose `first_mes` (intro + a trailing `[CHAR_CREATE_BEGIN]`). No pre-pasted sheet. |
| ARC-45 | ARC-3 | skills points-tiers per brief | **Stage 5 / 5a**: advancement triggers + **capability progression** (the `skill` category → a points-tiers profile); EMITS a `[Rule] Skills` entry. |
| ARC-5 | ARC-45 | a couple of NPCs; currency per brief | **Stage 6 / 9**: NPC/creature schema design (Stage 6); currency denominations + starting wealth (Stage 9 → `[Rule] Currency`). (Skips ranks/companions — not in features.) |
| ARC-6 | ARC-5 | accept; quests per brief | **Stage 7 / 11**: combat/conflict handling (Stage 7 → `[Rule] Combat`); quest categories/statuses (Stage 11 → `[Rule] Quests`). |
| ARC-65 | ARC-6 | header per brief | **Stage 8**: defines the `[HEADER_FORMAT]` (tokens only for fields this system has) and EMITS the keystone constant `[System Definition]` book entry (content = literal `[SYSTEM_DEF]` + `[HEADER_FORMAT]`) plus the `[Block Protocol]` entry. |
| ARC-675 | ARC-65 | The Ashen Pact; reputation per brief | **Stage 12**: faction lore + reputation scale/tiers → `[Rule] Reputation`. |
| ARC-7 | ARC-675 | accept | **Stage 15**: GM guidance / pacing / WORLD_TIME triggers → a `system_prompt` guidance section. (Skips 13/14 — world_events/domains off.) |
| ARC-8 | ARC-7 | accept | **Stage 16**: summarizes the **whole** system AND states which card pieces are already emitted vs still missing; asks for explicit confirmation. Does **not** finalize yet. |
| ARC-9 | ARC-8 | "Yep, that all matches — go ahead and build it." | **Stage 17 (finalize)**: the card was BUILT INCREMENTALLY across the prior stages — here it emits any still-missing required pieces, then `[CARD_FIELD key: post_history_instructions]`, then `[CARD_FINALIZE]`; the extension **assembles + downloads** the card (toast "Card … assembled & downloaded (N lore entries)"), `data.name == "<System> GM"`. Then a one-shot empty `[LOREBOOK_OUTPUT]`. |

## 6. Part A — guardrail negatives (`ARC-NEG-*`)

| ID | Check | Expected |
|----|----|----|
| ARC-NEG-01 | Before Stage 16 confirmation, ask "just finalize and give me the card now." | Declines to **finalize** early — it keeps building sections per stage but won't emit `[CARD_FINALIZE]`/download until the Stage 16 review is confirmed (may offer to skip ahead, clearly flagging what's unconfirmed). |
| ARC-NEG-02 | Scan the produced card + all Architect turns. | **No retired blocks**: `PLAYER_SHEET`, `NPC_BEGIN/UPDATE/ATTR_CHANGE/MEMORY`, `BESTIARY`, `COMPANION_UPDATE`, `BOON`, `TITLE`, `EVOLUTION`, `ABILITY`, `SKILL_SYSTEM`, `SKILL_UPDATE`. Only unified `[ENTITY]` / `[CAPABILITY]` (+`_UPDATE`). |
| ARC-NEG-03 | Emberhold is levelless/classless. | **No `level`, `xp`, or `class`** referenced anywhere (def, schema, formulas, header, rules). |
| ARC-NEG-04 | Disabled features (ranks, domains, world_events, companions). | Their blocks/sections appear **nowhere** in the produced card or its `post_history_instructions`. |
| ARC-NEG-05 | `character_book` of the produced card. | **≤ 15** rule entries (plus the constant protocol entry + `[Campaign Setup]`). |
| ARC-NEG-06 | `first_mes` of the produced card. | Leads in-chat creation; **never** asks the player to pre-paste a sheet. |
| ARC-NEG-07 | Realism directives. | Embedded in the produced card's `system_prompt` (a GM REALISM DIRECTIVES section) since Emberhold calls for them. |

---

## 7. Part B — produced GM card structural validation (`PCARD-*`)

The card is the one the extension **assembled and downloaded on `[CARD_FINALIZE]`** (chunked path) — open that `.json` and the `[LOREBOOK_OUTPUT]` JSON (copy from the chat). `JSON.parse` both first (PCARD-00). All assertions are on the assembled artifact, regardless of how many chunks built it.

| ID | Assertion |
|----|----|
| PCARD-00 | Card JSON and lorebook JSON both `JSON.parse` cleanly. |
| PCARD-01 | Card: `spec == "chara_card_v2"`, `spec_version == "2.0"`, **`data.name == "<System> GM"`** (e.g. `"Emberhold GM"`) — NOT `"The Architect"`, NOT blank (the naming gate enforces this), **`data.character_version` present**. |
| PCARD-02 | `data.system_prompt` contains, in substance: (1) system identity/tone; (2) **PLAYER AGENCY DIRECTIVE**; (3) **CONTENT RESTRICTIONS**; (3b) **GM REALISM DIRECTIVES**; (4) World Context; (5) system-definition rationale (+ note it emits `[SYSTEM_DEF]` at session start); (6) in-chat creation procedure; (7) the block protocol for **only the enabled features**; (8) guidance; (9) narrative style; (10) what-not-to-do. |
| PCARD-03 | `data.first_mes` is **in-world opening narration** (immersive scene-setting prose) that ends with a single `[CHAR_CREATE_BEGIN]` to start creation. It does **NOT** contain `[SYSTEM_DEF]` or `[HEADER_FORMAT]` (those live in the `[System Definition]` lore entry — see PCARD-03b) and does not ask for a pre-pasted sheet. |
| PCARD-03b | `data.character_book` has a **constant** `[System Definition]` entry whose **content** is the literal `[SYSTEM_DEF_BEGIN]…[SYSTEM_DEF_END]` block followed by a `[HEADER_FORMAT_BEGIN]…[HEADER_FORMAT_END]` block. (The extension hydrates the ruleset + header from this on load — see E2E-DEF.) Comment is exactly `[System Definition]`. |
| PCARD-04 | `data.character_book.entries`: the `[System Definition]` entry (PCARD-03b) + an id-0 **constant** protocol entry (lists this system's block types) + a `[Campaign Setup]` entry (agency + content) + 10–15 narrow keyword rule entries; total ≤ ~17. **No exact-duplicate entries** (same comment or same key-set — collapsed on assembly, richer copy kept), **no empty-content entries** (dropped on assembly), and **no thin one-line stubs**: each rule entry is substantial (~120–400 words: mechanic + concrete example + GM guidance). |
| PCARD-05 | `data.post_history_instructions`: a numbered checklist naming **only** the block types this system uses (no ranks/domains/world_events/companions; no level/xp). |
| PCARD-06 | `[LOREBOOK_OUTPUT]`: valid world-info JSON with an `entries` object that is **empty** (the extension fills it during play). |
| PCARD-07 | Grep the card for forbidden markers: no retired block names; no disabled-feature block names. For `level`/`xp`/`class` (Emberhold is levelless/classless) the ban is on **prose** references — narration, rules, or comparative framing such as "growth instead of levels/XP" or "starts at level 0". The **`[SYSTEM_DEF]` declaration lines are exempt and expected** (`progression: levels: false`, `xp: false`, `classes: enabled: false`), as is "level" used as a plain word for a skill *tier*. Note: a small model may still leak one comparative phrase — flag it as a model-quality slip, not a mechanism failure. |
| PCARD-08 | The `[SYSTEM_DEF]` inside the **`[System Definition]` lore entry** round-trips: features = the six chosen, `progression: levels:false xp:false`, the four attributes **with descriptions**, the single derived formula, `capabilities … require_granted: true`, `inventory … item_box: true`, the reputation tiers, needs thresholds. |

---

## 8. Part C — end-to-end: import & play the designed system (`E2E-*`)

Import the produced card (Characters → Import) and the produced lorebook (World Info → Import, name e.g. `emberhold-campaign`). In gm-lore-parser settings set **Campaign Lorebook = `emberhold-campaign`** and link it to the card + chat. Start a **new** chat.

| ID | Action | Expected |
|----|----|----|
| E2E-DEF | Start the chat (first_mes greeting auto-fires; it's narration + `[CHAR_CREATE_BEGIN]`). | The ruleset **hydrates from the card's `[System Definition]` entry on load** (no `[SYSTEM_DEF]` emission needed): `chatMetadata['gm-lore-parser'].system_def.name == "Emberhold"`; features match (levelless); `header_format` seeded from the entry's `[HEADER_FORMAT]`; a constant `[GM Directives]` entry appears. (The GM re-emitting `[SYSTEM_DEF]` later still works too.) |
| E2E-HDR | Continue one GM turn. | The narrative header renders from the designed `[HEADER_FORMAT]` (e.g. `Aria \| 24/24 \| …` + coin/hunger line); single render, no double `---`. |
| E2E-CC | Go through in-chat creation. | `[CHAR_CREATE_BEGIN] → STEP(s) → FINALIZE` builds the sheet; **all four attributes (Brawn/Agility/Wits/Spirit) show in the panel** with their hover descriptions; `health` derived computes from the formula; **no `level` field** anywhere. |
| E2E-BLK-01 | In play, take damage / change a condition. | An `[ENTITY_UPDATE]` updates `health`/conditions in the panel + context. |
| E2E-BLK-02 | Be granted a skill, then practice it; also try progressing an **un-granted** skill. | `[CAPABILITY] (skill)` grants it; `[CAPABILITY_UPDATE]` advances it on the points-tiers profile; progressing an un-granted skill is **rejected** (`require_granted: true`). |
| E2E-BLK-03 | Interact with The Ashen Pact. | `[FACTION]` + `[REPUTATION_UPDATE]` move standing on the **designed** 0–100 / Hated…Honored scale. |
| E2E-BLK-04 | Stash something in the cache; check carried load. | `[ITEM_BOX_UPDATE]` is **accepted** (box defined) and shows via `#itembox`/panel; weight-based load reflects capacity 40. |
| E2E-BLK-05 | Pick up a quest; gain/spend coin; party/scene change. | `[QUEST]`, `[CURRENCY_UPDATE]`, `[PARTY_UPDATE]`/`[SCENE_UPDATE]` all process per the designed def. |
| E2E-CONST | Inspect `emberhold-campaign`. | Constant entries are **exactly** `[System Definition]`, `[GM Directives]`, `[Scene]`, `[Party]` (+ any NPC core memory); skills/possessions surface as keyword-triggered `[Player:Skills]`/`[Player:Possessions]`; quests/factions via their own entries. |

---

## 9. Coverage matrix

- **Stages → ARC IDs** (ARC ids are stable labels; stage numbers are the new scheme): S0→ARC-00; S1→ARC-01; S2 System Definition→ARC-15; S2a→ARC-16; S3 Resolution→ARC-2; S4/4a/4b→ARC-3; S5/5a→ARC-45; S6 NPC + S9 Currency→ARC-5; S7 Combat + S11 Quests→ARC-6; S8 Header + [System Definition] entry→ARC-65; S12 Reputation→ARC-675; S15 Guidance→ARC-7; S16 Review→ARC-8; S17 Finalize→ARC-9.
- **Produced-card sections → PCARD IDs:** identity/agency/content/realism/world/rationale/creation/protocol/guidance/style/what-not → PCARD-02; first_mes (prose + CHAR_CREATE) → PCARD-03; [System Definition] lore entry → PCARD-03b; character_book → PCARD-04; post_history → PCARD-05; lorebook → PCARD-06; def round-trip → PCARD-08; forbidden markers → PCARD-07/NEG.
- **Designed blocks → E2E IDs:** SYSTEM_DEF→E2E-DEF; HEADER_FORMAT→E2E-HDR; CHAR_CREATE→E2E-CC; ENTITY_UPDATE→BLK-01; CAPABILITY/_UPDATE (+require_granted)→BLK-02; FACTION/REPUTATION_UPDATE→BLK-03; ITEM_BOX_UPDATE→BLK-04; QUEST/CURRENCY/PARTY/SCENE→BLK-05; always-on audit→E2E-CONST.

## 10. Pitfalls (read before running)

1. **The card is built INCREMENTALLY, not dumped at the end.** The Architect opens `[CARD_BEGIN]` at Stage 2 (which also NAMES the card) and emits one small section per confirmed stage (`[CARD_FIELD]`/`[CARD_BOOK_ENTRY]`); `[CARD_FINALIZE]` is last (Stage 17). The draft persists in `card_draft` across the whole chat (no reset/timeout), so a stall leaves the partial card intact — nudge the next section. This is much easier on small models than the old single-shot dump; keep the chat focused (long/poisoned history still hurts).
   - **Card name comes from `[CARD_BEGIN] name: <System> GM` at Stage 2.** If the model skips it, the card would import under the DESIGNER's name ("The Architect"). The extension now BLOCKS finalize on a missing/blank/designer name (deriving `<System> GM` from the `[System Definition]` entry when it can) — verify the downloaded card's `data.name` is `"<System> GM"` (PCARD-01).
   - **Literal tags, not headings.** Block tags must be verbatim square-bracket tags; a `## System Definition` markdown heading does NOT form the entry. The card stresses this; if an entry/def is missing, check the model wrote `[SYSTEM_DEF_BEGIN]` not `## …`.
   - **Emit, don't narrate.** If the model replies "I will now emit…" *without a real block* (no `card_draft` opens), **check P2.5 first** — an immersive/roleplay global **System Prompt** is the most common cause: it orders descriptive prose and overrides the card's emit-blocks instruction at *any* temperature, so the model narrates instead of emitting. Disabling it flips the behavior immediately (verified: with the "Roleplay - Immersive" system prompt OFF, gemma-4-e4b's first card-emission turn began `[CARD_BEGIN] name: … [CARD_FIELD_BEGIN]…`; with it ON, it narrated regardless of temp 0.4/0.8/1.0 or instruct on/off). Secondary causes: history poisoning (accumulated narration turns → start a fresh chat) and over-long directives. The output protocol is written as direct imperatives; a literal "copy this opening" nudge reliably breaks a stall once the system prompt is clear.
   - **Early finalize is blocked in code.** The extension **refuses** `[CARD_FINALIZE]` (warning toast, draft left open) until a real **name** + `system_prompt` + `first_mes` + `post_history_instructions` + ≥1 **non-empty** book entry exist (empty/duplicate entries are dropped *before* this check), so a broken or mis-named card can't be produced — nudge the model to emit the missing piece, then it finalizes. (The card's COMPLETENESS rule asks for the full set; the gate is the backstop.)
   - **`first_mes` is prose now, not blocks.** As of the lorebook-hosted-def redesign, `first_mes` should be in-world opening narration ending with a single `[CHAR_CREATE_BEGIN]`; the `[SYSTEM_DEF]` + `[HEADER_FORMAT]` live in the constant `[System Definition]` lore entry, which the extension hydrates on load. So a prose `first_mes` is now *correct*, not a failure. What to check instead: that the `[System Definition]` entry exists and its content holds the real `[SYSTEM_DEF]`/`[HEADER_FORMAT]` blocks (PCARD-03b). If the model dumps the ruleset into `first_mes` anyway, it's not fatal — the runtime emission path still loads it — but nudge it to use the lore entry so `first_mes` reads as an intro.
   - **Shallow / duplicated lore entries.** A chatty model can restate the protocol/agency/GM-directive entries as extra short entries and pad past ~15. Exact duplicates (same comment or key-set) are de-duped on assembly (richer copy kept; info toast), and entries `<120` chars are logged as shallow. The card directive asks for ~12–15 substantial entries (mechanic + example + GM guidance) emitted once; verify the assembled `character_book` isn't padded with thin restatements. Semantic near-duplicates with distinct comments aren't auto-removed — that's a model-quality check.
   - **One comparative `level`/`xp` slip is expected on small models.** See PCARD-07: the declaration lines are fine; a stray "instead of levels/XP" in prose is a known small-model residue, not a bug.
   - **`system_prompt` fragmentation on `continue` is auto-absorbed.** When continuing, a small model sometimes emits the prompt's sections as their own named fields (`[CARD_FIELD key: entity_protocol]`, `gm_directives`, …) instead of `key: system_prompt`/`append: true`. The extension folds any unrecognized field key into `system_prompt` as a `## Titled Section`, so the prompt still forms and finalize isn't blocked (verified). Prefer a clean single-turn emission (a higher output-token limit helps) to avoid relying on `continue` at all. Observed: with a raised token limit, gemma-4-e4b emitted `system_prompt` (~3.6k chars) + a real `first_mes` (~2.5k) + 13 substantial, non-duplicate entries (avg ~400 chars, 0 shallow) in one turn — the richness directive working as intended.
2. **Nothing downloads until `[CARD_FINALIZE]`** — fields/entries only buffer; the card assembles + downloads on finalize. If the model forgets to finalize, the card never appears. The one-shot `[CARD_OUTPUT]` still requires valid JSON (malformed → "Card JSON invalid", no file).
2b. **`[CARD_FIELD]`/`[CARD_BOOK_ENTRY]`/`[CARD_FINALIZE]` outside an active `[CARD_BEGIN]` are ignored** (console warn) — if the model skips `[CARD_BEGIN]`, nothing buffers.
3. **Blank the Campaign Lorebook while designing** (P4) so the Architect's example blocks don't write into a real campaign book.
4. **World-Info dropdown is stale** until you reopen the panel / reload — the produced/imported books exist server-side even if not yet listed.
5. **One model emit per turn** when verifying; don't chain.
6. **Re-import after edits.** If you change the Architect card file, re-import it (ST keeps the previously-imported copy).
7. **Judge Part A against intent**, not exact wording — the Architect is generative; the checkpoint is "did it ask/produce the right *thing* at this stage," not a string match.
