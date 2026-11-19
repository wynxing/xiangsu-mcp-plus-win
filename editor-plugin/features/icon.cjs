'use strict';
// Icon slot write and the icon-creation window.
// Call sequence adapted from Muqian-Sun/xiangsu-mcp-plus editor-plugin/features/delivery.cjs
// iconSet / iconOpen (MIT, Copyright (c) 2026 muqian), inspected at 05d83470.
// This file does not tick an agreement, submit for review, publish, or call paid generation.
const fs = require('fs');
const path = require('path');
const { M } = require('./common.cjs');

// IconPreviewManager.iconTypeToProjectIconPathMap keys (IconType: Female 0, Male 1, Common 2).
const ICON_TYPES = { female: 0, male: 1, common: 2 };

function sniffPng(buf) {
  return Buffer.isBuffer(buf) && buf.length >= 8 && buf.readUInt32BE(0) === 0x89504e47;
}

function sameIconPath(a, b, platform = process.platform) {
  const norm = (value) => value.trim().normalize('NFC').replace(/[\\/]+/g, '/').replace(/\/+$/, '');
  const left = norm(a);
  const right = norm(b);
  return platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
}

function activeProject(lib, expected) {
  if (typeof expected !== 'string' || !expected.trim()) throw Error('ICON_TARGET_REQUIRED: pass expected_project_path');
  const pm = lib.mod(M.ef).ProjectManager.getInstance();
  if (!pm || typeof pm.getActiveProject !== 'function') throw Error('INCOMPATIBLE_EDITOR: ProjectManager.getInstance().getActiveProject');
  const project = pm.getActiveProject();
  if (!project || typeof project.path !== 'string' || !project.path) throw Error('NO_ACTIVE_PROJECT');
  if (!sameIconPath(project.path, expected)) throw Error(`ICON_WINDOW_MISMATCH: active project is ${project.path}, expected ${expected}`);
  return project;
}

function projectIcons(lib, project) {
  const map = lib.mod(M.iconPreview).iconTypeToProjectIconPathMap;
  return Object.keys(ICON_TYPES).filter((name) => fs.existsSync(path.join(project.path, map[ICON_TYPES[name]])));
}

const methods = {
  // `png_path` is a square PNG prepared by the MCP server. It is copied onto the icon paths the
  // editor module names, then uploaded once the way the icon window's finish button does.
  // A failed or unclear upload is not called again.
  async iconSet({ types = ['female', 'male'], png_path, expected_project_path } = {}) {
    this.ensureCompatible('icon');
    const requested = Array.isArray(types) && types.length ? types : [null];
    const bad = requested.filter((type) => !Object.prototype.hasOwnProperty.call(ICON_TYPES, type));
    if (bad.length) throw Error(`INVALID_ICON_TYPE: ${bad.join(', ')}; valid: ${Object.keys(ICON_TYPES).join(', ')}`);
    if (typeof png_path !== 'string' || !fs.existsSync(png_path) || !fs.statSync(png_path).isFile()) throw Error(`ICON_FILE_NOT_FOUND: ${png_path}`);
    const pngBytes = fs.readFileSync(png_path);
    if (!sniffPng(pngBytes)) throw Error(`ICON_FILE_NOT_PNG: ${png_path}`);
    const project = activeProject(this, expected_project_path);
    const { IconPreviewManager, iconTypeToProjectIconPathMap } = this.mod(M.iconPreview);
    const icons = IconPreviewManager.getInstance();
    const other = requested.includes('common') ? ['female', 'male'] : ['common'];
    const removed = [];
    for (const type of other) {
      const slot = ICON_TYPES[type];
      if (!fs.existsSync(path.join(project.path, iconTypeToProjectIconPathMap[slot])) && !icons.isIconCreated(slot)) continue;
      icons.deleteIcon(slot);
      icons.uploadDeleteIcon(slot);
      removed.push(type);
    }
    const written = [];
    for (const type of requested) {
      const slot = ICON_TYPES[type];
      const dest = path.join(project.path, iconTypeToProjectIconPathMap[slot]);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(png_path, dest);
      const copied = fs.readFileSync(dest);
      if (!copied.equals(pngBytes)) throw Error(`ICON_WRITE_UNCONFIRMED: ${dest}; upload was not called`);
      icons.importAndCreateIcon(slot, project.path);
      icons.setIconExistState(slot, true);
      icons.updateIcon(slot, { iconUri: undefined, uploadData: undefined });
      written.push(dest);
    }
    let uploaded;
    try {
      uploaded = await this.mod(M.iconUpload).default.uploadIcon();
    } catch (error) {
      throw Error(`ICON_UPLOAD_UNKNOWN: ${error.message}; icon upload was not retried`);
    }
    icons.saveIconJson();
    if (uploaded === false) throw Error('ICON_UPLOAD_FAILED: the icon files are written but the platform did not take the upload (network or login); icon upload was not retried');
    if (uploaded !== true) throw Error(`ICON_UPLOAD_UNCONFIRMED: uploadIcon returned ${uploaded === undefined ? 'undefined' : typeof uploaded}; icon upload was not retried`);
    const present = projectIcons(this, project);
    const missing = requested.filter((type) => !present.includes(type));
    if (missing.length) throw Error(`ICON_READBACK_FAILED: missing ${missing.join(', ')}; icon upload was not retried`);
    return {
      types: requested,
      icon_paths: written,
      removed,
      uploaded: true,
      project_path: project.path,
      project_icons: present,
      readback: written.map((file) => ({ path: file, bytes: fs.statSync(file).size, exists: true })),
    };
  },

  // Opens the editor icon window. This process does not minimize it and does not read the window list back.
  iconOpen({ expected_project_path } = {}) {
    this.ensureCompatible('icon');
    const project = activeProject(this, expected_project_path);
    const show = this.mod(M.iconWindow).showIconCreationWindow;
    if (typeof show !== 'function') throw Error('INCOMPATIBLE_EDITOR: showIconCreationWindow');
    show('tool_bar');
    return {
      project_path: project.path,
      called: 'showIconCreationWindow',
      argument: 'tool_bar',
      window_readback: false,
      minimized: null,
      focus_policy: 'not_attempted',
    };
  },
};

const METHODS = { icon_set: 'iconSet', icon_open: 'iconOpen' };

module.exports = { methods, METHODS, ICON_TYPES, sameIconPath };
