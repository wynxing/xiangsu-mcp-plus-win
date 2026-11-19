// Douyin music-library tools. Search is read-only. Binding re-checks the target
// window with the same allow and deny rules as project open/close, then asks the
// plugin once. A lost write is not sent again.
import { z } from 'zod';
import { COLD_START } from './projects.mjs';

const LIST_TIMEOUT_MS = 25000;
const APPLY_TIMEOUT_MS = 185000;

const target = {
  project_path: z.string().min(1).optional().describe('Absolute path of the target project. Pass this or instance_id. Required when more than one project window is open.'),
  instance_id: z.union([z.string(), z.number()]).optional().describe('instance_id from the official list_instances.'),
};

const pageCursor = z.union([z.string().min(1), z.number().finite()]).optional().describe('page_cursor from the previous page. Omit it for the first page. This is not next_cursor.');

function compact(fields) {
  const out = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

async function targetWindow(projects, args, { write }) {
  const projectPath = await projects.resolveProjectPath(args);
  const windows = await projects.windows();
  if (!windows.length) throw Error(`NO_EDITOR_WINDOW: ${COLD_START.detail} (${COLD_START.code})`);
  const hits = projectPath ? windows.filter((window) => window.project_path && projects.same(window.project_path, projectPath)) : windows;
  if (hits.length !== 1) {
    throw Error(projectPath ? `NO_UNIQUE_WINDOW for ${projectPath}: ${hits.length} matches` : `AMBIGUOUS_INSTANCE: ${windows.length} windows; pass project_path or instance_id`);
  }
  const hit = hits[0];
  if (!write) return hit;
  if (!hit.project_path) throw Error(`PROJECT_PATH_UNREADABLE: refusing to bind music on pid ${hit.pid}; music_apply was not called`);
  let instances;
  try {
    instances = await projects.officialInstances();
  } catch (e) {
    throw Error(`OFFICIAL_INSTANCE_UNCONFIRMED: ${e.message}; music_apply was not called`);
  }
  const official = instances.find((instance) => instance.pid === hit.pid);
  if (!official?.project_path || !projects.same(hit.project_path, official.project_path)) {
    throw Error(`OFFICIAL_INSTANCE_UNCONFIRMED: refusing to bind music on pid ${hit.pid}; plugin path ${hit.project_path}, official path ${official?.project_path ?? 'missing'}; music_apply was not called`);
  }
  projects.assertMutable(hit.project_path);
  const again = (await projects.windows()).find((window) => window.pid === hit.pid);
  if (!again?.project_path || !projects.same(again.project_path, hit.project_path)) {
    throw Error(`WINDOW_CHANGED: pid ${hit.pid} no longer shows ${hit.project_path}; music_apply was not called`);
  }
  return again;
}

export async function callMusic(projects, method, params, args, { write, timeoutMs }) {
  const hit = await targetWindow(projects, args, { write });
  if (!write) return projects.d.callPlugin(method, params, { pid: hit.pid, timeoutMs });
  return projects.locks.run(hit.pid, async () => {
    let current;
    try {
      current = await projects.d.callPlugin('status', {}, { pid: hit.pid, timeoutMs: 5000 });
    } catch (e) {
      throw Error(`WINDOW_UNCONFIRMED: ${e.message}; music_apply was not called`);
    }
    if (!current?.projectPath || !projects.same(current.projectPath, hit.project_path)) {
      throw Error(`WINDOW_CHANGED: pid ${hit.pid} no longer shows ${hit.project_path}; music_apply was not called`);
    }
    try {
      return await projects.d.callPlugin(method, params, { pid: hit.pid, timeoutMs });
    } catch (e) {
      const message = String(e.message || e);
      if (message.includes('not retried')) throw e;
      throw Error(`${message}; music_apply was not retried`);
    }
  });
}

function browse(method, timeoutMs) {
  return async (args, _d, projects) =>
    callMusic(projects, method, compact({ category_code: args.category_code, query: args.query, page_cursor: args.page_cursor }), args, {
      write: false,
      timeoutMs,
    });
}

function selection(args) {
  if (args.source === 'category' && !args.category_code) throw Error('INVALID_CATEGORY: pass category_code from the track selection');
  if (args.source === 'search' && !args.query) throw Error('INVALID_QUERY: pass query from the track selection');
  if (args.source === 'category' && args.query) throw Error('INVALID_MUSIC: category binding does not take a search query');
  if (args.source === 'search' && args.category_code) throw Error('INVALID_MUSIC: search binding does not take a category_code');
  return compact({
    music_id: args.music_id,
    source: args.source,
    category_code: args.category_code,
    query: args.query,
    page_cursor: args.page_cursor,
    start_sec: args.start_sec,
    end_sec: args.end_sec,
  });
}

export function musicToolDefinitions() {
  return [
    {
      name: 'music_categories',
      description:
        'List Douyin music-library categories in one project window. Each category has category_code and name. ' +
        'Pass category_code to music_list. Requires features.music in that window. A missing music module fails this tool and does not fail project tools. ' +
        'Editor acceptance of these module paths is still unverified.',
      readOnly: true,
      schema: z.strictObject({ ...target }),
      run: browse('music_categories', LIST_TIMEOUT_MS),
    },
    {
      name: 'music_list',
      description:
        'One page of a Douyin music-library category. Each item has music_id, title, author, duration_sec, cover_url, preview_url, has_copyright, binding douyin_library, and selection. ' +
        'Pass selection back to music_apply. page_cursor repeats this page; next_cursor asks for the following page. No title fallback.',
      readOnly: true,
      schema: z.strictObject({
        ...target,
        category_code: z.string().min(1).describe('category_code from music_categories.'),
        page_cursor: pageCursor,
      }),
      run: browse('music_list', LIST_TIMEOUT_MS),
    },
    {
      name: 'music_search',
      description:
        'Search the Douyin music library by keyword, one page. Items use the same music_id and selection fields as music_list. ' +
        'page_cursor repeats this page; next_cursor asks for the following page. has_copyright false is returned, not hidden.',
      readOnly: true,
      schema: z.strictObject({
        ...target,
        query: z.string().min(1).describe('Search text. Leading and trailing spaces are ignored by the plugin.'),
        page_cursor: pageCursor,
      }),
      run: browse('music_search', LIST_TIMEOUT_MS),
    },
    {
      name: 'music_apply',
      description:
        'Bind one Douyin library track onto the open effect with setDouyinMusicInfo (the library 使用 path, not a local audio file import). ' +
        'Re-reads the category or search page and binds only an exact music_id from selection. The target window must still show that project, and the path must pass the current allow and deny rules. ' +
        'confirmed is true only when Assets/NoImportAsset/<music_id>/MusicInfo.json is present after that single call. A boolean true with no asset file is not confirmed. getDouyinMusicInfo is not used. This tool does not save the project; effect.dyehpj soundID and the on-disk scene object appear only after a later explicit save. A false result, a title mismatch, a disconnect, or a missing asset file is not retried.',
      schema: z.strictObject({
        ...target,
        music_id: z.string().min(1).describe('music_id from music_list or music_search.'),
        source: z.enum(['category', 'search']).describe('selection.source.'),
        category_code: z.string().min(1).optional().describe('selection.category_code when source is category.'),
        query: z.string().min(1).optional().describe('selection.query when source is search.'),
        page_cursor: pageCursor.describe('selection.page_cursor. Omit it when the track was on the first page.'),
        start_sec: z.number().finite().min(0).optional().describe('Clip start in seconds. Defaults to 0.'),
        end_sec: z.number().finite().positive().optional().describe('Clip end in seconds. Defaults to the track duration.'),
      }),
      run: async (args, _d, projects) => callMusic(projects, 'music_apply', selection(args), args, { write: true, timeoutMs: APPLY_TIMEOUT_MS }),
    },
  ];
}
