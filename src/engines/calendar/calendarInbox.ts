import { createUid } from '../id';

export type CalendarUnreadChangeKind = 'note' | 'period';

export type CalendarUnreadChange = {
  id: string;
  kind: CalendarUnreadChangeKind;
  date: string;
  text: string;
  authorName: string;
  createdAt: number;
};

const STORAGE_PREFIX = 'polaris:calendar-unread:v1:';
const UPDATE_EVENT = 'polaris:calendar-unread-updated';
const MAX_UNREAD_CHANGES = 100;

function storageKey(collaboratorId: string) {
  return `${STORAGE_PREFIX}${collaboratorId || 'default'}`;
}

function getStorage() {
  return typeof window !== 'undefined' ? window.localStorage : null;
}

export function listCalendarUnreadChanges(collaboratorId: string): CalendarUnreadChange[] {
  const storage = getStorage();
  if (!storage) return [];
  try {
    const parsed = JSON.parse(storage.getItem(storageKey(collaboratorId)) || '[]') as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is CalendarUnreadChange => Boolean(
      entry
      && typeof entry === 'object'
      && typeof (entry as CalendarUnreadChange).id === 'string'
      && typeof (entry as CalendarUnreadChange).date === 'string'
      && typeof (entry as CalendarUnreadChange).text === 'string'
      && ((entry as CalendarUnreadChange).kind === 'note' || (entry as CalendarUnreadChange).kind === 'period')
    ));
  } catch {
    return [];
  }
}

function writeCalendarUnreadChanges(collaboratorId: string, changes: CalendarUnreadChange[]) {
  const storage = getStorage();
  if (!storage) return;
  storage.setItem(storageKey(collaboratorId), JSON.stringify(changes.slice(-MAX_UNREAD_CHANGES)));
  window.dispatchEvent(new CustomEvent(UPDATE_EVENT, { detail: { collaboratorId } }));
}

export function pushCalendarUnreadChange(input: {
  collaboratorId: string;
  kind: CalendarUnreadChangeKind;
  date: string;
  text: string;
  authorName?: string;
}) {
  const change: CalendarUnreadChange = {
    id: createUid('calendar-unread'),
    kind: input.kind,
    date: input.date,
    text: input.text.trim(),
    authorName: input.authorName?.trim() || '艺艺',
    createdAt: Date.now()
  };
  if (!change.text) return null;
  writeCalendarUnreadChanges(input.collaboratorId, [
    ...listCalendarUnreadChanges(input.collaboratorId),
    change
  ]);
  return change;
}

export function countCalendarUnreadChanges(collaboratorId: string) {
  return listCalendarUnreadChanges(collaboratorId).length;
}

export function markCalendarUnreadChangesSeen(collaboratorId: string) {
  const changes = listCalendarUnreadChanges(collaboratorId);
  if (changes.length === 0) return 0;
  writeCalendarUnreadChanges(collaboratorId, []);
  return changes.length;
}

export function subscribeCalendarUnreadChanges(collaboratorId: string, listener: () => void) {
  if (typeof window === 'undefined') return () => {};
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<{ collaboratorId?: string }>).detail;
    if (!detail?.collaboratorId || detail.collaboratorId === collaboratorId) listener();
  };
  window.addEventListener(UPDATE_EVENT, handler);
  return () => window.removeEventListener(UPDATE_EVENT, handler);
}