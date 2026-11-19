'use strict';
const fs = require('fs');
const path = require('path');
// Douyin music library inside one project window.
// Module ids are the REQUIRED.music paths already probed by features/check.cjs
// (from Muqian-Sun/xiangsu-mcp-plus, MIT, Copyright (c) 2026 muqian).
// A track is chosen only by music_id on the page that listed it. Binding calls
// setDouyinMusicInfo once and reports success only when that same id is read back.
const { M } = require('./common.cjs');

// Hang guards, not measured editor limits. A timed-out write is not sent again.
const MUSIC_LIST_TIMEOUT_MS = 20000;
const MUSIC_APPLY_TIMEOUT_MS = 180000;

function withTimeout(work, what, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Error(`MUSIC_TIMEOUT: ${what}`)), ms);
  });
  return Promise.race([Promise.resolve(work).finally(() => clearTimeout(timer)), timeout]);
}

function limitMs(lib, fallback) {
  return typeof lib.musicTimeoutMs === 'number' ? lib.musicTimeoutMs : fallback;
}

function startAt(list, cursor) {
  if (cursor === undefined || cursor === null) return;
  if (!list || !list.cursorInfo || typeof list.cursorInfo.next !== 'function') {
    throw Error('MUSIC_CURSOR_UNAVAILABLE: this list model cannot resume a page; the first page was not fetched instead');
  }
  list.cursorInfo.next({ cursor, count: list.pageSize, hasMore: true });
}

function paging(list) {
  if (!list || !list.cursorInfo || typeof list.cursorInfo.getValue !== 'function') {
    return { next_cursor: null, has_more: null, paging: 'unread' };
  }
  const value = list.cursorInfo.getValue() || {};
  return {
    next_cursor: value.cursor ?? null,
    has_more: typeof value.hasMore === 'boolean' ? value.hasMore : null,
    paging: 'cursor',
  };
}

function rowsOf(value, what) {
  if (!Array.isArray(value)) throw Error(`MUSIC_PAGE_INVALID: ${what} result was not an array`);
  return value;
}

function trackView(item, locator) {
  const musicId = String(item.id);
  return {
    music_id: musicId,
    title: typeof item.title === 'string' ? item.title : '',
    author: typeof item.author === 'string' ? item.author : '',
    duration_sec: typeof item.duration === 'number' ? item.duration : null,
    cover_url: Array.isArray(item.cover) ? item.cover[0] ?? null : null,
    preview_url: Array.isArray(item.fileUrl) ? item.fileUrl[0] ?? null : null,
    has_copyright: item.hasCopyright === true || item.hasCopyright === false ? item.hasCopyright : null,
    binding: 'douyin_library',
    selection: {
      music_id: musicId,
      source: locator.source,
      category_code: locator.category_code,
      query: locator.query,
      page_cursor: locator.page_cursor,
    },
  };
}

function pageBody(rawRows, list, locator) {
  const usable = rawRows.filter((item) => item && item.id != null && item.id !== '');
  return {
    ...locator,
    ...paging(list),
    omitted_without_id: rawRows.length - usable.length,
    items: usable.map((item) => trackView(item, locator)),
  };
}

function locatorOf({ source, categoryCode, query, pageCursor }) {
  return {
    source,
    category_code: categoryCode,
    query,
    page_cursor: pageCursor ?? null,
  };
}

async function loadCategory(lib, categoryCode, pageCursor) {
  const categories = new (lib.mod(M.musicCategory).MusicCategoryModel)();
  const list = new (lib.mod(M.musicList).MusicListModel)(categories);
  list.requestTimestamp = String(Date.now());
  categories.setSelectedCategory({ codeCategory: categoryCode });
  startAt(list, pageCursor);
  const rows = rowsOf(await withTimeout(list.getNextMusicListForDouyin(), 'list', limitMs(lib, MUSIC_LIST_TIMEOUT_MS)), 'list');
  return { rows, list };
}

async function loadSearch(lib, query, pageCursor) {
  const list = new (lib.mod(M.musicList).MusicListModel)(new (lib.mod(M.musicCategory).MusicCategoryModel)());
  list.requestTimestamp = String(Date.now());
  startAt(list, pageCursor);
  const rows = rowsOf(
    await withTimeout(list.getNextSearchMusicListForDouyin(query), 'search', limitMs(lib, MUSIC_LIST_TIMEOUT_MS)),
    'search',
  );
  return { rows, list };
}

