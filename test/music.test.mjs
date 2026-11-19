import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { tmpdir } from '../support/tmp.mjs';

const require = createRequire(import.meta.url);
const { Library } = require('../editor-plugin/library.cjs');
const { M } = require('../editor-plugin/features/common.cjs');

function track(id, extra = {}) {
  return {
    id,
    title: extra.title ?? `Track ${id}`,
    author: extra.author ?? 'Artist',
    duration: extra.duration === undefined ? 30 : extra.duration,
    cover: ['https://example.invalid/cover'],
    fileUrl: ['https://example.invalid/preview'],
    hasCopyright: extra.hasCopyright === undefined ? true : extra.hasCopyright,
    secret: 'do-not-leave-the-plugin',
  };
}

function writeMusicAsset(projectPath, info) {
  const dir = path.join(projectPath, 'Assets', 'NoImportAsset', String(info.id));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'MusicInfo.json'),
    JSON.stringify({ title: info.title, author: info.author, duration: info.duration }),
  );
}

function musicEditor(overrides = {}) {
  const calls = [];
  const projectPath = overrides.projectPath ?? tmpdir('xs-music-proj-');
  const listState = {
    pages: overrides.pages ?? [track('m1'), track('m2', { title: 'Other', hasCopyright: false })],
    searchPages: overrides.searchPages ?? [track('s1', { title: 'Searched' })],
    cursorWrites: [],
  };
  class MusicCategoryModel {
    updateCategoryList() {
      calls.push('categories');
      if (overrides.hang === 'categories') return new Promise(() => {});
      return overrides.categories ?? [
        { codeCategory: 'rec', name: '推荐' },
        { name: 'missing code' },
        null,
      ];
    }

    setSelectedCategory(category) {
      calls.push(['category', category]);
    }
  }
  class MusicListModel {
    constructor() {
      this.pageSize = 35;
      this.requestTimestamp = null;
      if (!overrides.omitCursor) {
        this.cursorInfo = {
          next: (value) => {
            listState.cursorWrites.push(value);
            this.cursorValue = value;
          },
          getValue: () => this.cursorValue ?? { cursor: null, hasMore: false },
        };
      }
    }

    getNextMusicListForDouyin() {
      calls.push(['list', this.requestTimestamp, listState.cursorWrites.slice()]);
      if (overrides.hang === 'list') return new Promise(() => {});
      if (overrides.badPage) return { not: 'an array' };
      this.cursorInfo?.next({ cursor: 'next-page', hasMore: true });
      return listState.pages;
    }

    getNextSearchMusicListForDouyin(query) {
      calls.push(['search', query]);
      if (overrides.hang === 'search') return new Promise(() => {});
      this.cursorInfo?.next({ cursor: 9, hasMore: false });
      return listState.searchPages;
    }
  }
  const square = {
    setDouyinMusicInfo: async (info, categoryCode) => {
      calls.push(['set', info && info.id, categoryCode, info && info.startTime, info && info.endTime]);
      if (overrides.applyThrows) throw Error('socket hang up');
      const result = overrides.applyReturns !== undefined ? overrides.applyReturns : true;
      if (overrides.writeAsset !== false && result !== false && result != null && info && info.id != null) {
        writeMusicAsset(projectPath, { ...info, title: overrides.assetTitle ?? info.title });
      }
      if (result !== false && result != null) square.bound = { ...info };
      return result;
    },
    getDouyinMusicInfo: () => {
      calls.push('missing-reader');
      throw Error('getDouyinMusicInfo is not on 9.8.3');
    },
    getLocalMusicList: () => {
      calls.push('local-list');
      return [];
    },
    getLocalMusicResourceItem: () => {
      calls.push('local-item');
      return null;
    },
    showMusicAsset: () => calls.push('show-panel'),
    importLocalAudio: async () => calls.push('import-local'),
  };
  const registry = {
    [M.musicCategory]: { MusicCategoryModel },
    [M.musicList]: { MusicListModel },
    [M.musicSquare]: { MusicSquareManager: { instance: square } },
    [M.ef]: {
      ProjectManager: {
        getInstance: () => ({
          hasActiveProject: () => overrides.active !== false,
          getCurrentActiveProject: () => (overrides.active === false ? null : { path: projectPath }),
        }),
      },
    },
  };
  if (overrides.drop) delete registry[overrides.drop];
  const lib = new Library((name) => {
    if (!Object.prototype.hasOwnProperty.call(registry, name)) throw Error(`MODULE_NOT_FOUND: ${name}`);
    return registry[name];
  });
  if (overrides.timeoutMs != null) lib.musicTimeoutMs = overrides.timeoutMs;
  return { lib, calls, square, projectPath };
}

