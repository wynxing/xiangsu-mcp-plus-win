#!/usr/bin/env node
// stdio MCP server. Official 像塑 tools are forwarded once. This slice adds
// ext_status, project_open, project_new and project_close. Music and icon tools
// are not registered.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, McpError } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { callPlugin, listInstances } from './bridge.mjs';
import { OfficialMcp, OfficialUnreachable } from './official.mjs';
import { installFromEnvironment } from './plugininstall.mjs';
import { COLD_START, Projects } from './projects.mjs';
import { redact, redactObject } from './redact.mjs';

const VERSION = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

const text = (value) => ({ content: [{ type: 'text', text: JSON.stringify(redactObject(value), null, 2) }] });
const failure = (message) => ({ isError: true, content: [{ type: 'text', text: redact(message) }] });

function depsFrom(overrides) {
  return {
    callPlugin,
    listInstances,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    openTimeoutMs: 90000,
    closeTimeoutMs: 30000,
    launchRetryMs: 8000,
    instanceTimeoutMs: 30000,
    saveTimeoutMs: 15000,
    pluginInstall: null,
    ...overrides,
  };
}

export function toolDefinitions() {
  const target = {
    project_path: z.string().min(1).optional().describe('Absolute path of the target project. Pass this or instance_id. Required when more than one project window is open.'),
    instance_id: z.union([z.string(), z.number()]).optional().describe('instance_id from the official list_instances.'),
  };
  return [
    {
      name: 'ext_status',
      description:
        'Diagnostics for this Windows bridge: official MCP connectivity, plugin install result, per-window self-check, and explicit unsupported states. ' +
        'features.project must be true before project_open / project_new / project_close. Music and icon tools are not enabled; their modules are diagnostic only. ' +
        'Cold start without a project window is unsupported. This is not evidence that a real 像塑 editor accepted the plugin.',
      schema: z.strictObject({}),
      run: async (_args, d, projects) => {
        const official = await d.official.listTools().then(() => d.official.status());
        let instances = [];
        let official_error = null;
        try {
          instances = await projects.officialInstances();
        } catch (e) {
          official_error = e.message;
        }
        const ids = new Map(instances.filter((i) => i.pid != null).map((i) => [i.pid, i.instance_id]));
        let windows = [];
        let windows_error = null;
        try {
          const listed = await projects.windows();
          for (const w of listed) {
            const self_check = await d.callPlugin('self_check', {}, { pid: w.pid, timeoutMs: 5000 }).catch((e) => ({ ok: false, error: e.message }));
            const state = await d.callPlugin('project_state', {}, { pid: w.pid, timeoutMs: 5000 }).catch(() => null);
            windows.push({
              ...w,
              instance_id: ids.get(w.pid) ?? null,
              unsaved_changes: state && (state.changed === true || state.changed === false) ? state.changed : null,
              self_check,
            });
          }
        } catch (e) {
          windows_error = e.message;
        }
        const officialNames = new Set((d.official.tools || []).map((t) => t.name));
        return {
          server: { name: 'xiangsu-mcp-plus-win', version: VERSION },
          contract: {
            tested: 'node:test mocks and contract tests',
            editor_acceptance: 'unverified',
          },
          official: { ...official, list_error: official_error },
          plugin_install: d.pluginInstall ?? null,
          bootstrap: COLD_START,
          phases: {
            music: { enabled: false, reason: 'not in this slice; ext_status self_check.features.music is diagnostic only' },
            icon: { enabled: false, reason: 'not in this slice; ext_status self_check.features.icon is diagnostic only' },
          },
          windows,
          windows_error,
          shadowed_official_tools: ['ext_status', 'project_open', 'project_new', 'project_close'].filter((name) => officialNames.has(name)),
        };
      },
    },
    {
      name: 'project_open',
      description:
        'Open an existing project directory (it must contain effect.dyehpj) through an already-open project window. ' +
        'If that project is already open, returns it unchanged. With no project window, returns NO_EDITOR_WINDOW and does not launch the editor. ' +
        'Does not minimize or activate unrelated windows.',
      schema: z.strictObject({ path: z.string().min(1).describe('Absolute path of the project folder.') }),
      run: async (args, _d, projects) => projects.open(args),
    },
    {
      name: 'project_new',
      description:
        'Create a blank project through an already-open project window and save it once with the official save_project tool. ' +
        'The target must be missing or an empty directory. Does not overwrite an existing directory or project. ' +
        'A failed or disconnected save is not retried.',
      schema: z.strictObject({ path: z.string().min(1).describe('Absolute path of the folder to save the new project into.') }),
      run: async (args, _d, projects) => projects.create(args),
    },
    {
      name: 'project_close',
      description:
        'Close one project window via the namespace Project.unload path. Refuses unless the plugin isProjectChanged() is false and official project_status is_changed is false. ' +
        'Refuses when scene_dirty is true, when either read fails, or when the official path does not match. Does not kill processes or restart the editor.',
      schema: z.strictObject({
        ...target,
        discard_changes: z.boolean().optional().describe('Discard unsaved changes and close. Omitted or false refuses a dirty project.'),
      }),
      run: async (args, _d, projects) => projects.close(args),
    },
  ];
}

