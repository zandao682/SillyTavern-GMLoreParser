/**
 * GM Lore Parser — SillyTavern Extension  v0.0.12 (beta)
 *
 * Entry point only. All logic lives in modules/. Load order matters:
 * state → utils → lorebook → system → schema → entity → progression →
 *   inventory → capabilities → domain → lore → sheet → creation →
 *   quests → reputation → events → currency → needs →
 *   commands → panel → context
 *
 * To add a new block type:
 *   1. Add its begin/end strings to UPDATE_BLOCKS or SHEET_BLOCKS in modules/state.js
 *   2. Write a handler function in a new or existing module file
 *   3. Register it in the appropriate handler loop below (onMessageReceived)
 *   4. Add a stripAllBlocks entry (automatic via the registry arrays in state.js)
 */

// SillyTavern loads this entry as an ES module (<script type="module">), so its
// top-level declarations are NOT global. The classic module scripts injected by
// glpLoadModules (state.js, …) read MODULE_NAME / VERSION as globals, so expose
// them on window. (MODULE_NAME is also the settings/chatMetadata key.)
var MODULE_NAME = window.MODULE_NAME = 'gm-lore-parser';
var VERSION     = window.VERSION     = '0.0.12';

// Resolve our own install folder from this module's own URL so module loading
// works regardless of the third-party folder name (a GitHub clone is typically
// "SillyTavern-GMLoreParser", not "gm-lore-parser"). Falls back to the
// MODULE_NAME path if import.meta is unavailable.
var GLP_MODULES_BASE = (function () {
    try {
        if (import.meta && import.meta.url)
            return import.meta.url.replace(/index\.js(?:\?.*)?$/, 'modules/');
    } catch (e) { /* fall through */ }
    return `/scripts/extensions/third-party/${MODULE_NAME}/modules/`;
})();

// ── Module loader ─────────────────────────────────────────────────────────────

var GLP_MODULE_LOAD_ORDER = [
    'state',      // constants, block registries, settings/state accessors
    'utils',      // pure utilities, parseFields, extractBlocks, parseSchema
    'lorebook',   // lorebook CRUD helpers
    'system',     // system definition (ruleset) — getSystemDef, evalFormula
    'schema',     // schema engine (applyFieldValue, regen, promotions)
    'entity',     // unified entity core + all type rules (player/npc/companion/creature)
    'scene',      // party & scene rosters (always-on constant entries)
    'progression',// rank ladders + XP awards
    'inventory',  // equipment slots, inventory model, item box
    'capabilities',// unified capabilities (static + progressing; def-driven progression)
    'domain',     // domain sub-game
    'lore',       // npc storage internals, item, location, generic lore handlers
    'sheet',      // player sheet + world time
    'creation',   // interactive character creation session
    'quests',     // quest tracker
    'reputation', // faction reputation
    'events',     // world events + plot lorebook
    'currency',   // pure wealth tracking
    'needs',      // life simulation needs meters
    'header',     // narrative status header (merged from gm-narrative-header)
    'commands',   // # command interceptor
    'panel',      // status panel rendering
    'context',    // context injection
];

async function glpLoadModules() {
    const base = GLP_MODULES_BASE;
    for (const name of GLP_MODULE_LOAD_ORDER) {
        await new Promise((resolve) => {
            const s = document.createElement('script');
            s.src = `${base}${name}.js?v=${VERSION}`;
            s.onload = resolve;
            s.onerror = () => {
                console.error(`[${MODULE_NAME}] Failed to load module: ${name}.js`);
                resolve(); // non-fatal — keep loading remaining modules
            };
            document.head.appendChild(s);
        });
    }
}

// ── CARD_OUTPUT handler ───────────────────────────────────────────────────────

function handleCardOutput(raw) {
    try {
        const parsed = JSON.parse(raw);
        const name   = parsed?.data?.name || 'generated-gm-card';
        const url    = URL.createObjectURL(new Blob([JSON.stringify(parsed, null, 2)], { type: 'application/json' }));
        const a      = Object.assign(document.createElement('a'), {
            href: url, download: `${name.toLowerCase().replace(/\s+/g, '-')}.json`,
        });
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        URL.revokeObjectURL(url);
        SillyTavern.getContext().toastr?.success(`Card "${name}" downloaded`, 'GM Lore Parser', { timeOut: 4000 });
        return true;
    } catch (e) {
        console.error(`[${MODULE_NAME}] CARD_OUTPUT parse error:`, e);
        SillyTavern.getContext().toastr?.error('Card JSON invalid', 'GM Lore Parser');
        return false;
    }
}

// ── Message handlers ──────────────────────────────────────────────────────────

