import { useEffect, useRef, type ReactNode } from 'react';
import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { AppTopbar, type AppTopbarProps } from '../shell/AppTopbar';

type MobileAppShellFrameProps = {
  topbarProps: AppTopbarProps;
  onEdgeOpenDrawer: () => void;
  /** 返回一步；返回 false 表示已经在最外层、没东西可关，交给系统退出应用。 */
  onEdgeBack: () => boolean;
  children: ReactNode;
};

type GestureStart = {
  x: number;
  y: number;
  fromRightEdge: boolean;
  blocked: boolean;
  triggered: boolean;
};

// 向右滑开抽屉不再要求从屏幕边缘起手：手落在正文中间照样能划出来。
// 返回仍然只认右边缘（和系统手势一致），避免和横向滚动打架。
const DRAWER_SWIPE_PX = 64;
const BACK_SWIPE_PX = 48;
const RIGHT_EDGE_ZONE_PX = 24;
const HORIZONTAL_RATIO = 1.4;
const MAX_ANCESTOR_SCAN = 8;

function startsInsideHorizontalSurface(target: EventTarget | null): boolean {
  let element = target instanceof Element ? target : null;
  let depth = 0;
  while (element && element !== document.body && depth < MAX_ANCESTOR_SCAN) {
    const tagName = element.tagName.toLowerCase();
    if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') return true;
    if ((element as HTMLElement).isContentEditable) return true;
    const role = element.getAttribute('role');
    if (role === 'slider' || role === 'textbox' || role === 'combobox') return true;
    // 弹层/抽屉里不要再被外层的横划手势带走
    if (role === 'dialog' || element.getAttribute('aria-modal') === 'true') return true;
    // 组件可以显式退出这个手势（比如自带的横向画廊）。
    if (element.hasAttribute('data-swipe-ignore')) return true;

    const style = window.getComputedStyle(element);
    if (style.touchAction.includes('pan-x') || style.touchAction.includes('none')) return true;
    if ((style.overflowX === 'auto' || style.overflowX === 'scroll')
      && element.scrollWidth > element.clientWidth + 8) {
      return true;
    }

    element = element.parentElement;
    depth += 1;
  }
  return false;
}

export function MobileAppShellFrame({ topbarProps, onEdgeOpenDrawer, onEdgeBack, children }: MobileAppShellFrameProps) {
  const gestureRef = useRef<GestureStart | null>(null);
  const drawerOpenRef = useRef(topbarProps.state.collaboratorSwitchOpen);
  const edgeBackRef = useRef(onEdgeBack);

  useEffect(() => {
    drawerOpenRef.current = topbarProps.state.collaboratorSwitchOpen;
  }, [topbarProps.state.collaboratorSwitchOpen]);

  useEffect(() => {
    edgeBackRef.current = onEdgeBack;
  }, [onEdgeBack]);

  // Android 的返回手势/返回键是系统派发给 WebView 的，右边缘那一划到不了我们自己的 touch 监听，
  // 所以接管 backButton，把系统返回接到和右边缘滑动同一条逻辑上。
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let handle: { remove: () => Promise<void> } | undefined;
    let disposed = false;
    void (async () => {
      try {
        const registered = await CapacitorApp.addListener('backButton', () => {
          if (!edgeBackRef.current()) {
            void CapacitorApp.exitApp();
          }
        });
        if (disposed) {
          void registered.remove();
          return;
        }
        handle = registered;
      } catch {
        // 插件不可用时保持系统默认行为
      }
    })();
    return () => {
      disposed = true;
      void handle?.remove();
    };
  }, []);

  useEffect(() => {
    const handleTouchStart = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch) return;
      gestureRef.current = {
        x: touch.clientX,
        y: touch.clientY,
        fromRightEdge: touch.clientX >= window.innerWidth - RIGHT_EDGE_ZONE_PX,
        blocked: startsInsideHorizontalSurface(event.target),
        triggered: false
      };
    };

    const handleTouchMove = (event: TouchEvent) => {
      const gesture = gestureRef.current;
      const touch = event.touches[0];
      if (!gesture || !touch || gesture.triggered) return;

      const deltaX = touch.clientX - gesture.x;
      const deltaY = touch.clientY - gesture.y;
      if (Math.abs(deltaX) < Math.abs(deltaY) * HORIZONTAL_RATIO) return;

      // 右边缘往左滑 = 返回
      if (gesture.fromRightEdge && deltaX <= -BACK_SWIPE_PX) {
        gesture.triggered = true;
        event.preventDefault();
        edgeBackRef.current();
        return;
      }

      // 任意位置向右滑 = 打开左侧抽屉
      if (!gesture.blocked && deltaX >= DRAWER_SWIPE_PX && !drawerOpenRef.current) {
        gesture.triggered = true;
        event.preventDefault();
        onEdgeOpenDrawer();
      }
    };

    const clearGesture = () => {
      gestureRef.current = null;
    };

    document.addEventListener('touchstart', handleTouchStart, { capture: true, passive: true });
    document.addEventListener('touchmove', handleTouchMove, { capture: true, passive: false });
    document.addEventListener('touchend', clearGesture, { capture: true, passive: true });
    document.addEventListener('touchcancel', clearGesture, { capture: true, passive: true });
    return () => {
      document.removeEventListener('touchstart', handleTouchStart, { capture: true });
      document.removeEventListener('touchmove', handleTouchMove, { capture: true });
      document.removeEventListener('touchend', clearGesture, { capture: true });
      document.removeEventListener('touchcancel', clearGesture, { capture: true });
    };
  }, [onEdgeOpenDrawer]);

  return (
    <div className="app-stage">
      <AppTopbar {...topbarProps} />
      {children}
    </div>
  );
}