function definition(tool) {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: z.toJSONSchema(tool.schema),
    annotations: tool.name === 'ext_status' ? { readOnlyHint: true } : { readOnlyHint: false, destructiveHint: tool.name === 'project_close' },
  };
}

export async function listToolDefs(d) {
  const own = toolDefinitions();
  const ownNames = new Set(own.map((tool) => tool.name));
  let official = [];
  try {
    official = await d.official.listTools();
  } catch {
    official = d.official.tools || [];
  }
  return [
    ...own.map(definition),
    ...official
      .filter((tool) => !ownNames.has(tool.name))
      .map((tool) => ({
        ...tool,
        description: `${tool.description || ''}\n\n(xiangsu-mcp-plus-win) Forwarded to the official MCP once. A disconnect or timeout after the request is sent is not retried.`.trim(),
      })),
  ];
}

export async function dispatchTool(d, name, args) {
  const projects = d.projects ?? new Projects(d);
  d.projects = projects;
  const own = toolDefinitions().find((tool) => tool.name === name);
  if (own) {
    const parsed = own.schema.safeParse(args ?? {});
    if (!parsed.success) return failure(`INVALID_ARGUMENTS(${name}): ${parsed.error.message}`);
    try {
      return text(await own.run(parsed.data, d, projects));
    } catch (e) {
      return failure(e.message);
    }
  }
  try {
    return await d.official.callTool(name, args ?? {});
  } catch (e) {
    if (e instanceof McpError) return failure(`OFFICIAL_TOOL_ERROR(${name}): ${e.message}`);
    if (e instanceof OfficialUnreachable) return failure(`OFFICIAL_MCP_UNAVAILABLE(${name}): ${e.message}`);
    return failure(e.message || `OFFICIAL_MCP_DISCONNECTED(${name}): request was not retried`);
  }
}

export function createServer(overrides = {}) {
  const d = depsFrom(overrides);
  d.official = d.official ?? new OfficialMcp();
  const server = new Server({ name: 'xiangsu-mcp-plus-win', version: VERSION }, { capabilities: { tools: { listChanged: true } } });
  d.official.onToolsChanged = () => server.sendToolListChanged().catch(() => {});
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: await listToolDefs(d) }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => dispatchTool(d, req.params.name, req.params.arguments ?? {}));
  return server;
}

function isDirect() {
  if (!process.argv[1]) return false;
  try {
    return import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
}

if (isDirect()) {
  const official = new OfficialMcp();
  official.watch();
  let pluginInstall;
  try {
    pluginInstall = installFromEnvironment();
  } catch (e) {
    pluginInstall = { action: 'failed', error: redact(e.message) };
  }
  const server = createServer({ official, pluginInstall });
  await server.connect(new StdioServerTransport());
}
