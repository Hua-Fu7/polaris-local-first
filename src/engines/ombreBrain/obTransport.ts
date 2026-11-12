// Ombre-Brain HTTP 传输层。
//
// OB 的接口是普通 HTTP（`/auth/login`、`/api/search`、`/api/buckets` …），带 cookie 会话。
// WebView 里的 fetch 会被 CORS 挡掉，所以原生侧走 CapacitorHttp；桌面/dev 用 fetch。
//
// 注意：项目自己的 NativeProviderHttp 桥只回 status + body，**读不到响应头**，
// 因此拿不到 `Set-Cookie`，cookie 会话不能走那条桥。

import { Capacitor, CapacitorHttp } from '@capacitor/core';

export type ObTransportRequest = {
  url: string;
  method: 'GET' | 'POST' | 'DELETE';
  /** 键名会被统一成小写再发出。 */
  headers: Record<string, string>;
  body?: string;
  timeoutMs: number;
};

export type ObTransportResponse = {
  status: number;
  /** 键名已统一成小写。 */
  headers: Record<string, string>;
  body: string;
};

export type ObTransport = (request: ObTransportRequest) => Promise<ObTransportResponse>;

function normalizeHeaders(raw: Record<string, unknown> | undefined): Record<string, string> {
  const headers: Record<string, string> = {};
  if (!raw) return headers;
  for (const [key, value] of Object.entries(raw)) {
    if (value === null || value === undefined) continue;
    headers[key.toLowerCase()] = Array.isArray(value) ? value.join(', ') : String(value);
  }
  return headers;
}

async function requestViaCapacitorHttp(request: ObTransportRequest): Promise<ObTransportResponse> {
  const response = await CapacitorHttp.request({
    url: request.url,
    method: request.method,
    headers: request.headers,
    data: request.body,
    // CapacitorHttp 没有 signal，超时靠这两个字段。
    connectTimeout: request.timeoutMs,
    readTimeout: request.timeoutMs
  });
  const data = response.data;
  return {
    status: response.status,
    headers: normalizeHeaders(response.headers as Record<string, unknown> | undefined),
    body: typeof data === 'string' ? data : JSON.stringify(data ?? '')
  };
}

async function requestViaFetch(request: ObTransportRequest): Promise<ObTransportResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), request.timeoutMs);
  try {
    const response = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      signal: controller.signal
    });
    const body = await response.text();
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    return { status: response.status, headers, body };
  } finally {
    clearTimeout(timer);
  }
}

/** 原生走 CapacitorHttp（免 CORS、能读 Set-Cookie），其余走 fetch。 */
export function createDefaultObTransport(): ObTransport {
  const useNative = Capacitor.isNativePlatform();
  return useNative ? requestViaCapacitorHttp : requestViaFetch;
}
