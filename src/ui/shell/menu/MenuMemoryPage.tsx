import { useEffect, useState } from 'react';
import type { ConversationSummaryModelSettings, MemoryVectorRetrievalSettings, ProviderProfile } from '../../../types/domain';
import { type I18nTranslator, useI18n } from '../../../i18n';
import { HelpHint } from '../../HelpHint';
import { Icon } from '../../Icon';
import { useRuntimeStore } from '../../../stores/runtimeStore';
import { createObClient } from '../../../engines/ombreBrain/obClient';
import { hasPersistentObSecretStore, readObPassword, writeObPassword } from '../../../engines/ombreBrain/obSecret';

type MenuMemoryPageProps = {
  conversationSummaryModel: ConversationSummaryModelSettings;
  memoryVectorRetrieval: MemoryVectorRetrievalSettings;
  providers: ProviderProfile[];
  onBack: () => void;
  onSetConversationSummaryModel: (patch: Partial<ConversationSummaryModelSettings>) => void;
  onSetMemoryVectorRetrieval: (patch: Partial<MemoryVectorRetrievalSettings>) => void;
};

function formatConversationSummaryUpdatedAt(timestamp: number, language: I18nTranslator['language']) {
  return new Date(timestamp).toLocaleString(language, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function getConversationSummaryAutoStatus(settings: ConversationSummaryModelSettings, i18n: I18nTranslator) {
  if (settings.autoUpdateEnabled) {
    return settings.lastUpdatedAt
      ? i18n.t('settings.memory.autoWithLast', { time: formatConversationSummaryUpdatedAt(settings.lastUpdatedAt, i18n.language) })
      : i18n.t('settings.memory.autoWaiting');
  }

  return settings.lastUpdatedAt
    ? i18n.t('settings.memory.manualWithLast', { time: formatConversationSummaryUpdatedAt(settings.lastUpdatedAt, i18n.language) })
    : i18n.t('settings.memory.manualIdle');
}

function ConversationSummaryModelSettingsPanel({
  settings,
  providers,
  onSetConversationSummaryModel
}: {
  settings: ConversationSummaryModelSettings;
  providers: ProviderProfile[];
  onSetConversationSummaryModel: (patch: Partial<ConversationSummaryModelSettings>) => void;
}) {
  const i18n = useI18n();
  const { t } = i18n;
  const summaryStateLabel = settings.enabled ? t('settings.enabled') : t('settings.disabled');
  const autoStateLabel = settings.autoUpdateEnabled ? t('settings.enabled') : t('settings.disabled');
  const skipProcessedStateLabel = settings.skipProcessedSources !== false ? t('settings.enabled') : t('settings.disabled');

  return (
    <div className="memory-toggle memory-toggle--switch toolbox-toggle-row" data-checked={settings.enabled ? 'true' : 'false'}>
      <div className="toolbox-toggle-row-head">
        <div className="memory-toggle-copy toolbox-toggle-copy">
          <strong>
            <span className="toolbox-toggle-icon" aria-hidden="true">
              <Icon name="feather" size={13} />
            </span>
            {t('settings.memory.summaryTitle')}
          </strong>
          <span>{t('settings.memory.summaryDetail')}</span>
        </div>
        <button
          type="button"
          className={`ps-toggle-sw memory-toggle-switch ${settings.enabled ? 'ps-toggle-sw--on' : ''}`}
          aria-pressed={settings.enabled}
          aria-label={`${t('settings.memory.summaryTitle')} ${summaryStateLabel}`}
          onClick={() => onSetConversationSummaryModel({ enabled: !settings.enabled })}
        >
          <span className="ps-toggle-knob" />
        </button>
      </div>
      {settings.enabled ? (
        <div className="toolbox-inline-config">
          <div className="settings-form">
            <label>{t('settings.memory.providerLabel')}</label>
            <select
              value={settings.providerId ?? ''}
              onChange={(event) => onSetConversationSummaryModel({ providerId: event.target.value })}
            >
              <option value="">{t('settings.memory.followGlobalProvider')}</option>
              {providers.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.name} · {provider.model}
                </option>
              ))}
            </select>
            <label>{t('settings.memory.modelLabel')}</label>
            <input
              value={settings.modelOverride ?? ''}
              onChange={(event) => onSetConversationSummaryModel({ modelOverride: event.target.value })}
              placeholder={t('settings.memory.modelPlaceholder')}
            />
            <label>{t('settings.memory.sourceCharsLabel')}</label>
            <input
              value={String(settings.targetSourceChars ?? '')}
              inputMode="numeric"
              onChange={(event) => {
                const value = Number(event.target.value);
                onSetConversationSummaryModel({
                  targetSourceChars: Number.isFinite(value) ? value : undefined
                });
              }}
              placeholder="50000"
            />
          </div>
          <div
            className="memory-toggle memory-toggle--switch toolbox-toggle-row"
            data-checked={settings.autoUpdateEnabled ? 'true' : 'false'}
          >
            <div className="toolbox-toggle-row-head">
              <div className="memory-toggle-copy toolbox-toggle-copy">
                <strong>
                  <span className="toolbox-toggle-icon" aria-hidden="true">
                    <Icon name="refresh" size={13} />
                  </span>
                  {t('settings.memory.autoTitle')}
                </strong>
                <span>{t('settings.memory.autoDetail')}</span>
              </div>
              <button
                type="button"
                className={`ps-toggle-sw memory-toggle-switch ${settings.autoUpdateEnabled ? 'ps-toggle-sw--on' : ''}`}
                aria-pressed={settings.autoUpdateEnabled === true}
                aria-label={`${t('settings.memory.autoTitle')} ${autoStateLabel}`}
                onClick={() => onSetConversationSummaryModel({ autoUpdateEnabled: !settings.autoUpdateEnabled })}
              >
                <span className="ps-toggle-knob" />
              </button>
            </div>
          </div>
          <div
            className="memory-toggle memory-toggle--switch toolbox-toggle-row"
            data-checked={settings.skipProcessedSources !== false ? 'true' : 'false'}
          >
            <div className="toolbox-toggle-row-head">
              <div className="memory-toggle-copy toolbox-toggle-copy">
                <strong>
                  <span className="toolbox-toggle-icon" aria-hidden="true">
                    <Icon name="check" size={13} />
                  </span>
                  {t('settings.memory.skipProcessedTitle')}
                </strong>
                <span>{t('settings.memory.skipProcessedDetail')}</span>
              </div>
              <button
                type="button"
                className={`ps-toggle-sw memory-toggle-switch ${settings.skipProcessedSources !== false ? 'ps-toggle-sw--on' : ''}`}
                aria-pressed={settings.skipProcessedSources !== false}
                aria-label={`${t('settings.memory.skipProcessedTitle')} ${skipProcessedStateLabel}`}
                onClick={() => onSetConversationSummaryModel({ skipProcessedSources: settings.skipProcessedSources === false })}
              >
                <span className="ps-toggle-knob" />
              </button>
            </div>
          </div>
          <div className="memory-vector-index-progress" aria-label={t('settings.memory.statusLabel')}>
            <div className="memory-vector-index-progress-copy">
              <span>{getConversationSummaryAutoStatus(settings, i18n)}</span>
              <span>{t('settings.memory.bodyHidden')}</span>
            </div>
            <div className="memory-vector-index-meta">
              <span>{settings.enabled ? t('settings.memory.summaryEnabled') : t('settings.memory.summaryDisabled')}</span>
              <span>{settings.autoUpdateEnabled ? t('settings.memory.autoIdle') : t('settings.memory.manualMode')}</span>
              <span>{settings.skipProcessedSources !== false ? t('settings.memory.skipProcessedOn') : t('settings.memory.skipProcessedOff')}</span>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function OmbreBrainSettingsPanel() {
  const { t } = useI18n();
  const obBrain = useRuntimeStore((state) => state.obBrain);
  const setObBrain = useRuntimeStore((state) => state.setObBrain);
  const [passwordDraft, setPasswordDraft] = useState('');
  const [storedPassword, setStoredPassword] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const persistentSecret = hasPersistentObSecretStore();

  useEffect(() => {
    let cancelled = false;
    void readObPassword().then((value) => {
      if (!cancelled) setStoredPassword(value);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const effectivePassword = passwordDraft.trim() || storedPassword;

  const savePassword = async () => {
    const value = passwordDraft.trim();
    if (!value) return;
    await writeObPassword(value);
    setStoredPassword(value);
    setPasswordDraft('');
    setTestResult(null);
  };

  const testConnection = async () => {
    if (!obBrain.baseUrl.trim()) {
      setTestResult(t('settings.ob.testFail', { reason: t('settings.ob.urlLabel') }));
      return;
    }
    if (!effectivePassword) {
      setTestResult(t('settings.ob.testFail', { reason: t('settings.ob.passwordMissing') }));
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      // 手动测连接，预算给宽一点：这里等得起，召回不能等。
      const client = createObClient({
        baseUrl: obBrain.baseUrl,
        password: effectivePassword,
        timeoutMs: 5000
      });
      const buckets = await client.listBuckets({ budgetMs: 5000 });
      const error = client.getLastError();
      setTestResult(error
        ? t('settings.ob.testFail', { reason: error })
        : t('settings.ob.testOk', { count: buckets.length }));
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="memory-toggle-grid">
      <div
        className="memory-toggle memory-toggle--switch toolbox-toggle-row"
        data-checked={obBrain.enabled ? 'true' : 'false'}
      >
        <div className="toolbox-toggle-row-head">
          <div className="memory-toggle-copy toolbox-toggle-copy">
            <strong>
              <span className="toolbox-toggle-icon" aria-hidden="true">
                <Icon name="orbit" size={13} />
              </span>
              {t('settings.ob.title')}
            </strong>
            <span>{t('settings.ob.detail')}</span>
          </div>
          <button
            type="button"
            className={`ps-toggle-sw memory-toggle-switch ${obBrain.enabled ? 'ps-toggle-sw--on' : ''}`}
            aria-pressed={obBrain.enabled}
            aria-label={`${t('settings.ob.title')} ${obBrain.enabled ? t('settings.enabled') : t('settings.disabled')}`}
            onClick={() => setObBrain({ enabled: !obBrain.enabled })}
          >
            <span className="ps-toggle-knob" />
          </button>
        </div>
        {obBrain.enabled ? (
          <div className="toolbox-inline-config">
            <div className="settings-form">
              <label>{t('settings.ob.urlLabel')}</label>
              <input
                value={obBrain.baseUrl}
                onChange={(event) => setObBrain({ baseUrl: event.target.value })}
                placeholder="https://ombrebrain.example.top"
                inputMode="url"
                autoComplete="off"
              />
              <label>{t('settings.ob.passwordLabel')}</label>
              <div className="ob-secret-row">
                <input
                  type="password"
                  value={passwordDraft}
                  onChange={(event) => setPasswordDraft(event.target.value)}
                  placeholder={storedPassword ? '••••••••' : t('settings.ob.passwordLabel')}
                  autoComplete="off"
                />
                <button
                  type="button"
                  className="ob-secret-save"
                  disabled={!passwordDraft.trim()}
                  onClick={() => { void savePassword(); }}
                >
                  {t('memory.docs.save')}
                </button>
              </div>
              <p className="settings-form-note">
                {persistentSecret ? t('settings.ob.passwordNote') : t('settings.ob.passwordVolatile')}
              </p>
              <label>{t('settings.ob.timeoutLabel')}</label>
              <input
                value={String(obBrain.timeoutMs)}
                inputMode="numeric"
                onChange={(event) => {
                  const value = Number(event.target.value);
                  setObBrain({ timeoutMs: Number.isFinite(value) ? value : undefined });
                }}
                placeholder="1500"
              />
            </div>
            <div className="ob-test-row">
              <button type="button" className="ob-test-btn" disabled={testing} onClick={() => { void testConnection(); }}>
                {testing ? t('settings.ob.testing') : t('settings.ob.test')}
              </button>
              {testResult ? <span className="ob-test-result">{testResult}</span> : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function MenuMemoryPage({
  conversationSummaryModel,
  providers,
  onBack,
  onSetConversationSummaryModel
}: MenuMemoryPageProps) {
  const { t } = useI18n();

  return (
    <div className="menu-sheet-page">
      <div className="menu-sheet-header">
        <button type="button" className="menu-sheet-back" aria-label={t('settings.pageBack')} onClick={onBack}>
          <span className="menu-sheet-back-icon"><Icon name="chevron" size={26} /></span>
        </button>
        <div className="menu-sheet-title">
          <h2>{t('settings.memory.title')}</h2>
        </div>
      </div>

      <section className="menu-section">
        <div className="menu-section-head">
          <span className="menu-section-kicker menu-section-kicker-row">
            {t('settings.memory.crossChatSection')}
            <HelpHint
              label={t('settings.memory.crossChatSection')}
              text={t('settings.memory.crossChatHelp')}
            />
          </span>
          <p className="menu-section-note">{t('settings.memory.noteGeneration')}</p>
          <p className="menu-section-note">{t('settings.memory.noteVector')}</p>
        </div>
        <div className="memory-toggle-grid">
          <ConversationSummaryModelSettingsPanel
            settings={conversationSummaryModel}
            providers={providers}
            onSetConversationSummaryModel={onSetConversationSummaryModel}
          />
        </div>
      </section>

      <section className="menu-section">
        <div className="menu-section-head">
          <span className="menu-section-kicker menu-section-kicker-row">
            {t('settings.ob.section')}
            <HelpHint
              label={t('settings.ob.section')}
              text={t('settings.ob.help')}
            />
          </span>
          <p className="menu-section-note">{t('settings.ob.note')}</p>
        </div>
        <OmbreBrainSettingsPanel />
      </section>
    </div>
  );
}
