import { afterEach, describe, expect, it, vi } from 'vitest';

// mcpRuntimeHttp 在原生端会走 native/providerHttp 的 NativeProviderHttp 插件，
// 这里搭一个最小的假 MCP 服务：按请求体里的 method 回对应的 JSON-RPC 结果。
const nativeHttp = vi.hoisted(() => {
  const state = {
    listeners: [] as Array<(event: { requestId: string; type: string; data?: string }) => void>,
    startCalls: [] as Array<{ url: string; method: string }>
  };

  function replyFor(body: { id?: unknown; method?: string }) {
    if (body.method === 'initialize') {
      return {
        jsonrpc: '2.0',
        id: body.id,
        result: { protocolVersion: '2025-03-26', capabilities: { tools: {} } }
      };
    }
    if (body.method === 'notifications/initialized') {
      return null;
    }
    if (body.method === 'tools/list') {
      return {
        jsonrpc: '2.0',
        id: body.id,
        result: {
          tools: [{ name: 'get_weather', description: 'Get weather', inputSchema: { type: 'object' } }]
        }
      };
    }
    if (body.method === 'tools/call') {
      return {
        jsonrpc: '2.0',
        id: body.id,
        result: { content: [{ type: 'text', text: 'Current weather: sunny' }] }
      };
    }
    return null;
  }

  const plugin = {
    start: async (options: { requestId: string; url: string; body?: string }) => {
      const body = options.body ? JSON.parse(options.body) : {};
      state.startCalls.push({ url: options.url, method: body?.method ?? '' });
      const reply = replyFor(body);
      const base64 = reply ? Buffer.from(JSON.stringify(reply), 'utf8').toString('base64') : '';
      // 事件在 start 的 await 之后才到，providerHttp 会把先到的事件排队，这里用微任务复现同样的时序。
      queueMicrotask(() => {
        for (const listener of [...state.listeners]) {
          if (base64) listener({ requestId: options.requestId, type: 'chunk', data: base64 });
          listener({ requestId: options.requestId, type: 'complete' });
        }
      });
      return { status: 200, contentType: 'application/json' };
    },
    cancel: async () => undefined,
    addListener: async (
      _eventName: string,
      listener: (event: { requestId: string; type: string; data?: string }) => void
    ) => {
      state.listeners.push(listener);
      return {
        remove: async () => {
          state.listeners = state.listeners.filter((item) => item !== listener);
        }
      };
    }
  };

  return { state, plugin };
});

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: vi.fn(() => false),
    getPlatform: vi.fn(() => 'web'),
    isPluginAvailable: vi.fn(() => true)
  },
  CapacitorHttp: {
    request: vi.fn()
  },
  registerPlugin: vi.fn(() => nativeHttp.plugin)
}));

import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { clearMcpToolCatalogCacheForTests, invokeMcpTool, resolveMcpToolCatalog } from './mcpRuntime';
import type { McpServerConfig } from '../types/domain';

function createServer(overrides: Partial<McpServerConfig> = {}): McpServerConfig {
  return {
    id: 'server-1',
    handle: 'weather',
    name: 'Weather MCP',
    description: '',
    transport: 'streamable-http',
    url: 'https://mcp.example.com',
    headers: [],
    isActive: true,
    ...overrides
  };
}

function createJsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers ?? {})
    },
    ...init
  });
}

function createNativeResponse(data: unknown, init?: { status?: number; headers?: Record<string, string> }) {
  return {
    data,
    status: init?.status ?? 200,
    headers: init?.headers ?? {},
    url: 'https://mcp.example.com'
  };
}

