/**
 * 首页开关。
 *
 * 启动时默认落在首页；`WorldAnchor`（顶栏那块空白）点一下也回首页。
 * 只活在进程内：不持久化，所以每次打开 App 都是首页。
 */

const UPDATE_EVENT = 'polaris:home-screen-updated';

let homeOpen = true;

function emit() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(UPDATE_EVENT, { detail: homeOpen }));
}

export function isHomeScreenOpen() {
  return homeOpen;
}

export function setHomeScreenOpen(open: boolean) {
  if (homeOpen === open) return;
  homeOpen = open;
  emit();
}

export function openHomeScreen() {
  setHomeScreenOpen(true);
}

export function closeHomeScreen() {
  setHomeScreenOpen(false);
}

export function subscribeHomeScreen(listener: () => void) {
  if (typeof window === 'undefined') return () => undefined;
  const handler = () => listener();
  window.addEventListener(UPDATE_EVENT, handler);
  return () => window.removeEventListener(UPDATE_EVENT, handler);
}
