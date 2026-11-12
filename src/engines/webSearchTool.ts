import { Capacitor } from '@capacitor/core';
import { buildInternalApiEndpoint } from './chat-api/chatApiEndpoint';
import type { ToolResult } from './toolResult';
import type { WebPageReadEvidence, WebSearchConfig, WebSearchEvidence } from '../types/domain';

const DEFAULT_SEARCH_MAX_RESULTS = 8;
const MAX_SEARCH_RESULTS = 20;
const DEFAULT_PAGE_MAX_CHARS = 40_000;
const MAX_PAGE_CHARS = 80_000;
const SEARCH_ENDPOINT = '/api/search';
const BOCHA_SEARCH_URL = 'https://api.bochaai.com/v1/web-search';
const TAVILY_SEARCH_URL = 'https://api.tavily.com/search';
const TAVILY_EXTRACT_URL = 'https://api.tavily.com/extract';
const GITHUB_API_BASE_URL = 'https://api.github.com';

type WebSearchRequestConfig =
  Pick<WebSearchConfig, 'provider' | 'apiKey' | 'bochaSummary' | 'bochaFreshness'>
  & Partial<Pick<WebSearchConfig, 'customEndpoint' | 'customAdapter' | 'customLabel'>>;

export type WebSearchItem = {
  title: string;
  url: string;
  snippet: string;
  source?: string;
  publishedAt?: string;
};

export type WebSearchResult = ToolResult<{
  query: string;
  results: WebSearchItem[];
  provider: string;
  degraded?: boolean;
  warning?: string;
  webSearch: WebSearchEvidence;
  detailText: string;
}>;

type SearchPayload = {
  query: string;
  provider: string;
  degraded?: boolean;
  warning?: string;
  results: WebSearchItem[];
};

type PagePayload = {
  url: string;
  title: string | null;
  text: string;
  provider: string;
  truncated: boolean;
  originalLength: number;
};

export type ReadWebPageResult = ToolResult<{
  url: string;
  title: string | null;
  text: string;
  provider: string;
  truncated: boolean;
  originalLength: number;
  webPageRead: WebPageReadEvidence;
  detailText: string;
}>;

