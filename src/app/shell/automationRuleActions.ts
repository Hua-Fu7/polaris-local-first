import { buildCompanionAutomationTriggerUrl } from '../../engines/companionApi';
import { buildTriggerShortcutUrl } from '../../engines/triggerShortcutUrl';
import { writeTextToClipboard } from '../../infrastructure/clipboard';
import type { I18nTranslator } from '../../i18n';
import type {
  Persona,
  PolarisCompanionHostState,
  PolarisTriggerRule,
  PolarisTriggerSchedule
} from '../../types/domain';

type AutomationRuleUiPort = {
  alert: (message: string) => void;
  confirm: (message: string) => boolean;
};

type AutomationRuleActionCopy = Pick<I18nTranslator, 't'>;

/** 规则没起名字时按排期生成一个默认名，让列表里一眼能看出是什么节奏。 */
export function buildDefaultAutomationRuleName(
  schedule: PolarisTriggerSchedule,
  collaboratorName: string,
  copy: AutomationRuleActionCopy
) {
  switch (schedule.kind) {
    case 'daily':
      return copy.t('settings.automation.defaultNameDaily', { name: collaboratorName, time: schedule.time });
    case 'interval':
      return copy.t('settings.automation.defaultNameInterval', {
        name: collaboratorName,
        minutes: schedule.everyMinutes
      });
    case 'idle':
      return copy.t('settings.automation.defaultNameIdle', {
        name: collaboratorName,
        hours: Math.round((schedule.idleMinutes / 60) * 10) / 10
      });
  }
}

type CreateAutomationRuleArgs = {
  seed: {
    collaboratorId: string;
    conversationMode?: PolarisTriggerRule['target']['conversationMode'];
    conversationId?: string | null;
    mode?: PolarisTriggerRule['mode'];
    proactiveSettings?: PolarisTriggerRule['proactiveSettings'];
    sourceMessageId?: string;
    nextRunAt?: number | null;
    schedule: PolarisTriggerSchedule;
    prompt: string;
    name?: string;
  };
  personas: Persona[];
  createTriggerRule: (seed: {
    name?: string;
    mode?: PolarisTriggerRule['mode'];
    schedule: PolarisTriggerSchedule;
    target: PolarisTriggerRule['target'];
    action: PolarisTriggerRule['action'];
    proactiveSettings?: PolarisTriggerRule['proactiveSettings'];
    sourceMessageId?: string;
    nextRunAt?: number | null;
  }) => string;
  ui: Pick<AutomationRuleUiPort, 'alert'>;
  copy: AutomationRuleActionCopy;
};

export function createAutomationRuleForCollaborator({
  seed,
  personas,
  createTriggerRule,
  ui,
  copy
}: CreateAutomationRuleArgs) {
  const targetCollaboratorId = seed.collaboratorId.trim();
  const collaborator = personas.find((persona) => persona.id === targetCollaboratorId) ?? null;
  if (!targetCollaboratorId || !collaborator) {
    ui.alert(copy.t('settings.automation.missingPersonaWake'));
    return null;
  }
  const trimmedPrompt = seed.prompt.trim();
  const proactiveSettings = seed.mode === 'proactive-settings' ? seed.proactiveSettings : undefined;
  if (seed.mode !== 'proactive-settings' && !trimmedPrompt) {
    ui.alert(copy.t('settings.automation.emptyTrigger'));
    return null;
  }
  const defaultName = buildDefaultAutomationRuleName(seed.schedule, collaborator.name, copy);
  const conversationMode = seed.conversationMode === 'fixed' ? 'fixed' : 'follow-latest';
  const conversationId = conversationMode === 'fixed' ? seed.conversationId?.trim() || null : null;
  if (conversationMode === 'fixed' && !conversationId) {
    ui.alert(copy.t('settings.automation.missingConversation'));
    return null;
  }
  return createTriggerRule({
    name: seed.name?.trim() || defaultName,
    mode: seed.mode,
    schedule: seed.schedule,
    target: {
      collaboratorId: targetCollaboratorId,
      conversationMode,
      conversationId
    },
    action: {
      prompt: trimmedPrompt
    },
    proactiveSettings,
    sourceMessageId: seed.sourceMessageId,
    nextRunAt: seed.nextRunAt
  });
}

export function updateAutomationRuleForCollaborator(args: {
  ruleId: string;
  patch: Partial<PolarisTriggerRule>;
  triggerRules: PolarisTriggerRule[];
  personas: Persona[];
  updateTriggerRule: (ruleId: string, patch: Partial<PolarisTriggerRule>) => void;
  ui: Pick<AutomationRuleUiPort, 'alert'>;
  copy: AutomationRuleActionCopy;
}) {
  const rule = args.triggerRules.find((entry) => entry.id === args.ruleId) ?? null;
  if (!rule) return;
  const targetCollaboratorId = args.patch.target?.collaboratorId ?? rule.target.collaboratorId;
  if (!args.personas.some((persona) => persona.id === targetCollaboratorId)) {
    args.ui.alert(args.copy.t('settings.automation.missingPersonaWake'));
    return;
  }
  args.updateTriggerRule(args.ruleId, {
    ...args.patch,
    target: args.patch.target
      ? {
          ...rule.target,
          ...args.patch.target,
          collaboratorId: targetCollaboratorId
        }
      : undefined
  });
}

export function deleteAutomationRuleWithConfirmation(args: {
  ruleId: string;
  triggerRules: PolarisTriggerRule[];
  deleteTriggerRule: (ruleId: string) => void;
  ui: Pick<AutomationRuleUiPort, 'confirm'>;
  copy: AutomationRuleActionCopy;
}) {
  const rule = args.triggerRules.find((entry) => entry.id === args.ruleId) ?? null;
  if (rule && !args.ui.confirm(args.copy.t('settings.automation.deleteConfirm', { name: rule.name }))) return;
  args.deleteTriggerRule(args.ruleId);
}

export async function copyAutomationTriggerUrl(args: {
  ruleId: string;
  triggerRules: PolarisTriggerRule[];
  companionHost: PolarisCompanionHostState;
  ui: Pick<AutomationRuleUiPort, 'alert'>;
  copy: AutomationRuleActionCopy;
}) {
  const rule = args.triggerRules.find((entry) => entry.id === args.ruleId) ?? null;
  if (!rule) {
    args.ui.alert(args.copy.t('settings.automation.ruleMissing'));
    return;
  }
  const relayReady = args.companionHost.enabled
    && args.companionHost.relayUrl.trim()
    && args.companionHost.hostId
    && rule.webhookSecret;
  const triggerUrl = relayReady
    ? buildCompanionAutomationTriggerUrl({
        relayUrl: args.companionHost.relayUrl,
        hostId: args.companionHost.hostId!,
        ruleId: rule.id,
        secret: rule.webhookSecret
      })
    : buildTriggerShortcutUrl(rule.id);
  try {
    await writeTextToClipboard(triggerUrl);
    args.ui.alert(relayReady
      ? args.copy.t('settings.automation.copiedRelayLink')
      : args.copy.t('settings.automation.copiedShortcutLink'));
  } catch {
    args.ui.alert(args.copy.t('settings.automation.copyFallback', {
      label: relayReady
        ? args.copy.t('settings.automation.relayLinkLabel')
        : args.copy.t('settings.automation.shortcutLinkLabel'),
      url: triggerUrl
    }));
  }
}
