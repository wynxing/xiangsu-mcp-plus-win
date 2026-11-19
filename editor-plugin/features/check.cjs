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
    [M.iconUpload, 'default.uploadIcon'],
    [M.iconWindow, 'showIconCreationWindow'],
  ],
};

const ENFORCED = new Set(['project']);

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
