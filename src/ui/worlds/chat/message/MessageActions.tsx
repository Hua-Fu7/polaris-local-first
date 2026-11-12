import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CodeCardActionMode } from '../../../../app/chat/chatDerivedState';
import { readMessageSpeechCacheBlob } from '../../../../app/chat/messageSpeechCache';
import { writeTextToClipboard } from '../../../../infrastructure/clipboard';
import { exportBlobToFile } from '../../../../infrastructure/exportBlobFile';
import type { ChatMemoryEvidence, ChatMessageVoiceCache, ChatObRecallEvidence, ConversationTaskStatus } from '../../../../types/domain';
import { Icon } from '../../../Icon';
import { runSelectionAction, runSuccessAction } from '../../../haptics';
import { useI18n } from '../../../../i18n';
import { MessageMemoryEvidence } from './MessageMemoryEvidence';

export type MessageTaskReceiptAction = {
  status: ConversationTaskStatus;
  expanded: boolean;
  onToggle: () => void;
};

type MessageActionsProps = {
  canCopyAssistant: boolean;
  canEditAssistant: boolean;
  canForkAssistant: boolean;
  canRetryAssistant: boolean;
  retryAssistantLabel?: string;
  memoryEvidence?: ChatMemoryEvidence | null;
  /** 这一轮 OB 召回了什么；没开 OB 就是 null，什么都不显示。 */
  obRecall?: ChatObRecallEvidence | null;
  taskReceiptAction?: MessageTaskReceiptAction | null;
  codeCardActionLabel: string;
  codeCardActionMode: CodeCardActionMode;
  codeCardProgressLabel: string | null;
  messageContent: string;
  speechCache?: ChatMessageVoiceCache | null;
  role: 'assistant' | 'user';
  onSetCommandStatus: (text: string, isError?: boolean) => void;
  onCodeCardAction: () => void;
  onEditAssistant: (content: string) => void;
  onForkAssistant: () => void;
  onRetryLatestAssistant: () => void;
};

