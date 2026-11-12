import { useEffect, useMemo, useRef, useState } from 'react';
import {
  buildMessageSearchText,
  normalizeConversationSearchQuery
} from '../../../../app/collection/conversationMessageSearch';
import { useSpaceStore } from '../../../../stores/spaceStore';
import type { ChatMessage } from '../../../../types/domain';
import { Icon } from '../../../Icon';
import { runSelectionAction } from '../../../haptics';
import { useI18n } from '../../../../i18n';
import { useChatPresentation, useChatStablePayload } from '../context/ChatContext';

const MAX_RESULTS = 60;
const EXCERPT_BEFORE = 26;
const EXCERPT_AFTER = 54;

function formatMatchTime(timestamp: number) {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '';
  const date = new Date(timestamp);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  if (sameDay) return time;
  return `${date.getMonth() + 1}.${date.getDate()} ${time}`;
}

/** 截一段带上下文的片段，命中词两侧各留一点，让用户看懂上下文。 */
function buildExcerpt(messageText: string, normalizedQuery: string) {
  const matchIndex = messageText.toLowerCase().indexOf(normalizedQuery);
  if (matchIndex < 0) return messageText.slice(0, 90);
  const start = Math.max(0, matchIndex - EXCERPT_BEFORE);
  const end = Math.min(messageText.length, matchIndex + normalizedQuery.length + EXCERPT_AFTER);
  return `${start > 0 ? '...' : ''}${messageText.slice(start, end).trim()}${end < messageText.length ? '...' : ''}`;
}

/** 把命中的那一段单独包出来，方便高亮。 */
function splitExcerptAroundQuery(excerpt: string, normalizedQuery: string) {
  if (!normalizedQuery) return { head: excerpt, hit: '', tail: '' };
  const index = excerpt.toLowerCase().indexOf(normalizedQuery);
  if (index < 0) return { head: excerpt, hit: '', tail: '' };
  return {
    head: excerpt.slice(0, index),
    hit: excerpt.slice(index, index + normalizedQuery.length),
    tail: excerpt.slice(index + normalizedQuery.length)
  };
}

/**
 * 对话内搜索：只搜**当前这条对话**的消息正文（含附件名），点结果跳过去并高亮那一条。
 * 跨对话的全局搜索在「房间 → 对话」那一侧，两个入口各管各的，别混。
 */
export function ChatMessageSearchOverlay({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const stablePayload = useChatStablePayload();
  const presentation = useChatPresentation();
  const setFocusedMessageTarget = useSpaceStore((state) => state.setFocusedMessageTarget);
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const messages = stablePayload.messages;
  const normalizedQuery = normalizeConversationSearchQuery(query);

  const results = useMemo(() => {
    if (!normalizedQuery) return [];
    const matches: Array<{ message: ChatMessage; excerpt: string }> = [];
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (!message || message.toolInvocation) continue;
      const text = buildMessageSearchText(message);
      if (!text.toLowerCase().includes(normalizedQuery)) continue;
      matches.push({ message, excerpt: buildExcerpt(text, normalizedQuery) });
      if (matches.length >= MAX_RESULTS) break;
    }
    return matches;
  }, [messages, normalizedQuery]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const assistantLabel = stablePayload.persona?.name || presentation.fallbackAssistantName;
  const totalHitCount = results.length;

  return (
    <div className="chat-search-overlay" role="dialog" aria-modal="true" aria-label={t('chat.search.title')}>
      <div className="chat-search-bar">
        <button
          type="button"
          className="chat-search-back"
          aria-label={t('chat.search.close')}
          onClick={(event) => runSelectionAction(onClose, { element: event.currentTarget })}
        >
          <Icon name="chevron" size={18} />
        </button>
        <span className="chat-search-field">
          <Icon name="search" size={16} />
          <input
            ref={inputRef}
            type="search"
            className="chat-search-input"
            value={query}
            placeholder={t('chat.search.placeholder')}
            aria-label={t('chat.search.placeholder')}
            onChange={(event) => setQuery(event.target.value)}
          />
          {query ? (
            <button
              type="button"
              className="chat-search-clear"
              aria-label={t('chat.search.clear')}
              onClick={() => setQuery('')}
            >
              <Icon name="x" size={14} />
            </button>
          ) : null}
        </span>
      </div>

      <div className="chat-search-results">
        {!normalizedQuery ? (
          <p className="chat-search-hint">{t('chat.search.hint')}</p>
        ) : totalHitCount === 0 ? (
          <p className="chat-search-hint">{t('chat.search.empty')}</p>
        ) : (
          <>
            <div className="chat-search-count">
              {t('chat.search.resultCount', { count: totalHitCount })}
            </div>
            {results.map(({ message, excerpt }) => {
              const { head, hit, tail } = splitExcerptAroundQuery(excerpt, normalizedQuery);
              return (
                <button
                  key={message.id}
                  type="button"
                  className="chat-search-result"
                  onClick={() => {
                    if (presentation.activeConversationId) {
                      setFocusedMessageTarget({
                        conversationId: presentation.activeConversationId,
                        messageId: message.id
                      });
                    }
                    onClose();
                  }}
                >
                  <span className="chat-search-result-head">
                    <span className={`chat-search-role ${message.role}`}>
                      {message.role === 'user' ? t('chat.search.roleUser') : assistantLabel}
                    </span>
                    <span className="chat-search-time">{formatMatchTime(message.timestamp)}</span>
                  </span>
                  <span className="chat-search-excerpt">
                    {head}
                    {hit ? <mark>{hit}</mark> : null}
                    {tail}
                  </span>
                </button>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
