/**
 * gm-lore-parser / modules/lorebook.js
 * Lorebook CRUD helpers — load, upsert, link, build entry base objects.
 */

async function loadOrCreateLorebook(name) {
    const { loadWorldInfo, saveWorldInfo, updateWorldInfoList } = SillyTavern.getContext();
    let data = await loadWorldInfo(name);
    if (!data) {
        data = { name, entries: {}, scan_depth: 4, token_budget: 1500, recursive_scanning: true };
        await saveWorldInfo(name, data);
        await updateWorldInfoList();
        console.log(`[${MODULE_NAME}] Created lorebook: "${name}"`);
    }
    return data;
}

/**
 * Insert or update a lorebook entry matched by comment field.
 * If an entry with the same comment exists, its content/keys are updated.
 * Otherwise a new entry is created.
 */
async function upsertEntry(lorebookName, entry) {
    const { loadWorldInfo, saveWorldInfo } = SillyTavern.getContext();
    const data = await loadWorldInfo(lorebookName);
    if (!data) return false;
    if (!data.entries) data.entries = {};
    const ex = Object.values(data.entries).find(e => e.comment === entry.comment);
    if (ex) {
        Object.assign(ex, {
            content:  entry.content,
            key:      entry.key,
            order:    entry.order,
            memo:     entry.memo,
            constant: entry.constant ?? ex.constant,
        });
    } else {
        const uid = Object.keys(data.entries).length > 0
            ? Math.max(...Object.keys(data.entries).map(Number)) + 1
            : 0;
        data.entries[uid] = { ...entry, uid };
    }
    await saveWorldInfo(lorebookName, data);
    return true;
}

/** Remove entries whose comment is NOT in keepSet but whose extensions.type
 *  matches `ofType` (so we only prune entries this extension owns). Returns the
 *  number removed. Used to drop stale [System Rule] entries when a feature is
 *  disabled or a rule is no longer emitted. */
async function removeEntriesByComment(lorebookName, keepSet, ofType) {
    const { loadWorldInfo, saveWorldInfo } = SillyTavern.getContext();
    const data = await loadWorldInfo(lorebookName);
    if (!data || !data.entries) return 0;
    let removed = 0;
    for (const [uid, e] of Object.entries(data.entries)) {
        if (ofType && e.extensions?.type !== ofType) continue;
        if (keepSet.has(e.comment)) continue;
        delete data.entries[uid];
        removed++;
    }
    if (removed) await saveWorldInfo(lorebookName, data);
    return removed;
}

/** Attach a lorebook to the current chat (idempotent). */
async function linkToChat(name) {
    return linkToChatMany([name]);
}

/** Attach several lorebooks to the current chat in a single metadata save (idempotent). */
async function linkToChatMany(names) {
    const { chatMetadata, saveMetadata } = SillyTavern.getContext();
    if (!Array.isArray(chatMetadata.world_info))
        chatMetadata.world_info = chatMetadata.world_info ? [chatMetadata.world_info].filter(Boolean) : [];
    let added = false;
    for (const name of names)
        if (name && !chatMetadata.world_info.includes(name)) { chatMetadata.world_info.push(name); added = true; }
    if (added) await saveMetadata();
    return added;
}

/** Link every lorebook this extension generates for the active campaign to the current
 *  chat, so their entries are pulled by BOTH keyword World Info and Vector Storage.
 *  Covers the campaign book (its constant [System Definition]/[GM Directives]/[Scene]/
 *  [Party] entries only reach the model when the book is chat-active), the plot book,
 *  and every campaign-scoped per-subject memory book (`<campaign>-npc-*` /
 *  `<campaign>-location-*`). Called on chat change and when the campaign lorebook is set. */
async function linkCampaignBooks(settings) {
    const camp = settings?.campaignLorebook;
    if (!camp) return false;
    const ctx  = SillyTavern.getContext();
    const all  = (ctx.getWorldInfoNames ? ctx.getWorldInfoNames() : []) || [];
    const plot = settings.plotLorebook || `${camp}-plot`;
    const link = [camp];
    if (all.includes(plot)) link.push(plot);
    for (const n of all)
        if (n.startsWith(`${camp}-npc-`) || n.startsWith(`${camp}-location-`)) link.push(n);
    return linkToChatMany(link);
}

/** Build a base lorebook entry object with all required fields. */
function entryBase(comment, keys, content, order, settings, extra = {}) {
    return {
        comment, key: keys, keysecondary: [], content,
        constant: false, selective: false, selectiveLogic: 0,
        order, depth: settings.defaultScanDepth, disable: false, addMemo: true,
        position: 0, role: null,
        memo: `gm-lore-parser v${VERSION}`,
        extensions: { gm_lore_parser: true, ...extra },
    };
}