async function postSearchPayload<T>(payload: Record<string, unknown>): Promise<T> {
  const response = await fetch(buildInternalApiEndpoint(SEARCH_ENDPOINT), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json().catch(() => null) as
    | (T & { error?: { message?: string } })
    | { error?: { message?: string } }
    | null;

  if (!response.ok) {
    throw new Error(data?.error?.message || `搜索服务异常（${response.status}）`);
  }
  if (!data) {
    throw new Error('搜索服务返回了空响应。');
  }
  return data as T;
}


function shouldUseDirectBocha(searchConfig?: WebSearchRequestConfig | null) {
  return Boolean(
    searchConfig
    && (
      searchConfig.provider === 'bocha'
      || (searchConfig.provider === 'custom' && searchConfig.customAdapter === 'bocha')
    )
  );
}

function resolveBochaEndpoint(searchConfig: WebSearchRequestConfig) {
  const customEndpoint = searchConfig.provider === 'custom'
    ? searchConfig.customEndpoint?.trim()
    : '';
  return customEndpoint || BOCHA_SEARCH_URL;
}

async function runDirectBochaSearch(
  query: string,
  maxResults: number,
  searchConfig: WebSearchRequestConfig
): Promise<SearchPayload> {
  const apiKey = searchConfig.apiKey.trim();
  if (!apiKey) throw new Error('请先填写 Bocha API Key。');

  const response = await fetch(resolveBochaEndpoint(searchConfig), {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify({
      query,
      count: maxResults,
      summary: searchConfig.bochaSummary,
      freshness: searchConfig.bochaFreshness || 'noLimit'
    })
  });
  const data = await response.json().catch(() => null) as {
    message?: string;
    error?: string | { message?: string };
    data?: { webPages?: { value?: Array<Record<string, unknown>> } };
    webPages?: { value?: Array<Record<string, unknown>> };
  } | null;
  if (!response.ok) {
    const errorMessage = typeof data?.error === 'string'
      ? data.error
      : data?.error?.message;
    throw new Error(errorMessage || data?.message || `Bocha 搜索失败（${response.status}）。`);
  }
  const values = data?.data?.webPages?.value ?? data?.webPages?.value ?? [];
  const results = values.map((item) => ({
    title: String(item.name ?? item.title ?? item.url ?? '未命名结果'),
    url: String(item.url ?? ''),
    snippet: String(item.summary ?? item.snippet ?? item.description ?? ''),
    source: String(item.siteName ?? 'Bocha'),
    publishedAt: item.datePublished ? String(item.datePublished) : undefined
  })).filter((item) => item.url);
  if (!results.length) throw new Error(`没有找到和“${query}”相关的网页结果。`);

  return {
    query,
    provider: searchConfig.provider === 'custom' && searchConfig.customLabel?.trim()
      ? searchConfig.customLabel.trim()
      : 'Bocha',
    results
  };
}


function shouldUseDirectTavily(searchConfig?: WebSearchRequestConfig | null) {
  return Boolean(
    searchConfig
    && (
      searchConfig.provider === 'tavily'
      || (searchConfig.provider === 'custom' && searchConfig.customAdapter === 'tavily')
    )
  );
}

function resolveTavilyEndpoint(searchConfig: WebSearchRequestConfig) {
  const customEndpoint = searchConfig.provider === 'custom'
    ? searchConfig.customEndpoint?.trim()
    : '';
  return customEndpoint || TAVILY_SEARCH_URL;
}

async function runDirectTavilySearch(
  query: string,
  maxResults: number,
  searchConfig: WebSearchRequestConfig
): Promise<SearchPayload> {
  const apiKey = searchConfig.apiKey.trim();
  if (!apiKey) throw new Error('请先填写 Tavily API Key。');

  const response = await fetch(resolveTavilyEndpoint(searchConfig), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      max_results: maxResults,
      search_depth: 'basic',
      include_answer: false,
      include_raw_content: false
    })
  });
  const data = await response.json().catch(() => null) as {
    message?: string;
    error?: string | { message?: string };
    results?: Array<{ title?: string; url?: string; content?: string; score?: number }>;
  } | null;
  if (!response.ok) {
    const errorMessage = typeof data?.error === 'string'
      ? data.error
      : data?.error?.message;
    throw new Error(errorMessage || data?.message || `Tavily 搜索失败（${response.status}）。`);
  }
  const results = (data?.results ?? []).map((item) => ({
    title: item.title?.trim() || item.url?.trim() || '未命名结果',
    url: item.url?.trim() || '',
    snippet: item.content?.trim() || '',
    source: 'Tavily'
  })).filter((item) => item.url);
  if (!results.length) throw new Error(`没有找到和“${query}”相关的网页结果。`);

  return {
    query,
    provider: searchConfig.provider === 'custom' && searchConfig.customLabel?.trim()
      ? searchConfig.customLabel.trim()
      : 'Tavily',
    results
  };
}

/**
 * 手机上读网页正文。
 *
 * WebView 里的 fetch 受 CORS 限制，内部 /api/read 又要求打包期写死
 * VITE_POLARIS_API_ORIGIN，所以原生端默认没有可用的读网页通道。
 * 这里复用用户已经填好的 Tavily key 的 extract 接口，和直连搜索走同一条路。
 */
