import { useMemo } from 'react';
import type { ChatMessage } from '../../../../types/domain';
import { useI18n } from '../../../../i18n';
import { Icon } from '../../../Icon';
import { buildThinkingSessionSummary, createThinkingSummaryCopy } from '../thinkingSummary';

type ThinkingSheetProps = {
  message: ChatMessage | null;
  messages: ChatMessage[];
  assistantName: string;
  onClose: () => void;
};

export function ThinkingSheet({
  message,
  messages,
  assistantName,
  onClose
}: ThinkingSheetProps) {
  const { t } = useI18n();
  const copy = useMemo(() => createThinkingSummaryCopy(t), [t]);
  const session = useMemo(
    () => (message ? buildThinkingSessionSummary(messages, message.id, copy) : null),
    [copy, message, messages]
  );

  if (!message || !session) return null;

  const thinkingSteps = session.steps.filter((step) => step.kind === 'thinking');

  return (
    <div className="thinking-summary-overlay" role="dialog" aria-modal="true" aria-label={t('chat.thinking.sheetAria')}>
      <button type="button" className="thinking-summary-backdrop" aria-label={t('chat.thinking.closeAria')} onClick={onClose} />
      <div className="thinking-summary-sheet">
        <div className="sheet-handle" />
        <div className="thinking-summary-topbar">
          <button type="button" className="thinking-summary-close" onClick={onClose} aria-label={t('chat.thinking.closeAria')}>
            <Icon name="x" size={18} />
          </button>
          <div className="thinking-summary-title">
            <strong>Summary</strong>
            <span>{message.assistantName || assistantName}</span>
          </div>
          <div className="thinking-summary-spacer" aria-hidden="true" />
        </div>
        <div className="thinking-summary-list thinking-summary-list--plain">
          {thinkingSteps.map((step) => (
            <article key={step.id} className="thinking-summary-step thinking thinking-summary-step--plain">
              <div className="thinking-summary-phase-list">
                {step.items.map((item) => (
                  <div key={item.id} className={`thinking-summary-phase-item ${item.kind}`}>
                    <span className={`thinking-summary-phase-dot ${item.kind}`} aria-hidden="true" />
                    <div className="thinking-summary-phase-copy">
                      <p>{item.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}