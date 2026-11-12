// Ombre-Brain 只读客户端（A 层共用底座）。
//
// 只做这几件事：登录换 cookie、按话检索、列出全部记忆、取单条全文。B（自动召回）和
// C（导入）都建在这上面，所以这里的行为定得死一点：
//   - **整次调用**共用一份时间预算（默认 1.5s）：登录、401 重登、重试都在这份预算里，
//     不会出现"1.5s 登录 + 1.5s 检索 + 1.5s 重登"叠成 4.5s 的情况
//   - 只有 401（密码错）和 429（限流）会把登录标记成"别再试了"；
//     网络抖动/超时**不**粘住，下次调用还会重新登录
//   - 任何失败都返回空结果，不抛异常——召回是锦上添花，不能因为它崩掉一次聊天

import { createDefaultObTransport, type ObTransport } from './obTransport';

/** A 层默认预算：够本地/内网用，又不至于卡住一轮回复。 */
export const DEFAULT_OB_TIMEOUT_MS = 1500;

export type ObSearchHit = {
  id: string;
  name: string;
  score: number;
  domain: string[];
  /** 只有前 200 字，OB 就是这么给的。要全文用 fetchBucket。 */
  contentPreview: string;
};

export type ObBucketSummary = {
  id: string;
  name: string;
  /** `dynamic` / `permanent` 等；归档条目也会出现在列表里。 */
  type: string;
  tags: string[];
  importance: number;
  pinned: boolean;
  resolved: boolean;
  score: number;
  createdAt: string;
  lastActive: string;
  activationCount: number;
  /** 只有前 200 字。 */
  contentPreview: string;
};

export type ObBucketDetail = {
  id: string;
  name: string;
  tags: string[];
  /** 完整正文。 */
  content: string;
};

export type ObCallOptions = {
  /** 这次调用的总预算（毫秒），登录和重试都算在里面。 */
  budgetMs?: number;
};

export type ObClient = {
  /** 按话检索，失败返回空数组。 */
  search(query: string, options?: ObCallOptions & { limit?: number }): Promise<ObSearchHit[]>;
  /** 列出全部记忆（只有 200 字预览），失败返回空数组。 */
  listBuckets(options?: ObCallOptions): Promise<ObBucketSummary[]>;
  /** 取单条全文，失败或不存在返回 null。 */
  fetchBucket(id: string, options?: ObCallOptions): Promise<ObBucketDetail | null>;
  /** 给设置页显示"上次为什么没成"，成功时为 null。 */
  getLastError(): string | null;
  /** 改过地址或密码后调用，丢掉旧 cookie 和失败记忆。 */
  reset(): void;
};

export type CreateObClientArgs = {
  baseUrl: string;
  password: string;
  transport?: ObTransport;
  /** 单次调用的默认预算。 */
  timeoutMs?: number;
};

export function normalizeObBaseUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  // 手输地址最常见的错就是漏了协议头。补上比报错友好，而且 https 是唯一合理猜测。
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return withScheme.replace(/\/+$/, '');
}

function parseJsonBody(body: string): unknown {
  if (!body) return null;
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

/**
 * 按名字取响应头，忽略大小写。
 *
 * 传输层会统一转小写，但这是防御：桌面 fetch 如果哪天换实现、或者有人塞了自定义
 * transport，`Set-Cookie` 会保持原样大小写，这里不能因为大小写就拿不到 cookie。
 */
function readHeader(headers: Record<string, string>, name: string): string {
  const lowerName = name.toLowerCase();
  const direct = headers[lowerName];
  if (typeof direct === 'string') return direct;
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lowerName && typeof value === 'string') return value;
  }
  return '';
}

/**
 * 从 Set-Cookie 里抠出会话 cookie。
 * OB 只认 cookie（`_is_authenticated` 读的是请求 cookie），所以这一步拿不到就等于没登录。
 */