async function onMessageReceived(messageId) {
    const settings = getSettings();
    if (!settings.enabled) return;
    await loadSystemDefFromLorebook(settings);   // hydrate ruleset cache (idempotent)
    const { chat, toastr } = SillyTavern.getContext();
    const message = chat[messageId]; if (!message) return;
    if (message.is_user && !settings.scanUserMessages) {
        await handlePlayerSheetBlocks(message, messageId, settings);
        return;
    }

    const text = message.mes;
    let sheetChanged = false;
    const notifications = [];

    // ── Narrative header: capture a [HEADER_FORMAT] block (rendered at the end) ──
    if (captureHeaderFormat(messageId)) sheetChanged = true;

    // ── System definition (must apply before any consumer this message) ────────
    for (const b of extractBlocks(text, SHEET_BLOCKS.SYSTEM_DEF.begin, SHEET_BLOCKS.SYSTEM_DEF.end)) {
        await saveSystemDef(parseSystemDef(b.raw), settings);
        sheetChanged = true;
    }

    // ── Entity blocks (player / npc / companion / creature) ────────────────────
    let loreSaved = 0;
    for (const b of extractBlocks(text, SHEET_BLOCKS.ENTITY.begin, SHEET_BLOCKS.ENTITY.end)) {
        const type = entityType(b.raw);
        const ok = await onEntityBegin(b.raw, settings);
        if (!ok) continue;
        if (type === 'player') sheetChanged = true; else loreSaved++;
    }

    for (const b of extractBlocks(text, SHEET_BLOCKS.ENTITY_UPDATE.begin, SHEET_BLOCKS.ENTITY_UPDATE.end)) {
        const type = entityType(b.raw);
        const r = await onEntityUpdate(b.raw, settings);
        if (!r) continue;
        if (type === 'player' || type === 'companion') {
            sheetChanged = true;
            const p = checkPromotions(getCharState().schema?.fields || {}, getCharState().values);
            for (const x of p) notifications.push({ type: 'promotion', msg: x.reason });
        } else {
            loreSaved++;
            if (r.promotions?.length)
                for (const p of r.promotions)
                    notifications.push({ type: 'npc_promotion', msg: `${parseFlatFields(b.raw).name}: ${p.reason}` });
        }
    }

    for (const b of extractBlocks(text, SHEET_BLOCKS.ENTITY_EVENT.begin, SHEET_BLOCKS.ENTITY_EVENT.end)) {
        const type = entityType(b.raw);
        const r = await onEntityEvent(b.raw, settings);
        if (!r || !r.changes?.length) continue;
        if (type === 'player' || type === 'companion') {
            sheetChanged = true;
            notifications.push({ type: 'attr_change', msg: `${r.reason}: ${r.changes.map(c => `${c.key}:${c.oldVal}→${c.newVal}`).join(', ')}` });
        } else {
            loreSaved++;
            notifications.push({ type: 'npc_attr_change', msg: `${parseFlatFields(b.raw).name} — ${r.reason}` });
        }
    }

    for (const b of extractBlocks(text, SHEET_BLOCKS.ENTITY_MEMORY.begin, SHEET_BLOCKS.ENTITY_MEMORY.end))
        if (await onEntityMemory(b.raw, settings)) loreSaved++;

    if (featureOn('capabilities')) {
    for (const b of extractBlocks(text, SHEET_BLOCKS.CAPABILITY.begin, SHEET_BLOCKS.CAPABILITY.end))
        { if (await processCapabilityBlock(parseFields(b.raw), settings)) sheetChanged = true; }

    for (const b of extractBlocks(text, SHEET_BLOCKS.CAPABILITY_UPDATE.begin, SHEET_BLOCKS.CAPABILITY_UPDATE.end)) {
        const n = applyCapabilityUpdate(b.raw);
        if (n.length) { sheetChanged = true; for (const x of n) notifications.push({ type: x.type, msg: x.msg }); }
    }
    }

    if (featureOn('party'))
    for (const b of extractBlocks(text, SHEET_BLOCKS.PARTY_UPDATE.begin, SHEET_BLOCKS.PARTY_UPDATE.end))
        { if (await applyPartyUpdate(b.raw, settings)) sheetChanged = true; }

    if (featureOn('scene'))
    for (const b of extractBlocks(text, SHEET_BLOCKS.SCENE_UPDATE.begin, SHEET_BLOCKS.SCENE_UPDATE.end))
        { if (await applySceneUpdate(b.raw, settings)) sheetChanged = true; }

    if (featureOn('domains'))
    for (const b of extractBlocks(text, SHEET_BLOCKS.DOMAIN_UPDATE.begin, SHEET_BLOCKS.DOMAIN_UPDATE.end))
        { applyDomainUpdate(b.raw); sheetChanged = true; }

    if (featureOn('reputation'))
    for (const b of extractBlocks(text, SHEET_BLOCKS.REPUTATION_UPDATE.begin, SHEET_BLOCKS.REPUTATION_UPDATE.end))
        { if (await applyReputationUpdate(b.raw, settings)) sheetChanged = true; }

    if (featureOn('world_events')) {
    for (const b of extractBlocks(text, SHEET_BLOCKS.WORLD_EVENT.begin, SHEET_BLOCKS.WORLD_EVENT.end))
        { if (await applyWorldEventBlock(b.raw, settings)) sheetChanged = true; }

    for (const b of extractBlocks(text, SHEET_BLOCKS.PLOT_ENTRY.begin, SHEET_BLOCKS.PLOT_ENTRY.end))
        { await processPlotEntry(b.raw, settings); }
    }

    if (featureOn('currency'))
    for (const b of extractBlocks(text, SHEET_BLOCKS.CURRENCY_UPDATE.begin, SHEET_BLOCKS.CURRENCY_UPDATE.end))
        { if (applyCurrencyUpdate(b.raw)) sheetChanged = true; }

    if (featureOn('ranks'))
    for (const b of extractBlocks(text, SHEET_BLOCKS.RANK_CHANGE.begin, SHEET_BLOCKS.RANK_CHANGE.end))
        { if (applyRankChange(b.raw)) sheetChanged = true; }

    for (const b of extractBlocks(text, SHEET_BLOCKS.XP_AWARD.begin, SHEET_BLOCKS.XP_AWARD.end))
        { if (applyXpAward(b.raw)) sheetChanged = true; }

    for (const b of extractBlocks(text, SHEET_BLOCKS.WORLD_TIME.begin, SHEET_BLOCKS.WORLD_TIME.end)) {
        const r = await applyWorldTime(b.raw, settings);
        if (r.playerRegenChanged || r.playerPromotions.length) sheetChanged = true;
        for (const p of r.playerPromotions) notifications.push({ type: 'promotion',     msg: p.reason });
        for (const p of r.npcPromotions)    notifications.push({ type: 'npc_promotion', msg: `${p.npc}: ${p.reason}` });
    }

    for (const b of extractBlocks(text, SHEET_BLOCKS.CARD_OUTPUT.begin, SHEET_BLOCKS.CARD_OUTPUT.end))
        handleCardOutput(b.raw);

    // ── Character creation blocks ──────────────────────────────────────────────
    for (const b of extractBlocks(text, SHEET_BLOCKS.CHAR_CREATE_BEGIN.begin, SHEET_BLOCKS.CHAR_CREATE_BEGIN.end))
        { applyCharCreateBegin(b.raw); sheetChanged = true; }

    for (const b of extractBlocks(text, SHEET_BLOCKS.CHAR_CREATE_STEP.begin, SHEET_BLOCKS.CHAR_CREATE_STEP.end))
        { if (await applyCharCreateStep(b.raw, settings)) sheetChanged = true; }

    for (const b of extractBlocks(text, SHEET_BLOCKS.CHAR_CREATE_FINALIZE.begin, SHEET_BLOCKS.CHAR_CREATE_FINALIZE.end))
        { applyCharCreateFinalize(b.raw); sheetChanged = true; }

    // ── Needs blocks ───────────────────────────────────────────────────────────
    if (featureOn('needs')) {
    for (const b of extractBlocks(text, SHEET_BLOCKS.NEEDS_SYSTEM.begin, SHEET_BLOCKS.NEEDS_SYSTEM.end))
        { applyNeedsSystem(b.raw); sheetChanged = true; }

    for (const b of extractBlocks(text, SHEET_BLOCKS.NEEDS_UPDATE.begin, SHEET_BLOCKS.NEEDS_UPDATE.end))
        { if (applyNeedsUpdate(b.raw)) sheetChanged = true; }
    }

    for (const b of extractBlocks(text, SHEET_BLOCKS.ITEM_BOX_UPDATE.begin, SHEET_BLOCKS.ITEM_BOX_UPDATE.end))
        { if (applyItemBoxUpdate(b.raw)) sheetChanged = true; }

    // ── Lore blocks (Location / Faction / Item / Rule / Event / Quest) ─────────
    if (settings.campaignLorebook) {
        for (const [type, cfg] of Object.entries(LORE_BLOCKS)) {
            for (const b of extractBlocks(text, cfg.begin, cfg.end)) {
                const fields = parseFields(b.raw); fields._raw = b.raw;
                let ok = false;
                if (type === 'ITEM')          ok = await processItemBlock(fields, settings);
                else if (type === 'LOCATION') ok = await processLocationBlock(fields, settings);
                else if (type === 'QUEST')    { if (featureOn('quests')) ok = await processQuestBlock(fields, settings); }
                else if (type === 'FACTION')  { if (featureOn('reputation')) ok = await processFactionBlock(fields, settings); }
                else ok = await processGenericLore(type, cfg, fields, settings);
                if (ok) loreSaved++;
            }
        }

        for (const b of extractBlocks(text, UPDATE_BLOCKS.ITEM_UPDATE.begin, UPDATE_BLOCKS.ITEM_UPDATE.end))
            if (await processItemUpdate(b.raw, settings)) loreSaved++;

        if (featureOn('quests'))
        for (const b of extractBlocks(text, UPDATE_BLOCKS.QUEST_UPDATE.begin, UPDATE_BLOCKS.QUEST_UPDATE.end))
            if (await applyQuestUpdate(b.raw, settings)) loreSaved++;

        if (featureOn('reputation'))
        for (const b of extractBlocks(text, UPDATE_BLOCKS.FACTION_UPDATE.begin, UPDATE_BLOCKS.FACTION_UPDATE.end))
            if (await processFactionUpdate(b.raw, settings)) loreSaved++;

        if (featureOn('world_events'))
        for (const b of extractBlocks(text, UPDATE_BLOCKS.WORLD_EVENT_UPDATE.begin, UPDATE_BLOCKS.WORLD_EVENT_UPDATE.end))
            if (await applyWorldEventUpdate(b.raw, settings)) loreSaved++;

        for (const b of extractBlocks(text, UPDATE_BLOCKS.LOCATION_MEMORY.begin, UPDATE_BLOCKS.LOCATION_MEMORY.end))
            if (await processLocationMemory(b.raw, settings)) loreSaved++;
    }

    // ── Post-processing ───────────────────────────────────────────────────────
    if (sheetChanged) {
        await saveCharState(); refreshStatusPanel(); injectCharacterContext(); await rebuildPlayerLoreEntries(settings);
        if (settings.notifyOnSave && toastr) {
            toastr.info('Character sheet updated', 'GM Lore Parser', { timeOut: 2000, positionClass: 'toast-bottom-right' });
            for (const n of notifications) {
                const isGood = ['tier','promotion','npc_promotion','branch','level'].includes(n.type);
                if (isGood)
                    toastr.success(n.msg, 'GM Lore Parser', { timeOut: 6000, positionClass: 'toast-bottom-right' });
                else if (['attr_change','npc_attr_change'].includes(n.type))
                    toastr.info(n.msg, 'GM Lore Parser', { timeOut: 5000, positionClass: 'toast-bottom-right' });
            }
        }
    }
    if (loreSaved > 0 && settings.notifyOnSave && toastr)
        toastr.success(`${loreSaved} ${loreSaved === 1 ? 'entry' : 'entries'} saved`, 'GM Lore Parser',
            { timeOut: 3000, positionClass: 'toast-bottom-right' });

    if (settings.hideBlocks) {
        const c = stripAllBlocks(text);
        if (c !== text) rerenderMessage(messageId, c);
    }

    // ── Narrative header: render + prepend after the message text is finalized ──
    applyNarrativeHeader(messageId);
}