async function runDirectTavilyExtract(
  rawUrl: string,
  maxChars: number,
  searchConfig: WebSearchRequestConfig
): Promise<PagePayload> {
  const apiKey = searchConfig.apiKey.trim();
  if (!apiKey) throw new Error('请先填写 Tavily API Key。');

  const response = await fetch(TAVILY_EXTRACT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify({
      api_key: apiKey,
      urls: [rawUrl],
      extract_depth: 'basic'
    })
  });
  const data = await response.json().catch(() => null) as {
    message?: string;
    error?: string | { message?: string };
    results?: Array<{ url?: string; raw_content?: string; title?: string }>;
    failed_results?: Array<{ url?: string; error?: string }>;
  } | null;

  if (!response.ok) {
    const errorMessage = typeof data?.error === 'string'
      ? data.error
      : data?.error?.message;
    throw new Error(errorMessage || data?.message || `Tavily 读取失败（${response.status}）。`);
  }

  const first = data?.results?.[0];
  const content = first?.raw_content?.trim() ?? '';
  if (!content) {
    const failure = data?.failed_results?.[0]?.error?.trim();
    throw new Error(failure || '没有拿到该网页的正文。');
  }

  return {
    url: first?.url?.trim() || rawUrl,
    title: first?.title?.trim() || null,
    text: content.slice(0, maxChars),
    provider: 'Tavily',
    truncated: content.length > maxChars,
    originalLength: content.length
  };
}

function parseGithubUrl(rawUrl: string) {  try {
    const input = new URL(rawUrl);
    if (input.hostname !== 'github.com' && input.hostname !== 'www.github.com') return null;
    const parts = input.pathname.split('/').filter(Boolean).map((part) => decodeURIComponent(part));
    const [owner, repo, kind, ...rest] = parts;
    if (!owner || !repo) return null;
    return { owner, repo, kind: kind ?? '', rest };
  } catch {
    return null;
  }
}

function isGithubUrl(rawUrl: string) {
  return Boolean(parseGithubUrl(rawUrl));
}

async function githubApiFetch(path: string, accept = 'application/vnd.github+json') {
  const response = await fetch(`${GITHUB_API_BASE_URL}${path}`, {
    headers: { 'Accept': accept }
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null) as { message?: string } | null;
    throw new Error(data?.message || `GitHub API 请求失败（${response.status}）。`);
  }
  return response;
}

