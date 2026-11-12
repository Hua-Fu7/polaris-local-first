import { describe, expect, it } from 'vitest';
import { createObClient, extractObSessionCookie, normalizeObBaseUrl } from './obClient';
import type { ObTransportRequest, ObTransportResponse } from './obTransport';

type Handler = (request: ObTransportRequest, callIndex: number) => ObTransportResponse | Promise<ObTransportResponse>;

function createFakeTransport(handler: Handler) {
  const calls: ObTransportRequest[] = [];
  const transport = async (request: ObTransportRequest) => {
    calls.push(request);
    return handler(request, calls.length - 1);
  };
  return { transport, calls };
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): ObTransportResponse {
  return { status, headers, body: JSON.stringify(body) };
}

const SESSION = { 'set-cookie': 'ombre_session=abc123; Path=/; HttpOnly' };

const HIT = { id: 'b1', name: '生日', score: 0.9, domain: ['person'], content_preview: '测试用户 的生日是 3 月 14 日。' };

describe('obClient', () => {
  it('先登录再检索，并把 cookie 带在请求上', async () => {
    const { transport, calls } = createFakeTransport((request) => {
      if (request.url.endsWith('/auth/login')) return json(200, { ok: true }, SESSION);
      return json(200, [HIT]);
    });
    const client = createObClient({ baseUrl: 'https://ob.example/', password: 'pw', transport });

    const hits = await client.search('生日');

    expect(hits).toHaveLength(1);
    expect(hits[0].id).toBe('b1');
    expect(hits[0].contentPreview).toContain('3 月 14 日');
    // 地址末尾的斜杠被去掉了
    expect(calls[0].url).toBe('https://ob.example/auth/login');
    expect(calls[1].url).toBe('https://ob.example/api/search?q=%E7%94%9F%E6%97%A5');
    expect(calls[1].headers.cookie).toBe('ombre_session=abc123');
  });

  it('登录一次之后复用 cookie，不重复登录', async () => {
    const { transport, calls } = createFakeTransport((request) => {
      if (request.url.endsWith('/auth/login')) return json(200, { ok: true }, SESSION);
      return json(200, []);
    });
    const client = createObClient({ baseUrl: 'https://ob.example', password: 'pw', transport });

    await client.search('猫');
    await client.search('狗');

    expect(calls.filter((call) => call.url.endsWith('/auth/login'))).toHaveLength(1);
  });

  it('401 时重新登录一次并重试成功', async () => {
    const { transport, calls } = createFakeTransport((request) => {
      if (request.url.endsWith('/auth/login')) return json(200, { ok: true }, SESSION);
      const searchCalls = calls.filter((call) => call.url.includes('/api/search')).length;
      if (searchCalls === 1) return json(401, { error: 'unauthorized' });
      return json(200, [{ ...HIT, id: 'b9', content_preview: '养了一只猫。' }]);
    });
    const client = createObClient({ baseUrl: 'https://ob.example', password: 'pw', transport });

    const hits = await client.search('猫');

    expect(hits.map((hit) => hit.id)).toEqual(['b9']);
    expect(calls.filter((call) => call.url.endsWith('/auth/login'))).toHaveLength(2);
  });

  it('重登之后仍然 401 就放弃，不无限重试', async () => {
    const { transport, calls } = createFakeTransport((request) => {
      if (request.url.endsWith('/auth/login')) return json(200, { ok: true }, SESSION);
      return json(401, { error: 'unauthorized' });
    });
    const client = createObClient({ baseUrl: 'https://ob.example', password: 'pw', transport });

    expect(await client.search('猫')).toEqual([]);
    expect(calls.filter((call) => call.url.endsWith('/auth/login'))).toHaveLength(2);
    expect(calls.filter((call) => call.url.includes('/api/search'))).toHaveLength(2);
    expect(client.getLastError()).toContain('仍然被拒');
  });

  it('密码错时立刻停手，不反复撞登录限流', async () => {
    const { transport, calls } = createFakeTransport((request) => {
      if (request.url.endsWith('/auth/login')) return json(401, { error: '密码错误' });
      return json(200, []);
    });
    const client = createObClient({ baseUrl: 'https://ob.example', password: 'wrong', transport });

    expect(await client.search('猫')).toEqual([]);
    expect(await client.search('狗')).toEqual([]);

    expect(calls.filter((call) => call.url.endsWith('/auth/login'))).toHaveLength(1);
    expect(client.getLastError()).toBe('OB 密码不对');
  });

  it('网络抖动不粘住：这次失败，下次仍然会重试登录', async () => {
    let loginAttempts = 0;
    const { transport } = createFakeTransport((request) => {
      if (request.url.endsWith('/auth/login')) {
        loginAttempts += 1;
        if (loginAttempts === 1) {
          const error = new Error('network');
          error.name = 'AbortError';
          throw error;
        }
        return json(200, { ok: true }, SESSION);
      }
      return json(200, [HIT]);
    });
    const client = createObClient({ baseUrl: 'https://ob.example', password: 'pw', transport });

    expect(await client.search('猫')).toEqual([]);
    expect(client.getLastError()).toBe('OB 登录超时');

    const hits = await client.search('猫');

    expect(hits.map((hit) => hit.id)).toEqual(['b1']);
    expect(loginAttempts).toBe(2);
  });

  it('预算花在登录上就用光，不再发检索请求', async () => {
    const { transport, calls } = createFakeTransport(async (request) => {
      if (request.url.endsWith('/auth/login')) {
        await new Promise((resolve) => setTimeout(resolve, 30));
        return json(200, { ok: true }, SESSION);
      }
      return json(200, [HIT]);
    });
    const client = createObClient({ baseUrl: 'https://ob.example', password: 'pw', transport });

    expect(await client.search('猫', { budgetMs: 10 })).toEqual([]);
    expect(calls).toHaveLength(1);
    expect(client.getLastError()).toBe('OB 请求超时');
  });

  it('取单条全文时用 /api/bucket/{id}', async () => {
    const { transport, calls } = createFakeTransport((request) => {
      if (request.url.endsWith('/auth/login')) return json(200, { ok: true }, SESSION);
      return json(200, {
        id: 'b1',
        metadata: { name: '生日', tags: ['person'] },
        content: '测试用户 的生日是 3 月 14 日，那天喜欢吃面。',
        score: 1.1
      });
    });
    const client = createObClient({ baseUrl: 'https://ob.example', password: 'pw', transport });

    const bucket = await client.fetchBucket('b1');

    expect(calls[1].url).toBe('https://ob.example/api/bucket/b1');
    expect(bucket?.content).toContain('喜欢吃面');
    expect(bucket?.name).toBe('生日');
  });

  it('取全文遇到 404 时返回 null 并记下原因', async () => {
    const { transport } = createFakeTransport((request) => {
      if (request.url.endsWith('/auth/login')) return json(200, { ok: true }, SESSION);
      return json(404, { error: 'not found' });
    });
    const client = createObClient({ baseUrl: 'https://ob.example', password: 'pw', transport });

    expect(await client.fetchBucket('nope')).toBeNull();
    expect(client.getLastError()).toContain('404');
  });

  it('请求抛异常时静默返回空数组，并把原因留给设置页', async () => {
    const transport = async () => {
      const error = new Error('timed out');
      error.name = 'AbortError';
      throw error;
    };
    const client = createObClient({ baseUrl: 'https://ob.example', password: 'pw', transport });

    expect(await client.listBuckets()).toEqual([]);
    expect(client.getLastError()).toBe('OB 登录超时');
  });

  it('把底层错误原样带出来，别一律写成「请求失败」', async () => {
    const transport = async () => {
      throw new Error('Unable to resolve host "ombrebrain.nat100.top"');
    };
    const client = createObClient({ baseUrl: 'https://ob.example', password: 'pw', transport });

    expect(await client.search('猫')).toEqual([]);
    expect(client.getLastError()).toContain('OB 登录失败：Unable to resolve host');
  });

  it('底层报超时（哪怕不是 AbortError）也说成超时', async () => {
    const transport = async () => {
      throw new Error('Read timed out');
    };
    const client = createObClient({ baseUrl: 'https://ob.example', password: 'pw', transport });

    await client.search('猫');
    expect(client.getLastError()).toBe('OB 登录超时');
  });

  it('没填地址或密码时不发请求', async () => {
    const { transport, calls } = createFakeTransport(() => json(200, []));

    expect(await createObClient({ baseUrl: '', password: 'pw', transport }).search('猫')).toEqual([]);
    expect(await createObClient({ baseUrl: 'https://ob.example', password: '', transport }).search('猫')).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('把列出结果的字段名换成驼峰，并丢掉没有 id 的脏条目', async () => {
    const { transport } = createFakeTransport((request) => {
      if (request.url.endsWith('/auth/login')) return json(200, { ok: true }, SESSION);
      return json(200, [
        {
          id: 'b1',
          name: '生日',
          type: 'permanent',
          tags: ['person'],
          importance: 8,
          pinned: true,
          resolved: true,
          score: 1.2,
          created: '2026-01-01',
          last_active: '2026-02-02',
          activation_count: 3,
          content_preview: '预览文字'
        },
        { name: '没有 id 的脏数据' }
      ]);
    });
    const client = createObClient({ baseUrl: 'https://ob.example', password: 'pw', transport });

    const buckets = await client.listBuckets();

    expect(buckets).toHaveLength(1);
    expect(buckets[0]).toMatchObject({
      id: 'b1',
      type: 'permanent',
      tags: ['person'],
      importance: 8,
      pinned: true,
      resolved: true,
      lastActive: '2026-02-02',
      activationCount: 3,
      contentPreview: '预览文字'
    });
  });

  it('reset 之后重新登录', async () => {
    const { transport, calls } = createFakeTransport((request) => {
      if (request.url.endsWith('/auth/login')) return json(200, { ok: true }, SESSION);
      return json(200, []);
    });
    const client = createObClient({ baseUrl: 'https://ob.example', password: 'pw', transport });

    await client.search('猫');
    client.reset();
    await client.search('猫');

    expect(calls.filter((call) => call.url.endsWith('/auth/login'))).toHaveLength(2);
  });
});

describe('normalizeObBaseUrl', () => {
  it('补上漏掉的协议头，去掉末尾斜杠', () => {
    expect(normalizeObBaseUrl('  https://ob.example/  ')).toBe('https://ob.example');
    expect(normalizeObBaseUrl('http://192.168.1.9:8000')).toBe('http://192.168.1.9:8000');
    expect(normalizeObBaseUrl('ombrebrain.nat100.top')).toBe('https://ombrebrain.nat100.top');
    expect(normalizeObBaseUrl('')).toBe('');
  });
});

describe('extractObSessionCookie', () => {
  it('从 Set-Cookie 里只取 ombre_session 这一段', () => {
    expect(extractObSessionCookie({ 'set-cookie': 'ombre_session=xyz; Path=/; HttpOnly; Secure' })).toBe('ombre_session=xyz');
    expect(extractObSessionCookie({ 'set-cookie': 'a=1, ombre_session=xyz; Path=/' })).toBe('ombre_session=xyz');
    expect(extractObSessionCookie({ 'set-cookie': 'other=1; Path=/' })).toBeNull();
    expect(extractObSessionCookie({})).toBeNull();
  });

  it('响应头大小写不敏感', () => {
    expect(extractObSessionCookie({ 'Set-Cookie': 'ombre_session=xyz; Path=/' })).toBe('ombre_session=xyz');
  });
});
