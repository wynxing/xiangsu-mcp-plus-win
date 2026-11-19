// Client for 像塑's official MCP (streamable HTTP).
// A call is sent at most once. A disconnect or timeout after the request is written is
// ambiguous: the editor may already have run it (and a generation may have spent credits).
// That failure is not retried here.
// Adapted from Muqian-Sun/xiangsu-mcp-plus src/official.mjs (MIT, Copyright (c) 2026 muqian).
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { McpError } from '@modelcontextprotocol/sdk/types.js';
import { longFetch } from './longfetch.mjs';

export const DEFAULT_OFFICIAL_URL = 'http://127.0.0.1:17320/mcp';
const CALL_TIMEOUT_MS = 15 * 60 * 1000;

export class OfficialUnreachable extends Error {}

const refused = (e) => e?.cause?.code === 'ECONNREFUSED';
const describe = (e) => `${e?.message ?? e}${e?.cause?.code ? ` (${e.cause.code})` : ''}`;

async function defaultConnect(url) {
  const client = new Client({ name: 'xiangsu-mcp-plus-win', version: '0.1.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(url), { fetch: longFetch }));
  return client;
}

export class OfficialMcp {
  constructor({ url = process.env.XIANGSU_MCP_URL || DEFAULT_OFFICIAL_URL, connect = defaultConnect, onToolsChanged } = {}) {
    this.url = url;
    this.connectFn = connect;
    this.onToolsChanged = onToolsChanged;
    this.client = null;
    this.connecting = null;
    this.tools = [];
    this.lastError = null;
  }

  async connect() {
    if (this.client) return this.client;
    if (!this.connecting) {
      this.connecting = (async () => {
        try {
          const client = await this.connectFn(this.url);
          const { tools } = await client.listTools();
          const changed = JSON.stringify(tools.map((t) => t.name)) !== JSON.stringify(this.tools.map((t) => t.name));
          this.client = client;
          this.tools = tools;
          this.lastError = null;
          if (changed && this.onToolsChanged) this.onToolsChanged();
          return client;
        } catch (e) {
          this.lastError = String(e?.message ?? e);
          throw e;
        } finally {
          this.connecting = null;
        }
      })();
    }
    return this.connecting;
  }

  reset() {
    const c = this.client;
    this.client = null;
    if (c) c.close().catch(() => {});
  }

  status() {
    return { url: this.url, connected: !!this.client, tools: this.tools.length, last_error: this.lastError };
  }

  async listTools() {
    try {
      await this.connect();
    } catch {
      // Keep the last list. Empty until the first successful contact.
    }
    return this.tools;
  }

  async callTool(name, args) {
    let client;
    try {
      client = await this.connect();
    } catch (e) {
      throw new OfficialUnreachable(describe(e), { cause: e });
    }
    try {
      return await client.callTool({ name, arguments: args ?? {} }, undefined, { timeout: CALL_TIMEOUT_MS, resetTimeoutOnProgress: true });
    } catch (e) {
      if (e instanceof McpError) throw e;
      this.reset();
      if (refused(e)) throw new OfficialUnreachable(describe(e), { cause: e });
      const ambiguous = Error(`OFFICIAL_MCP_DISCONNECTED(${name}): ${describe(e)}; request was not retried`);
      ambiguous.cause = e;
      ambiguous.ambiguous = true;
      throw ambiguous;
    }
  }

  async callJson(name, args) {
    const res = await this.callTool(name, args);
    const text = (res.content || []).find((c) => c.type === 'text')?.text;
    if (res.isError) throw Error(`OFFICIAL_TOOL_ERROR(${name}): ${text ?? 'unknown error'}`);
    try {
      return JSON.parse(text);
    } catch {
      throw Error(`OFFICIAL_TOOL_BAD_RESPONSE(${name}): ${String(text).slice(0, 200)}`);
    }
  }

  watch(intervalMs = 5000) {
    const timer = setInterval(() => {
      if (!this.client) this.connect().catch(() => {});
    }, intervalMs);
    timer.unref?.();
    return timer;
  }
}
