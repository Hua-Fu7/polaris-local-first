import { useEffect, useMemo, useState } from 'react';
import {
  addCalendarNote,
  deleteCalendarNote,
  listCalendarNotes,
  localDateIso,
  subscribeCalendarNotes
} from '../../engines/calendar/calendarNotes';
import {
  calendarWeatherMetaFromCode,
  fetchTodayWeather,
  readCalendarCity,
  readCalendarWeatherOverride,
  writeCalendarCity,
  writeCalendarWeatherOverride,
  type CalendarWeather,
  type CalendarWeatherOverride
} from '../../engines/calendar/calendarWeather';
import {
  readCalendarPeriods,
  resolvePredictedPeriods,
  setCalendarPeriod,
  subscribeCalendarPeriods
} from '../../engines/calendar/calendarPeriods';
import { pushCalendarUnreadChange } from '../../engines/calendar/calendarInbox';
import { Icon } from '../Icon';

type CalendarWorldProps = {
  open: boolean;
  collaboratorId: string;
  collaboratorName: string;
  onClose: () => void;
};

type CalendarCell = {
  date: string;
  inMonth: boolean;
};

const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日'];
const WEEKDAY_FULL_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const WEATHER_CYCLE = [0, 1, 2, 45, 61, 71, 95];

function buildMonthCells(cursor: Date): CalendarCell[] {
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const start = new Date(first);
  start.setDate(first.getDate() - ((first.getDay() + 6) % 7));
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return {
      date: localDateIso(date),
      inMonth: date.getMonth() === cursor.getMonth()
    };
  });
}

function displayMonth(cursor: Date) {
  return `${cursor.getFullYear()} 年 ${cursor.getMonth() + 1} 月`;
}

function formatSelectedDate(date: string) {
  const parsed = new Date(`${date}T00:00`);
  return `${date} ${WEEKDAY_FULL_LABELS[parsed.getDay()]}${date === localDateIso(new Date()) ? ' · 今天' : ''}`;
}

function weatherFromLive(weather: CalendarWeather): CalendarWeatherOverride {
  return {
    code: weather.code,
    label: weather.label,
    emoji: weather.emoji,
    temperature: weather.temperature
  };
}

