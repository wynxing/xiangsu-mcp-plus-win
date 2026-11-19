'use strict';
// Assembles the in-editor library for this Windows slice: project lifecycle and diagnostics.
const check = require('./features/check.cjs');
const project = require('./features/project.cjs');

const { Library } = check;
Object.assign(Library.prototype, project.methods);

const METHODS = { self_check: 'selfCheck', ...project.METHODS };

module.exports = { Library, METHODS, REQUIRED: check.REQUIRED };
