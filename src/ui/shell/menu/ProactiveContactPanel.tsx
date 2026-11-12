import {
  DEFAULT_PROACTIVE_CONTACT_SETTINGS,
  PROACTIVE_SETTINGS_RULE_NAME,
  findProactiveSettingsRule,
  resolveProactiveSettings,
  resolveTodayProactiveSentCount
} from '../../../engines/proactiveContact';
import type { Persona, PolarisTriggerRule } from '../../../types/domain';

type ProactiveContactPanelProps = {
  collaborator: Persona;
  triggerRules: PolarisTriggerRule[];
  onCreateTriggerRule: (seed: {
    collaboratorId: string;
    mode?: PolarisTriggerRule['mode'];
    conversationMode?: PolarisTriggerRule['target']['conversationMode'];
    conversationId?: string | null;
    schedule: PolarisTriggerRule['schedule'];
    prompt: string;
    name?: string;
    proactiveSettings?: PolarisTriggerRule['proactiveSettings'];
    sourceMessageId?: string;
    nextRunAt?: number | null;
  }) => string | null;
  onUpdateTriggerRule: (ruleId: string, patch: Partial<PolarisTriggerRule>) => void;
};

export function ProactiveContactPanel({
  collaborator,
  triggerRules,
  onCreateTriggerRule,
  onUpdateTriggerRule
}: ProactiveContactPanelProps) {
  const settingsRule = findProactiveSettingsRule(triggerRules, collaborator.id);
  const settings = settingsRule
    ? resolveProactiveSettings(settingsRule)
    : DEFAULT_PROACTIVE_CONTACT_SETTINGS;
  const sentToday = resolveTodayProactiveSentCount(settings);

  const updateSettings = (patch: Partial<typeof settings>) => {
    const nextSettings = { ...settings, ...patch };
    if (settingsRule) {
      onUpdateTriggerRule(settingsRule.id, { proactiveSettings: nextSettings });
      return;
    }
    onCreateTriggerRule({
      collaboratorId: collaborator.id,
      mode: 'proactive-settings',
      name: PROACTIVE_SETTINGS_RULE_NAME,
      schedule: { kind: 'interval', everyMinutes: 24 * 60 },
      prompt: '',
      proactiveSettings: nextSettings,
      nextRunAt: null
    });
  };

  return (
    <section className="proactive-contact-card">
      <div className="proactive-contact-kicker">主动联系</div>
      <div className="proactive-contact-head">
        <div className="proactive-contact-copy">
          <h3>让他自己决定什么时候找你</h3>
          <p>今天主动找过你 {sentToday} 次</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={settings.enabled}
          className={`proactive-contact-switch ${settings.enabled ? 'is-on' : ''}`}
          onClick={() => updateSettings({ enabled: !settings.enabled })}
        >
          <span />
        </button>
      </div>

      <div className="proactive-contact-field">
        <span className="proactive-contact-label">一天最多几次</span>
        <div className="proactive-contact-segment">
          {[3, 6, 10].map((value) => (
            <button
              key={value}
              type="button"
              className={settings.maxPerDay === value ? 'active' : ''}
              onClick={() => updateSettings({ maxPerDay: value })}
            >
              {value} 次
            </button>
          ))}
        </div>
      </div>

      <div className="proactive-contact-field">
        <span className="proactive-contact-label">凌晨 1 点到早上 8 点</span>
        <div className="proactive-contact-segment">
          <button
            type="button"
            className={settings.quietHours ? 'active' : ''}
            onClick={() => updateSettings({ quietHours: true })}
          >
            不打扰
          </button>
          <button
            type="button"
            className={!settings.quietHours ? 'active' : ''}
            onClick={() => updateSettings({ quietHours: false })}
          >
            也可以发
          </button>
        </div>
      </div>

      <p className="proactive-contact-note">
        不是定时提醒。每次聊完，他会想一想：要是你一直没回，什么时候该问一句、问什么。你一说话，这些打算就作废重想。只对单聊和工作区有效；每次会用一次模型调用来预约。
      </p>
    </section>
  );
}