export function CalendarWorld({
  open,
  collaboratorId,
  collaboratorName,
  onClose
}: CalendarWorldProps) {
  const today = localDateIso(new Date());
  const [cursor, setCursor] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState(today);
  const [notesVersion, setNotesVersion] = useState(0);
  const [periodsVersion, setPeriodsVersion] = useState(0);
  const [city, setCity] = useState(() => readCalendarCity());
  const [cityDraft, setCityDraft] = useState(() => readCalendarCity());
  const [weather, setWeather] = useState<CalendarWeather | null>(null);
  const [weatherStatus, setWeatherStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [weatherOverride, setWeatherOverride] = useState<CalendarWeatherOverride | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    if (!open) return;
    return subscribeCalendarNotes(collaboratorId, () => setNotesVersion((value) => value + 1));
  }, [collaboratorId, open]);

  useEffect(() => {
    if (!open) return;
    return subscribeCalendarPeriods(() => setPeriodsVersion((value) => value + 1));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const refreshCity = () => {
      const next = readCalendarCity();
      setCity(next);
      setCityDraft(next);
    };
    window.addEventListener('polaris:calendar-city-updated', refreshCity);
    return () => window.removeEventListener('polaris:calendar-city-updated', refreshCity);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setWeatherStatus('loading');
    void fetchTodayWeather(city)
      .then((result) => {
        if (cancelled) return;
        setWeather(result);
        setWeatherStatus('ready');
      })
      .catch(() => {
        if (cancelled) return;
        setWeather(null);
        setWeatherStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [city, open]);

  useEffect(() => {
    setWeatherOverride(readCalendarWeatherOverride(city, selectedDate));
  }, [city, selectedDate, weather]);

  useEffect(() => {
    setDraft('');
    setAddOpen(false);
  }, [selectedDate]);

  const cells = useMemo(() => buildMonthCells(cursor), [cursor]);
  const firstDate = cells[0]?.date ?? today;
  const lastDate = cells[cells.length - 1]?.date ?? today;
  const notes = useMemo(
    () => listCalendarNotes(collaboratorId, firstDate, lastDate),
    [collaboratorId, firstDate, lastDate, notesVersion]
  );
  const notesByDate = useMemo(() => {
    const map = new Map<string, number>();
    notes.forEach((note) => map.set(note.date, (map.get(note.date) ?? 0) + 1));
    return map;
  }, [notes]);
  const selectedNotes = useMemo(
    () => listCalendarNotes(collaboratorId, selectedDate, selectedDate),
    [collaboratorId, selectedDate, notesVersion]
  );
  const periods = useMemo(() => {
    void periodsVersion;
    return readCalendarPeriods();
  }, [periodsVersion]);
  const predictedPeriods = useMemo(() => resolvePredictedPeriods(periods), [periods]);
  const periodSet = useMemo(() => new Set(periods), [periods]);
  const liveWeather = selectedDate === today && weatherStatus === 'ready' && weather
    ? weatherFromLive(weather)
    : null;
  const effectiveWeather = weatherOverride ?? liveWeather ?? {
    code: 0,
    ...calendarWeatherMetaFromCode(0)
  };

  if (!open) return null;

  const goMonth = (offset: number) => {
    setCursor((current) => new Date(current.getFullYear(), current.getMonth() + offset, 1));
  };

  const goToday = () => {
    setCursor(new Date());
    setSelectedDate(today);
  };

  const commitCity = () => {
    const next = cityDraft.trim();
    if (!next || next === city) {
      setCityDraft(city);
      return;
    }
    writeCalendarCity(next);
    setCity(readCalendarCity());
  };

  const cycleWeather = () => {
    const currentIndex = WEATHER_CYCLE.indexOf(effectiveWeather.code);
    const nextCode = WEATHER_CYCLE[(currentIndex + 1 + WEATHER_CYCLE.length) % WEATHER_CYCLE.length] ?? 0;
    const meta = calendarWeatherMetaFromCode(nextCode);
    const next = { code: nextCode, ...meta, temperature: effectiveWeather.temperature };
    writeCalendarWeatherOverride(city, selectedDate, next);
    setWeatherOverride(next);
  };

  const setTemperature = (value: string) => {
    const temperature = value.trim() === '' ? undefined : Number(value);
    const next = {
      ...effectiveWeather,
      temperature: typeof temperature === 'number' && Number.isFinite(temperature) ? temperature : undefined
    };
    writeCalendarWeatherOverride(city, selectedDate, next);
    setWeatherOverride(next);
  };

  const togglePeriod = () => {
    const nextEnabled = !periodSet.has(selectedDate);
    setCalendarPeriod(selectedDate, nextEnabled);
    pushCalendarUnreadChange({
      collaboratorId,
      kind: 'period',
      date: selectedDate,
      text: nextEnabled ? '标记为经期' : '取消经期标记'
    });
  };

  const addNote = () => {
    const note = addCalendarNote({
      collaboratorId,
      date: selectedDate,
      author: 'user',
      authorName: '艺艺',
      text: draft
    });
    if (!note) return;
    pushCalendarUnreadChange({
      collaboratorId,
      kind: 'note',
      date: selectedDate,
      text: note.text
    });
    setDraft('');
    setAddOpen(false);
    setNotesVersion((value) => value + 1);
  };

  const removeNote = (noteId: string) => {
    if (!window.confirm('删掉这条便签？')) return;
    deleteCalendarNote(collaboratorId, noteId);
    setNotesVersion((value) => value + 1);
  };

  return (
    <div className="calendar-world-layer" role="dialog" aria-modal="true" aria-label="日历">
      <section className="calendar-world">
        <header className="calendar-world-head">
          <div className="calendar-city-block">
            <input
              className="calendar-city-input"
              value={cityDraft}
              maxLength={12}
              aria-label="所在城市"
              enterKeyHint="done"
              onChange={(event) => setCityDraft(event.target.value)}
              onBlur={commitCity}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur();
              }}
            />
            <div className="calendar-month-label">{displayMonth(cursor)}</div>
            <div className="calendar-weather-chip">
              <button type="button" onClick={cycleWeather} aria-label="切换天气">
                {effectiveWeather.emoji}
              </button>
              <span>{effectiveWeather.label}</span>
              <input
                type="number"
                inputMode="numeric"
                value={effectiveWeather.temperature ?? ''}
                placeholder="--"
                aria-label="温度"
                onChange={(event) => setTemperature(event.target.value)}
              />
              <span>°C</span>
            </div>
          </div>
          <div className="calendar-month-nav">
            <button type="button" onClick={() => goMonth(-1)} aria-label="上个月">‹</button>
            <button type="button" onClick={goToday}>今天</button>
            <button type="button" onClick={() => goMonth(1)} aria-label="下个月">›</button>
            <button type="button" className="calendar-close-btn" onClick={onClose} aria-label="关闭">
              <Icon name="x" size={17} />
            </button>
          </div>
        </header>

        <div className="calendar-weekdays" aria-hidden="true">
          {WEEKDAY_LABELS.map((day) => <span key={day}>{day}</span>)}
        </div>

        <div className="calendar-days-grid">
          {cells.map((cell) => {
            const predicted = predictedPeriods.get(cell.date);
            const classes = [
              'calendar-day-cell',
              cell.inMonth ? '' : 'is-outside',
              periodSet.has(cell.date) ? 'is-period' : '',
              predicted !== undefined ? 'is-predicted' : '',
              predicted === true ? 'is-predicted-fade' : '',
              cell.date === today ? 'is-today' : '',
              cell.date === selectedDate ? 'is-selected' : ''
            ].filter(Boolean).join(' ');
            return (
              <button
                type="button"
                key={cell.date}
                className={classes}
                onClick={() => setSelectedDate(cell.date)}
              >
                <i>{Number(cell.date.slice(-2))}</i>
                {notesByDate.has(cell.date) ? <span className="calendar-day-dot" aria-hidden="true" /> : null}
              </button>
            );
          })}
        </div>

        <div className="calendar-selected-date">{formatSelectedDate(selectedDate)}</div>

        <button type="button" className="calendar-add-note" onClick={() => setAddOpen((value) => !value)}>
          ＋ 记一件事
        </button>
        {addOpen ? (
          <div className="calendar-add-note-box">
            <input
              value={draft}
              maxLength={60}
              placeholder="今天发生了什么"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') addNote();
              }}
            />
            <button type="button" onClick={addNote} disabled={!draft.trim()}>保存</button>
          </div>
        ) : null}

        <ul className="calendar-event-list">
          {selectedNotes.length ? selectedNotes.map((note) => (
            <li key={note.id}>
              <span>{note.text}</span>
              <button type="button" onClick={() => removeNote(note.id)} aria-label="删除">✕</button>
            </li>
          )) : <li className="calendar-event-empty">这天还没有便签。</li>}
        </ul>

        <section className="calendar-period-card">
          <h2>
            <span aria-hidden="true">♥</span>
            经期
          </h2>
          <div className="calendar-period-row">
            <span>这天算不算经期</span>
            <button
              type="button"
              role="switch"
              aria-checked={periodSet.has(selectedDate)}
              className={`calendar-period-switch ${periodSet.has(selectedDate) ? 'is-on' : ''}`}
              onClick={togglePeriod}
            >
              <span />
            </button>
          </div>
        </section>

        <div className="calendar-collaborator-hint">
          便签会同时给小机看；{collaboratorName || '小机'} 也可以往这里写。
        </div>
      </section>
    </div>
  );
}