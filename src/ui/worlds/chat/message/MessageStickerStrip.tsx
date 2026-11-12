import { useEffect, useRef } from 'react';
import type { ChatAttachment } from '../../../../types/domain';
import { ChatAttachmentStrip } from '../ChatAttachmentStrip';

type MessageStickerStripProps = {
  attachments: ChatAttachment[] | undefined;
  onLongPress?: () => void;
};

export function MessageStickerStrip({ attachments, onLongPress }: MessageStickerStripProps) {
  const timerRef = useRef<number | null>(null);
  const triggeredRef = useRef(false);
  const startPointRef = useRef<{ x: number; y: number } | null>(null);
  const pressStartedAtRef = useRef(0);

  const clearTimer = () => {
    if (timerRef.current === null) return;
    window.clearTimeout(timerRef.current);
    timerRef.current = null;
  };

  const triggerLongPress = () => {
    if (triggeredRef.current || !onLongPress) return;
    clearTimer();
    triggeredRef.current = true;
    onLongPress();
  };

  useEffect(() => () => clearTimer(), []);

  if (!attachments?.length) return null;

  return (
    <div
      className="message-sticker-longpress"
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={(event) => {
        event.stopPropagation();
        if (!onLongPress) return;
        clearTimer();
        triggeredRef.current = false;
        startPointRef.current = { x: event.clientX, y: event.clientY };
        pressStartedAtRef.current = Date.now();
        timerRef.current = window.setTimeout(triggerLongPress, 420);
      }}
      onPointerMove={(event) => {
        event.stopPropagation();
        const start = startPointRef.current;
        if (!start) return;
        const distance = Math.hypot(event.clientX - start.x, event.clientY - start.y);
        if (distance > 14) {
          pressStartedAtRef.current = 0;
          clearTimer();
        }
      }}
      onPointerUp={(event) => {
        event.stopPropagation();
        if (pressStartedAtRef.current > 0 && Date.now() - pressStartedAtRef.current >= 420) {
          triggerLongPress();
        }
        pressStartedAtRef.current = 0;
        startPointRef.current = null;
        clearTimer();
      }}
      onPointerCancel={(event) => {
        event.stopPropagation();
        pressStartedAtRef.current = 0;
        startPointRef.current = null;
        clearTimer();
      }}
      onClickCapture={(event) => {
        if (!triggeredRef.current) return;
        event.preventDefault();
        event.stopPropagation();
        triggeredRef.current = false;
      }}
    >
      <ChatAttachmentStrip attachments={attachments} tone="sticker" />
    </div>
  );
}