async function readDirectGithubPage(rawUrl: string, maxChars: number): Promise<PagePayload | null> {
  const target = parseGithubUrl(rawUrl);
  if (!target) return null;
  const { owner, repo, kind, rest } = target;
  let title = `${owner}/${repo}`;
  let text = '';
  let canonicalUrl = rawUrl;

  if (kind === 'blob' && rest.length >= 2) {
    const branch = rest[0];
    const filePath = rest.slice(1).join('/');
    const response = await githubApiFetch(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${filePath.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(branch)}`,
      'application/vnd.github.raw+json'
    );
    title = `${owner}/${repo}/${filePath}`;
    text = await response.text();
    canonicalUrl = `https://github.com/${owner}/${repo}/blob/${branch}/${filePath}`;
  } else if (kind === 'issues' || kind === 'pull' || kind === 'pulls') {
    const number = rest[0];
    const response = await githubApiFetch(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${encodeURIComponent(number || '')}`
    );
    const data = await response.json() as Record<string, unknown>;
    title = String(data.title ?? `${owner}/${repo}#${number}`);
    text = [
      `Title: ${data.title ?? ''}`,
      `State: ${data.state ?? ''}`,
      `URL: ${data.html_url ?? rawUrl}`,
      '',
      String(data.body ?? '')
    ].join('\n');
  } else if (kind === 'tree') {
    const branch = rest[0];
    const directory = rest.slice(1).join('/');
    const response = await githubApiFetch(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${directory.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(branch)}`
    );
    const data = await response.json() as Array<Record<string, unknown>>;
    title = `${owner}/${repo}/${directory}`;
    text = data.map((item) => `${String(item.type ?? '')}\t${String(item.name ?? '')}`).join('\n');
  } else {
    const response = await githubApiFetch(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`);
    const data = await response.json() as Record<string, unknown>;
    title = String(data.full_name ?? `${owner}/${repo}`);
    text = [
      `Repository: ${title}`,
      `Description: ${data.description ?? ''}`,
      `Default branch: ${data.default_branch ?? ''}`,
      `Stars: ${data.stargazers_count ?? ''}`,
      `Language: ${data.language ?? ''}`,
      `URL: ${data.html_url ?? rawUrl}`
    ].join('\n');
    canonicalUrl = `https://github.com/${owner}/${repo}`;
  }

  const normalized = text.replace(/\r\n/g, '\n').trim();
  return {
    url: canonicalUrl,
    title,
    text: normalized.slice(0, maxChars),
    provider: 'GitHub API',
    truncated: normalized.length > maxChars,
    originalLength: normalized.length
  };
}

async function fetchSearchPayload(
  payload: Record<string, unknown>,
  query: string,
  maxResults: number,
  searchConfig?: WebSearchRequestConfig | null
): Promise<SearchPayload> {
  const directRunner = searchConfig?.apiKey.trim()
    ? shouldUseDirectBocha(searchConfig)
      ? () => runDirectBochaSearch(query, maxResults, searchConfig)
      : shouldUseDirectTavily(searchConfig)
        ? () => runDirectTavilySearch(query, maxResults, searchConfig)
        : null
    : null;
  let directError: unknown;
  if (directRunner && Capacitor.isNativePlatform()) {
    try {
      return await directRunner();
    } catch (error) {
      directError = error;
    }
  }

  try {
    return await postSearchPayload<SearchPayload>(payload);
  } catch (backendError) {
    if (directRunner) {
      try {
        return await directRunner();
      } catch (fallbackError) {
        throw directError ?? fallbackError;
      }
    }
    throw backendError;
  }
}

async function fetchPagePayload(
  rawUrl: string,
  maxChars: number,
  searchConfig?: WebSearchRequestConfig | null
): Promise<PagePayload> {
  const directCapable = isGithubUrl(rawUrl);
  // 非 GitHub 的普通网页：原生端只有 Tavily key 这一条直连通道，否则只能靠内部 /api/read。
  const canExtractDirectly = Boolean(searchConfig?.apiKey.trim()) && shouldUseDirectTavily(searchConfig);
  let directError: unknown;

  if (Capacitor.isNativePlatform()) {
    if (directCapable) {
      try {
        const direct = await readDirectGithubPage(rawUrl, maxChars);
        if (direct) return direct;
      } catch (error) {
        directError = error;
      }
    }
    if (!directCapable && canExtractDirectly) {
      try {
        return await runDirectTavilyExtract(rawUrl, maxChars, searchConfig!);
      } catch (error) {
        directError = error;
      }
    }
  }

  try {
    return await postSearchPayload<PagePayload>({
      mode: 'read',
      url: rawUrl,
      maxChars
    });
  } catch (backendError) {
    if (directCapable) {
      try {
        const direct = await readDirectGithubPage(rawUrl, maxChars);
        if (direct) return direct;
      } catch (fallbackError) {
        throw directError ?? fallbackError;
      }
    }
    // 直连失败的原因比"没配 API origin"更能说明问题，优先把它报出去。
    if (directError) throw directError;
    throw backendError;
  }
}

function buildSearchProviderPayload(searchConfig?: WebSearchRequestConfig | null) {
  const provider = searchConfig?.provider ?? 'bingLocal';
  return {
    searchProvider: provider,
    searchApiKey: provider === 'bingLocal' ? undefined : searchConfig?.apiKey,
    bochaSummary: provider === 'bocha' ? searchConfig?.bochaSummary : undefined,
    bochaFreshness: provider === 'bocha' ? searchConfig?.bochaFreshness : undefined,
    customSearchEndpoint: provider === 'custom' ? searchConfig?.customEndpoint : undefined,
    customSearchAdapter: provider === 'custom' ? searchConfig?.customAdapter : undefined,
    customSearchLabel: provider === 'custom' ? searchConfig?.customLabel : undefined
  };
}

export async function runWebSearch(
  query: string,
  maxResults?: number,
  searchConfig?: WebSearchRequestConfig | null
): Promise<WebSearchResult> {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    return { ok: false, error: '搜索内容不能为空。' };
  }

  try {
    const limit = Math.max(1, Math.min(MAX_SEARCH_RESULTS, Math.floor(maxResults ?? DEFAULT_SEARCH_MAX_RESULTS)));
    const data = await fetchSearchPayload(
      {
        mode: 'search',
        query: normalizedQuery,
        maxResults: limit,
        ...buildSearchProviderPayload(searchConfig)
      },
      normalizedQuery,
      limit,
      searchConfig
    );

    if (!Array.isArray(data.results)) {
      throw new Error('搜索服务返回格式异常。');
    }
    if (!data.results.length) {
      return { ok: false, error: `没有找到和“${normalizedQuery}”相关的网页结果。` };
    }

    const webSearch: WebSearchEvidence = {
      query: data.query,
      provider: data.provider,
      degraded: data.degraded || undefined,
      warning: data.warning || undefined,
      results: data.results
    };

    const detailParts = [
      `查询：${data.query}`,
      `来源：${data.provider}`,
      data.degraded ? '状态：降级搜索结果，请优先用 readWebPage 读取可靠来源后再回答。' : '',
      data.warning ? `提示：${data.warning}` : '',
      ...data.results.map(
        (item, index) =>
          [
            `${index + 1}. ${item.title}`,
            item.url,
            item.publishedAt ? `时间：${item.publishedAt}` : '',
            item.snippet
          ].filter(Boolean).join('\n')
      ),
      '下一步：如果用户要事实、时效信息、产品/地点/新闻/规则判断，请继续用 readWebPage 读取已返回的相关结果页；只有用户只要链接时，才直接根据搜索结果回答。不要对同一个查询再次调用 webSearch 来等待更好的结果；如果候选来源不足或不可读，直接说明限制。'
    ].filter(Boolean);

    return {
      ok: true,
      query: data.query,
      provider: data.provider,
      degraded: data.degraded || undefined,
      warning: data.warning || undefined,
      results: data.results,
      webSearch,
      detailText: detailParts.join('\n\n')
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : '联网搜索失败。'
    };
  }
}

export async function readWebPageContent(
  url: string,
  maxChars?: number,
  searchConfig?: WebSearchRequestConfig | null
): Promise<ReadWebPageResult> {
  const normalizedUrl = url.trim();
  if (!normalizedUrl) {
    return { ok: false, error: '网页地址不能为空。' };
  }

  try {
    const limit = Math.max(1000, Math.min(MAX_PAGE_CHARS, Math.floor(maxChars ?? DEFAULT_PAGE_MAX_CHARS)));
    const data = await fetchPagePayload(normalizedUrl, limit, searchConfig);

    if (typeof data.text !== 'string') {
      throw new Error('网页读取服务返回格式异常。');
    }
    const webPageRead: WebPageReadEvidence = {
      url: data.url,
      title: data.title,
      provider: data.provider,
      excerpt: data.text,
      truncated: data.truncated || undefined,
      originalLength: data.originalLength || undefined
    };

    const detailText = [
      `网页：${data.title || data.url}`,
      data.url,
      `来源：${data.provider}`,
      '',
      data.text
    ];
    if (data.truncated) {
      detailText.push('', `[内容已截断，原始长度 ${data.originalLength.toLocaleString('zh-CN')} 字]`);
    }

    return {
      ok: true,
      url: data.url,
      title: data.title,
      text: data.text,
      provider: data.provider,
      truncated: data.truncated,
      originalLength: data.originalLength,
      webPageRead,
      detailText: detailText.join('\n')
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : '网页读取失败。'
    };
  }
}
