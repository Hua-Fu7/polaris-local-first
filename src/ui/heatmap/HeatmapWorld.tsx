import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import type { Conversation } from '../../types/domain';
import { readConversationMessages } from '../../stores/chat';
import {
  accumulateChatHeatmapDays,
  chatHeatmapAddDays,
  chatHeatmapDayDate,
  chatHeatmapDayKey,
  chatHeatmapDayTotal,
  cloneChatHeatmapDays,
  mergeChatHeatmapDays,
  resolveChatHeatmapStats,
  type ChatHeatmapDays
} from '../../engines/heatmap/chatHeatmap';
import { Icon } from '../Icon';

const WEEKS = 16;
const WEEKDAY_MARKS = ['一', '', '三', '', '五', '', '日'];
const MONTH_LABELS = Array.from({ length: 12 }, (_unused, index) => `${index + 1} 月`);

type HeatmapWorldProps = {
  open: boolean;
  collaboratorName: string;
  conversations: Conversation[];
  onClose: () => void;
};

type HeatmapCell = {
  key: string;
  date: Date;
  future: boolean;
  level: number;
  total: number;
};

type HeatmapMonthMark = {
  week: number;
  label: string;
};

// 已统计过的对话按 updatedAt 缓存，重新打开热力图不用再读一遍本地库。
const conversationDayCache = new Map<string, { stamp: number; days: ChatHeatmapDays }>();

async function readConversationHeatmapDays(conversation: Conversation): Promise<ChatHeatmapDays> {
  const cached = conversationDayCache.get(conversation.id);
  if (cached && cached.stamp === conversation.updatedAt) return cached.days;

  let messages = conversation.messages;
  if (messages.length === 0) {
    // 没在内存里的对话（归档态）直接读本地库，读完只留每天的数字，不把正文塞回 store。
    try {
      messages = await readConversationMessages(conversation.id);
    } catch {
      messages = [];
    }
  }

  const days = accumulateChatHeatmapDays({}, messages);
  conversationDayCache.set(conversation.id, { stamp: conversation.updatedAt, days });
  return days;
}

function heatLevel(total: number, max: number) {
  if (!total) return 0;
  const ratio = total / max;
  if (ratio < 0.12) return 1;
  if (ratio < 0.28) return 2;
  if (ratio < 0.48) return 3;
  if (ratio < 0.72) return 4;
  return 5;
}

function pad(value: number) {
  return String(value).padStart(2, '0');
}