describe('mcpRuntime', () => {
  afterEach(() => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
    vi.mocked(Capacitor.getPlatform).mockReturnValue('web');
    vi.mocked(CapacitorHttp.request).mockReset();
    nativeHttp.state.startCalls = [];
    nativeHttp.state.listeners = [];
    clearMcpToolCatalogCacheForTests();
    vi.unstubAllGlobals();
  });

  it('lists streamable-http MCP tools into Polaris tool definitions', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : null;

      if (body?.method === 'initialize') {
        return createJsonResponse({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            protocolVersion: '2025-03-26',
            capabilities: {
              tools: {}
            }
          }
        }, {
          headers: {
            'content-type': 'application/json',
            'Mcp-Session-Id': 'session-1'
          }
        });
      }

      if (body?.method === 'notifications/initialized') {
        return new Response(null, { status: 202 });
      }

      if (body?.method === 'tools/list') {
        return createJsonResponse({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            tools: [{
              name: 'get_weather',
              description: 'Get weather by city',
              inputSchema: {
                type: 'object',
                properties: {
                  city: {
                    type: 'string'
                  }
                },
                required: ['city']
              }
            }]
          }
        });
      }

      if (init?.method === 'DELETE' && String(input) === 'https://mcp.example.com') {
        return new Response(null, { status: 204 });
      }

      throw new Error(`Unexpected fetch call: ${String(input)} ${init?.method ?? 'GET'}`);
    });

    const result = await resolveMcpToolCatalog({
      servers: [createServer()],
      timeoutSeconds: 5,
      fetchImpl: fetchMock as typeof fetch
    });

    expect(result.errors).toEqual([]);
    expect(result.tools).toHaveLength(1);
    expect(result.tools[0]).toMatchObject({
      serverId: 'server-1',
      serverName: 'Weather MCP',
      toolName: 'get_weather'
    });
    expect(result.tools[0]?.schemaName).toContain('mcp__weather__get_weather');
  });

  it('filters disabled MCP tools unless the caller is syncing the server catalog', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : null;

      if (body?.method === 'initialize') {
        return createJsonResponse({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            protocolVersion: '2025-03-26',
            capabilities: {
              tools: {}
            }
          }
        }, {
          headers: {
            'content-type': 'application/json',
            'Mcp-Session-Id': 'session-filter'
          }
        });
      }

      if (body?.method === 'notifications/initialized') {
        return new Response(null, { status: 202 });
      }

      if (body?.method === 'tools/list') {
        return createJsonResponse({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            tools: [
              { name: 'read_notes', description: 'Read notes' },
              { name: 'delete_notes', description: 'Delete notes' }
            ]
          }
        });
      }

      if (init?.method === 'DELETE') {
        return new Response(null, { status: 204 });
      }

      throw new Error(`Unexpected fetch call: ${String(_input)} ${init?.method ?? 'GET'}`);
    });

    const server = createServer({
      tools: [{
        name: 'delete_notes',
        description: 'Delete notes',
        inputSchema: { type: 'object' },
        enabled: false
      }]
    });

    const visible = await resolveMcpToolCatalog({
      servers: [server],
      timeoutSeconds: 5,
      fetchImpl: fetchMock as typeof fetch,
      retryDelaysMs: []
    });
    const syncing = await resolveMcpToolCatalog({
      servers: [server],
      timeoutSeconds: 5,
      fetchImpl: fetchMock as typeof fetch,
      retryDelaysMs: [],
      includeDisabledTools: true
    });

    expect(visible.tools.map((tool) => tool.toolName)).toEqual(['read_notes']);
    expect(syncing.tools.map((tool) => [tool.toolName, tool.enabled])).toEqual([
      ['read_notes', true],
      ['delete_notes', false]
    ]);
  });

  it.each(['ios', 'android'] as const)('routes streamable-http MCP through the native bridge on native %s', async (platform) => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(Capacitor.getPlatform).mockReturnValue(platform);
    // 原生端必须走 NativeProviderHttp 桥：WebView 里的 fetch 受 CORS 约束，很多 MCP
    // 服务器（galatea、lkcoffee 之类）根本不回 OPTIONS 预检，带 Authorization 就必然失败。
    // 见 mcpRuntimeHttp.ts 里的 shouldUseNativeMcpHttp。
    const nativeRequestMock = vi.mocked(CapacitorHttp.request).mockResolvedValue(
      createNativeResponse('', { status: 500 })
    );
    const fetchMock = vi.fn(async () => {
      throw new Error(`fetch must not be used on native ${platform}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await resolveMcpToolCatalog({
      servers: [createServer()],
      timeoutSeconds: 5
    });

    expect(result.errors).toEqual([]);
    expect(result.tools[0]).toMatchObject({
      serverId: 'server-1',
      toolName: 'get_weather'
    });
    expect(nativeHttp.state.startCalls.map((call) => call.method)).toEqual([
      'initialize',
      'notifications/initialized',
      'tools/list'
    ]);
    expect(nativeHttp.state.startCalls.every((call) => call.url === 'https://mcp.example.com')).toBe(true);
    // 桥接走的是自定义插件，既不是 CapacitorHttp，也不是 fetch。
    expect(fetchMock).not.toHaveBeenCalled();
    expect(nativeRequestMock).not.toHaveBeenCalled();
  });

  it('retries MCP catalog reads before hiding tools from the directory', async () => {
    let initializeAttempts = 0;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : null;

      if (body?.method === 'initialize') {
        initializeAttempts += 1;
        if (initializeAttempts === 1) {
          throw new Error('temporary network drop');
        }
        return createJsonResponse({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            protocolVersion: '2025-03-26',
            capabilities: {
              tools: {}
            }
          }
        }, {
          headers: {
            'content-type': 'application/json',
            'Mcp-Session-Id': 'session-retry'
          }
        });
      }

      if (body?.method === 'notifications/initialized') {
        return new Response(null, { status: 202 });
      }

      if (body?.method === 'tools/list') {
        return createJsonResponse({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            tools: [{
              name: 'search_memory',
              description: 'Search memory'
            }]
          }
        });
      }

      if (init?.method === 'DELETE') {
        return new Response(null, { status: 204 });
      }

      throw new Error(`Unexpected fetch call: ${init?.method ?? 'GET'}`);
    });

    const result = await resolveMcpToolCatalog({
      servers: [createServer()],
      timeoutSeconds: 5,
      fetchImpl: fetchMock as typeof fetch,
      retryDelaysMs: [0]
    });

    expect(initializeAttempts).toBe(2);
    expect(result.errors).toEqual([]);
    expect(result.tools[0]?.toolName).toBe('search_memory');
  });

  it('keeps the last successful MCP tool directory when a heartbeat refresh fails', async () => {
    const successFetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : null;

      if (body?.method === 'initialize') {
        return createJsonResponse({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            protocolVersion: '2025-03-26',
            capabilities: {
              tools: {}
            }
          }
        }, {
          headers: {
            'content-type': 'application/json',
            'Mcp-Session-Id': 'session-cache'
          }
        });
      }

      if (body?.method === 'notifications/initialized') {
        return new Response(null, { status: 202 });
      }

      if (body?.method === 'tools/list') {
        return createJsonResponse({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            tools: [{
              name: 'read_notes',
              description: 'Read notes'
            }]
          }
        });
      }

      if (init?.method === 'DELETE') {
        return new Response(null, { status: 204 });
      }

      throw new Error(`Unexpected fetch call: ${init?.method ?? 'GET'}`);
    });

    await resolveMcpToolCatalog({
      servers: [createServer()],
      timeoutSeconds: 5,
      fetchImpl: successFetch as typeof fetch,
      retryDelaysMs: []
    });

    const failingFetch = vi.fn(async () => {
      throw new Error('offline');
    });
    const result = await resolveMcpToolCatalog({
      servers: [createServer()],
      timeoutSeconds: 5,
      fetchImpl: failingFetch as typeof fetch,
      retryDelaysMs: []
    });

    expect(result.errors).toEqual([]);
    expect(result.tools[0]?.toolName).toBe('read_notes');
  });

  it('supports legacy SSE transport when the POST endpoint returns JSON-RPC responses', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'GET') {
        return new Response('event: endpoint\ndata: /messages\n\n', {
          status: 200,
          headers: {
            'content-type': 'text/event-stream'
          }
        });
      }

      const body = init?.body ? JSON.parse(String(init.body)) : null;
      if (body?.method === 'initialize') {
        return createJsonResponse({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            protocolVersion: '2025-03-26',
            capabilities: {
              tools: {}
            }
          }
        });
      }

      if (body?.method === 'notifications/initialized') {
        return new Response(null, { status: 202 });
      }

      if (body?.method === 'tools/list') {
        return createJsonResponse({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            tools: [{
              name: 'search_docs',
              description: 'Search docs',
              inputSchema: {
                type: 'object',
                properties: {
                  query: {
                    type: 'string'
                  }
                }
              }
            }]
          }
        });
      }

      throw new Error(`Unexpected fetch call: ${init?.method ?? 'GET'}`);
    });

    const result = await resolveMcpToolCatalog({
      servers: [createServer({
        id: 'server-2',
        handle: 'docs',
        name: 'Docs MCP',
        transport: 'sse',
        url: 'https://legacy.example.com/sse'
      })],
      timeoutSeconds: 5,
      fetchImpl: fetchMock as typeof fetch
    });

    expect(result.errors).toEqual([]);
    expect(result.tools[0]).toMatchObject({
      serverId: 'server-2',
      toolName: 'search_docs',
      schemaName: 'mcp__docs__search_docs'
    });
  });

  it('calls a discovered MCP tool and formats the text result', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : null;

      if (body?.method === 'initialize') {
        return createJsonResponse({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            protocolVersion: '2025-03-26',
            capabilities: {
              tools: {}
            }
          }
        }, {
          headers: {
            'content-type': 'application/json',
            'Mcp-Session-Id': 'session-2'
          }
        });
      }

      if (body?.method === 'notifications/initialized') {
        return new Response(null, { status: 202 });
      }

      if (body?.method === 'tools/call') {
        return createJsonResponse({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            content: [{
              type: 'text',
              text: 'Current weather: sunny'
            }, {
              type: 'image',
              data: 'iVBORw0KGgo=',
              mimeType: 'image/png'
            }, {
              type: 'audio',
              data: 'bXAz',
              mimeType: 'audio/mpeg'
            }, {
              type: 'resource',
              resource: {
                uri: 'docs://guide/readme.md',
                mimeType: 'text/markdown',
                text: '# Guide'
              }
            }],
            structuredContent: {
              replies: [{ id: 8891 }]
            }
          }
        });
      }

      if (init?.method === 'DELETE') {
        return new Response(null, { status: 204 });
      }

      throw new Error(`Unexpected fetch call: ${init?.method ?? 'GET'}`);
    });

    const result = await invokeMcpTool({
      tool: {
        schemaName: 'mcp__weather__get_weather',
        serverId: 'server-1',
        serverName: 'Weather MCP',
        serverHandle: 'weather',
        transport: 'streamable-http',
        url: 'https://mcp.example.com',
        toolName: 'get_weather',
        description: 'Get weather',
        inputSchema: {
          type: 'object',
          properties: {
            city: {
              type: 'string'
            }
          }
        }
      },
      argumentsObject: {
        city: 'Shanghai'
      },
      timeoutSeconds: 5,
      fetchImpl: fetchMock as typeof fetch
    });

    expect(result).toEqual({
      ok: true,
      detailText: 'Current weather: sunny\n\n[image image/png]\n\n[audio audio/mpeg]\n\n[resource docs://guide/readme.md]\n\n{"replies":[{"id":8891}]}',
      isError: false,
      attachmentContent: [
        {
          kind: 'image',
          sourceType: 'image',
          dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
          mimeType: 'image/png',
          name: 'image-2.png'
        },
        {
          kind: 'file',
          sourceType: 'audio',
          dataUrl: 'data:audio/mpeg;base64,bXAz',
          mimeType: 'audio/mpeg',
          name: 'audio-3.mp3'
        },
        {
          kind: 'file',
          sourceType: 'resource',
          dataUrl: 'data:text/markdown,%23%20Guide',
          mimeType: 'text/markdown',
          name: 'readme.md',
          textContent: '# Guide',
          uri: 'docs://guide/readme.md'
        }
      ],
      structuredContent: {
        replies: [{ id: 8891 }]
      }
    });
  });

  it('keeps MCP isError results as executed tool evidence', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : null;

      if (body?.method === 'initialize') {
        return createJsonResponse({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            protocolVersion: '2025-03-26',
            capabilities: {
              tools: {}
            }
          }
        }, {
          headers: {
            'content-type': 'application/json',
            'Mcp-Session-Id': 'session-error'
          }
        });
      }

      if (body?.method === 'notifications/initialized') {
        return new Response(null, { status: 202 });
      }

      if (body?.method === 'tools/call') {
        return createJsonResponse({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            isError: true,
            content: [{
              type: 'text',
              text: 'Permission denied'
            }],
            structuredContent: {
              code: 'permission_denied',
              retryable: false
            }
          }
        });
      }

      if (init?.method === 'DELETE') {
        return new Response(null, { status: 204 });
      }

      throw new Error(`Unexpected fetch call: ${init?.method ?? 'GET'}`);
    });

    const result = await invokeMcpTool({
      tool: {
        schemaName: 'mcp__docs__delete_doc',
        serverId: 'server-1',
        serverName: 'Docs MCP',
        serverHandle: 'docs',
        transport: 'streamable-http',
        url: 'https://mcp.example.com',
        toolName: 'delete_doc',
        description: 'Delete doc',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      },
      argumentsObject: {
        id: 'doc-1'
      },
      timeoutSeconds: 5,
      fetchImpl: fetchMock as typeof fetch
    });

    expect(result).toEqual({
      ok: true,
      detailText: 'Permission denied\n\n{"code":"permission_denied","retryable":false}',
      isError: true,
      structuredContent: {
        code: 'permission_denied',
        retryable: false
      }
    });
  });

  it('uses fetch for streamable-http MCP outside native iOS', async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
    vi.mocked(Capacitor.getPlatform).mockReturnValue('web');
    const nativeRequestMock = vi.mocked(CapacitorHttp.request).mockResolvedValue(
      createNativeResponse('', {
        status: 500
      })
    );
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : null;

      if (body?.method === 'initialize') {
        return createJsonResponse({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            protocolVersion: '2025-03-26',
            capabilities: {
              tools: {}
            }
          }
        }, {
          headers: {
            'content-type': 'application/json',
            'Mcp-Session-Id': 'session-2'
          }
        });
      }

      if (body?.method === 'notifications/initialized') {
        return new Response(null, { status: 202 });
      }

      if (body?.method === 'tools/call') {
        return createJsonResponse({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            content: [{
              type: 'text',
              text: 'Current weather: sunny'
            }]
          }
        });
      }

      if (init?.method === 'DELETE') {
        return new Response(null, { status: 204 });
      }

      throw new Error(`Unexpected fetch call: ${init?.method ?? 'GET'}`);
    });

    const result = await invokeMcpTool({
      tool: {
        schemaName: 'mcp__weather__get_weather',
        serverId: 'server-1',
        serverName: 'Weather MCP',
        serverHandle: 'weather',
        transport: 'streamable-http',
        url: 'https://mcp.example.com',
        toolName: 'get_weather',
        description: 'Get weather',
        inputSchema: {
          type: 'object',
          properties: {
            city: {
              type: 'string'
            }
          }
        }
      },
      argumentsObject: {
        city: 'Shanghai'
      },
      timeoutSeconds: 5,
      fetchImpl: fetchMock as typeof fetch
    });

    expect(result).toEqual({
      ok: true,
      detailText: 'Current weather: sunny',
      isError: false
    });
    expect(nativeRequestMock).not.toHaveBeenCalled();
  });

  it('reuses a just-read tool directory instead of re-reading it on every send', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : null;

      if (body?.method === 'initialize') {
        return createJsonResponse({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            protocolVersion: '2025-03-26',
            capabilities: {
              tools: {}
            }
          }
        }, {
          headers: {
            'content-type': 'application/json',
            'Mcp-Session-Id': 'session-fresh'
          }
        });
      }

      if (body?.method === 'notifications/initialized') {
        return new Response(null, { status: 202 });
      }

      if (body?.method === 'tools/list') {
        return createJsonResponse({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            tools: [{
              name: 'get_weather',
              description: 'Get weather'
            }]
          }
        });
      }

      if (init?.method === 'DELETE' && String(input) === 'https://mcp.example.com') {
        return new Response(null, { status: 204 });
      }

      throw new Error(`Unexpected fetch call: ${String(input)} ${init?.method ?? 'GET'}`);
    });
    const server = createServer({ id: 'server-fresh', handle: 'fresh' });

    const first = await resolveMcpToolCatalog({
      servers: [server],
      timeoutSeconds: 5,
      fetchImpl: fetchMock as typeof fetch
    });
    const callsAfterFirstRead = fetchMock.mock.calls.length;

    const second = await resolveMcpToolCatalog({
      servers: [server],
      timeoutSeconds: 5,
      fetchImpl: fetchMock as typeof fetch
    });

    expect(first.tools.map((tool) => tool.toolName)).toEqual(['get_weather']);
    expect(second.tools.map((tool) => tool.toolName)).toEqual(['get_weather']);
    // 目录刚读过就不该再占着发送路径等一次网络——新鲜度由心跳负责。
    expect(fetchMock.mock.calls.length).toBe(callsAfterFirstRead);

    const refreshed = await resolveMcpToolCatalog({
      servers: [server],
      timeoutSeconds: 5,
      fetchImpl: fetchMock as typeof fetch,
      forceRefresh: true
    });

    expect(refreshed.tools.map((tool) => tool.toolName)).toEqual(['get_weather']);
    expect(fetchMock.mock.calls.length).toBeGreaterThan(callsAfterFirstRead);
  });

  it('stops re-paying the retry budget while an MCP server is known to be down', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('connection refused');
    });
    const server = createServer({ id: 'server-down', handle: 'down' });

    const first = await resolveMcpToolCatalog({
      servers: [server],
      timeoutSeconds: 5,
      fetchImpl: fetchMock as typeof fetch,
      retryDelaysMs: [0, 0, 0]
    });
    const attemptsAfterFirstCall = fetchMock.mock.calls.length;

    const second = await resolveMcpToolCatalog({
      servers: [server],
      timeoutSeconds: 5,
      fetchImpl: fetchMock as typeof fetch,
      retryDelaysMs: [0, 0, 0]
    });

    // 第一次照旧把重试走完……
    expect(attemptsAfterFirstCall).toBeGreaterThan(1);
    expect(first.errors).toHaveLength(1);
    // ……之后每次发送都不再为一个已知挂掉的服务器重走一遍退避。
    expect(fetchMock.mock.calls.length).toBe(attemptsAfterFirstCall);
    expect(second.tools).toEqual([]);
    expect(second.errors).toHaveLength(1);
  });
});
