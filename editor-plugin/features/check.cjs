'use strict';
// Capability probe. Project tools call ensureCompatible('project') and refuse when a
// required internal is missing. Music, icon and quiet-window modules are reported only.
// Required paths for project/music/icon/quietWindows are from
// Muqian-Sun/xiangsu-mcp-plus editor-plugin/features/assets.cjs (MIT, Copyright (c) 2026 muqian).
const { M } = require('./common.cjs');

const REQUIRED = {
  project: [
    [M.ef, 'Project.unload'],
    [M.ef, 'ProjectManager.getInstance'],
    [M.analytics, 'AnalyticsBusinessPlugin.instance.flush'],
    [M.analytics, 'AnalyticsBusinessPlugin.instance.safelyExitApplication'],
    [M.ipc, 'OpenProjectFromEditCommand'],
    [M.sender, 'EditSender.getInstance'],
    [M.scene, 'SceneModule.getEditingSceneService'],
  ],
  quietWindows: [
    [M.ef, 'ProjectManager.getInstance'],
    [M.editWindow, 'EditWindowController.getInstance'],
    ...['show', 'showMinimized', 'requestActive', 'raise', 'bringToTop'].map((prop) => [M.orionui, `Window.prototype.${prop}`]),
    [M.orionui, 'WindowState.Minimized'],
    [M.orionui, 'WindowStyle.ButtonMin'],
    [M.orionui, 'WindowStyle.Borderless'],
  ],
  music: [
    [M.musicCategory, 'MusicCategoryModel.prototype.updateCategoryList'],
    [M.musicCategory, 'MusicCategoryModel.prototype.setSelectedCategory'],
    [M.musicList, 'MusicListModel.prototype.getNextMusicListForDouyin'],
    [M.musicList, 'MusicListModel.prototype.getNextSearchMusicListForDouyin'],
    [M.musicSquare, 'MusicSquareManager.instance.setDouyinMusicInfo'],
  ],
  icon: [
    [M.iconPreview, 'iconTypeToProjectIconPathMap'],
    [M.iconPreview, 'IconPreviewManager.getInstance'],
    [M.iconPreview, 'IconPreviewManager.prototype.importAndCreateIcon'],
    [M.iconPreview, 'IconPreviewManager.prototype.setIconExistState'],
    [M.iconPreview, 'IconPreviewManager.prototype.saveIconJson'],
    [M.iconPreview, 'IconPreviewManager.prototype.isIconCreated'],
    [M.iconPreview, 'IconPreviewManager.prototype.deleteIcon'],
    [M.iconPreview, 'IconPreviewManager.prototype.uploadDeleteIcon'],
    [M.iconPreview, 'IconPreviewManager.prototype.updateIcon'],
    [M.iconUpload, 'default.uploadIcon'],
    [M.iconWindow, 'showIconCreationWindow'],
  ],
};

const ENFORCED = new Set(['project']);

// 9.8.3 exports Project as a star namespace. The class is Project.Project.
// Older builds export the class directly. An open instance method counts only
// when neither prototype is present. No prototype and no open instance stays incompatible.
function dirtyMethodFound(mod) {
  let EF;
  try {
    EF = mod(M.ef);
  } catch {
    return false;
  }
  if (typeof EF?.Project?.prototype?.isProjectChanged === 'function') return true;
  if (typeof EF?.Project?.Project?.prototype?.isProjectChanged === 'function') return true;
  try {
    const pm = typeof EF?.ProjectManager?.getInstance === 'function' ? EF.ProjectManager.getInstance() : null;
    if (pm && typeof pm.hasActiveProject === 'function' && pm.hasActiveProject() === false) return false;
    let project = null;
    if (pm && typeof pm.getCurrentActiveProject === 'function') project = pm.getCurrentActiveProject();
    if (!project && typeof EF?.Project?.getCurrent === 'function') project = EF.Project.getCurrent();
    return !!project && typeof project.isProjectChanged === 'function';
  } catch {
    return false;
  }
}

class Library {
  constructor(mod) {
    this.mod = mod;
    this.schedule = (fn, ms) => setTimeout(fn, ms);
  }

  selfCheck(arg) {
    const feature = typeof arg === 'string' ? arg : arg && arg.feature;
    if (feature !== undefined && !Object.prototype.hasOwnProperty.call(REQUIRED, feature)) throw Error(`UNKNOWN_FEATURE: ${feature}`);
    const features = {};
    const missing = [];
    for (const [name, list] of Object.entries(REQUIRED)) {
      if (feature && name !== feature) continue;
      const own = [];
      for (const [mod, prop] of list) {
        try {
          let value = this.mod(mod);
          for (const key of prop.split('.')) value = value == null ? undefined : value[key];
          if (value == null) own.push(`${mod} :: ${prop}`);
        } catch (e) {
          own.push(`${mod} :: ${prop} (${e.message})`);
        }
      }
      if (name === 'project' && !dirtyMethodFound(this.mod)) own.push(`${M.ef} :: Project.prototype.isProjectChanged`);
      features[name] = own.length === 0;
      missing.push(...own);
    }
    const enforcedOk = [...ENFORCED].every((name) => features[name] === true);
    return {
      ok: feature ? features[feature] === true : enforcedOk,
      diagnostics_ok: missing.length === 0,
      missing,
      features,
      enforced: [...ENFORCED],
      not_enabled: ['music', 'icon'],
    };
  }

  ensureCompatible(feature = 'project') {
    const check = this.selfCheck(feature);
    if (!check.ok) throw Error(`INCOMPATIBLE_EDITOR: missing ${check.missing.join('; ')}`);
    return check;
  }
}

module.exports = { Library, REQUIRED, ENFORCED };