function exactTrack(rows, musicId) {
  const hits = rows.filter((item) => item && String(item.id) === String(musicId));
  if (hits.length === 0) throw Error(`MUSIC_NOT_ON_PAGE: ${musicId} is not on the requested library page`);
  if (hits.length > 1) throw Error(`AMBIGUOUS_MUSIC: ${musicId} appears ${hits.length} times on the requested page`);
  return hits[0];
}

function clipRange(item, startSec, endSec) {
  const start = startSec === undefined ? 0 : startSec;
  const end = endSec === undefined ? item.duration : endSec;
  if (typeof start !== 'number' || typeof end !== 'number' || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || !(end > start)) {
    throw Error(`INVALID_RANGE: start ${start}, end ${end}`);
  }
  return { start, end };
}

function assertSafeMusicId(musicId) {
  if (!/^[A-Za-z0-9_-]+$/.test(musicId)) throw Error('INVALID_MUSIC: music_id is not a single path segment');
}

function activeProjectPath(lib) {
  let project = null;
  try {
    const pm = lib.mod(M.ef).ProjectManager.getInstance();
    if (pm && typeof pm.getCurrentActiveProject === 'function') project = pm.getCurrentActiveProject();
  } catch (e) {
    throw Error(`PROJECT_PATH_UNREADABLE: ${e.message}; setDouyinMusicInfo was not called`);
  }
  const projectPath = project && typeof project.path === 'string' ? project.path : '';
  if (!projectPath) throw Error('PROJECT_PATH_UNREADABLE: the active project path cannot be read; setDouyinMusicInfo was not called');
  return projectPath;
}

// 9.8.3 writes the chosen track under Assets/NoImportAsset/<music id>/ at apply
// time. getDouyinMusicInfo does not exist. getLocalMusicList and
// getLocalMusicResourceItem are not the bound track. effect.dyehpj soundID and
// the saved scene object appear only after a later official save; this function
// does not save.
function readMusicAsset(projectPath, musicId, item) {
  const relative = `Assets/NoImportAsset/${musicId}/MusicInfo.json`;
  const infoPath = path.join(projectPath, 'Assets', 'NoImportAsset', musicId, 'MusicInfo.json');
  if (!fs.existsSync(infoPath)) return { missing: true, relative };
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(infoPath, 'utf8'));
  } catch {
    return { unreadable: true, relative };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { unreadable: true, relative };
  const title = typeof parsed.title === 'string' ? parsed.title : '';
  const expected = typeof item.title === 'string' ? item.title : '';
  if (title && expected && title !== expected) return { mismatch: true, title, relative };
  return {
    relative,
    title,
    author: typeof parsed.author === 'string' ? parsed.author : '',
  };
}

