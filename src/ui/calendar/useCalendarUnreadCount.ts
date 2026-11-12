import { useEffect, useState } from 'react';
import {
  countCalendarUnreadChanges,
  subscribeCalendarUnreadChanges
} from '../../engines/calendar/calendarInbox';

export function useCalendarUnreadCount(collaboratorId: string | null | undefined) {
  const normalizedCollaboratorId = collaboratorId?.trim() || 'default';
  const [count, setCount] = useState(() => countCalendarUnreadChanges(normalizedCollaboratorId));

  useEffect(() => {
    setCount(countCalendarUnreadChanges(normalizedCollaboratorId));
    return subscribeCalendarUnreadChanges(normalizedCollaboratorId, () => {
      setCount(countCalendarUnreadChanges(normalizedCollaboratorId));
    });
  }, [normalizedCollaboratorId]);

  return count;
}