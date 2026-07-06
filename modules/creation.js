/**
 * gm-lore-parser / modules/creation.js
 * Interactive character creation session.
 *
 * Three-block flow:
 *   [CHAR_CREATE_BEGIN] — GM defines schema + character identity
 *   [CHAR_CREATE_STEP_BEGIN] — one or more steps (race, attributes, skills, boons, gear, …)
 *   [CHAR_CREATE_FINALIZE_BEGIN] — seals the session, computes derived stats, applies state
 *
 * The extension shows a step-checklist panel while creation is active.
 * Existing block types (CAPABILITY, CAPABILITY_UPDATE, CURRENCY_UPDATE) fire normally
 * during the session and contribute to the final character.
 *
 * Character identity fields (name, class_, background) can be set in CHAR_CREATE_BEGIN
 * or deferred to any CHAR_CREATE_STEP.
 */

// ── Session open ──────────────────────────────────────────────────────────────

function applyCharCreateBegin(raw) {
    const state  = getCharState();
    const fields = parseFields(raw);

    // Store the schema block verbatim for applyPlayerSheet to consume
    state.char_creation.active           = true;
    state.char_creation.steps_completed  = [];
    state.char_creation.draft            = {};

    // Apply the schema now (same parser as PLAYER_SHEET)
    applyPlayerSheet(raw);

    // Capture identity fields into draft so context injection can reference them
    if (fields.name)       state.char_creation.draft.name       = fields.name;
    if (fields.class)      state.char_creation.draft.class_     = fields.class;
    if (fields.background) state.char_creation.draft.background = fields.background;

    console.log(`[${MODULE_NAME}] Character creation session opened.`);
    return true;
}

// ── Step processing ───────────────────────────────────────────────────────────

async function applyCharCreateStep(raw, settings) {
    const state  = getCharState();
    const fields = parseFields(raw);
    if (!state.char_creation.active) {
        console.warn(`[${MODULE_NAME}] CHAR_CREATE_STEP received outside of creation session — ignoring.`);
        return false;
    }

    const step = (fields.step || 'step').toLowerCase();

    // Merge all non-meta fields into the draft
    const skipKeys = new Set(['step']);
    for (const [k, v] of Object.entries(fields)) {
        if (skipKeys.has(k)) continue;
        state.char_creation.draft[k] = v;
    }

    // Race passives become passive capabilities (one unified concept).
    if (fields.race_passives) {
        for (const p of fields.race_passives.split(/[,;]/).map(s => s.trim()).filter(Boolean))
            await processCapabilityBlock({ name: p, category: 'passive', description: `Racial passive (${state.char_creation.draft.race || 'race'})` }, settings);
    }

    // Handle step-specific side effects
    if (step === 'gear' || step === 'starting_gear') {
        // Emit any currency fields as a CURRENCY_UPDATE so applyCurrencyUpdate can handle them
        const denomFields = Object.entries(fields).filter(([k]) => !skipKeys.has(k) && k !== 'inventory');
        if (denomFields.length) {
            const pseudoRaw = denomFields.map(([k, v]) => `${k}: ${v}`).join('\n');
            applyCurrencyUpdate(pseudoRaw);
        }
        if (fields.inventory) {
            const items = fields.inventory.split(';').map(s => s.trim()).filter(Boolean);
            const s2 = getCharState();
            const existing = Array.isArray(s2.values.inventory) ? s2.values.inventory : [];
            s2.values.inventory = [...existing, ...items];
        }
    }

    if (!state.char_creation.steps_completed.includes(step))
        state.char_creation.steps_completed.push(step);

    console.log(`[${MODULE_NAME}] Creation step "${step}" recorded.`);
    return true;
}

// ── Finalize ──────────────────────────────────────────────────────────────────
// Merges the draft into live state, computes derived stats where formulas are known,
// and closes the creation session.

