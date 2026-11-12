import { useEffect, useMemo, useState } from 'react';
import {
  addCalendarNote,
  deleteCalendarNote,
  listCalendarNotes,
  subscribeCalendarNotes,
  updateCalendarNote,
  type CalendarNote
} from '../../engines/calendar/calendarNotes';
import { Icon } from '../Icon';

type CalendarDaySheetProps = {
  open: boolean;
  date: string;
  collaboratorId: string;
  collaboratorName: string;
  onClose: () => void;
};

function formatDateTitle(date: string) {
  const [year, month, day] = date.split('-').map(Number);
  return `${year}年${month}月${day}日`;
}

function noteTime(timestamp: number) {
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(new Date(timestamp));
}

export function CalendarDaySheet({ open, date, collaboratorId, collaboratorName, onClose }: CalendarDaySheetProps) {
  const [version, setVersion] = useState(0);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    if (!open) return;
    return subscribeCalendarNotes(collaboratorId, () => setVersion((value) => value + 1));
  }, [collaboratorId, open]);

  const notes = useMemo(
    () => listCalendarNotes(collaboratorId, date, date),
    [collaboratorId, date, version]
  );

  useEffect(() => {
    if (!open) setDraft('');
  }, [open]);

  if (!open) return null;

  const addNote = () => {
    const note = addCalendarNote({
      collaboratorId,
      date,
      author: 'user',
      authorName: '艺艺',
      text: draft
    });
    if (note) {
      setDraft('');
      setVersion((value) => value + 1);
    }
  };

  return (
    <div className="calendar-day-layer" role="dialog" aria-modal="true" aria-label={formatDateTitle(date)}>
      <button type="button" className="calendar-day-backdrop" onClick={onClose} aria-label="关闭" />
      <section className="calendar-day-sheet">
        <header className="calendar-day-head">
          <div>
            <span>当天便签</span>
            <h3>{formatDateTitle(date)}</h3>
          </div>
          <button type="button" className="calendar-icon-btn" onClick={onClose} aria-label="关闭">
            <Icon name="x" size={18} />
          </button>
        </header>

        <div className="calendar-note-list">
          {notes.length ? notes.map((note: CalendarNote) => (
            <article className={`calendar-note-card is-${note.author}`} key={note.id}>
              <header>
                <strong>{note.author === 'user' ? '艺艺' : note.authorName || collaboratorName || '小机'}</strong>
                <span>{noteTime(note.updatedAt)}</span>
              </header>
              <p>{note.text}</p>
              <footer>
                <button type="button" onClick={() => {
                  const next = window.prompt('修改便签', note.text);
                  if (next === null) return;
                  updateCalendarNote({ collaboratorId, noteId: note.id, text: next });
                  setVersion((value) => value + 1);
                }}>改</button>
                <button type="button" onClick={() => {
                  if (!window.confirm('删掉这条便签？')) return;
                  deleteCalendarNote(collaboratorId, note.id);
                  setVersion((value) => value + 1);
                }}>删</button>
              </footer>
            </article>
          )) : <p className="calendar-note-empty">这天还没有便签。写一张，小机也看得到。</p>}
        </div>

        <div className="calendar-note-compose">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="给这天留张便签…"
            rows={3}
          />
          <button type="button" className="calendar-primary-btn" onClick={addNote} disabled={!draft.trim()}>
            写上
          </button>
        </div>
      </section>
    </div>
  );
}
