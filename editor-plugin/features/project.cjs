'use strict';
// Project windows: ask the home process to open or create a project, and close this window.
// Adapted from Muqian-Sun/xiangsu-mcp-plus editor-plugin/features/project.cjs
// (MIT, Copyright (c) 2026 muqian).
const fs = require('fs');
const path = require('path');
const { M } = require('./common.cjs');

const OPERATIONS = new Set(['createNew', 'openLocal', 'openTemplate']);
const CLOSE_DELAY_MS = 300;

const methods = {
  projectState() {
    const EF = this.mod(M.ef);
    const pm = EF.ProjectManager.getInstance();
    if (!pm.hasActiveProject()) throw Error('UNKNOWN_DIRTY_STATE: no active project; unsaved state cannot be proven clean');
    const project = pm.getCurrentActiveProject();
    let sceneReady = false;
    try {
      const service = this.mod(M.scene).SceneModule.getEditingSceneService();
      sceneReady = !!(service && service.sceneEditor);
    } catch (e) {
      throw Error(`UNKNOWN_DIRTY_STATE: scene module unreadable (${e.message})`);
    }
    if (!project || typeof project.isProjectChanged !== 'function') throw Error('UNKNOWN_DIRTY_STATE: isProjectChanged is unavailable');
    const changed = project.isProjectChanged();
    if (changed !== true && changed !== false) throw Error('UNKNOWN_DIRTY_STATE: isProjectChanged did not return a boolean');
    if (!project.path) throw Error('UNKNOWN_DIRTY_STATE: project path cannot be read');
    return { project_path: project.path, changed, scene_ready: sceneReady };
  },

  async projectLaunch({ operation, path: projectPath }) {
    this.ensureCompatible('project');
    if (!OPERATIONS.has(operation)) throw Error(`INVALID_OPERATION: ${operation}; expected ${[...OPERATIONS].join(', ')}`);
    const withPath = operation !== 'createNew';
    if (withPath) {
      if (typeof projectPath !== 'string' || !path.isAbsolute(projectPath)) throw Error(`INVALID_PATH: ${operation} needs an absolute project folder`);
      if (!fs.existsSync(path.join(projectPath, 'effect.dyehpj'))) throw Error(`NOT_A_PROJECT: ${projectPath} has no effect.dyehpj`);
    }
    const { OpenProjectFromEditCommand } = this.mod(M.ipc);
    const res = await this.mod(M.sender)
      .EditSender.getInstance()
      .sendCmdWithResponse(new OpenProjectFromEditCommand(operation, withPath ? projectPath : undefined, { enter_method: 'xiangsu_mcp_plus_win' }));
    const status = res && res.status;
    if (status === 'succeeded') return { requested: operation, path: withPath ? projectPath : null };
    if (status === 'reuseCurrent') throw Error(`WINDOW_LIMIT: all ${res.processCount} project windows are in use; close one with project_close first`);
    if (status === 'cancelled' && res.reason === 'duplicateProject') throw Error(`PROJECT_ALREADY_OPEN: ${projectPath} is open in another window`);
    if (status === 'cancelled' || status === 'failed') throw Error(`LAUNCH_${String(status).toUpperCase()}: ${JSON.stringify(res)}`);
    throw Error(`UNEXPECTED_LAUNCH_RESPONSE: ${JSON.stringify(res)}`);
  },

  projectClose({ discard_changes = false } = {}) {
    this.ensureCompatible('project');
    const state = this.projectState();
    if (state.changed !== false && !discard_changes) {
      if (state.changed === true) throw Error(`PROJECT_HAS_UNSAVED_CHANGES: ${state.project_path}; save it first or pass discard_changes`);
      throw Error('UNKNOWN_DIRTY_STATE: unsaved state is not proven clean');
    }
    const { Project } = this.mod(M.ef);
    const analytics = this.mod(M.analytics).AnalyticsBusinessPlugin.instance;
    this.schedule(() => {
      return (async () => {
        const again = this.projectState();
        if (again.changed !== false && !discard_changes) {
          throw Error(again.changed === true ? `PROJECT_HAS_UNSAVED_CHANGES: ${again.project_path}; not exiting` : 'UNKNOWN_DIRTY_STATE: not exiting');
        }
        await Project.unload();
        await analytics.flush();
        analytics.safelyExitApplication('no_save_exit');
      })().catch(() => {
        // A failed re-check or unload must leave the process running. Do not exit from this catch.
      });
    }, CLOSE_DELAY_MS);
    return { closing: true, project_path: state.project_path, discarded_changes: state.changed === true && !!discard_changes };
  },
};

const METHODS = { project_state: 'projectState', project_launch: 'projectLaunch', project_close: 'projectClose' };

module.exports = { methods, METHODS, CLOSE_DELAY_MS };