const methods = {
  async musicCategories() {
    this.ensureCompatible('music');
    const rows = rowsOf(
      await withTimeout(new (this.mod(M.musicCategory).MusicCategoryModel)().updateCategoryList(), 'categories', limitMs(this, MUSIC_LIST_TIMEOUT_MS)),
      'categories',
    );
    const categories = [];
    let omitted = 0;
    for (const row of rows) {
      const categoryCode = row && typeof row.codeCategory === 'string' ? row.codeCategory.trim() : '';
      if (!categoryCode) {
        omitted += 1;
        continue;
      }
      categories.push({ category_code: categoryCode, name: typeof row.name === 'string' ? row.name : '' });
    }
    return { categories, omitted_without_code: omitted };
  },

  async musicList({ category_code, page_cursor } = {}) {
    this.ensureCompatible('music');
    if (typeof category_code !== 'string' || !category_code.trim()) throw Error('INVALID_CATEGORY: pass category_code from music_categories');
    const categoryCode = category_code.trim();
    const { rows, list } = await loadCategory(this, categoryCode, page_cursor);
    return pageBody(rows, list, locatorOf({ source: 'category', categoryCode, query: null, pageCursor: page_cursor }));
  },

  async musicSearch({ query, page_cursor } = {}) {
    this.ensureCompatible('music');
    if (typeof query !== 'string' || !query.trim()) throw Error('INVALID_QUERY: query must be a non-empty string');
    const text = query.trim();
    const { rows, list } = await loadSearch(this, text, page_cursor);
    return pageBody(rows, list, locatorOf({ source: 'search', categoryCode: null, query: text, pageCursor: page_cursor }));
  },

  async musicApply({ music_id, source, category_code, query, page_cursor, start_sec, end_sec } = {}) {
    this.ensureCompatible('music');
    if (typeof music_id !== 'string' || !music_id.trim()) throw Error('INVALID_MUSIC: pass music_id from music_list or music_search');
    const musicId = music_id.trim();
    assertSafeMusicId(musicId);
    let loaded;
    let categoryCode = null;
    let searchQuery = null;
    if (source === 'category') {
      if (typeof category_code !== 'string' || !category_code.trim()) throw Error('INVALID_CATEGORY: pass category_code from the track selection');
      categoryCode = category_code.trim();
      loaded = await loadCategory(this, categoryCode, page_cursor);
    } else if (source === 'search') {
      if (typeof query !== 'string' || !query.trim()) throw Error('INVALID_QUERY: pass query from the track selection');
      searchQuery = query.trim();
      loaded = await loadSearch(this, searchQuery, page_cursor);
    } else {
      throw Error('INVALID_MUSIC: source must be category or search');
    }
    const item = exactTrack(loaded.rows, musicId);
    const { start, end } = clipRange(item, start_sec, end_sec);
    let active = false;
    try {
      active = this.mod(M.ef).ProjectManager.getInstance().hasActiveProject() === true;
    } catch (e) {
      throw Error(`NO_ACTIVE_PROJECT: ${e.message}`);
    }
    if (!active) throw Error('NO_ACTIVE_PROJECT: refusing to bind music without an active project');
    const projectPath = activeProjectPath(this);
    const manager = this.mod(M.musicSquare).MusicSquareManager.instance;
    // Search has no category. Upstream omits that argument. Passing null is a
    // different call and is not used.
    const categoryArg = categoryCode || undefined;
    let returned;
    try {
      returned = await withTimeout(
        manager.setDouyinMusicInfo({ ...item, startTime: start, endTime: end }, categoryArg),
        'apply',
        limitMs(this, MUSIC_APPLY_TIMEOUT_MS),
      );
    } catch (e) {
      throw Error(`MUSIC_APPLY_UNCONFIRMED: ${e.message}; setDouyinMusicInfo was not retried`);
    }
    if (returned === false || returned == null) {
      throw Error(`MUSIC_APPLY_FAILED: ${musicId}; setDouyinMusicInfo rejected the track; not retried`);
    }
    const asset = readMusicAsset(projectPath, musicId, item);
    if (asset.mismatch) {
      throw Error(`MUSIC_APPLY_MISMATCH: requested ${musicId}, MusicInfo title ${asset.title}; not saved; not retried`);
    }
    if (asset.missing || asset.unreadable) {
      const returnedLabel = returned === true ? 'true' : typeof returned;
      throw Error(
        `MUSIC_APPLY_UNCONFIRMED: ${musicId}; setDouyinMusicInfo returned ${returnedLabel}; ${asset.relative} was not found; not saved; not retried`,
      );
    }
    return {
      confirmed: true,
      saved: false,
      binding: 'douyin_library',
      local_import: false,
      music_id: musicId,
      title: asset.title || (typeof item.title === 'string' ? item.title : ''),
      author: asset.author || (typeof item.author === 'string' ? item.author : ''),
      start_sec: start,
      end_sec: end,
      category_code: categoryCode,
      query: searchQuery,
      readback: {
        music_id: musicId,
        title: asset.title,
        author: asset.author,
        asset: asset.relative,
        start_sec: start,
        end_sec: end,
        binding: 'douyin_library',
        scene_saved: false,
      },
      apply_calls: 1,
    };
  },
};

const METHODS = {
  music_categories: 'musicCategories',
  music_list: 'musicList',
  music_search: 'musicSearch',
  music_apply: 'musicApply',
};

module.exports = { methods, METHODS, MUSIC_LIST_TIMEOUT_MS, MUSIC_APPLY_TIMEOUT_MS };
