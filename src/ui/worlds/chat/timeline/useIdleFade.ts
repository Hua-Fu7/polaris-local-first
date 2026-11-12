import { useEffect, useRef, useState } from 'react';

/**
 * 屏幕上的「浮层控件」用这个开关：动一下屏幕就亮出来，静置 `delayMs` 之后自动淡掉。
 *
 * 为什么不用 CSS 的 `:hover` / `animation` —— 触屏上没有 hover，也不该让按钮一直杵在
 * 内容上面抢注意力。这里监听的是**整个 window**（capture 阶段），所以点屏幕任何地方都算
 * 「有操作」，不需要用户精准点到按钮上。
 */
const ACTIVITY_EVENTS = [
  'pointerdown',
  'pointermove',
  'touchstart',
  'touchmove',
  'keydown',
  'wheel',
  'scroll'
] as const;

export function useIdleFade(delayMs = 2000) {
  const [visible, setVisible] = useState(true);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    const clearTimer = () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
    const armTimer = () => {
      clearTimer();
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        setVisible(false);
      }, delayMs);
    };
    const handleActivity = () => {
      // 已经亮着时 setVisible(true) 是同一个值，React 会直接跳过重渲染，不会打爆渲染。
      setVisible(true);
      armTimer();
    };

    handleActivity();
    ACTIVITY_EVENTS.forEach((name) => {
      window.addEventListener(name, handleActivity, { passive: true, capture: true });
    });

    return () => {
      clearTimer();
      ACTIVITY_EVENTS.forEach((name) => {
        window.removeEventListener(name, handleActivity, { capture: true });
      });
    };
  }, [delayMs]);

  return visible;
}
