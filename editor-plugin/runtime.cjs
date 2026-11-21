'use strict';
// Runs inside a 像塑 project window. Serves a random-token RPC endpoint on 127.0.0.1
// and advertises it through a per-process state file.
// Adapted from Muqian-Sun/xiangsu-mcp-plus editor-plugin/runtime.cjs
// (MIT, Copyright (c) 2026 muqian). Eval and describe are omitted.
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { redact } = require('./redact.cjs');
const { restrictPrivate } = require('./private-file.cjs');

const MAX_BODY = 4 * 1024 * 1024;
const MUTATING = new Set(['project_launch', 'project_close', 'icon_set', 'icon_open', 'music_apply']);

function statePaths() {
  const root = process.env.XIANGSU_MCP_PLUS_STATE || path.join(os.homedir(), '.xiangsu-mcp-plus-win');
  return {
    root,
    instanceDir: path.join(root, 'instances'),
    logFile: path.join(root, 'logs', 'plugin.log'),
  };
}

function isLoopback(address) {
  return address === '127.0.0.1' || address === '::ffff:127.0.0.1' || address === '::1';
}

class Runtime {
  constructor() {
    this.token = crypto.randomBytes(24).toString('hex');
    this.server = null;
    this.tail = Promise.resolve();
    const lib = require('./library.cjs');
    this.library = new lib.Library((name) => this.requireModule(name));
    this.libraryMethods = lib.METHODS;
    this.methods = { status: () => this.status() };
  }

  log(...args) {
    try {
      const { logFile } = statePaths();
      fs.mkdirSync(path.dirname(logFile), { recursive: true });
      let line = args.map(String).join(' ');
      line = line.split(this.token).join('[redacted-token]');
      line = redact(line);
      fs.appendFileSync(logFile, `[${new Date().toISOString()}] [${process.pid}] ${line}\n`);
    } catch (_) {}
  }

  requireModule(name) {
    const registry = globalThis.orion;
    if (!registry) throw Error('globalThis.orion is unavailable');
    const mod = registry[name];
    if (mod === undefined) throw Error(`MODULE_NOT_FOUND: ${name}`);
    return mod;
  }

  currentProject() {
    try {
      return this.requireModule('@orion/orion-sdk/EditorFramework').Project.getCurrent() || null;
    } catch (_) {
      return null;
    }
  }

  resolve(method) {
    if (Object.prototype.hasOwnProperty.call(this.methods, method)) return this.methods[method];
    const name = Object.prototype.hasOwnProperty.call(this.libraryMethods, method) ? this.libraryMethods[method] : null;
    return name ? (params) => this.library[name](params) : null;
  }

  status() {
    const project = this.currentProject();
    return {
      pid: process.pid,
      projectPath: project?.path || null,
      hasOrion: !!globalThis.orion,
      methods: [...Object.keys(this.methods), ...Object.keys(this.libraryMethods)],
    };
  }

  start(options = {}) {
    const protect = typeof options.protect === 'function' ? options.protect : restrictPrivate;
    const { instanceDir } = statePaths();
    this.stateFile = path.join(instanceDir, `${process.pid}.json`);
    this.server = http.createServer((req, res) => this.handle(req, res));
    this.server.requestTimeout = 0;
    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (error) => {
        if (settled) return;
        settled = true;
        this.stop();
        this.log('init failed', error && (error.stack || error.message || error));
        reject(error);
      };
      this.server.once('error', fail);
      this.server.listen(0, '127.0.0.1', () => {
        try {
          const { port } = this.server.address();
          fs.mkdirSync(instanceDir, { recursive: true, mode: 0o700 });
          protect(instanceDir);
          const tmp = `${this.stateFile}.tmp`;
          fs.writeFileSync(tmp, JSON.stringify({ pid: process.pid, port, token: this.token, startedAt: Date.now() }), { mode: 0o600 });
          protect(tmp);
          fs.renameSync(tmp, this.stateFile);
          protect(this.stateFile);
          this.log('listening', port);
          settled = true;
          resolve(port);
        } catch (e) {
          fail(e);
        }
      });
    });
  }

  stop() {
    try {
      this.server && this.server.close();
    } catch (_) {}
    try {
      fs.unlinkSync(this.stateFile);
    } catch (_) {}
  }

  handle(req, res) {
    const send = (code, body) => {
      const payload = JSON.stringify(body);
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(payload.split(this.token).join('[redacted-token]'));
    };
    if (!isLoopback(req.socket.remoteAddress)) return send(403, { ok: false, error: 'loopback only' });
    if (req.method !== 'POST' || req.url !== '/rpc') return send(404, { ok: false, error: 'not found' });
    const auth = req.headers.authorization || '';
    const expected = `Bearer ${this.token}`;
    const authBuf = Buffer.from(auth);
    const expectedBuf = Buffer.from(expected);
    if (authBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(authBuf, expectedBuf)) {
      return send(401, { ok: false, error: 'unauthorized' });
    }
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) req.destroy();
      else chunks.push(chunk);
    });
    req.on('end', () => {
      let body;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch (_) {
        return send(400, { ok: false, error: 'invalid json' });
      }
      const job = async () => {
        const mutating = MUTATING.has(body.method);
        if (mutating) this.log('rpc start', body.method);
        try {
          const fn = this.resolve(body.method);
          if (!fn) return send(400, { ok: false, error: `unknown method: ${body.method}` });
          const value = await fn(body.params || {});
          if (mutating) this.log('rpc done', body.method);
          send(200, { ok: true, value });
        } catch (e) {
          this.log('rpc error', body.method, e && e.stack);
          send(200, { ok: false, error: redact(String((e && e.message) || e)).split(this.token).join('[redacted-token]') });
        }
      };
      if (!MUTATING.has(body.method)) {
        job();
        return;
      }
      const prev = this.tail;
      let done;
      this.tail = new Promise((resolve) => {
        done = resolve;
      });
      prev.then(job).then(done, done);
    });
  }
}

function log(...args) {
  try {
    const { logFile } = statePaths();
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${redact(args.map(String).join(' '))}\n`);
  } catch (_) {}
}

module.exports = { Runtime, log, isLoopback, MUTATING };
