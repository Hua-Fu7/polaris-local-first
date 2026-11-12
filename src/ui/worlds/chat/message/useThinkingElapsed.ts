import { useEffect, useRef, useState } from 'react';

export type ThinkingElapsed = {
  /** 当前这一段活动的秒数；换一段活动（思考 → 调工具 → 再思考）就重新数。 */
  segmentSeconds: number;
  /** 这一轮从开始到现在的秒数，收尾时定格成「想了多久」。 */
  runSeconds: number;
  /**
   * 有没有真的测过。历史消息（App 重启后翻出来的）没测过，
   * 别拿 0 去编一个「Thought for 0s」出来。
   */
  measured: boolean;
  /** 这一轮开始计时的墙上时间；收尾时用它算总时长，切后台也不会变成 0。 */
  startedAtMs: number | null;
};

/**
 * 给 Thinking 状态条数秒。
 *
 * 只在活动期间跑（1 秒一跳），停下来就把最后的数字留住；
 * 换一段活动时段内秒数归零，整轮秒数继续走。
 */
export function useThinkingElapsed(args: {
  isActive: boolean;
  segmentKey: string;
}): ThinkingElapsed {
  const { isActive, segmentKey } = args;
  const runStartRef = useRef<number | null>(null);
  const segmentStartRef = useRef<number | null>(null);
  const segmentKeyRef = useRef(segmentKey);
  const [segmentSeconds, setSegmentSeconds] = useState(0);
  const [runSeconds, setRunSeconds] = useState(0);

  useEffect(() => {
    if (!isActive) return;
    const now = Date.now();
    if (runStartRef.current === null) {
      runStartRef.current = now;
    }
    if (segmentStartRef.current === null || segmentKeyRef.current !== segmentKey) {
      segmentKeyRef.current = segmentKey;
      segmentStartRef.current = now;
    }

    const tick = () => {
      const current = Date.now();
      const segmentStart = segmentStartRef.current ?? current;
      const runStart = runStartRef.current ?? current;
      setSegmentSeconds(Math.max(0, Math.floor((current - segmentStart) / 1000)));
      setRunSeconds(Math.max(0, Math.floor((current - runStart) / 1000)));
    };

    tick();
    const intervalId = window.setInterval(tick, 1000);
    return () => window.clearInterval(intervalId);
  }, [isActive, segmentKey]);

  return {
    segmentSeconds,
    runSeconds,
    measured: runStartRef.current !== null,
    startedAtMs: runStartRef.current
  };
}
