/**
 * gm-lore-parser / modules/telemetry.js
 * Per-chat token / cost instrumentation for GLP's own side-generations.
 *
 * GLP is primarily single-model: the narrator emits blocks inline in its normal
 * reply (that generation is SillyTavern's, not GLP's). But GLP makes its OWN model
 * calls for side-tasks — the optional 2nd-pass state extractor, memory enrichment /
 * autonomous-memory summaries, and card-assembly auto-retry. This module accumulates
 * the token cost of THOSE calls so the overhead of the extractor (the new dual-model
 * path) can be measured against a paid hosted model — the headline "is two-pass worth
 * it on a paid API?" question.
 *
 * Opt-in (settings.telemetryEnabled); recording is a no-op otherwise. Estimates are
 * char-based (~4 chars/token) unless a backend usage figure is supplied; each row
 * notes which method was used so estimates aren't mistaken for exact counts. Storage
 * is in-memory, keyed by chat, and resets on reload — measurement scaffolding, not
 * shipped state. Functions are global (GLP's shared-scope module pattern).
 */

// ── Token / cost telemetry ──────────────────────────────────────────────────────

var GLP_CHARS_PER_TOKEN = 4;
var _glpTelemetryStore = {};

/** Rough char-based token estimate (~4 chars/token). */
function glpEstimateTokens(text) {
    if (typeof text !== 'string' || !text) return 0;
    return Math.ceil(text.length / GLP_CHARS_PER_TOKEN);
}

function _glpTeleChatId(chatId) {
    if (chatId) return chatId;
    try { return SillyTavern.getContext().chatId || '_'; } catch (_) { return '_'; }
}

function _glpTeleBucket(chatId) {
    const key = _glpTeleChatId(chatId);
    if (!_glpTelemetryStore[key]) _glpTelemetryStore[key] = { passes: [], totals: { in: 0, out: 0, calls: 0 } };
    return _glpTelemetryStore[key];
}

/**
 * Record one side-generation's token cost. No-op unless settings.telemetryEnabled.
 * @param {object} p
 * @param {string} [p.chatId]     - defaults to the active chat
 * @param {string} [p.kind]       - 'extractor' | 'memory' | 'card-retry' | …
 * @param {string} [p.promptText] - assembled prompt (used when inTokens absent)
 * @param {string} [p.outputText] - model output (used when outTokens absent)
 * @param {number} [p.inTokens]   - backend-reported prompt tokens, if available
 * @param {number} [p.outTokens]  - backend-reported completion tokens, if available
 * @returns {object|null} the recorded row, or null when telemetry is off
 */
function glpRecordPass(p) {
    p = p || {};
    try { if (!getSettings().telemetryEnabled) return null; } catch (_) { return null; }
    const inT  = Number.isFinite(p.inTokens)  ? p.inTokens  : glpEstimateTokens(p.promptText || '');
    const outT = Number.isFinite(p.outTokens) ? p.outTokens : glpEstimateTokens(p.outputText || '');
    const method = (Number.isFinite(p.inTokens) || Number.isFinite(p.outTokens)) ? 'backend' : 'estimate';
    const b = _glpTeleBucket(p.chatId);
    const row = { kind: p.kind || 'extractor', in: inT, out: outT, method };
    b.passes.push(row);
    b.totals.in += inT;
    b.totals.out += outT;
    b.totals.calls += 1;
    return row;
}

/** Accumulated telemetry for a chat (defaults to the active chat). */
function glpGetTelemetry(chatId) {
    return _glpTelemetryStore[_glpTeleChatId(chatId)] || { passes: [], totals: { in: 0, out: 0, calls: 0 } };
}

/** Clear telemetry (one chat, or all when chatId omitted). */
function glpResetTelemetry(chatId) {
    if (chatId) delete _glpTelemetryStore[chatId];
    else for (const k of Object.keys(_glpTelemetryStore)) delete _glpTelemetryStore[k];
}

/**
 * Project a paid-API cost from accumulated tokens at reference $/1M-token prices
 * (defaults ≈ a cheap flash-tier extractor model). Purely indicative.
 */
function glpProjectCost(chatId, inPricePerM, outPricePerM) {
    if (inPricePerM == null) inPricePerM = 0.15;
    if (outPricePerM == null) outPricePerM = 0.60;
    const t = glpGetTelemetry(chatId).totals;
    const cost = (t.in / 1e6) * inPricePerM + (t.out / 1e6) * outPricePerM;
    return {
        calls: t.calls,
        inTokens: t.in,
        outTokens: t.out,
        estCostUSD: +cost.toFixed(4),
        perCallUSD: t.calls ? +(cost / t.calls).toFixed(5) : 0,
    };
}

/** One-line human summary for the settings readout. */
function glpTelemetrySummary(chatId) {
    const tele = glpGetTelemetry(chatId);
    const t = tele.totals;
    if (!t.calls) return 'No side-generations recorded yet.';
    const byKind = {};
    for (const p of tele.passes) byKind[p.kind] = (byKind[p.kind] || 0) + 1;
    const kinds = Object.keys(byKind).map(k => `${k}:${byKind[k]}`).join(', ');
    const c = glpProjectCost(chatId);
    return `${t.calls} side-call${t.calls === 1 ? '' : 's'} (${kinds}) · in ${t.in} / out ${t.out} tok · ~$${c.estCostUSD} (~$${c.perCallUSD}/call)`;
}
