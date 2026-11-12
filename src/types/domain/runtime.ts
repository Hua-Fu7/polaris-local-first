import type { ImageUnderstandingSettings } from './persona';

export interface ProviderProfile {
  id: string;
  name: string;
  protocol: ProviderProtocol;
  baseUrl: string;
  path: string;
  apiKey: string;
  model: string;
  capabilities: ProviderCapabilities;
  imageUnderstanding?: ImageUnderstandingSettings;
}

export type ProviderProtocol =
  | 'openai-completions'
  | 'anthropic-messages'
  | 'openai-responses'
  | 'gemini-generate-content';

export type AppBackgroundFit = 'cover' | 'contain';
export type CustomFontScope = 'global' | 'titles' | 'chat' | 'cards';
export type AppAppearancePreference = 'system' | 'light' | 'dark';

export interface AppDisplayPreferences {
  appearance: AppAppearancePreference;
  hapticsEnabled: boolean;
  fontScale: number;
}

export interface AppCustomization {
  showChatAvatars: boolean;
  /** 每条消息底下的小时钟（HH:mm）。缺省视为开。 */
  showMessageClock?: boolean;
  /** 消息头部的协作者名字。缺省视为开。 */
  showCollaboratorName?: boolean;
  /** 消息头部的模型名胶囊。缺省视为开。 */
  showModelName?: boolean;
  /** 消息头部的 token 用量胶囊。缺省视为开。 */
  showTokenUsage?: boolean;
  starColor: string | null;
  starOpacity: number;
  starGlow: number;
  starScale: number;
  starWarmth: number;
  /** Colour of the voice-call orb. Null falls back to the built-in grey. */
  voiceCallOrbColor: string | null;
  backgroundAssetId: string | null;
  customFontAssetIds: string[];
  customFontScopeAssignments: Record<CustomFontScope, string | null>;
  backgroundOpacity: number;
  backgroundDim: number;
  backgroundBlur: number;
  backgroundFit: AppBackgroundFit;
}

export interface ProviderCapabilities {
  images: boolean;
  streaming: boolean;
  thinking: boolean;
}

export interface WebDavConfig {
  endpoint: string;
  username: string;
  password: string;
}

export type WebSearchProviderType = 'bingLocal' | 'brave' | 'bocha' | 'tavily' | 'custom';
export type WebSearchCustomAdapter = 'brave' | 'bocha' | 'tavily';

export interface WebSearchConfig {
  provider: WebSearchProviderType;
  apiKey: string;
  bochaSummary: boolean;
  bochaFreshness: string;
  customEndpoint: string;
  customAdapter: WebSearchCustomAdapter;
  customLabel: string;
}

export type McpServerTransport = 'streamable-http' | 'sse';

export interface McpServerHeader {
  id: string;
  key: string;
  value: string;
}

export interface McpServerToolConfig {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  enabled: boolean;
}

export interface McpServerConfig {
  id: string;
  handle: string;
  name: string;
  description: string;
  transport: McpServerTransport;
  url: string;
  headers: McpServerHeader[];
  tools?: McpServerToolConfig[];
  isActive: boolean;
}
