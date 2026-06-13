/**
 * gm-lore-parser / modules/needs.js
 * Life Simulation — Needs meters (hunger, thirst, rest, warmth, etc.).
 *
 * Block types (SHEET_BLOCKS):
 *   [NEEDS_SYSTEM_BEGIN] — define what meters exist (run once at session start)
 *   [NEEDS_UPDATE_BEGIN] — change meter values (delta or absolute)
 *
 * Context injection fires only when a need is at or below its warn_threshold.
 */

// ── System configuration ───────────────────────────────────────────────────────

function applyNeedsSystem(raw) {
    const state  = getCharState();
    const fields = parseFields(raw);

    for (const [key, value] of Object.entries(fields)) {
        // warn / critical threshold fields — wire to existing meter
        const warnMatch = key.match(/^(.+)_warn$/);
        if (warnMatch) {
            const meterKey = warnMatch[1];
            if (state.needs[meterKey]) state.needs[meterKey].warn_threshold = parseFloat(value) || 0;
            continue;
        }
        const critMatch = key.match(/^(.+)_critical$/);
        if (critMatch) {
            const meterKey = critMatch[1];
            if (state.needs[meterKey]) state.needs[meterKey].critical_threshold = parseFloat(value) || 0;
            continue;
        }

        // Base meter definition — value is the max
        const maxVal = parseFloat(value);
        if (isNaN(maxVal)) continue;
        if (!state.needs[key]) {
            const nd = getSystemDef().needs || {};
            state.needs[key] = {
                value:              maxVal,
                max:                maxVal,
                label:              _labelFor(key),
                warn_threshold:     nd.warn_threshold     ?? 30,
                critical_threshold: nd.critical_threshold ?? 10,
            };
        } else {
            // Reconfigure max without resetting current value
            state.needs[key].max   = maxVal;
            state.needs[key].label = _labelFor(key);
        }
    }

    console.log(`[${MODULE_NAME}] Needs system configured: ${Object.keys(state.needs).join(', ')}`);
    return true;
}

function _labelFor(key) {
    return key.charAt(0).toUpperCase() + key.slice(1);
}

// ── Needs update ──────────────────────────────────────────────────────────────

function applyNeedsUpdate(raw) {
    const state  = getCharState();
    const fields = parseFields(raw);
    let changed  = false;

    for (const [key, rawVal] of Object.entries(fields)) {
        if (!state.needs[key]) continue;
        const meter = state.needs[key];
        const val   = parseFloat(rawVal);
        if (isNaN(val)) continue;

        // Delta syntax (+N / -N) vs absolute
        if (typeof rawVal === 'string' && (rawVal.trim().startsWith('+') || rawVal.trim().startsWith('-'))) {
            meter.value = Math.max(0, Math.min(meter.max, meter.value + val));
        } else {
            meter.value = Math.max(0, Math.min(meter.max, val));
        }
        changed = true;
    }

    if (changed) console.log(`[${MODULE_NAME}] Needs updated.`);
    return changed;
}

// ── Context injection ─────────────────────────────────────────────────────────
// Only injects when at least one need is below its warn_threshold.

function buildNeedsContextString(needs) {
    const warned = Object.entries(needs).filter(([, m]) => m.value <= m.warn_threshold);
    if (!warned.length) return '';
    const lines = ['[Needs — Attention Required]'];
    for (const [key, m] of warned) {
        const pct = Math.round((m.value / m.max) * 100);
        const level = m.value <= m.critical_threshold ? 'CRITICAL' : 'LOW';
        lines.push(`  ${m.label}: ${m.value}/${m.max} (${pct}%) [${level}]`);
    }
    return lines.join('\n');
}

// ── Panel HTML ────────────────────────────────────────────────────────────────

function buildNeedsPanel(needs, settings) {
    if (!settings.showNeedsPanel) return '';
    const entries = Object.entries(needs);
    if (!entries.length) return '';

    const bars = entries.map(([key, m]) => {
        const pct     = Math.min(100, Math.max(0, Math.round((m.value / m.max) * 100)));
        const isCrit  = m.value <= m.critical_threshold;
        const isWarn  = m.value <= m.warn_threshold;
        const cls     = isCrit ? 'glp-need-crit' : isWarn ? 'glp-need-warn' : 'glp-need-ok';
        return `<div class="glp-need-row">
            <span class="glp-need-label">${m.label}</span>
            <div class="glp-need-bar-bg">
                <div class="glp-need-bar-fill ${cls}" style="width:${pct}%"></div>
            </div>
            <span class="glp-need-val">${m.value}/${m.max}</span>
        </div>`;
    }).join('');

    return `<div class="glp-panel-section glp-needs-section">
        <b>Needs</b>
        ${bars}
    </div>`;
}

// ── Command ───────────────────────────────────────────────────────────────────

function cmdNeeds(state) {
    const entries = Object.entries(state.needs || {});
    if (!entries.length) return 'No needs system configured.';
    return entries.map(([, m]) => {
        const pct    = Math.round((m.value / m.max) * 100);
        const isCrit = m.value <= m.critical_threshold;
        const isWarn = m.value <= m.warn_threshold;
        const tag    = isCrit ? ' ⚠ CRITICAL' : isWarn ? ' ⚠ LOW' : '';
        const bar    = _asciiBar(pct, 20);
        return `${m.label.padEnd(12)} [${bar}] ${m.value}/${m.max}${tag}`;
    }).join('\n');
}

function _asciiBar(pct, width) {
    const filled = Math.round((pct / 100) * width);
    return '█'.repeat(filled) + '░'.repeat(width - filled);
}