async function onUserMessageRendered(messageId) {
    const settings = getSettings(); if (!settings.enabled) return;
    const { chat }  = SillyTavern.getContext();
    const message   = chat[messageId]; if (!message || !message.is_user) return;

    if (settings.interceptCommands && message.mes?.trim().startsWith('#')) {
        const response = tryHandleCommand(message.mes);
        if (response) { injectCommandResponse(response, messageId); return; }
    }
    await handlePlayerSheetBlocks(message, messageId, settings);
}

/** Player may paste a player [ENTITY_BEGIN] block in their own message. */
async function handlePlayerSheetBlocks(message, messageId, settings) {
    await loadSystemDefFromLorebook(settings);
    const blocks = extractBlocks(message.mes, SHEET_BLOCKS.ENTITY.begin, SHEET_BLOCKS.ENTITY.end);
    if (!blocks.length) return;
    let applied = false;
    for (const b of blocks) {
        if (entityType(b.raw) !== 'player') continue;
        await onEntityBegin(b.raw, settings);
        applied = true;
    }
    if (!applied) return;
    await saveCharState(); refreshStatusPanel(); injectCharacterContext(); await rebuildPlayerLoreEntries(settings);
    if (settings.hideBlocks) {
        let c = message.mes;
        for (const b of blocks) c = c.replace(b.fullMatch, '');
        rerenderMessage(messageId, c.trim());
    }
}

