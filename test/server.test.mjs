import assert from 'node:assert/strict';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { OfficialMcp } from '../src/official.mjs';
import { createServer, dispatchTool } from '../src/server.mjs';

function officialScript(call) {
  const log = { calls: [] };
  const connect = async () => ({
    listTools: async () => ({
      tools: [
        { name: 'get_scene', description: 'read scene', inputSchema: { type: 'object' } },
        { name: 'save_project', description: 'save', inputSchema: { type: 'object' } },
        { name: 'project_open', description: 'should stay ours', inputSchema: { type: 'object' } },
      ],
    }),
    callTool: async (params) => {
      log.calls.push(params);
      return call(params);
    },
    close: async () => {},
  });
  return { official: new OfficialMcp({ connect }), log };
}

test('official tools are forwarded once and a disconnect is not replayed', async () => {
  const { official, log } = officialScript(() => {
    throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'UND_ERR_SOCKET' } });
  });
  const result = await dispatchTool(
    {
      official,
      pluginInstall: { action: 'kept' },
      listInstances: () => [],
      callPlugin: async () => { throw Error('no window'); },
      sleep: async () => {},
      openTimeoutMs: 10,
      closeTimeoutMs: 10,
      launchRetryMs: 10,
      instanceTimeoutMs: 0,
      saveTimeoutMs: 10,
    },
    'save_project',
    { instance_id: '1', path: 'E:\\probe' },
  );
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /not retried/);
  assert.equal(log.calls.length, 1);
  assert.equal(log.calls[0].name, 'save_project');
});

test('ext_status reports install, cold start, and redacts tokens without faking a window', async () => {
  const { official } = officialScript(() => ({ content: [{ type: 'text', text: '{}' }] }));
  const result = await dispatchTool(
    {
      official,
      pluginInstall: { action: 'failed', error: 'EDITOR_NOT_FOUND', token: 'should-not-leak' },
      listInstances: () => { throw Error('PROCESS_START_CHECK_FAILED: down'); },
      callPlugin: async () => ({}),
      sleep: async () => {},
      openTimeoutMs: 10,
      closeTimeoutMs: 10,
      launchRetryMs: 10,
      instanceTimeoutMs: 0,
      saveTimeoutMs: 10,
    },
    'ext_status',
    {},
  );
  const body = JSON.parse(result.content[0].text);
  assert.equal(body.plugin_install.action, 'failed');
  assert.equal(body.plugin_install.token, '[redacted]');
  assert.equal(body.bootstrap.supported, false);
  assert.equal(body.bootstrap.code, 'WINDOWS_COLD_START_UNVERIFIED');
  assert.equal(body.phases.music.enabled, false);
  assert.deepEqual(body.phases.icon.registered, ['icon_set', 'icon_open']);
  assert.equal(body.phases.icon.editor_acceptance, 'unverified');
  assert.equal(body.contract.editor_acceptance, 'unverified');
  assert.match(body.windows_error, /WINDOW_LIST_FAILED/);
  assert.equal(body.contract.editor_acceptance, 'unverified');
  assert.equal(result.content[0].text.includes('should-not-leak'), false);
  assert.deepEqual(body.shadowed_official_tools, ['project_open']);
});

test('the stdio server lists extension tools and forwarded official tools', async () => {
  const { official } = officialScript(() => ({ content: [{ type: 'text', text: '{"ok":1}' }] }));
  const server = createServer({
    official,
    pluginInstall: { action: 'kept' },
    listInstances: () => [],
    callPlugin: async () => { throw Error('no window'); },
    sleep: async () => {},
    openTimeoutMs: 10,
    closeTimeoutMs: 10,
    launchRetryMs: 10,
    instanceTimeoutMs: 0,
    saveTimeoutMs: 10,
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(clientTransport);
  const listed = await client.listTools();
  const names = listed.tools.map((tool) => tool.name);
  assert.ok(names.includes('ext_status'));
  assert.ok(names.includes('project_open'));
  assert.ok(names.includes('project_new'));
  assert.ok(names.includes('project_close'));
  assert.ok(names.includes('get_scene'));
  assert.ok(names.includes('save_project'));
  assert.equal(names.filter((name) => name === 'project_open').length, 1);
  assert.equal(names.includes('music_apply'), false);
  assert.equal(names.includes('icon_set'), true);
  assert.equal(names.includes('icon_open'), true);
  const iconSet = listed.tools.find((tool) => tool.name === 'icon_set');
  assert.match(iconSet.description, /not retried/);
  assert.match(iconSet.description, /does not tick a creator agreement/);
  const forwarded = listed.tools.find((tool) => tool.name === 'save_project');
  assert.match(forwarded.description, /not retried/);
  await client.close();
});