export function MessageActions({
  canCopyAssistant,
  canEditAssistant,
  canForkAssistant,
  canRetryAssistant,
  retryAssistantLabel,
  memoryEvidence = null,
  obRecall = null,
  taskReceiptAction = null,
  codeCardActionLabel,
  codeCardActionMode,
  codeCardProgressLabel,
  messageContent,
  speechCache = null,
  role,
  onSetCommandStatus,
  onCodeCardAction,
  onEditAssistant,
  onForkAssistant,
  onRetryLatestAssistant
}: MessageActionsProps) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const [assistantSheetOpen, setAssistantSheetOpen] = useState(false);
  const [assistantSheetMode, setAssistantSheetMode] = useState<'menu' | 'edit' | 'memory' | 'ob'>('menu');
  const [assistantDraft, setAssistantDraft] = useState(messageContent);
  const showCodeCardAction = codeCardActionMode !== 'hidden';
  const hasMemoryEvidence = role === 'assistant' && Boolean(memoryEvidence?.items.length);
  const hasSpeechCache = role === 'assistant' && Boolean(speechCache?.assetId);
  const hasAssistantMore = role === 'assistant' && (canEditAssistant || canForkAssistant || canRetryAssistant || hasMemoryEvidence || hasSpeechCache);
  const resolvedRetryAssistantLabel = retryAssistantLabel ?? t('chat.messageActions.retry');

  useEffect(() => {
    if (!assistantSheetOpen) {
      setAssistantDraft(messageContent);
      setAssistantSheetMode('menu');
    }
  }, [assistantSheetOpen, messageContent]);

  useEffect(() => {
    if (!assistantSheetOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setAssistantSheetOpen(false);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [assistantSheetOpen]);

  if (!canCopyAssistant && !hasAssistantMore && !showCodeCardAction && !taskReceiptAction) {
    return null;
  }

  const copyMessage = async () => {
    if (!messageContent.trim()) return;
    await runSuccessAction(() => writeTextToClipboard(messageContent));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  const downloadCachedSpeech = async (cache: ChatMessageVoiceCache) => {
    try {
      const blob = await readMessageSpeechCacheBlob(cache);
      const exported = await exportBlobToFile(blob, cache.name || 'Polaris-voice.mp3');
      if (exported) onSetCommandStatus(t('chat.messageActions.speechCacheExported'));
    } catch (error) {
      const message = error instanceof Error ? error.message : t('chat.messageActions.speechCacheMissing');
      onSetCommandStatus(message, true);
    }
  };

  const closeAssistantSheet = () => {
    setAssistantSheetOpen(false);
  };

  const saveAssistantDraft = () => {
    if (!assistantDraft.trim()) return;
    onEditAssistant(assistantDraft);
    closeAssistantSheet();
  };
  const assistantSheet = assistantSheetOpen && typeof document !== 'undefined' ? createPortal(
    <>
      <button
        type="button"
        className="assistant-message-sheet-dismiss"
        aria-label={t('chat.messageActions.closeAssistantActions')}
        onClick={closeAssistantSheet}
      />
      <div className="assistant-message-action-sheet" role="dialog" aria-modal="true" aria-label={assistantSheetMode === 'edit' ? t('chat.messageActions.editAssistant') : t('chat.messageActions.assistantActions')}>
        <div className="assistant-message-action-handle" aria-hidden="true" />
        {assistantSheetMode === 'menu' ? (
          <div className="assistant-message-action-menu">
            {hasMemoryEvidence && memoryEvidence ? (
              <button
                type="button"
                className="assistant-message-action-btn"
                onClick={(event) => {
                  runSelectionAction(() => {
                    setAssistantSheetMode('memory');
                  }, { element: event.currentTarget });
                }}
              >
                <Icon name="memoryMap" size={18} />
                <span>{t('chat.messageActions.memorySources')}</span>
              </button>
            ) : null}
            {speechCache?.assetId ? (
              <button
                type="button"
                className="assistant-message-action-btn"
                onClick={(event) => {
                  runSelectionAction(() => {
                    void downloadCachedSpeech(speechCache);
                    closeAssistantSheet();
                  }, { element: event.currentTarget });
                }}
              >
                <Icon name="download" size={18} />
                <span>{t('chat.messageActions.exportSpeechCache')}</span>
              </button>
            ) : null}
            {canEditAssistant ? (
              <button
                type="button"
                className="assistant-message-action-btn"
                onClick={(event) => {
                  runSelectionAction(() => {
                    setAssistantDraft(messageContent);
                    setAssistantSheetMode('edit');
                  }, { element: event.currentTarget });
                }}
              >
                <Icon name="edit" size={18} />
                <span>{t('chat.messageActions.edit')}</span>
              </button>
            ) : null}
            {canForkAssistant ? (
              <button
                type="button"
                className="assistant-message-action-btn"
                onClick={(event) => {
                  runSelectionAction(() => {
                    onForkAssistant();
                    closeAssistantSheet();
                  }, { element: event.currentTarget });
                }}
              >
                <Icon name="branch" size={18} />
                <span>{t('chat.messageActions.forkFromHere')}</span>
              </button>
            ) : null}
            {canRetryAssistant ? (
              <button
                type="button"
                className="assistant-message-action-btn"
                onClick={(event) => {
                  runSelectionAction(() => {
                    onRetryLatestAssistant();
                    closeAssistantSheet();
                  }, { element: event.currentTarget });
                }}
              >
                <Icon name="refresh" size={18} />
                <span>{resolvedRetryAssistantLabel}</span>
              </button>
            ) : null}
          </div>
        ) : assistantSheetMode === 'memory' && memoryEvidence ? (
          <div className="assistant-message-memory">
            <div className="assistant-message-memory-title">
              <button
                type="button"
                className="assistant-message-memory-back"
                onClick={() => setAssistantSheetMode('menu')}
                aria-label={t('chat.messageActions.backToActions')}
              >
                <Icon name="chevron" size={16} />
              </button>
              <span>{t('chat.messageActions.memorySources')}</span>
            </div>
            <MessageMemoryEvidence
              evidence={memoryEvidence}
              expanded
              onToggle={() => {}}
              showTrigger={false}
            />
          </div>
        ) : assistantSheetMode === 'ob' && obRecall ? (
          <div className="assistant-message-memory">
            <div className="assistant-message-memory-title">
              <button
                type="button"
                className="assistant-message-memory-back"
                onClick={() => setAssistantSheetMode('menu')}
                aria-label={t('chat.messageActions.backToActions')}
              >
                <Icon name="chevron" size={16} />
              </button>
              <span>{t('chat.obRecall.title')}</span>
            </div>
            {/* 失败和"搜到了 0 条"是两件事，只能显示一个，否则自相矛盾。 */}
            {obRecall.status === 'failed' ? (
              <p className="ob-recall-note">
                {t('chat.obRecall.failedReason', { reason: obRecall.error ?? t('chat.obRecall.failed') })}
              </p>
            ) : obRecall.items.length === 0 ? (
              <p className="ob-recall-note">{t('chat.obRecall.empty')}</p>
            ) : (
              <ul className="ob-recall-list">
                {obRecall.items.map((item) => (
                  <li key={item.id} className="ob-recall-item">
                    <span className="ob-recall-name">
                      {item.name}
                      <span className="ob-recall-score">{item.score.toFixed(2)}</span>
                    </span>
                    <span className="ob-recall-excerpt">{item.excerpt}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <div className="assistant-message-edit">
            <div className="assistant-message-edit-title">{t('chat.messageActions.editAssistant')}</div>
            <textarea
              className="assistant-message-edit-input"
              value={assistantDraft}
              onChange={(event) => setAssistantDraft(event.target.value)}
              rows={8}
              autoFocus
            />
            <div className="assistant-message-edit-actions">
              <button type="button" className="assistant-message-edit-btn secondary" onClick={() => setAssistantSheetMode('menu')}>{t('chat.messageActions.cancel')}</button>
              <button type="button" className="assistant-message-edit-btn primary" onClick={saveAssistantDraft} disabled={!assistantDraft.trim()}>{t('chat.messageActions.confirmEdit')}</button>
            </div>
          </div>
        )}
      </div>
    </>,
    document.body
  ) : null;

  return (
    <div className={`message-inline-actions ${role}`}>
      {obRecall ? (
        <button
          type="button"
          className={`ob-recall-chip${obRecall.status === 'failed' ? ' is-failed' : ''}${assistantSheetMode === 'ob' && assistantSheetOpen ? ' active' : ''}`}
          onClick={(event) => {
            runSelectionAction(() => {
              setAssistantSheetOpen(true);
              setAssistantSheetMode('ob');
            }, { element: event.currentTarget });
          }}
          aria-label={t('chat.obRecall.open')}
          title={t('chat.obRecall.open')}
        >
          <Icon name={obRecall.status === 'failed' ? 'zap' : 'orbit'} size={13} />
          <span>
            {obRecall.status === 'failed'
              ? t('chat.obRecall.failed')
              : t('chat.obRecall.badge', { count: obRecall.count })}
          </span>
        </button>
      ) : null}
      {canCopyAssistant && (
        <button type="button" className={`micro-action-btn ${copied ? 'active' : ''}`} onClick={() => { void copyMessage(); }} aria-label={copied ? t('chat.messageActions.copied') : t('chat.messageActions.copyAssistant')} title={copied ? t('chat.messageActions.copied') : t('chat.messageActions.copyAssistant')}>
          <Icon name="copy" size={14} />
        </button>
      )}
      {taskReceiptAction ? (
        <button
          type="button"
          className={`micro-action-btn task-receipt ${taskReceiptAction.status} ${taskReceiptAction.expanded ? 'active' : ''}`}
          onClick={(event) => {
            runSelectionAction(taskReceiptAction.onToggle, { element: event.currentTarget });
          }}
          aria-label={taskReceiptAction.expanded ? t('chat.messageActions.collapseTask') : t('chat.messageActions.viewTask')}
          title={taskReceiptAction.expanded ? t('chat.messageActions.collapseTaskTitle') : t('chat.messageActions.viewTaskTitle')}
          aria-expanded={taskReceiptAction.expanded}
        >
          <Icon name={taskReceiptAction.status === 'completed' ? 'check' : 'task'} size={14} />
        </button>
      ) : null}
      {showCodeCardAction && (
        <>
          <button
            type="button"
            className={`micro-action-btn ${codeCardActionMode === 'open' ? 'active' : ''}`}
            onClick={(event) => {
              runSelectionAction(onCodeCardAction, { element: event.currentTarget });
            }}
            aria-label={codeCardActionLabel}
            title={codeCardActionLabel}
          >
            <Icon name="code" size={14} />
          </button>
          {codeCardProgressLabel && <span className="message-inline-progress">{codeCardProgressLabel}</span>}
        </>
      )}
      {hasAssistantMore ? (
        <>
          <button
            type="button"
            className={`micro-action-btn ${assistantSheetOpen ? 'active' : ''}`}
            onClick={(event) => {
              runSelectionAction(() => {
                setAssistantSheetOpen(true);
                setAssistantSheetMode('menu');
              }, { element: event.currentTarget });
            }}
            aria-label={t('chat.messageActions.moreAssistantActions')}
            title={t('chat.messageActions.more')}
            aria-expanded={assistantSheetOpen}
          >
            <Icon name="more" size={15} />
          </button>
          {assistantSheet}
        </>
      ) : null}
    </div>
  );
}
