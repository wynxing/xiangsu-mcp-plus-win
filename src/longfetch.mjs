// fetch for calls that may run for minutes. Node's built-in fetch aborts when headers
// take longer than undici's headersTimeout (300s). Official generations and plugin
// replies answer once, when they finish; the caller's AbortSignal is the deadline.
// Adapted from Muqian-Sun/xiangsu-mcp-plus src/longfetch.mjs (MIT, Copyright (c) 2026 muqian).
import { Agent, fetch } from 'undici';

const agent = new Agent({ headersTimeout: 0, bodyTimeout: 0 });

export const longFetch = (url, init = {}) => fetch(url, { ...init, dispatcher: agent });
