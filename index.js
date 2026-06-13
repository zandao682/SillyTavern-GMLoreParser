/**
 * GM Lore Parser — SillyTavern Extension  v9.0.0
 *
 * Entry point only. All logic lives in modules/. Load order matters:
 * state → utils → lorebook → system → schema → entity → companions →
 *   progression → inventory → skills → domain → lore → sheet → creation →
 *   quests → reputation → events → currency → abilities → needs →
 *   commands → panel → context
 *
 * To add a new block type:
 *   1. Add its begin/end strings to UPDATE_BLOCKS or SHEET_BLOCKS in modules/state.js
 *   2. Write a handler function in a new or existing module file
 *   3. Register it in the appropriate handler loop below (onMessageReceived)
 *   4. Add a stripAllBlocks entry (automatic via the registry arrays in state.js)
 */

var MODULE_NAME = 'gm-lore-parser';
var VERSION     = '8.0.0';

// ── Module loader ─────────────────────────────────────────────────────────────

var GLP_MODULE_LOAD_ORDER = [
    'state',      // constants, block registries, settings/state accessors
    'utils',      // pure utilities, parseFields, extractBlocks, parseSchema
    'lorebook',   // lorebook CRUD helpers
    'system',     // system definition (ruleset) — getSystemDef, evalFormula
    'schema',     // schema engine (applyFieldValue, regen, promotions)
    'entity',     // unified entity core (player/npc/companion/creature) + dispatcher
    'companions', // companion entity-type rules (loyalty, control, AP, legion)
    'progression',// rank ladders + XP awards
    'inventory',  // equipment slots, inventory model, item box
    'skills',     // skill system (PP + use_tracked)
    'domain',     // domain sub-game
    'lore',       // npc storage internals, item, location, generic lore handlers
    'sheet',      // player sheet + world time
    'creation',   // interactive character creation session
    'quests',     // quest tracker
    'reputation', // faction reputation
    'events',     // world events + plot lorebook
    'currency',   // pure wealth tracking
    'abilities',  // unified abilities (boon/title/passive/trait/evolution)
    'needs',      // life simulation needs meters
    'commands',   // # command interceptor
    'panel',      // status panel rendering
    'context',    // context injection
];

async function glpLoadModules() {
    const base = `/scripts/extensions/third-party/${MODULE_NAME}/modules/`;
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

    if (featureOn('abilities'))
    for (const b of extractBlocks(text, SHEET_BLOCKS.ABILITY.begin, SHEET_BLOCKS.ABILITY.end))
        { if (await processAbilityBlock(parseFields(b.raw), settings)) sheetChanged = true; }

    if (featureOn('skills')) {
    for (const b of extractBlocks(text, SHEET_BLOCKS.SKILL_SYSTEM.begin, SHEET_BLOCKS.SKILL_SYSTEM.end))
        { applySkillSystemConfig(b.raw); sheetChanged = true; }

    for (const b of extractBlocks(text, SHEET_BLOCKS.SKILL_UPDATE.begin, SHEET_BLOCKS.SKILL_UPDATE.end)) {
        const n = applySkillUpdate(b.raw);
        if (n.length) { sheetChanged = true; for (const x of n) notifications.push({ type: x.type, msg: x.msg }); }
    }
    }

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
        await saveCharState(); refreshStatusPanel(); injectCharacterContext();
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
    await saveCharState(); refreshStatusPanel(); injectCharacterContext();
    if (settings.hideBlocks) {
        let c = message.mes;
        for (const b of blocks) c = c.replace(b.fullMatch, '');
        rerenderMessage(messageId, c.trim());
    }
}

function onGenerationStarted() { injectCharacterContext(); }
async function onChatChanged() {
    await loadSystemDefFromLorebook(getSettings());
    refreshStatusPanel();
    injectCharacterContext();
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
      <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
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
      <div class="glp-field-setting">
        <label for="glp-plot-lorebook">Plot Lorebook (optional)</label>
        <select id="glp-plot-lorebook" class="text_pole"><option value="">— auto (campaign-plot) —</option>${opts}</select>
        <small>Plot entries go here. Auto-created if blank.</small>
      </div>
      <label class="glp-row"><input type="checkbox" id="glp-inject-ctx"   ${settings.injectIntoContext?'checked' : ''}><span>Inject state into context</span></label>
      <label class="glp-row"><input type="checkbox" id="glp-inject-res"   ${settings.injectResolution!==false?'checked' : ''}><span>Inject resolution mechanic into context</span></label>
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
        <b>v9 — modular build.</b> Modules: state · utils · lorebook · system · schema · entity · companions · progression · inventory · skills · domain · lore · sheet · creation · quests · reputation · events · currency · abilities · needs · commands · panel · context<br>
        <b>Skill modes:</b> pp (multi-tier, configurable) · use_tracked (threshold counter)<br>
        <b>Add a block type:</b> edit modules/state.js (registry) + add handler in the appropriate module
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
    $('#glp-plot-lorebook').on('change', function() { getSettings().plotLorebook      = this.value;   save(); });
    $('#glp-inject-ctx').on('change', function()    { getSettings().injectIntoContext = this.checked; injectCharacterContext(); save(); });
    $('#glp-inject-res').on('change', function()    { getSettings().injectResolution = this.checked; injectCharacterContext(); save(); });
    $('#glp-ctx-depth').on('change', function()  { getSettings().contextDepth     = parseInt(this.value) || 1; injectCharacterContext(); save(); });
    $('#glp-scan-depth').on('change', function() { getSettings().defaultScanDepth = parseInt(this.value) || 4; save(); });
    $('#glp-lore-order').on('change', function() { getSettings().loreOrder        = parseInt(this.value) || 100; save(); });
    $('#glp-rule-order').on('change', function() { getSettings().ruleOrder        = parseInt(this.value) || 50;  save(); });
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
        refreshStatusPanel();
        injectCharacterContext();
    });

    console.log(`[${MODULE_NAME}] v${VERSION} loaded. Modules: ${GLP_MODULE_LOAD_ORDER.join(', ')}`);
});