test('music categories return stable codes and a missing music module does not fail project', async () => {
  const ready = musicEditor();
  const page = await ready.lib.musicCategories();
  assert.deepEqual(page.categories, [{ category_code: 'rec', name: '推荐' }]);
  assert.equal(page.omitted_without_code, 2);
  assert.equal(ready.lib.selfCheck('music').features.music, true);
  assert.equal(ready.lib.selfCheck().features.project, false);
  assert.equal(ready.lib.selfCheck().ok, false);

  const missing = musicEditor({ drop: M.musicList });
  assert.equal(missing.lib.selfCheck().features.music, false);
  assert.equal(missing.lib.selfCheck('project').features.music, undefined);
  await assert.rejects(missing.lib.musicSearch({ query: 'song' }), /INCOMPATIBLE_EDITOR/);
  assert.equal(missing.calls.includes('categories'), false);
  assert.equal(missing.calls.some((call) => Array.isArray(call) && call[0] === 'search'), false);
});

test('music list and search return a reusable selection and do not leak the raw track', async () => {
  const { lib, calls } = musicEditor();
  const listed = await lib.musicList({ category_code: 'rec', page_cursor: 4 });
  assert.equal(listed.category_code, 'rec');
  assert.equal(listed.page_cursor, 4);
  assert.equal(listed.next_cursor, 'next-page');
  assert.equal(listed.has_more, true);
  assert.equal(listed.items.length, 2);
  assert.deepEqual(listed.items[0].selection, {
    music_id: 'm1',
    source: 'category',
    category_code: 'rec',
    query: null,
    page_cursor: 4,
  });
  assert.equal(listed.items[0].binding, 'douyin_library');
  assert.equal(listed.items[0].has_copyright, true);
  assert.equal(listed.items[1].has_copyright, false);
  assert.equal(listed.items[0].preview_url, 'https://example.invalid/preview');
  assert.equal(JSON.stringify(listed).includes('do-not-leave-the-plugin'), false);
  assert.equal(Object.hasOwn(listed, 'raw'), false);
  assert.deepEqual(calls.find((call) => Array.isArray(call) && call[0] === 'category')[1], { codeCategory: 'rec' });

  const searched = await lib.musicSearch({ query: '  night  ' });
  assert.equal(searched.query, 'night');
  assert.equal(searched.page_cursor, null);
  assert.equal(searched.items[0].selection.source, 'search');
  assert.equal(searched.items[0].selection.query, 'night');
  assert.equal(searched.items[0].music_id, 's1');
  assert.equal(calls.some((call) => Array.isArray(call) && call[0] === 'search' && call[1] === 'night'), true);
});

test('list and search refuse a bad request before calling the library', async () => {
  const listed = musicEditor();
  await assert.rejects(listed.lib.musicList({}), /INVALID_CATEGORY/);
  await assert.rejects(listed.lib.musicSearch({ query: '   ' }), /INVALID_QUERY/);
  const unpaged = musicEditor({ omitCursor: true });
  await assert.rejects(unpaged.lib.musicList({ category_code: 'rec', page_cursor: 2 }), /MUSIC_CURSOR_UNAVAILABLE/);
  assert.equal(unpaged.calls.some((call) => Array.isArray(call) && call[0] === 'list'), false);
  const bad = musicEditor({ badPage: true });
  await assert.rejects(bad.lib.musicList({ category_code: 'rec' }), /MUSIC_PAGE_INVALID/);
});

test('a hanging music request fails once and does not pretend the page was empty', async () => {
  const { lib } = musicEditor({ hang: 'categories', timeoutMs: 20 });
  await assert.rejects(lib.musicCategories(), /MUSIC_TIMEOUT: categories/);
});

