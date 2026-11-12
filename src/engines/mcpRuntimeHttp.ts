// Streamable HTTP transport for the MCP runtime.
//
// Owns the streamable-http session lifecycle (initialize → notifications/initialized
// → requests → DELETE), the single-shot HTTP request including the native HTTP
// bridge, and parsing one HTTP response (JSON or text/event-stream)
// into a JSON-RPC message. No catalog, no cache, no persistent SSE connection —
// that legacy transport lives separately.

import {
  createRpcId,
  ensureSuccessMessage,
  findResponseMessage
} from './mcpRuntimeJsonRpc';
import {
  canUseNativeProviderHttp,
  executeNativeProviderHttpRequest
} from '../native/providerHttp';
import type {
  JsonRpcId,
  JsonRpcMessage,
  JsonRpcNotification,
  JsonRpcRequest
} from './mcpRuntimeJsonRpc';
import { createTimeoutError } from './mcpRuntimeTiming';
import {
  buildServerHeaders,
  getFetchImpl,
  MCP_CLIENT_INFO,
  MCP_PROTOCOL_VERSION,
  parseSseEvents
} from './mcpRuntimeTransport';
import type { InitializeResult, McpTransportOptions } from './mcpRuntimeTransport';

export type StreamableSession = {
  endpoint: string;
  protocolVersion: string;
  sessionId?: string;
};

/**
 * MCP servers reached from the phone must go through the native HTTP bridge.
 *
 * A WebView `fetch` is subject to CORS, and plenty of MCP servers (galatea,
 * lkcoffee, …) simply do not answer the `OPTIONS` preflight at all — they were
 * written for server-to-server callers. Sending `Authorization` makes the
 * request non-simple, which forces a preflight, which fails, which surfaces in
 * the UI as a bare `Failed to fetch`. Routing through the native bridge skips
 * CORS entirely, so any server the desktop build can reach also works on the
 * phone, including ones added later.
 *
 * Desktop/web keeps using `fetch`: there is no bridge there, and the browser
 * dev server has no CORS problem with the endpoints users configure.
 */
function shouldUseNativeMcpHttp(_url: string, _options: McpTransportOptions) {
  return canUseNativeProviderHttp();
}

function serializeNativeHttpBody(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}

/**
 * Run one MCP request through the native bridge and turn it back into a
 * `Response`, so the rest of the transport keeps working in terms of fetch.
 *
 * The bridge streams the reply as base64 chunks; MCP replies are small JSON or
 * SSE documents, so buffering them all and building the body afterwards is both
 * simpler and safe. Streaming is reserved for the model transport, which needs
 * incremental delivery — the catalog and tool calls do not.
 */
async function requestViaNativeBridge(
  url: string,
  init: RequestInit
) {
  const requestHeaders = new Headers(init.headers ?? undefined);
  const headerRecord: Record<string, string> = {};
  requestHeaders.forEach((value, key) => {
    headerRecord[key] = value;
  });

  const rawBody = serializeNativeHttpBody(init.body);
  const body = rawBody ?? undefined;

  let status = 0;
  let contentType = '';
  let accumulated = '';

  await executeNativeProviderHttpRequest({
    url,
    headers: headerRecord,
    body: body ?? '',
    signal: init.signal ?? undefined,
    onResponse: (response) => {
      status = response.status;
      contentType = response.contentType || '';
    },
    onTextChunk: (chunk) => {
      accumulated += chunk;
    }
  });

  const responseHeaders = new Headers();
  if (contentType) {
    responseHeaders.set('content-type', contentType);
  }
  // MCP sessions are carried by this header; mirror it from the raw reply when
  // the server sent one, so `initializeStreamableSession` can pick it up.
  const sessionHeader = extractHeaderFromRawResponse(accumulated, 'mcp-session-id');
  if (sessionHeader) {
    responseHeaders.set('mcp-session-id', sessionHeader);
  }

  // A 202 (notification accepted) has no body, and turning an empty string into
  // a `Response` body is fine — but a 204 must not carry one at all.
  const bodyInit = status === 204 ? null : accumulated;
  return new Response(bodyInit, { status, headers: responseHeaders });
}

/**
 * The native bridge rebuilds the body but drops the headers, so `Mcp-Session-Id`
 * would be lost. It arrives as the first line of whatever the server streamed
 * back, so recover it from there. Returns null when absent.
 */
function extractHeaderFromRawResponse(raw: string, headerName: string) {
  if (!raw) return null;
  const match = raw.match(new RegExp(`"${headerName}"\\s*:\\s*"([^"]+)"`, 'i'));
  return match ? match[1] : null;
}