export function extractObSessionCookie(headers: Record<string, string>): string | null {
  const raw = readHeader(headers, 'set-cookie');
  if (!raw) return null;
  const match = /ombre_session=([^;,\s]+)/.exec(raw);
  return match ? `ombre_session=${match[1]}` : null;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function mapSearchHit(raw: unknown): ObSearchHit | null {
  const item = asRecord(raw);
  const id = asString(item.id);
  if (!id) return null;
  return {
    id,
    name: asString(item.name) || id,
    score: asNumber(item.score),
    domain: asStringArray(item.domain),
    contentPreview: asString(item.content_preview)
  };
}

function mapBucketSummary(raw: unknown): ObBucketSummary | null {
  const item = asRecord(raw);
  const id = asString(item.id);
  if (!id) return null;
  return {
    id,
    name: asString(item.name) || id,
    type: asString(item.type) || 'dynamic',
    tags: asStringArray(item.tags),
    importance: asNumber(item.importance, 5),
    pinned: item.pinned === true,
    resolved: item.resolved === true,
    score: asNumber(item.score),
    createdAt: asString(item.created),
    lastActive: asString(item.last_active),
    activationCount: asNumber(item.activation_count),
    contentPreview: asString(item.content_preview)
  };
}

type LoginOutcome =
  | { ok: true; cookie: string }
  | { ok: false; error: string; sticky: boolean };

/**
 * 把传输层抛出来的东西翻译成人能看懂的原因。
 *
 * 之前一律写成「请求失败」，结果超时和设备断网看起来一模一样，没法排查。
 * 这里保留原始信息（截断 80 字），并把各种超时说法统一成「超时」。
 */
function describeTransportError(error: unknown, action: '登录' | '请求'): string {
  const name = error instanceof Error ? error.name : '';
  const raw = (error instanceof Error ? error.message : String(error ?? '')).trim();
  if (name === 'AbortError' || /timeout|timed?\s*out|time out|timeout/i.test(raw)) {
    return `OB ${action}超时`;
  }
  const shortened = raw.length > 80 ? `${raw.slice(0, 80)}…` : raw;
  return shortened ? `OB ${action}失败：${shortened}` : `OB ${action}失败`;
}

export function createObClient({
  baseUrl,
  password,
  transport,
  timeoutMs = DEFAULT_OB_TIMEOUT_MS
}: CreateObClientArgs): ObClient {
  const base = normalizeObBaseUrl(baseUrl);
  const http = transport ?? createDefaultObTransport();
  let sessionCookie: string | null = null;
  /** 只有密码错 / 被限流才置位，避免拿网络抖动去封死整次会话。 */
  let loginFailed = false;
  let lastError: string | null = null;

  const fail = (message: string) => {
    lastError = message;
    return null;
  };

  const login = async (budgetMs: number): Promise<LoginOutcome> => {
    if (budgetMs <= 0) return { ok: false, error: 'OB 请求超时', sticky: false };
    let response;
    try {
      response = await http({
        url: `${base}/auth/login`,
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password }),
        timeoutMs: budgetMs
      });
    } catch (error) {
      return { ok: false, error: describeTransportError(error, '登录'), sticky: false };
    }
    if (response.status === 200) {
      const cookie = extractObSessionCookie(response.headers);
      if (!cookie) return { ok: false, error: 'OB 登录成功但没有拿到会话 cookie', sticky: false };
      sessionCookie = cookie;
      loginFailed = false;
      return { ok: true, cookie };
    }
    if (response.status === 401) return { ok: false, error: 'OB 密码不对', sticky: true };
    if (response.status === 429) return { ok: false, error: 'OB 登录太频繁，被限流了', sticky: true };
    return { ok: false, error: `OB 登录失败（HTTP ${response.status}）`, sticky: false };
  };

  /** 带 cookie 请求；401 时重登一次再重试。整条链共用一份时间预算。 */
  const request = async (path: string, budgetMs: number): Promise<string | null> => {
    if (!base) return fail('没有填 OB 地址');
    if (!password) return fail('没有填 OB 密码');

    const deadline = Date.now() + budgetMs;
    const remaining = () => deadline - Date.now();

    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (!sessionCookie) {
        if (loginFailed) return null;
        const outcome = await login(remaining());
        if (!outcome.ok) {
          lastError = outcome.error;
          if (outcome.sticky) loginFailed = true;
          return null;
        }
      }

      const allowed = remaining();
      if (allowed <= 0) return fail('OB 请求超时');

      let response;
      try {
        response = await http({
          url: `${base}${path}`,
          method: 'GET',
          headers: { cookie: sessionCookie ?? '' },
          timeoutMs: allowed
        });
      } catch (error) {
        return fail(describeTransportError(error, '请求'));
      }

      if (response.status === 401) {
        sessionCookie = null;
        continue;
      }
      if (response.status !== 200) return fail(`OB 请求失败（HTTP ${response.status}）`);

      lastError = null;
      return response.body;
    }

    return fail('OB 会话失效，重新登录后仍然被拒');
  };

  return {
    async search(query, options) {
      const trimmed = query.trim();
      if (!trimmed) return [];
      const body = await request(
        `/api/search?q=${encodeURIComponent(trimmed)}`,
        options?.budgetMs ?? timeoutMs
      );
      if (body === null) return [];
      const parsed = parseJsonBody(body);
      if (!Array.isArray(parsed)) return [];
      const limit = Math.max(0, options?.limit ?? 5);
      return parsed
        .map(mapSearchHit)
        .filter((hit): hit is ObSearchHit => hit !== null)
        .slice(0, limit);
    },

    async listBuckets(options) {
      const body = await request('/api/buckets', options?.budgetMs ?? timeoutMs);
      if (body === null) return [];
      const parsed = parseJsonBody(body);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .map(mapBucketSummary)
        .filter((bucket): bucket is ObBucketSummary => bucket !== null);
    },

    async fetchBucket(id, options) {
      const trimmed = id.trim();
      if (!trimmed) return null;
      const body = await request(
        `/api/bucket/${encodeURIComponent(trimmed)}`,
        options?.budgetMs ?? timeoutMs
      );
      if (body === null) return null;
      const parsed = asRecord(parseJsonBody(body));
      const bucketId = asString(parsed.id);
      if (!bucketId) return null;
      const metadata = asRecord(parsed.metadata);
      return {
        id: bucketId,
        name: asString(metadata.name) || bucketId,
        tags: asStringArray(metadata.tags),
        content: asString(parsed.content)
      };
    },

    getLastError() {
      return lastError;
    },

    reset() {
      sessionCookie = null;
      loginFailed = false;
      lastError = null;
    }
  };
}
