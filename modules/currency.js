/**
 * gm-lore-parser / modules/currency.js
 * Pure wealth tracking. Any denomination name is supported; values are deltas or
 * absolutes and clamp at 0.
 *
 *   [CURRENCY_UPDATE_BEGIN] … [CURRENCY_UPDATE_END]   gold: +10 / silver: -5
 *
 * Ranks/XP now live in modules/progression.js; companions in modules/entity.js.
 */

// ── Currency ──────────────────────────────────────────────────────────────────

function applyCurrencyUpdate(raw) {
    const fields = parseFields(raw);
    const state  = getCharState();

    for (const [denom, rawVal] of Object.entries(fields)) {
        const str = String(rawVal).trim();
        const isDelta = str.startsWith('+') || str.startsWith('-');
        const num = parseFloat(str.replace(/[^0-9.\-+]/g, ''));
        if (isNaN(num)) continue;

        if (!(denom in state.currency)) state.currency[denom] = 0;
        state.currency[denom] = isDelta
            ? state.currency[denom] + num
            : num;
        state.currency[denom] = Math.max(0, state.currency[denom]);
    }
    console.log(`[${MODULE_NAME}] Currency updated:`, JSON.stringify(state.currency));
    return true;
}

// ── Context string ────────────────────────────────────────────────────────────

function buildCurrencyContextString(currency) {
    if (!Object.keys(currency).length) return '';
    const coins = Object.entries(currency)
        .filter(([, v]) => v > 0)
        .map(([d, v]) => `${v} ${d}`)
        .join(', ');
    return coins ? `[Currency] ${coins}` : '';
}

// ── Panel HTML ────────────────────────────────────────────────────────────────

function buildCurrencyPanel(currency) {
    const denomEntries = Object.entries(currency || {});
    if (!denomEntries.length) return '';
    const rows = denomEntries.map(([d, v]) =>
        `<div class="glp-currency-row"><span class="glp-currency-denom">${d}</span><span class="glp-currency-val">${v}</span></div>`
    ).join('');
    return `<div class="glp-section"><div class="glp-section-title">Currency</div>${rows}</div>`;
}

// ── Command ───────────────────────────────────────────────────────────────────

function cmdCurrency(state) {
    const c = state.currency || {};
    if (!Object.keys(c).length) return '[Currency]\nNo currency recorded.';
    return '[Currency]\n' + Object.entries(c).map(([d, v]) => `  ${d}: ${v}`).join('\n');
}