async function requestMcpHttp(
  url: string,
  init: RequestInit,
  options: McpTransportOptions
) {
  if (!shouldUseNativeMcpHttp(url, options)) {
    const fetchImpl = getFetchImpl(options.fetchImpl);
    return await fetchImpl(url, init);
  }

  return await requestViaNativeBridge(url, init);
}

function dispatchJsonRpcFromSseData(
  rawData: string,
  expectedId: JsonRpcId
): JsonRpcMessage | null {
  try {
    const parsed = JSON.parse(rawData) as unknown;
    return findResponseMessage(parsed, expectedId);
  } catch {
    return null;
  }
}

async function readSseResponseForId(response: Response, expectedId: JsonRpcId, label: string) {
  const bodyText = await response.text();
  const events = parseSseEvents(bodyText);

  for (const event of events) {
    if (event.event !== 'message') continue;
    const match = dispatchJsonRpcFromSseData(event.data, expectedId);
    if (match) return match;
  }

  throw new Error(`${label} 没有在 SSE 响应里拿到结果。`);
}

async function parseHttpJsonRpcResponse(
  response: Response,
  expectedId: JsonRpcId,
  label: string
) {
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`${label} 失败：HTTP ${response.status}${errorText ? ` · ${errorText.trim()}` : ''}`);
  }

  if (response.status === 202) {
    return null;
  }

  if (contentType.includes('text/event-stream')) {
    return await readSseResponseForId(response, expectedId, label);
  }

  const parsed = await response.json().catch(() => null);
  const matched = findResponseMessage(parsed, expectedId);
  if (!matched) {
    throw new Error(`${label} 返回了无法识别的 JSON-RPC 结果。`);
  }
  return matched;
}

async function postStreamableJsonRpc(
  payload: JsonRpcRequest | JsonRpcNotification,
  options: McpTransportOptions & Partial<StreamableSession> & { label: string }
) {
  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => controller.abort(createTimeoutError(options.label, options.timeoutMs)), options.timeoutMs);

  try {
    const headers = buildServerHeaders(options.server, {
      'Content-Type': 'application/json',
      ...(options.protocolVersion ? { 'MCP-Protocol-Version': options.protocolVersion } : {}),
      ...(options.sessionId ? { 'Mcp-Session-Id': options.sessionId } : {})
    });

    return await requestMcpHttp(options.endpoint ?? options.server.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal
    }, options);
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
}

export async function initializeStreamableSession(options: McpTransportOptions): Promise<StreamableSession> {
  const requestId = createRpcId();
  const response = await postStreamableJsonRpc({
    jsonrpc: '2.0',
    id: requestId,
    method: 'initialize',
    params: {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: MCP_CLIENT_INFO
    }
  }, {
    ...options,
    endpoint: options.server.url,
    label: `初始化 MCP 服务 ${options.server.name}`
  });
  const sessionId = response.headers.get('Mcp-Session-Id') ?? undefined;
  const message = ensureSuccessMessage(
    await parseHttpJsonRpcResponse(response, requestId, `初始化 MCP 服务 ${options.server.name}`),
    `初始化 MCP 服务 ${options.server.name}`
  );
  const result = (message.result ?? {}) as InitializeResult;
  const protocolVersion = typeof result.protocolVersion === 'string' && result.protocolVersion.trim()
    ? result.protocolVersion
    : MCP_PROTOCOL_VERSION;

  await postStreamableJsonRpc({
    jsonrpc: '2.0',
    method: 'notifications/initialized'
  }, {
    ...options,
    endpoint: options.server.url,
    protocolVersion,
    sessionId,
    label: `确认 MCP 服务 ${options.server.name} 初始化`
  }).catch(() => null);

  return {
    endpoint: options.server.url,
    protocolVersion,
    sessionId
  };
}

export async function closeStreamableSession(options: McpTransportOptions & StreamableSession) {
  if (!options.sessionId) return;
  try {
    // Deliberately sent via plain `fetch`, not the native bridge: the bridge is
    // POST-only, and this close is a best-effort teardown whose result nobody
    // reads. A CORS failure here is harmless — the session expires on its own —
    // and swallowing it keeps the try/catch below as the only failure path.
    const fetchImpl = getFetchImpl(options.fetchImpl);
    await fetchImpl(options.endpoint, {
      method: 'DELETE',
      headers: buildServerHeaders(options.server, {
        'MCP-Protocol-Version': options.protocolVersion,
        'Mcp-Session-Id': options.sessionId
      })
    });
  } catch {
    // ignore close failures
  }
}

export async function requestStreamableJsonRpc(
  payload: JsonRpcRequest,
  options: McpTransportOptions & StreamableSession & { label: string }
) {
  const response = await postStreamableJsonRpc(payload, options);
  return ensureSuccessMessage(
    await parseHttpJsonRpcResponse(response, payload.id, options.label),
    options.label
  );
}
