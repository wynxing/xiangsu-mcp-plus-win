import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { McpError } from '@modelcontextprotocol/sdk/types.js';
import { OfficialMcp, OfficialUnreachable } from '../src/official.mjs';

function fakeConnector(script) {
  const log = { connects: 0, closes: 0, calls: 0 };
  const connect = async () => {
    log.connects += 1;
    const n = log.connects;
    const s = script(n);
    if (s.refuse) throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    return {
      listTools: async () => ({ tools: s.tools ?? [{ name: 'get_scene' }, { name: 'save_project' }] }),
      callTool: async (params) => {
        log.calls += 1;
        return s.call(params, n);
      },
      close: async () => {
        log.closes += 1;
      },
    };
  };
  return { connect, log };
}

test('a disconnect after the official call is sent is not retried', async () => {
  const { connect, log } = fakeConnector(() => ({
    call: () => {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'UND_ERR_SOCKET' } });
    },
  }));
  const official = new OfficialMcp({ connect });
  const err = await official.callTool('save_project', { path: 'E:\\probe' }).catch((e) => e);
  assert.match(err.message, /not retried/);
  assert.equal(err.ambiguous, true);
  assert.ok(!(err instanceof OfficialUnreachable));
  assert.equal(log.calls, 1);
  assert.equal(log.closes, 1);
  assert.equal(log.connects, 1);
});

test('a refused connection before a call is unreachable and still was not sent twice', async () => {
  const { connect, log } = fakeConnector(() => ({ refuse: true, call() {} }));
  const official = new OfficialMcp({ connect });
  const err = await official.callTool('save_project', {}).catch((e) => e);
  assert.ok(err instanceof OfficialUnreachable);
  assert.equal(log.calls, 0);
  assert.equal(log.connects, 1);
});

test('protocol errors are returned once', async () => {
  const { connect, log } = fakeConnector(() => ({
    call: () => {
      throw new McpError(-32602, 'Invalid arguments');
    },
  }));
  const official = new OfficialMcp({ connect });
  await assert.rejects(official.callTool('get_scene', {}), McpError);
  assert.equal(log.calls, 1);
  assert.equal(log.connects, 1);
});

test('an unreachable editor keeps the previous tool list instead of inventing tools', async () => {
  let up = false;
  const { connect } = fakeConnector(() => (up ? { tools: [{ name: 'health' }], call: () => ({}) } : { refuse: true, call() {} }));
  const official = new OfficialMcp({ connect });
  assert.deepEqual(await official.listTools(), []);
  assert.equal(official.status().connected, false);
  up = true;
  assert.deepEqual((await official.listTools()).map((tool) => tool.name), ['health']);
  official.reset();
  up = false;
  assert.deepEqual((await official.listTools()).map((tool) => tool.name), ['health']);
});

test('official calls do not go through the built-in fetch', async () => {
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    if (!body.trim()) return res.writeHead(202).end();
    let msg;
    try {
      msg = JSON.parse(body);
    } catch {
      return res.writeHead(400).end();
    }
    if (msg.id === undefined) return res.writeHead(202).end();
    const result =
      msg.method === 'initialize'
        ? { protocolVersion: msg.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'fake', version: '0' } }
        : msg.method === 'tools/list'
          ? { tools: [{ name: 'health', inputSchema: { type: 'object' } }] }
          : { content: [{ type: 'text', text: '{"status":"ok"}' }] };
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const builtin = globalThis.fetch;
  globalThis.fetch = () => Promise.reject(Error('built-in fetch used'));
  try {
    const official = new OfficialMcp({ url: `http://127.0.0.1:${server.address().port}/mcp` });
    assert.deepEqual(await official.callJson('health', {}), { status: 'ok' });
    official.reset();
  } finally {
    globalThis.fetch = builtin;
    server.closeAllConnections?.();
    server.close();
  }
});