function onGenerationStarted() { injectCharacterContext(); }
async function onChatChanged() {
    await loadSystemDefFromLorebook(getSettings());
    const st = getCharState();
    if (st.name) augmentSchemaWithDefAttributes(st.schema, st.values);   // backfill panel fields for def attributes (existing chars / def changes)
    refreshStatusPanel();
    injectCharacterContext();
    await rebuildPlayerLoreEntries(getSettings());
}

// ── Settings UI ───────────────────────────────────────────────────────────────

async function renderSettingsPanel() {
    const { world_names } = SillyTavern.getContext();
    const settings = getSettings();
    const opts = (world_names || []).map(n =>
        `<option value="${n}" ${n === settings.campaignLorebook ? 'selected' : ''}>${n}</option>`
    ).join('');

    const html = `
<div class="glp-settings">
  <div class="inline-drawer">
    <div class="inline-drawer-toggle inline-drawer-header">
      <b>GM Lore Parser</b>
      <div class="flex-container alignItemsCenter" style="gap:8px;margin-inline-start:auto;">
        <div id="glp-settings-popout" class="fa-solid fa-window-restore interactable" title="Pop out settings" tabindex="0"></div>
        <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
      </div>
    </div>
    <div class="inline-drawer-content">
      <label class="glp-row"><input type="checkbox" id="glp-enabled" ${settings.enabled ? 'checked' : ''}><span>Enable GM Lore Parser</span></label>
      <div class="glp-field-setting">
        <label for="glp-lorebook">Campaign Lorebook</label>
        <select id="glp-lorebook" class="text_pole"><option value="">— Select —</option>${opts}</select>
        <small>All lore entries written here. NPC memories → per-NPC lorebooks (auto-created).</small>
      </div>
      <label class="glp-row"><input type="checkbox" id="glp-hide"      ${settings.hideBlocks       ? 'checked' : ''}><span>Hide raw blocks from chat</span></label>
      <label class="glp-row"><input type="checkbox" id="glp-notify"    ${settings.notifyOnSave     ? 'checked' : ''}><span>Show toast notifications</span></label>
      <label class="glp-row"><input type="checkbox" id="glp-scan-user" ${settings.scanUserMessages ? 'checked' : ''}><span>Scan user messages for lore blocks</span></label>
      <label class="glp-row"><input type="checkbox" id="glp-intercept" ${settings.interceptCommands? 'checked' : ''}><span>Intercept # commands</span></label>
      <div class="glp-section-label">Panels</div>
      <label class="glp-row"><input type="checkbox" id="glp-show-panel"    ${settings.showStatusPanel  ? 'checked' : ''}><span>Character status panel</span></label>
      <label class="glp-row"><input type="checkbox" id="glp-show-skills"   ${settings.showSkillPanel   ? 'checked' : ''}><span>Skill panel</span></label>
      <label class="glp-row"><input type="checkbox" id="glp-show-domain"   ${settings.showDomainPanel  ? 'checked' : ''}><span>Domain panel</span></label>
      <label class="glp-row"><input type="checkbox" id="glp-show-quests"   ${settings.showQuestPanel   ? 'checked' : ''}><span>Quest panel</span></label>
      <label class="glp-row"><input type="checkbox" id="glp-show-rep"      ${settings.showRepPanel     ? 'checked' : ''}><span>Reputation panel</span></label>
      <label class="glp-row"><input type="checkbox" id="glp-show-events"   ${settings.showEventsPanel  ? 'checked' : ''}><span>World events panel</span></label>
      <label class="glp-row"><input type="checkbox" id="glp-show-currency" ${settings.showCurrencyPanel? 'checked' : ''}><span>Currency &amp; companions panel</span></label>
      <label class="glp-row"><input type="checkbox" id="glp-show-boons"    ${settings.showBoonPanel    ? 'checked' : ''}><span>Abilities &amp; titles panel</span></label>
      <label class="glp-row"><input type="checkbox" id="glp-show-needs"    ${settings.showNeedsPanel   ? 'checked' : ''}><span>Needs panel</span></label>
      <label class="glp-row"><input type="checkbox" id="glp-show-scene"    ${settings.showScenePanel!==false ? 'checked' : ''}><span>Scene panel</span></label>
      <label class="glp-row"><input type="checkbox" id="glp-show-party"    ${settings.showPartyPanel!==false ? 'checked' : ''}><span>Party panel</span></label>
      <div class="glp-section-label">Narrative Header</div>
      <label class="glp-row"><input type="checkbox" id="glp-hdr-enabled"   ${settings.headerEnabled!==false ? 'checked' : ''}><span>Prepend status header to GM messages</span></label>
      <label class="glp-row"><input type="checkbox" id="glp-hdr-block"     ${settings.headerUseFormatBlock!==false ? 'checked' : ''}><span>Use [HEADER_FORMAT] block when present</span></label>
      <label class="glp-row"><input type="checkbox" id="glp-hdr-every"     ${settings.headerShowOnEveryMsg!==false ? 'checked' : ''}><span>Show on every GM message</span></label>
      <div class="glp-field-setting">
        <label for="glp-hdr-sep">Header separator</label>
        <input type="text" id="glp-hdr-sep" class="text_pole" value="${(settings.headerSeparator ?? '---')}">
      </div>
      <div class="glp-field-setting">
        <label for="glp-hdr-manual">Manual header format (fallback)</label>
        <textarea id="glp-hdr-manual" class="text_pole" rows="2" placeholder="{name}  HP {hp}/{hp_max}  {conditions}  {time}">${settings.headerManualFormat || ''}</textarea>
      </div>
      <div class="glp-field-setting">
        <label for="glp-plot-lorebook">Plot Lorebook (optional)</label>
        <select id="glp-plot-lorebook" class="text_pole"><option value="">— auto (campaign-plot) —</option>${opts}</select>
        <small>Plot entries go here. Auto-created if blank.</small>
      </div>
      <label class="glp-row"><input type="checkbox" id="glp-inject-ctx"   ${settings.injectIntoContext?'checked' : ''}><span>Inject state into context</span></label>
      <label class="glp-row"><input type="checkbox" id="glp-inject-res"   ${settings.injectResolution!==false?'checked' : ''}><span>Inject resolution mechanic into context</span></label>
      <label class="glp-row"><input type="checkbox" id="glp-tiered-ctx"   ${settings.tieredContext!==false?'checked' : ''}><span>Tiered context (lean core + keyword-triggered detail)</span></label>
      <div class="glp-field-setting">
        <label for="glp-ctx-depth">Context injection depth</label>
        <input type="number" id="glp-ctx-depth" class="text_pole" min="0" max="20" value="${settings.contextDepth}">
      </div>
      <div class="glp-section-label">Advanced</div>
      <div class="glp-two-col">
        <div class="glp-field-setting"><label>Scan depth</label><input  type="number" id="glp-scan-depth"  class="text_pole" min="1" max="20"  value="${settings.defaultScanDepth}"></div>
        <div class="glp-field-setting"><label>Lore order</label><input  type="number" id="glp-lore-order"  class="text_pole" min="1" max="999" value="${settings.loreOrder}"></div>
        <div class="glp-field-setting"><label>Rule order</label><input  type="number" id="glp-rule-order"  class="text_pole" min="1" max="999" value="${settings.ruleOrder}"></div>
      </div>
      <div class="glp-info">
        <b>v0.0.12 (beta) — modular build.</b> A lorebook-hosted <b>[SYSTEM_DEF]</b> declares the ruleset; a unified <b>[ENTITY]</b> engine drives player/NPC/companion/creature; <b>[CAPABILITY]</b> unifies boons/titles/passives/traits/evolution/skills.<br>
        <b>Capability progression</b> is configurable per category via named profiles: none · counter · use_tracked · points_tiers · xp_levels · milestone (Veridia PP/tier = the built-in <i>veridia_pp</i>).<br>
        <b>Tiered context</b> (default on): the player's always-on injection is a lean core (identity, vitals, attributes, conditions, title, rank, time); skills, possessions &amp; domains move to keyword-triggered <b>[Player:Skills]</b>/<b>[Player:Possessions]</b>/<b>[Player:Domains]</b> entries that load only when referenced. <code>capabilities.require_granted</code> rejects progression on un-owned skills.<br>
        <b>Party &amp; scene</b> rosters, <b>GM realism directives</b>, and a built-in <b>narrative header</b> (merged from gm-narrative-header) are always-on backstops: only <b>[System Definition]</b>, <b>[GM Directives]</b>, <b>[Scene]</b>, <b>[Party]</b> and NPC core memories stay in context; everything else is keyword-triggered.<br>
        <b>Detailed mechanics</b> surface on demand as keyword-triggered <b>[System Rule]</b> lorebook entries (keys derived from the def's own vocabulary); <b># commands</b> are derived from the def and reshapeable via its <code>commands:</code> section.<br>
        <b>Add a block type:</b> register tags in modules/state.js + add a handler in the relevant module + dispatch in index.js.
      </div>
    </div>
  </div>
</div>`;

    $('#extensions_settings2').append(html);
    const save = () => SillyTavern.getContext().saveSettingsDebounced();
    $('#glp-enabled').on('change', function()    { getSettings().enabled          = this.checked; save(); });
    $('#glp-lorebook').on('change', function()   { getSettings().campaignLorebook = this.value;   save(); });
    $('#glp-hide').on('change', function()       { getSettings().hideBlocks       = this.checked; save(); });
    $('#glp-notify').on('change', function()     { getSettings().notifyOnSave     = this.checked; save(); });
    $('#glp-scan-user').on('change', function()  { getSettings().scanUserMessages = this.checked; save(); });
    $('#glp-intercept').on('change', function()  { getSettings().interceptCommands= this.checked; save(); });
    $('#glp-show-panel').on('change', function() { getSettings().showStatusPanel  = this.checked; refreshStatusPanel(); save(); });
    $('#glp-show-skills').on('change', function(){ getSettings().showSkillPanel   = this.checked; refreshStatusPanel(); save(); });
    $('#glp-show-domain').on('change', function()   { getSettings().showDomainPanel   = this.checked; refreshStatusPanel(); save(); });
    $('#glp-show-quests').on('change', function()   { getSettings().showQuestPanel    = this.checked; refreshStatusPanel(); save(); });
    $('#glp-show-rep').on('change', function()      { getSettings().showRepPanel      = this.checked; refreshStatusPanel(); save(); });
    $('#glp-show-events').on('change', function()   { getSettings().showEventsPanel   = this.checked; refreshStatusPanel(); save(); });
    $('#glp-show-currency').on('change', function() { getSettings().showCurrencyPanel = this.checked; refreshStatusPanel(); save(); });
    $('#glp-show-boons').on('change',    function()  { getSettings().showBoonPanel    = this.checked; refreshStatusPanel(); save(); });
    $('#glp-show-needs').on('change',    function()  { getSettings().showNeedsPanel   = this.checked; refreshStatusPanel(); save(); });
    $('#glp-show-scene').on('change',    function()  { getSettings().showScenePanel   = this.checked; refreshStatusPanel(); save(); });
    $('#glp-show-party').on('change',    function()  { getSettings().showPartyPanel   = this.checked; refreshStatusPanel(); save(); });
    $('#glp-hdr-enabled').on('change',   function()  { getSettings().headerEnabled        = this.checked; save(); });
    $('#glp-hdr-block').on('change',     function()  { getSettings().headerUseFormatBlock = this.checked; save(); });
    $('#glp-hdr-every').on('change',     function()  { getSettings().headerShowOnEveryMsg = this.checked; save(); });
    $('#glp-hdr-sep').on('change',       function()  { getSettings().headerSeparator      = this.value;   save(); });
    $('#glp-hdr-manual').on('change',    function()  { getSettings().headerManualFormat   = this.value;   save(); });
    $('#glp-plot-lorebook').on('change', function() { getSettings().plotLorebook      = this.value;   save(); });
    $('#glp-inject-ctx').on('change', function()    { getSettings().injectIntoContext = this.checked; injectCharacterContext(); save(); });
    $('#glp-inject-res').on('change', function()    { getSettings().injectResolution = this.checked; injectCharacterContext(); save(); });
    $('#glp-tiered-ctx').on('change', async function() { getSettings().tieredContext = this.checked; injectCharacterContext(); await rebuildPlayerLoreEntries(getSettings()); save(); });
    $('#glp-ctx-depth').on('change', function()  { getSettings().contextDepth     = parseInt(this.value) || 1; injectCharacterContext(); save(); });
    $('#glp-scan-depth').on('change', function() { getSettings().defaultScanDepth = parseInt(this.value) || 4; save(); });
    $('#glp-lore-order').on('change', function() { getSettings().loreOrder        = parseInt(this.value) || 100; save(); });
    $('#glp-rule-order').on('change', function() { getSettings().ruleOrder        = parseInt(this.value) || 50;  save(); });
    $('#glp-settings-popout').off('click').on('click', glpSettingsTogglePopout);
}

