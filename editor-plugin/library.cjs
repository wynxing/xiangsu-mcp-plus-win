'use strict';
// Assembles the in-editor library for this Windows slice: project lifecycle, icons, and diagnostics.
const check = require('./features/check.cjs');
const icon = require('./features/icon.cjs');
const project = require('./features/project.cjs');

const { Library } = check;
Object.assign(Library.prototype, project.methods, icon.methods);

const METHODS = { self_check: 'selfCheck', ...project.METHODS, ...icon.METHODS };

module.exports = { Library, METHODS, REQUIRED: check.REQUIRED };
