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

/** Attach a lorebook to the current chat (idempotent). */
async function linkToChat(name) {
    const { chatMetadata, saveMetadata } = SillyTavern.getContext();
    if (!chatMetadata.world_info) chatMetadata.world_info = [];
    if (!Array.isArray(chatMetadata.world_info))
        chatMetadata.world_info = [chatMetadata.world_info].filter(Boolean);
    if (!chatMetadata.world_info.includes(name)) {
        chatMetadata.world_info.push(name);
        await saveMetadata();
    }
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
