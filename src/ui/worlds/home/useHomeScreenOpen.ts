import { useEffect, useState } from 'react';
import { isHomeScreenOpen, subscribeHomeScreen } from '../../../app/home/homeScreenStore';

/** 读「现在是不是在首页」。首页默认是打开的。 */
export function useHomeScreenOpen() {
  const [open, setOpen] = useState(() => isHomeScreenOpen());

  useEffect(() => {
    setOpen(isHomeScreenOpen());
    return subscribeHomeScreen(() => setOpen(isHomeScreenOpen()));
  }, []);

  return open;
}
