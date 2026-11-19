#!/usr/bin/env node
// stdio MCP server. Official 像塑 tools are forwarded once. This slice adds
// ext_status, project window tools, icon tools, and the Douyin music library.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, McpError } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { callPlugin, listInstances } from './bridge.mjs';
import { OfficialMcp, OfficialUnreachable } from './official.mjs';
import { installFromEnvironment, stateRootOf } from './plugininstall.mjs';
import { openIcon, setIcon } from './icons.mjs';
import { musicToolDefinitions } from './music.mjs';
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
        'features.project must be true before project_open / project_new / project_close. ' +
        'icon_set and icon_open run only when that window reports features.icon. Music tools require features.music. A missing icon or music module does not fail project tools. ' +
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
            music: {
              enabled: true,
              tools: ['music_categories', 'music_list', 'music_search', 'music_apply'],
              editor_acceptance: 'unverified',
            },
            icon: {
              enabled: true,
              registered: ['icon_set', 'icon_open'],
              editor_acceptance: 'unverified',
              reason:
                'Tools are registered. A window runs them only when its self_check.features.icon is true. A missing icon module does not fail project tools. ' +
                'Icon upload is not effect submission. No 像塑 9.8.3 readback has been recorded.',
            },
          },
          windows,
          windows_error,
          shadowed_official_tools: toolDefinitions().map((tool) => tool.name).filter((name) => officialNames.has(name)),
        };
      },
    },
    {
      name: 'project_open',
      description:
        'Open an existing project directory (it must contain effect.dyehpj) through a project process that already has the plugin loaded. ' +
        'An idle process with no project can send the open. The home process may load it there or in a new process; the result is whichever pid reads back that path. ' +
        'A process that already shows a project is not replaced. If that project is already open, returns it unchanged. With no plugin process, returns NO_EDITOR_WINDOW and does not launch the editor. ' +
        'Does not minimize or activate unrelated windows.',
      schema: z.strictObject({ path: z.string().min(1).describe('Absolute path of the project folder.') }),
      run: async (args, _d, projects) => projects.open(args),
    },
    {
      name: 'project_new',
      description:
        'Create a blank project through a project process that already has the plugin loaded, then save it once with the official save_project tool. ' +
        'An idle process with no project can send the create. The home process may host the new project in that process or in a new one; exactly one pid must read back as ProjectCreatedTmp before save. ' +
        'A process that already shows a project must still show it afterwards. The target must be missing or an empty directory. Does not overwrite an existing directory or project. ' +
        'A failed or disconnected save is not retried. If the client connection closes after project_launch returns, save_project is not called and the call is not a success.',
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
    {
      name: 'icon_set',
      description:
        'Set the effect icon on one already-open project window. The image is centre-cropped and scaled to a new 360×360 PNG (the source file is not modified), copied onto the icon paths that window reports, then uploaded once. ' +
        'Pass project_path or instance_id when more than one window is open. Refuses unless that window self_check.features.icon is true. ' +
        'A disconnect, timeout, or upload result other than true is not retried and is not reported as success. ' +
        'This is not effect submission: it does not tick a creator agreement, submit for review, publish, or call paid generation.',
      schema: z.strictObject({
        ...target,
        image_path: z.string().min(1).describe('Absolute path of a png, jpeg, gif, or webp file.'),
        type: z.enum(['both', 'female', 'male', 'common']).optional().describe('both (default) writes the female and male slots. female, male, or common writes that slot.'),
      }),
      run: async (args, d, projects) => setIcon(d, projects, args),
    },
    {
      name: 'icon_open',
      description:
        'Ask one already-open project window to call showIconCreationWindow. Pass project_path or instance_id when more than one window is open. ' +
        'Refuses unless features.icon is true. The call is not retried. This bridge does not minimize the window, does not read the window list back, and does not submit, publish, or tick an agreement.',
      schema: z.strictObject({ ...target }),
      run: async (args, d, projects) => openIcon(d, projects, args),
    },
    ...musicToolDefinitions(),
  ];
}

function definition(tool) {
  const readOnly = tool.readOnly === true || tool.name === 'ext_status';
  const annotations = { readOnlyHint: readOnly };
  if (!readOnly) annotations.destructiveHint = tool.name === 'project_close';
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: z.toJSONSchema(tool.schema),
    annotations,
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

export function stdioPhase(line, env = process.env) {
  try {
    const file = path.join(stateRootOf(env), 'logs', 'stdio.log');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `[${new Date().toISOString()}] [${process.pid}] ${String(line).replace(/[\r\n]/g, ' ')}\n`);
  } catch {
    // A log failure must not be written to stdout. That stream is the MCP protocol.
  }
}

export async function dispatchTool(d, name, args, extra) {
  const projects = d.projects ?? new Projects(d);
  d.projects = projects;
  const own = toolDefinitions().find((tool) => tool.name === name);
  if (own) {
    const parsed = own.schema.safeParse(args ?? {});
    if (!parsed.success) return failure(`INVALID_ARGUMENTS(${name}): ${parsed.error.message}`);
    const previous = d.requestSignal;
    d.requestSignal = extra?.signal;
    d.logPhase = d.logPhase ?? stdioPhase;
    try {
      return text(await own.run(parsed.data, d, projects));
    } catch (e) {
      stdioPhase(`tool_error ${name} ${String(e && e.message ? e.message : e).split(':')[0].slice(0, 80)}`);
      return failure(e.message);
    } finally {
      d.requestSignal = previous;
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
  server.setRequestHandler(CallToolRequestSchema, async (req, extra) => dispatchTool(d, req.params.name, req.params.arguments ?? {}, extra));
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
  const mark = (line) => stdioPhase(line);
  process.stdin.on('end', () => mark('stdin end'));
  process.once('SIGTERM', () => mark('SIGTERM'));
  process.once('SIGINT', () => mark('SIGINT'));
  process.on('uncaughtException', (error) => {
    mark(`uncaught ${error && error.name ? error.name : 'Error'}`);
    process.exit(1);
  });
  process.on('unhandledRejection', (error) => {
    mark(`unhandled ${error && error.name ? error.name : 'rejection'}`);
    process.exit(1);
  });
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
