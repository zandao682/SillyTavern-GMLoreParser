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
            // merge extensions so audit/metadata flags (e.g. `enriched`) reflect the
            // latest write instead of going stale on an update of an existing entry
            extensions: { ...ex.extensions, ...entry.extensions },
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
    // Per-chat player book (holds the [Player:*] projections) if one exists for this chat.
    const pb = playerBookName(settings, false);
    if (pb && all.includes(pb)) link.push(pb);
    for (const n of all)
        if (n.startsWith(`${camp}-npc-`) || n.startsWith(`${camp}-location-`)) link.push(n);
    return linkToChatMany(link);
}

/** Stable per-chat player lorebook name. The tiered `[Player:*]` projections used to
 *  live in the shared campaign book, so two chats that share one campaign book but play
 *  different characters overwrote each other. This gives each chat its own player book
 *  (`<campaign>-player-<chatid>`), cached in per-chat state so it survives chat renames.
 *  Pure/synchronous — returns null if no campaign book or chat id is available and does
 *  NOT create or link the book (see ensurePlayerBook). Set `persist=false` for read-only
 *  lookups that shouldn't touch state (e.g. the click-to-view popup). */
function playerBookName(settings, persist = true) {
    const camp = settings?.campaignLorebook;
    if (!camp) return null;
    const st = (typeof getCharState === 'function') ? getCharState() : null;
    if (st?.player_book) return st.player_book;
    const ctx    = SillyTavern.getContext();
    const chatId = (typeof ctx.getCurrentChatId === 'function') ? ctx.getCurrentChatId() : null;
    if (!chatId) return null;
    const name = `${camp}-player-${slugify(String(chatId))}`;
    if (persist && st) { st.player_book = name; if (typeof saveCharState === 'function') saveCharState(); }
    return name;
}

/** Ensure the per-chat player book exists and is chat-linked; returns its name (or null). */
async function ensurePlayerBook(settings) {
    const name = playerBookName(settings);
    if (!name) return null;
    await loadOrCreateLorebook(name);
    await linkToChat(name);
    return name;
}

/** Generic lorebook-entry popup for any panel row backed by a lorebook entry.
 *  Searches the campaign book, the plot book, and the per-chat player book (in that
 *  order) for an entry whose `comment` matches `comment` or any of `altComments`,
 *  and renders its content in the shared `.glp-item-popup` markup. Falls back to a
 *  graceful "no entry" message when the row has no backing entry yet. */
async function glpShowLorePopup(comment, altComments = [], titleOverride = null) {
    const ctx      = SillyTavern.getContext();
    const settings = getSettings();
    const wanted   = [comment, ...(Array.isArray(altComments) ? altComments : [altComments])].filter(Boolean);
    const camp     = settings.campaignLorebook;

    const books = [];
    if (camp) {
        books.push(camp);
        books.push(settings.plotLorebook || `${camp}-plot`);
    }
    // Player book is where the per-chat [Player:*] entries live (read-only lookup).
    const pb = (typeof playerBookName === 'function') ? playerBookName(settings, false) : null;
    if (pb) books.push(pb);

    let entry = null, foundComment = wanted[0] || '';
    for (const bk of books) {
        if (!bk) continue;
        try {
            const data = await ctx.loadWorldInfo(bk);
            if (!data) continue;
            for (const w of wanted) {
                const e = Object.values(data.entries || {}).find(x => x.comment === w);
                if (e) { entry = e; foundComment = w; break; }
            }
            if (entry) break;
        } catch (e) { /* ignore missing book */ }
    }

    const esc   = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const title = titleOverride || String(foundComment).replace(/^\[[^\]]+\]\s*/, '') || foundComment;
    const body  = entry?.content ? esc(entry.content) : 'No lore entry recorded yet.';
    const html  = `<div class="glp-item-popup"><h3>${esc(title)}</h3><pre class="glp-item-popup-body">${body}</pre></div>`;
    if (typeof ctx.callGenericPopup === 'function' && ctx.POPUP_TYPE) ctx.callGenericPopup(html, ctx.POPUP_TYPE.TEXT);
    else if (typeof ctx.callPopup === 'function') ctx.callPopup(html, 'text');
    else toastr?.info?.(entry?.content || title);
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
