import { createUid } from '../id';

export type CalendarNoteAuthor = 'user' | 'collaborator';

export type CalendarNote = {
  id: string;
  date: string;
  author: CalendarNoteAuthor;
  authorName: string;
  text: string;
  createdAt: number;
  updatedAt: number;
};

const STORAGE_PREFIX = 'polaris:calendar-notes:v1:';
const UPDATE_EVENT = 'polaris:calendar-notes-updated';
const RETENTION_DAYS = 7;

function storageKey(collaboratorId: string) {
  return `${STORAGE_PREFIX}${collaboratorId || 'default'}`;
}

function getStorage() {
  return typeof window !== 'undefined' ? window.localStorage : null;
}

export function localDateIso(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function calendarDateFromIso(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
}

function dateOffsetIso(value: string, offsetDays: number) {
  const date = calendarDateFromIso(value);
  date.setDate(date.getDate() + offsetDays);
  return localDateIso(date);
}

function pruneExpired(notes: CalendarNote[], now = new Date()) {
  const cutoff = dateOffsetIso(localDateIso(now), -RETENTION_DAYS);
  const kept = notes.filter((note) => note.date >= cutoff);
  return kept.length === notes.length ? notes : kept;
}

function readNotes(collaboratorId: string) {
  const storage = getStorage();
  if (!storage) return [] as CalendarNote[];
  try {
    const raw = storage.getItem(storageKey(collaboratorId));
    const parsed = raw ? JSON.parse(raw) as CalendarNote[] : [];
    if (!Array.isArray(parsed)) return [];
    const notes = pruneExpired(parsed.filter((note) => (
      note
      && typeof note.id === 'string'
      && typeof note.date === 'string'
      && typeof note.text === 'string'
    )));
    if (notes.length !== parsed.length) {
      storage.setItem(storageKey(collaboratorId), JSON.stringify(notes));
    }
    return notes;
  } catch {
    return [];
  }
}

function writeNotes(collaboratorId: string, notes: CalendarNote[]) {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(storageKey(collaboratorId), JSON.stringify(pruneExpired(notes)));
    window.dispatchEvent(new CustomEvent(UPDATE_EVENT, { detail: { collaboratorId } }));
  } catch {
    // Best effort local storage.
  }
}

export function listCalendarNotes(collaboratorId: string, fromDate?: string, toDate?: string) {
  return readNotes(collaboratorId)
    .filter((note) => (!fromDate || note.date >= fromDate) && (!toDate || note.date <= toDate))
    .sort((left, right) => right.updatedAt - left.updatedAt);
}

export function addCalendarNote(input: {
  collaboratorId: string;
  date: string;
  author: CalendarNoteAuthor;
  authorName: string;
  text: string;
}) {
  const text = input.text.trim();
  if (!text) return null;
  const now = Date.now();
  const note: CalendarNote = {
    id: createUid('calendar-note'),
    date: input.date,
    author: input.author,
    authorName: input.authorName.trim() || (input.author === 'user' ? '我' : '小机'),
    text,
    createdAt: now,
    updatedAt: now
  };
  const notes = readNotes(input.collaboratorId);
  writeNotes(input.collaboratorId, [note, ...notes]);
  return note;
}

export function updateCalendarNote(input: {
  collaboratorId: string;
  noteId: string;
  text: string;
}) {
  const text = input.text.trim();
  if (!text) return null;
  const notes = readNotes(input.collaboratorId);
  const existing = notes.find((note) => note.id === input.noteId);
  if (!existing) return null;
  const updated: CalendarNote = { ...existing, text, updatedAt: Date.now() };
  writeNotes(input.collaboratorId, notes.map((note) => note.id === input.noteId ? updated : note));
  return updated;
}

export function deleteCalendarNote(collaboratorId: string, noteId: string) {
  const notes = readNotes(collaboratorId);
  const next = notes.filter((note) => note.id !== noteId);
  if (next.length === notes.length) return false;
  writeNotes(collaboratorId, next);
  return true;
}

export function subscribeCalendarNotes(collaboratorId: string, listener: () => void) {
  if (typeof window === 'undefined') return () => {};
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<{ collaboratorId?: string }>).detail;
    if (!detail?.collaboratorId || detail.collaboratorId === collaboratorId) listener();
  };
  window.addEventListener(UPDATE_EVENT, handler);
  return () => window.removeEventListener(UPDATE_EVENT, handler);
}