// ── Settings pop-out (detach the settings into a draggable floating panel) ─────
// Mirrors ST's Summarize extension. We MOVE the live .inline-drawer-content (so
// its change handlers travel with it) into a float, and move it back on close.

async function glpSettingsTogglePopout(e) {
    e?.stopPropagation?.();
    if (document.getElementById('glp-settings-popout-panel')) { $('#glpSettingsPopoutClose').trigger('click'); return; }

    const $content = $('.glp-settings .inline-drawer-content');
    if (!$content.length) return;
    const $origParent = $content.parent();

    const tpl = $('#zoomed_avatar_template').html();
    const $panel = tpl ? $(tpl) : $('<div></div>');
    $panel.attr('id', 'glp-settings-popout-panel')
        .removeClass('zoomed_avatar').addClass('draggable')
        .css('display', 'flex').empty();
    const controlBar = `<div class="panelControlBar flex-container">
        <div id="glpSettingsPopoutHeader" class="fa-solid fa-grip drag-grabber hoverglow"></div>
        <div id="glpSettingsPopoutClose" class="fa-solid fa-circle-xmark hoverglow dragClose" title="Close"></div>
    </div>`;
    $panel.append(controlBar).append($content);            // moves the live element
    $('#movingDivs').append($panel);

    try {
        const ra = await import('../../../RossAscends-mods.js');
        const pu = await import('../../../power-user.js');
        pu.loadMovingUIState?.();
        ra.dragElement?.($panel);
    } catch (err) { console.warn(`[${MODULE_NAME}] popout drag unavailable:`, err); }

    $('#glpSettingsPopoutClose').off('click').on('click', function () {
        $origParent.append($content);                      // move the live element back
        $('#glp-settings-popout-panel').remove();
    });
}

