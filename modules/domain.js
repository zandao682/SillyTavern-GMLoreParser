/**
 * gm-lore-parser / modules/domain.js
 * Domain / settlement sub-game system.
 * Handles DOMAIN_UPDATE blocks and context building.
 */

/** Apply a DOMAIN_UPDATE block to character state. Returns the domain name. */
function applyDomainUpdate(raw) {
    const fields     = parseFields(raw);
    const state      = getCharState();
    const domainName = fields.domain || fields.name || 'Domain';
    delete fields.domain;
    delete fields.name;

    if (!state.domains[domainName])
        state.domains[domainName] = { stats: {}, last_turn: '' };

    const domain = state.domains[domainName];
    for (const [key, val] of Object.entries(fields)) {
        if (key === 'last_turn') { domain.last_turn = val; continue; }
        const num = parseFloat(val);
        domain.stats[key] = isNaN(num) ? val : num;
    }

    console.log(`[${MODULE_NAME}] Domain updated: ${domainName}`);
    return domainName;
}

/** Build a plain-text summary of all domains for context injection. */
function buildDomainContextString(domains) {
    if (!domains || !Object.keys(domains).length) return '';
    const lines = [];
    for (const [name, domain] of Object.entries(domains)) {
        lines.push(`[Domain: ${name}]`);
        for (const [k, v] of Object.entries(domain.stats))
            lines.push(`  ${k.replace(/_/g, ' ')}: ${v}`);
        if (domain.last_turn) lines.push(`  Last Turn: ${domain.last_turn}`);
    }
    return lines.join('\n');
}