test('music_apply binds the exact library id, reads it back, and does not import a local file', async () => {
  const { lib, calls, square } = musicEditor();
  const bound = await lib.musicApply({
    music_id: 'm1',
    source: 'category',
    category_code: 'rec',
    page_cursor: null,
    item: { id: 'evil', title: 'Not this', duration: 10 },
    start_sec: 1,
    end_sec: 8,
  });
  assert.equal(bound.confirmed, true);
  assert.equal(bound.binding, 'douyin_library');
  assert.equal(bound.local_import, false);
  assert.equal(bound.music_id, 'm1');
  assert.equal(bound.readback.music_id, 'm1');
  assert.equal(bound.readback.start_sec, 1);
  assert.equal(bound.readback.end_sec, 8);
  assert.equal(bound.apply_calls, 1);
  assert.deepEqual(calls.filter((call) => Array.isArray(call) && call[0] === 'set'), [['set', 'm1', 'rec', 1, 8]]);
  assert.equal(calls.includes('import-local'), false);
  assert.equal(square.bound.id, 'm1');
  assert.equal(JSON.stringify(bound).includes('do-not-leave-the-plugin'), false);
});

test('music_apply refuses a title lookalike, a missing id, and a bad range without writing', async () => {
  const lookalike = musicEditor({ pages: [track('m1', { title: 'Same' }), track('m2', { title: 'Same' })] });
  await assert.rejects(lookalike.lib.musicApply({ music_id: 'm9', source: 'category', category_code: 'rec' }), /MUSIC_NOT_ON_PAGE/);
  await assert.rejects(lookalike.lib.musicApply({ music_id: 'm1', source: 'search', query: 'Same' }), /MUSIC_NOT_ON_PAGE/);
  const duplicate = musicEditor({ pages: [track('m1'), track('m1')] });
  await assert.rejects(duplicate.lib.musicApply({ music_id: 'm1', source: 'category', category_code: 'rec' }), /AMBIGUOUS_MUSIC/);
  const range = musicEditor();
  await assert.rejects(range.lib.musicApply({ music_id: 'm1', source: 'category', category_code: 'rec', start_sec: 20, end_sec: 10 }), /INVALID_RANGE/);
  const noDuration = musicEditor({ pages: [track('m1', { duration: null })] });
  await assert.rejects(noDuration.lib.musicApply({ music_id: 'm1', source: 'category', category_code: 'rec' }), /INVALID_RANGE/);
  for (const fixture of [lookalike, duplicate, range, noDuration]) {
    assert.equal(fixture.calls.some((call) => Array.isArray(call) && call[0] === 'set'), false);
    assert.equal(fixture.calls.includes('import-local'), false);
  }
});

test('an unconfirmed or failed bind is not written again', async () => {
  const unread = musicEditor({ applyReturns: true, writeAsset: false });
  await assert.rejects(
    unread.lib.musicApply({ music_id: 'm1', source: 'category', category_code: 'rec' }),
    /MUSIC_APPLY_UNCONFIRMED[\s\S]*MusicInfo\.json was not found[\s\S]*not saved[\s\S]*not retried/,
  );
  assert.equal(unread.calls.includes('local-list'), false);
  assert.equal(unread.calls.includes('missing-reader'), false);
  assert.equal(unread.calls.filter((call) => Array.isArray(call) && call[0] === 'set').length, 1);

  const rejected = musicEditor({ applyReturns: false });
  await assert.rejects(rejected.lib.musicApply({ music_id: 'm1', source: 'category', category_code: 'rec' }), /MUSIC_APPLY_FAILED[\s\S]*not retried/);
  assert.equal(rejected.calls.filter((call) => Array.isArray(call) && call[0] === 'set').length, 1);

  const dropped = musicEditor({ applyThrows: true, timeoutMs: 50 });
  await assert.rejects(dropped.lib.musicApply({ music_id: 'm1', source: 'category', category_code: 'rec' }), /MUSIC_APPLY_UNCONFIRMED[\s\S]*not retried/);
  assert.equal(dropped.calls.filter((call) => Array.isArray(call) && call[0] === 'set').length, 1);

  const swapped = musicEditor({ assetTitle: 'Other title' });
  await assert.rejects(swapped.lib.musicApply({ music_id: 'm1', source: 'category', category_code: 'rec' }), /MUSIC_APPLY_MISMATCH[\s\S]*not saved[\s\S]*not retried/);
  assert.equal(swapped.calls.filter((call) => Array.isArray(call) && call[0] === 'set').length, 1);
});

