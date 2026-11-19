// icon_set / icon_open for one already-open project window.
// Image bytes are prepared locally. The editor plugin writes and uploads.
// A sent call that times out or drops is not sent again. This does not submit an effect.
import { discardPreparedIcon, prepareIcon } from './icon-image.mjs';

function notRetried(message, verb) {
  return message.includes('was not retried') || message.includes('was not called') ? message : `${message}; ${verb} was not retried`;
}

export async function targetIconWindow(projects, args, verb) {
  const projectPath = await projects.resolveProjectPath(args);
  const windows = await projects.windows();
  const hits = projectPath ? windows.filter((window) => window.project_path && projects.same(window.project_path, projectPath)) : windows;
  if (hits.length !== 1) {
    throw Error(
      projectPath
        ? `NO_UNIQUE_WINDOW for ${projectPath}: ${hits.length} matches; ${verb} was not called`
        : `AMBIGUOUS_INSTANCE: ${windows.length} windows; pass project_path or instance_id; ${verb} was not called`,
    );
  }
  const hit = hits[0];
  if (!hit.project_path) throw Error(`PROJECT_PATH_UNREADABLE: refusing pid ${hit.pid}; ${verb} was not called`);
  projects.assertMutable(hit.project_path);
  let officialList;
  try {
    officialList = await projects.officialInstances();
  } catch (error) {
    throw Error(`OFFICIAL_INSTANCE_UNCONFIRMED: ${error.message}; ${verb} was not called`);
  }
  const official = officialList.find((instance) => instance.pid === hit.pid);
  if (!official?.project_path || !projects.same(official.project_path, hit.project_path)) {
    throw Error(`OFFICIAL_INSTANCE_UNCONFIRMED: refusing pid ${hit.pid}; plugin path ${hit.project_path}, official path ${official?.project_path ?? 'missing'}; ${verb} was not called`);
  }
  let state;
  try {
    state = await projects.d.callPlugin('project_state', {}, { pid: hit.pid, timeoutMs: 5000 });
  } catch (error) {
    throw Error(`ICON_WINDOW_MISMATCH: cannot read project_state for pid ${hit.pid} (${error.message}); ${verb} was not called`);
  }
  if (!state?.project_path || !projects.same(state.project_path, hit.project_path)) {
    throw Error(`ICON_WINDOW_MISMATCH: project_state path ${state?.project_path ?? 'missing'} does not match ${hit.project_path}; ${verb} was not called`);
  }
  return hit;
}

export async function setIcon(d, projects, args) {
  const { image_path, type } = args;
  const hit = await targetIconWindow(projects, args, 'icon_set');
  const prepare = d.prepareIcon ?? prepareIcon;
  let prepared;
  try {
    prepared = await prepare(image_path);
    let result;
    try {
      result = await d.callPlugin(
        'icon_set',
        {
          png_path: prepared.png,
          types: type && type !== 'both' ? [type] : ['female', 'male'],
          expected_project_path: hit.project_path,
        },
        { pid: hit.pid },
      );
    } catch (error) {
      throw Error(notRetried(error.message, 'icon_set'));
    }
    if (!result || result.uploaded !== true) {
      throw Error(`ICON_UPLOAD_UNCONFIRMED: plugin result did not report uploaded true; icon_set was not retried`);
    }
    if (!result.project_path || !projects.same(result.project_path, hit.project_path)) {
      throw Error(`ICON_WINDOW_MISMATCH: result path ${result?.project_path ?? 'missing'} does not match ${hit.project_path}; icon_set was not retried`);
    }
    return {
      ...result,
      pid: hit.pid,
      calls: 1,
      prepared: {
        width: prepared.output?.width ?? null,
        height: prepared.output?.height ?? null,
        crop: prepared.crop ?? null,
        input: prepared.input ?? null,
      },
    };
  } finally {
    discardPreparedIcon(prepared);
  }
}

export async function openIcon(d, projects, args) {
  const hit = await targetIconWindow(projects, args, 'icon_open');
  try {
    const result = await d.callPlugin('icon_open', { expected_project_path: hit.project_path }, { pid: hit.pid });
    return { ...result, pid: hit.pid, project_path: hit.project_path, calls: 1 };
  } catch (error) {
    throw Error(notRetried(error.message, 'icon_open'));
  }
}