export function HeatmapWorld({
  open,
  collaboratorName,
  conversations,
  onClose
}: HeatmapWorldProps) {
  const [days, setDays] = useState<ChatHeatmapDays>({});
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [selected, setSelected] = useState(() => chatHeatmapDayKey(new Date()));
  const todayKey = useMemo(() => chatHeatmapDayKey(new Date()), []);
  const partnerName = collaboratorName.trim() || 'TA';

  // 每次打开都回到今天（手机时钟被校正过的话，挂载时的日期可能是旧值）。
  useEffect(() => {
    if (!open) return;
    setSelected(chatHeatmapDayKey(new Date()));
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setProgress({ done: 0, total: conversations.length });

    void (async () => {
      const merged: ChatHeatmapDays = {};
      let done = 0;
      for (const conversation of conversations) {
        const part = await readConversationHeatmapDays(conversation);
        mergeChatHeatmapDays(merged, part);
        done += 1;
        if (cancelled) return;
        if (done % 4 === 0 || done === conversations.length) {
          setDays(cloneChatHeatmapDays(merged));
          setProgress(done >= conversations.length ? null : { done, total: conversations.length });
        }
      }
      if (cancelled) return;
      setDays(cloneChatHeatmapDays(merged));
      setProgress(null);
    })();

    return () => {
      cancelled = true;
    };
  }, [conversations, open]);

  const stats = useMemo(() => resolveChatHeatmapStats(days), [days]);

  const { cells, monthMarks, max } = useMemo(() => {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekdayIndex = (todayStart.getDay() + 6) % 7;
    const start = chatHeatmapAddDays(todayStart, -weekdayIndex - (WEEKS - 1) * 7);
    const totalOf = (key: string) => chatHeatmapDayTotal(days[key]);
    const maxTotal = Math.max(1, ...Object.keys(days).map((key) => totalOf(key)));

    const built: HeatmapCell[] = [];
    for (let week = 0; week < WEEKS; week += 1) {
      for (let row = 0; row < 7; row += 1) {
        const date = chatHeatmapAddDays(start, week * 7 + row);
        const key = chatHeatmapDayKey(date);
        const total = totalOf(key);
        built.push({
          key,
          date,
          future: date.getTime() > todayStart.getTime(),
          level: heatLevel(total, maxTotal),
          total
        });
      }
    }

    const marks: HeatmapMonthMark[] = [];
    let lastMonth = -1;
    for (let week = 0; week < WEEKS; week += 1) {
      const month = chatHeatmapAddDays(start, week * 7).getMonth();
      if (month !== lastMonth) {
        marks.push({ week, label: MONTH_LABELS[month] ?? `${month + 1} 月` });
        lastMonth = month;
      }
    }
    const visibleMarks = marks.filter((mark, index) => {
      const next = marks[index + 1];
      return !next || next.week - mark.week >= 3;
    });

    return { cells: built, monthMarks: visibleMarks, max: maxTotal };
  }, [days]);

  const selectedDay = days[selected] ?? { me: 0, ai: 0 };
  const selectedDate = chatHeatmapDayDate(selected);
  const selectedTotal = selectedDay.me + selectedDay.ai;
  const busy = progress !== null && progress.total > 0;
  const hasAny = stats.total > 0;

  if (!open) return null;

  return (
    <div className="heatmap-world-layer" role="dialog" aria-modal="true" aria-label="热力图">
      <section className="heatmap-world">
        <header className="heatmap-world-head">
          <div className="heatmap-world-title">
            <h1>热力图</h1>
            <p>
              {busy
                ? `正在统计 ${progress!.done} / ${progress!.total} 个对话…`
                : `和 ${partnerName} 说过的话，按天铺开`}
            </p>
          </div>
          <button type="button" className="heatmap-close-btn" onClick={onClose} aria-label="关闭">
            <Icon name="x" size={17} />
          </button>
        </header>

        <div className="heatmap-card">
          <div
            className="heatmap-months"
            style={{ ['--heat-weeks' as string]: WEEKS } as CSSProperties}
            aria-hidden="true"
          >
            {monthMarks.map((mark) => (
              <span key={`${mark.week}-${mark.label}`} style={{ gridColumn: mark.week + 1 }}>
                {mark.label}
              </span>
            ))}
          </div>

          <div className="heatmap-grid-row">
            <div className="heatmap-weekdays" aria-hidden="true">
              {WEEKDAY_MARKS.map((label, index) => (
                <span key={`weekday-${index}`}>{label}</span>
              ))}
            </div>
            <div
              className="heatmap-cells"
              style={{ ['--heat-weeks' as string]: WEEKS } as CSSProperties}
              role="grid"
              aria-label="每天说过的句数"
            >
              {cells.map((cell) => (
                <button
                  key={cell.key}
                  type="button"
                  className={`heatmap-cell${cell.future ? ' heatmap-cell--future' : ''}${cell.key === selected ? ' heatmap-cell--selected' : ''}`}
                  data-level={cell.level}
                  aria-label={`${cell.key} ${cell.total} 句`}
                  title={`${cell.key} · ${cell.total} 句`}
                  onClick={() => setSelected(cell.key)}
                />
              ))}
            </div>
          </div>

          <div className="heatmap-legend">
            <span>少</span>
            {[0, 1, 2, 3, 4, 5].map((level) => (
              <i key={`legend-${level}`} data-level={level} />
            ))}
            <span>多</span>
          </div>
        </div>

        <div className="heatmap-card">
          <div className="heatmap-date">
            {`${selectedDate.getFullYear()} 年 ${selectedDate.getMonth() + 1} 月 ${selectedDate.getDate()} 日`}
            {selected === todayKey ? ' · 今天' : ''}
          </div>
          <div className="heatmap-total">
            <span>{selectedTotal}</span>
            <small>句</small>
          </div>
          <div className="heatmap-split" aria-hidden="true">
            <div
              className="heatmap-split-me"
              style={{ flexGrow: selectedDay.me || 0.0001 }}
            />
            <div
              className="heatmap-split-ai"
              style={{ flexGrow: selectedDay.ai || 0.0001 }}
            />
          </div>
          <div className="heatmap-split-labels">
            <span>你 {selectedDay.me} 句</span>
            <span>{partnerName} {selectedDay.ai} 句</span>
          </div>
        </div>

        {hasAny ? (
          <div className="heatmap-stats">
            <div className="heatmap-stat">
              <b>{stats.activeDays}<small>天</small></b>
              <p>说过话的日子</p>
            </div>
            <div className="heatmap-stat">
              <b>{stats.currentStreak}<small>天</small></b>
              <p>到今天连着</p>
            </div>
            <div className="heatmap-stat">
              <b>{stats.longestStreak}<small>天</small></b>
              <p>最长连着</p>
            </div>
            <div className="heatmap-stat">
              <b>{stats.total}<small>句</small></b>
              <p>一共说过</p>
            </div>
          </div>
        ) : (
          <div className="heatmap-empty">
            {busy ? '翻旧对话中…' : '这段范围里还没有可以统计的对话。'}
          </div>
        )}

        <div className="heatmap-foot">
          {hasAny ? `你 ${stats.totalMe} 句 · ${partnerName} ${stats.totalAi} 句 · 最热闹的一天 ${stats.busiestTotal} 句` : null}
        </div>
      </section>
    </div>
  );
}