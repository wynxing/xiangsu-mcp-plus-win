'use strict';
// Assembles the in-editor library: project lifecycle, music library, and diagnostics.
const check = require('./features/check.cjs');
const music = require('./features/music.cjs');
const project = require('./features/project.cjs');

const { Library } = check;
Object.assign(Library.prototype, project.methods, music.methods);

const METHODS = { self_check: 'selfCheck', ...project.METHODS, ...music.METHODS };

module.exports = { Library, METHODS, REQUIRED: check.REQUIRED };