// ── GM State drawer (top-bar, pinnable; hosts the status panel) ────────────────
// Modeled on ST's AI Response Configuration drawer. ST binds `.drawer-toggle`
// once at init, so our late-injected toggle wires its own open/close. The pin
// uses ST's own `pinnedOpen` class, which exempts the drawer from ST's
// outside-click auto-close (see script.js html mousedown handler).

function mountGlpDrawer() {
    if (document.getElementById('glp-drawer-button')) return;       // mount once
    if (!document.getElementById('top-settings-holder')) return;
    const html = `
<div id="glp-drawer-button" class="drawer">
  <div class="drawer-toggle drawer-header">
    <div id="glpDrawerIcon" class="drawer-icon fa-solid fa-scroll fa-fw closedIcon interactable" title="GM State"></div>
  </div>
  <div id="glp-drawer" class="drawer-content fillLeft closedDrawer">
    <div id="glp-drawer-pin-div" title="Lock — the GM State panel stays open">
      <input type="checkbox" id="glp-drawer-pin">
      <label for="glp-drawer-pin">
        <div class="unchecked fa-solid fa-unlock"></div>
        <div class="checked fa-solid fa-lock"></div>
      </label>
    </div>
    <div id="glp-drawer-body"></div>
  </div>
</div>`;
    $('#top-settings-holder').append(html);

    const $icon = $('#glpDrawerIcon'), $drawer = $('#glp-drawer');
    const applyPin = (pinned) => {
        $drawer.toggleClass('pinnedOpen', pinned);
        $icon.toggleClass('drawerPinnedOpen', pinned);
        if (pinned) { $drawer.addClass('openDrawer').removeClass('closedDrawer'); $icon.addClass('openIcon').removeClass('closedIcon'); }
    };
    $('#glp-drawer-button > .drawer-toggle').on('click', function () {
        $drawer.toggleClass('openDrawer closedDrawer');
        $icon.toggleClass('openIcon closedIcon');
    });
    $('#glp-drawer-pin').prop('checked', !!getSettings().pinPanel).on('change', function () {
        getSettings().pinPanel = this.checked;
        SillyTavern.getContext().saveSettingsDebounced();
        applyPin(this.checked);
    });
    if (getSettings().pinPanel) applyPin(true);

    // Inventory item → popup its [Item] lorebook entry (delegated; survives re-renders).
    $(document).off('click.glpInvItem').on('click.glpInvItem', '.glp-inv-item', function () {
        if (typeof glpShowItemPopup === 'function') glpShowItemPopup($(this).attr('data-item'));
    });
    // Party/scene member → popup their NPC/companion/creature entry.
    $(document).off('click.glpMember').on('click.glpMember', '.glp-member', function () {
        if (typeof glpShowMemberPopup === 'function') glpShowMemberPopup($(this).attr('data-member'));
    });
}

// ── Entry point ───────────────────────────────────────────────────────────────

jQuery(async () => {
    await glpLoadModules();

    const { eventSource, event_types } = SillyTavern.getContext();
    getSettings();

    eventSource.on(event_types.MESSAGE_RECEIVED,      onMessageReceived);
    eventSource.on(event_types.USER_MESSAGE_RENDERED, onUserMessageRendered);
    eventSource.on(event_types.GENERATION_STARTED,    onGenerationStarted);
    eventSource.on(event_types.CHAT_CHANGED,          onChatChanged);
    eventSource.on(event_types.APP_READY, async () => {
        await renderSettingsPanel();
        mountGlpDrawer();
        refreshStatusPanel();
        injectCharacterContext();
    });

    console.log(`[${MODULE_NAME}] v${VERSION} loaded. Modules: ${GLP_MODULE_LOAD_ORDER.join(', ')}`);
});
