'use strict';
// Project lifecycle, icon tools, and the Douyin music library.
const check = require('./features/check.cjs');
const icon = require('./features/icon.cjs');
const music = require('./features/music.cjs');
const project = require('./features/project.cjs');

const { Library } = check;
Object.assign(Library.prototype, project.methods, icon.methods, music.methods);

const METHODS = { self_check: 'selfCheck', ...project.METHODS, ...icon.METHODS, ...music.METHODS };

module.exports = { Library, METHODS, REQUIRED: check.REQUIRED };
