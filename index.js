/**
 * GM Lore Parser — SillyTavern Extension  v8.0.0
 *
 * Entry point only. All logic lives in modules/. Load order matters:
 * state → utils → lorebook → schema → skills → domain → lore → sheet → commands → panel → context
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
    'state',    // constants, block registries, settings/state accessors
    'utils',    // pure utilities, parseFields, extractBlocks, parseSchema
    'lorebook', // lorebook CRUD helpers
    'schema',   // schema engine (applyFieldValue, regen, promotions)
    'skills',   // skill system (PP + use_tracked)
    'domain',   // domain sub-game
    'lore',     // NPC, item, bestiary, generic lore handlers
    'sheet',    // player sheet handlers + world time
    'commands', // # command interceptor
    'panel',    // status panel rendering
    'context',  // context injection
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
    const { chat, toastr } = SillyTavern.getContext();
    const message = chat[messageId]; if (!message) return;
    if (message.is_user && !settings.scanUserMessages) {
        await handlePlayerSheetBlocks(message, messageId, settings);
        return;
    }

    const text = message.mes;
    let sheetChanged = false;
    const notifications = [];

    // ── Sheet blocks ──────────────────────────────────────────────────────────
    for (const b of extractBlocks(text, SHEET_BLOCKS.PLAYER_SHEET.begin, SHEET_BLOCKS.PLAYER_SHEET.end))
        { applyPlayerSheet(b.raw); sheetChanged = true; }

    for (const b of extractBlocks(text, SHEET_BLOCKS.SKILL_SYSTEM.begin, SHEET_BLOCKS.SKILL_SYSTEM.end))
        { applySkillSystemConfig(b.raw); sheetChanged = true; }

    for (const b of extractBlocks(text, SHEET_BLOCKS.PLAYER_UPDATE.begin, SHEET_BLOCKS.PLAYER_UPDATE.end)) {
        const ch = applyPlayerUpdate(b.raw);
        if (ch.length) {
            sheetChanged = true;
            const p = checkPromotions(getCharState().schema?.fields || {}, getCharState().values);
            for (const x of p) notifications.push({ type: 'promotion', msg: x.reason });
        }
    }

    for (const b of extractBlocks(text, SHEET_BLOCKS.ATTR_CHANGE.begin, SHEET_BLOCKS.ATTR_CHANGE.end)) {
        const { changes, reason } = applyAttrChange(b.raw);
        if (changes.length) {
            sheetChanged = true;
            notifications.push({ type: 'attr_change', msg: `${reason}: ${changes.map(c => `${c.key}:${c.oldVal}→${c.newVal}`).join(', ')}` });
        }
    }

    for (const b of extractBlocks(text, SHEET_BLOCKS.SKILL_UPDATE.begin, SHEET_BLOCKS.SKILL_UPDATE.end)) {
        const n = applySkillUpdate(b.raw);
        if (n.length) { sheetChanged = true; for (const x of n) notifications.push({ type: x.type, msg: x.msg }); }
    }

    for (const b of extractBlocks(text, SHEET_BLOCKS.DOMAIN_UPDATE.begin, SHEET_BLOCKS.DOMAIN_UPDATE.end))
        { applyDomainUpdate(b.raw); sheetChanged = true; }

    for (const b of extractBlocks(text, SHEET_BLOCKS.WORLD_TIME.begin, SHEET_BLOCKS.WORLD_TIME.end)) {
        const r = await applyWorldTime(b.raw, settings);
        if (r.playerRegenChanged || r.playerPromotions.length) sheetChanged = true;
        for (const p of r.playerPromotions) notifications.push({ type: 'promotion',     msg: p.reason });
        for (const p of r.npcPromotions)    notifications.push({ type: 'npc_promotion', msg: `${p.npc}: ${p.reason}` });
    }

    for (const b of extractBlocks(text, SHEET_BLOCKS.CARD_OUTPUT.begin, SHEET_BLOCKS.CARD_OUTPUT.end))
        handleCardOutput(b.raw);

    // ── Lore blocks ───────────────────────────────────────────────────────────
    let loreSaved = 0;
    if (settings.campaignLorebook) {
        for (const [type, cfg] of Object.entries(LORE_BLOCKS)) {
            for (const b of extractBlocks(text, cfg.begin, cfg.end)) {
                const fields = parseFields(b.raw); fields._raw = b.raw;
                let ok = false;
                if (type === 'NPC')      ok = await processNpcBlock(fields, settings);
                else if (type === 'ITEM') ok = await processItemBlock(fields, settings);
                else if (type === 'BESTIARY') ok = await processBestiaryBlock(fields, settings);
                else ok = await processGenericLore(type, cfg, fields, settings);
                if (ok) loreSaved++;
            }
        }

        for (const b of extractBlocks(text, UPDATE_BLOCKS.NPC_UPDATE.begin, UPDATE_BLOCKS.NPC_UPDATE.end)) {
            const r = await processNpcUpdate(b.raw, settings);
            if (r) {
                loreSaved++;
                if (r.promotions?.length)
                    for (const p of r.promotions)
                        notifications.push({ type: 'npc_promotion', msg: `${parseFields(b.raw).name}: ${p.reason}` });
            }
        }

        for (const b of extractBlocks(text, UPDATE_BLOCKS.NPC_ATTR_CHANGE.begin, UPDATE_BLOCKS.NPC_ATTR_CHANGE.end)) {
            const r = await processNpcAttrChange(b.raw, settings);
            if (r) { loreSaved++; notifications.push({ type: 'npc_attr_change', msg: `${parseFields(b.raw).name} — ${r.reason}` }); }
        }

        for (const b of extractBlocks(text, UPDATE_BLOCKS.NPC_MEMORY.begin, UPDATE_BLOCKS.NPC_MEMORY.end))
            if (await processNpcMemory(b.raw, settings)) loreSaved++;

        for (const b of extractBlocks(text, UPDATE_BLOCKS.ITEM_UPDATE.begin, UPDATE_BLOCKS.ITEM_UPDATE.end))
            if (await processItemUpdate(b.raw, settings)) loreSaved++;
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

async function handlePlayerSheetBlocks(message, messageId, settings) {
    const blocks = extractBlocks(message.mes, SHEET_BLOCKS.PLAYER_SHEET.begin, SHEET_BLOCKS.PLAYER_SHEET.end);
    if (!blocks.length) return;
    for (const b of blocks) applyPlayerSheet(b.raw);
    await saveCharState(); refreshStatusPanel(); injectCharacterContext();
    if (settings.hideBlocks) {
        let c = message.mes;
        for (const b of blocks) c = c.replace(b.fullMatch, '');
        rerenderMessage(messageId, c.trim());
    }
}

function onGenerationStarted() { injectCharacterContext(); }
function onChatChanged()       { refreshStatusPanel(); injectCharacterContext(); }

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
      <label class="glp-row"><input type="checkbox" id="glp-show-panel"   ${settings.showStatusPanel ? 'checked' : ''}><span>Character status panel</span></label>
      <label class="glp-row"><input type="checkbox" id="glp-show-skills"  ${settings.showSkillPanel  ? 'checked' : ''}><span>Skill panel</span></label>
      <label class="glp-row"><input type="checkbox" id="glp-show-domain"  ${settings.showDomainPanel ? 'checked' : ''}><span>Domain panel</span></label>
      <label class="glp-row"><input type="checkbox" id="glp-inject-ctx"   ${settings.injectIntoContext?'checked' : ''}><span>Inject state into context</span></label>
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
        <b>v8 — modular build.</b> Modules: state · utils · lorebook · schema · skills · domain · lore · sheet · commands · panel · context<br>
        <b>Skill modes:</b> pp (multi-tier Veridia-style) · use_tracked (simple threshold)<br>
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
    $('#glp-show-domain').on('change', function(){ getSettings().showDomainPanel  = this.checked; refreshStatusPanel(); save(); });
    $('#glp-inject-ctx').on('change', function() { getSettings().injectIntoContext= this.checked; injectCharacterContext(); save(); });
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
