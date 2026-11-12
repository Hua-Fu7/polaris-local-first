import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ChangeEvent } from 'react';
import {
  readTogetherDate,
  writeTogetherDate,
  resolveTogetherDays,
  formatTogetherSince
} from '../../../app/home/homeTogether';
import { countTodayMessages, formatTodayStamp } from '../../../app/home/homeTodayActivity';
import {
  accumulateChatHeatmapDays,
  chatHeatmapAddDays,
  chatHeatmapDayKey,
  chatHeatmapDayTotal,
  type ChatHeatmapDays
} from '../../../engines/heatmap/chatHeatmap';
import { fetchTodayWeather, readCalendarCity, type CalendarWeather } from '../../../engines/calendar/calendarWeather';
import type { Conversation } from '../../../types/domain';
import { CalendarWorld } from '../../calendar/CalendarWorld';
import { HeatmapWorld } from '../../heatmap/HeatmapWorld';
import { useChatPresentation, useChatStablePayload } from '../chat/context/ChatContext';
import { AsciiOceanBackground } from './AsciiOceanBackground';

const MINI_WEEKS = 13;

function startOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** 13 周 × 7 天的迷你热力图（跟大热力图同一套数据结构）。 */
export function buildMiniHeatmap(
  messages: Parameters<typeof accumulateChatHeatmapDays>[1],
  now: Date
): { key: string; total: number; level: number; future: boolean }[] {
  const days: ChatHeatmapDays = accumulateChatHeatmapDays({}, messages);
  const today = startOfLocalDay(now);
  const end = chatHeatmapAddDays(today, 6 - ((today.getDay() + 6) % 7));
  const start = chatHeatmapAddDays(end, -(MINI_WEEKS * 7 - 1));
  const cells: { key: string; total: number; level: number; future: boolean }[] = [];
  for (let index = 0; index < MINI_WEEKS * 7; index += 1) {
    const date = chatHeatmapAddDays(start, index);
    const key = chatHeatmapDayKey(date);
    const total = chatHeatmapDayTotal(days[key]);
    const future = date.getTime() > today.getTime();
    const level = future || total === 0 ? 0 : Math.min(5, 1 + Math.floor(Math.log2(total)));
    cells.push({ key, total, level, future });
  }
  return cells;
}

/**
 * 首页。
 *
 * 只有一句话的东西：在一起多少天，以及今天的两条消息
 * （聊了几句 → 大热力图；天气 → 日历）。输入框和桌宠是聊天世界那一份。
 */
export function HomeScreen() {
  const stablePayload = useChatStablePayload();
  const presentation = useChatPresentation();
  const [togetherDate, setTogetherDate] = useState(() => readTogetherDate());
  const [weather, setWeather] = useState<CalendarWeather | null>(null);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [heatmapOpen, setHeatmapOpen] = useState(false);
  const now = useMemo(() => new Date(), []);

  const collaboratorId = presentation.activeCollaboratorId ?? '';
  const collaboratorName = presentation.assistantName?.trim() || presentation.fallbackAssistantName || 'Polaris';

  const togetherDays = resolveTogetherDays(togetherDate, now);
  const activity = useMemo(
    () => countTodayMessages(stablePayload.messages ?? [], now),
    [now, stablePayload.messages]
  );
  const todayTotal = activity.me + activity.ai;

  useEffect(() => {
    let disposed = false;
    void fetchTodayWeather(readCalendarCity())
      .then((next) => {
        if (!disposed) setWeather(next);
      })
      .catch(() => {
        if (!disposed) setWeather(null);
      });
    return () => {
      disposed = true;
    };
  }, []);

  // 首页打开时把 body 标记出来：CSS 靠它把 body / 外壳的底色让开，海才看得见。
  // 热力图 / 日历是从首页点开的「正经页面」——那时候要把标记摘掉，
  // 海收起来、配色回到正常主题，不然它们会被半透明的海盖成一片灰。
  const overlayOpen = calendarOpen || heatmapOpen;
  useEffect(() => {
    if (overlayOpen) {
      delete document.body.dataset.homeOcean;
      return;
    }
    document.body.dataset.homeOcean = 'on';
    return () => {
      delete document.body.dataset.homeOcean;
    };
  }, [overlayOpen]);

  useEffect(() => {
    const handler = () => setTogetherDate(readTogetherDate());
    window.addEventListener('polaris:home-together-updated', handler);
    return () => window.removeEventListener('polaris:home-together-updated', handler);
  }, []);

  const handleTogetherDateChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    if (!value) return;
    writeTogetherDate(value);
    setTogetherDate(value);
  }, []);

  const conversations: Conversation[] = presentation.recentConversations ?? [];
  const cityName = weather?.city ?? readCalendarCity();
  const weatherLine = weather
    ? `${Math.round(weather.temperature)}° ${weather.label}`
    : '看天气';

  // 让画布铺满整屏：顶栏、输入条那一带的白色也一起盖掉，按钮照旧浮在上面。
  const oceanLayer = typeof document !== 'undefined'
    ? createPortal(<AsciiOceanBackground portal />, document.body)
    : null;

  return (
    <section className="home-world" aria-label="首页">
      {oceanLayer}
      <div className="home-scroll">
        <div className="home-center">
          <div className="home-hero-label">在一起</div>
          <label className="home-hero-days">
            <span className="home-hero-days-value">{togetherDays}</span>
            <span className="home-hero-days-unit">天</span>
            <input
              type="date"
              className="home-hero-date-input"
              value={togetherDate}
              onChange={handleTogetherDateChange}
              aria-label="在一起的第一天"
            />
          </label>
          <div className="home-hero-since">自 {formatTogetherSince(togetherDate)} 起</div>

          <div className="home-summary-line">
            <span className="home-summary-stamp">{formatTodayStamp(now)}</span>
            <button
              type="button"
              className="home-summary-link"
              onClick={() => setHeatmapOpen(true)}
            >
              今天聊了 {todayTotal} 句
            </button>
            <span className="home-summary-sep" aria-hidden="true">·</span>
            <button
              type="button"
              className="home-summary-link"
              onClick={() => setCalendarOpen(true)}
            >
              {cityName} {weatherLine}
            </button>
          </div>
        </div>
      </div>

      <CalendarWorld
        open={calendarOpen}
        collaboratorId={collaboratorId}
        collaboratorName={collaboratorName}
        onClose={() => setCalendarOpen(false)}
      />
      <HeatmapWorld
        open={heatmapOpen}
        collaboratorName={collaboratorName}
        conversations={conversations}
        onClose={() => setHeatmapOpen(false)}
      />
    </section>
  );
}