function applyCharCreateFinalize(raw) {
    const state  = getCharState();
    const fields = parseFields(raw);
    if (!state.char_creation.active) {
        console.warn(`[${MODULE_NAME}] CHAR_CREATE_FINALIZE received outside of creation session — ignoring.`);
        return false;
    }

    const draft = state.char_creation.draft;
    const schema = state.schema?.fields || {};

    // Apply any remaining identity fields from the draft
    if (draft.name)       state.name       = draft.name;
    if (draft.class_)     state.class_     = draft.class_;
    if (draft.background) state.background = draft.background;

    // Merge numeric draft fields into state.values
    for (const [k, v] of Object.entries(draft)) {
        if (['name', 'class_', 'background'].includes(k)) continue;
        const num = parseFloat(v);
        if (!isNaN(num)) {
            // If it looks like an attribute modifier (+N / -N), apply as delta
            if (typeof v === 'string' && (v.startsWith('+') || v.startsWith('-'))) {
                state.values[k] = (state.values[k] || 0) + num;
            } else {
                state.values[k] = num;
            }
        } else if (typeof v === 'string') {
            state.values[k] = v;
        }
    }

    // Apply any finalize-specific fields (level, xp, etc.)
    for (const [k, v] of Object.entries(fields)) {
        const num = parseFloat(v);
        if (!isNaN(num)) state.values[k] = num;
        else state.values[k] = v;
    }

    // Compute derived stats for known formula fields if they haven't been set
    _computeDerivedStats(state);

    // Fold in every System-Definition attribute the character ended up with and
    // correct any grouping the char_create schema block left unset (HP → vitals,
    // attributes → attributes) so the finalized sheet renders correctly without a
    // page refresh.
    augmentSchemaWithDefAttributes(state.schema, state.values);

    // Mark session closed
    state.char_creation.active = false;
    console.log(`[${MODULE_NAME}] Character creation finalised: ${state.name || '(unnamed)'}.`);
    return true;
}

function _computeDerivedStats(state) {
    // Delegates to the shared entity core, which reads the active system
    // definition's attributes + derived-stat formulas.
    entityComputeDerived(state.values, state.schema);
}

// ── Context string ────────────────────────────────────────────────────────────

function buildCreationContextString(charCreation) {
    if (!charCreation.active) return '';
    const draft = charCreation.draft;
    const lines = ['[Character Creation — In Progress]'];
    if (draft.name)       lines.push(`  Name: ${draft.name}`);
    if (draft.class_)     lines.push(`  Class: ${draft.class_}`);
    if (draft.background) lines.push(`  Background: ${draft.background}`);
    if (charCreation.steps_completed.length)
        lines.push(`  Steps done: ${charCreation.steps_completed.join(', ')}`);
    // Show non-identity draft fields
    const skip = new Set(['name', 'class_', 'background']);
    for (const [k, v] of Object.entries(draft)) {
        if (skip.has(k)) continue;
        lines.push(`  ${k}: ${v}`);
    }
    return lines.join('\n');
}

// ── Panel HTML ────────────────────────────────────────────────────────────────

function buildCreationPanelHTML(charCreation) {
    if (!charCreation.active) return null; // null = show normal char panel

    const done = new Set(charCreation.steps_completed);
    const name = charCreation.draft.name || 'New Character';

    const stepRows = charCreation.steps_completed.length
        ? charCreation.steps_completed.map(s =>
            `<div class="glp-create-step glp-create-done">✓ ${s}</div>`).join('')
        : '<div class="glp-create-step glp-create-pending">Awaiting first step…</div>';

    return `<div class="glp-creation-panel">
        <div class="glp-creation-title">Creating: <b>${name}</b></div>
        <div class="glp-creation-steps">${stepRows}</div>
        <div class="glp-creation-hint">Character sheet will be finalized when the GM emits [CHAR_CREATE_FINALIZE_BEGIN].</div>
    </div>`;
}