test('a true set is confirmed from NoImportAsset even when the local music readers are empty', async () => {
  const { lib, calls, projectPath } = musicEditor({ omitReader: true, applyReturns: true, writeAsset: true });
  const bound = await lib.musicApply({ music_id: 'm1', source: 'category', category_code: 'rec' });
  assert.equal(bound.confirmed, true);
  assert.equal(bound.saved, false);
  assert.equal(bound.readback.music_id, 'm1');
  assert.equal(bound.readback.asset, 'Assets/NoImportAsset/m1/MusicInfo.json');
  assert.equal(fs.existsSync(path.join(projectPath, 'Assets', 'NoImportAsset', 'm1', 'MusicInfo.json')), true);
  assert.equal(calls.includes('local-list'), false);
  assert.equal(calls.includes('local-item'), false);
  assert.equal(calls.includes('missing-reader'), false);
  assert.equal(calls.includes('show-panel'), false);
  assert.equal(calls.filter((call) => Array.isArray(call) && call[0] === 'set').length, 1);
  assert.equal(JSON.stringify(bound).includes('effect.dyehpj'), false);
});

test('music_apply can confirm from the object setDouyinMusicInfo returns', async () => {
  const { lib, calls } = musicEditor({
    omitReader: true,
    applyReturns: { id: 's1', title: 'Searched', startTime: 0, endTime: 12 },
    searchPages: [track('s1', { duration: 12 })],
  });
  const bound = await lib.musicApply({ music_id: 's1', source: 'search', query: 'night', end_sec: 12 });
  assert.equal(bound.confirmed, true);
  assert.equal(bound.readback.music_id, 's1');
  assert.equal(bound.category_code, null);
  assert.equal(bound.query, 'night');
  assert.deepEqual(calls.filter((call) => Array.isArray(call) && call[0] === 'set'), [['set', 's1', undefined, 0, 12]]);
});

test('music_apply does not bind when the window has no active project', async () => {
  const { lib, calls } = musicEditor({ active: false });
  await assert.rejects(lib.musicApply({ music_id: 'm1', source: 'category', category_code: 'rec' }), /NO_ACTIVE_PROJECT/);
  assert.equal(calls.some((call) => Array.isArray(call) && call[0] === 'set'), false);
});

async function waitUntil(fn) {
  const deadline = Date.now() + 2000;
  while (!fn()) {
    if (Date.now() >= deadline) throw Error('timed out waiting for music_apply RPC');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test('music_apply RPC on one window does not overlap', async () => {
  process.env.XIANGSU_MCP_PLUS_STATE = tmpdir('xs-music-rt-');
  const { Runtime } = require('../editor-plugin/runtime.cjs');
  const rt = new Runtime();
  const port = await rt.start();
  let current = 0;
  let max = 0;
  let ended = 0;
  let release = () => {};
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  rt.server.on('request', (req) => req.on('end', () => { ended += 1; }));
  rt.library.musicApply = async () => {
    current += 1;
    max = Math.max(max, current);
    await gate;
    current -= 1;
    return { confirmed: true };
  };
  const call = () =>
    fetch(`http://127.0.0.1:${port}/rpc`, {
      method: 'POST',
      headers: { authorization: `Bearer ${rt.token}`, 'content-type': 'application/json', connection: 'close' },
      body: JSON.stringify({ method: 'music_apply', params: { music_id: 'm1' } }),
    });
  const first = call();
  const second = call();
  try {
    await waitUntil(() => ended >= 2 && current >= 1);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(current, 1);
    assert.equal(max, 1);
    release();
    const bodies = await Promise.all([first, second]);
    assert.equal((await bodies[0].json()).ok, true);
    assert.equal((await bodies[1].json()).ok, true);
    assert.equal(max, 1);
  } finally {
    release();
    await Promise.allSettled([first, second]);
    rt.stop();
  }
});
