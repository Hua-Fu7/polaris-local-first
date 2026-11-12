import type { ChatMessage } from './chat';

export type CompanionSource = 'polaris' | 'codex';
export type PolarisCompanionPushPlatform = 'android' | 'ios' | 'web';

export interface PolarisCompanionPushRegistration {
  platform: PolarisCompanionPushPlatform;
  token: string;
  updatedAt: number;
}

export interface PolarisCompanionHostState {
  enabled: boolean;
  relayUrl: string;
  label: string;
  hostId: string | null;
  hostSecret: string | null;
  pairCode: string | null;
  lastRegisteredAt: number | null;
  error: string | null;
}

export interface PolarisCompanionConnection {
  id: string;
  source: CompanionSource;
  collaboratorId: string;
  conversationId: string;
  relayUrl: string;
  hostId: string;
  clientId: string;
  clientSecret: string;
  label: string;
  hostLabel: string;
  pushToken: string | null;
  pushPlatform: PolarisCompanionPushPlatform | null;
  remoteThreadId?: string | null;
  createdAt: number;
  lastSnapshotAt: number | null;
  lastError: string | null;
}

export type PolarisTriggerSource = 'schedule' | 'webhook' | 'shortcut' | 'mcp' | 'manual';
export type PolarisTriggerSchedule =
  | {
      kind: 'daily';
      time: string;
    }
  | {
      kind: 'interval';
      everyMinutes: number;
    }
  | {
      /**
       * 空闲触发：用户连续 idleMinutes 没有活跃过，规则才算到期。
       * 到期时刻 = 最后活跃时间 + idleMinutes，由排期引擎在运行时反复重算，
       * 所以用户只要还在说话，计时就会一直往后推。
       */
      kind: 'idle';
      idleMinutes: number;
    };
export type PolarisTriggerRuleMode = 'manual' | 'proactive-settings' | 'proactive-plan';

export type PolarisProactiveContactSettings = {
  enabled: boolean;
  maxPerDay: number;
  quietHours: boolean;
  sentToday: number;
  day: string;
};

export type PolarisTriggerTarget = {
  collaboratorId: string;
  conversationMode: 'follow-latest' | 'fixed';
  conversationId: string | null;
};
export type PolarisTriggerAction = {
  prompt: string;
};
export interface PolarisTriggerRule {
  id: string;
  mode?: PolarisTriggerRuleMode;
  proactiveSettings?: PolarisProactiveContactSettings;
  sourceMessageId?: string;
  name: string;
  enabled: boolean;
  source: PolarisTriggerSource;
  webhookSecret: string;
  schedule: PolarisTriggerSchedule;
  target: PolarisTriggerTarget;
  action: PolarisTriggerAction;
  createdAt: number;
  updatedAt: number;
  lastRunAt: number | null;
  nextRunAt: number | null;
  lastError: string | null;
}

export interface PolarisCompanionAutomationRule {
  id: string;
  name: string;
  enabled: boolean;
  webhookSecret: string;
  schedule: PolarisTriggerSchedule;
  target: PolarisTriggerTarget;
  action: PolarisTriggerAction;
  lastRunAt: number | null;
  nextRunAt: number | null;
  updatedAt: number;
}

export interface PolarisCompanionTriggerCommand {
  ruleId: string;
  name: string;
  target: PolarisTriggerTarget;
  prompt: string;
  eventPrompt: string | null;
  source: 'webhook' | 'schedule' | 'mcp';
}

export interface PolarisCompanionCommand {
  id: string;
  text: string;
  createdAt: number;
  trigger?: PolarisCompanionTriggerCommand;
}

export interface PolarisCompanionSnapshot {
  hostId: string;
  hostLabel: string;
  threadKey: string | null;
  conversationTitle: string | null;
  collaboratorId: string | null;
  collaboratorName: string | null;
  messages: ChatMessage[];
  updatedAt: number;
}

