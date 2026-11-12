// OB 密码的存放位置。
//
// 需求是"密码进安全存储"，所以这里做成一个可替换的接口：
//   - 原生：交给 `ObSecretStore` 插件（Android Keystore / EncryptedSharedPreferences）
//   - 插件还没装上（或者跑在桌面/dev）：只留在内存里，**不落盘**
//
// 宁可这次会话结束就丢，也不要把明文写进普通配置里。

import { Capacitor, registerPlugin } from '@capacitor/core';

type ObSecretStorePlugin = {
  read(): Promise<{ value: string | null }>;
  write(options: { value: string }): Promise<void>;
  remove(): Promise<void>;
};

const ObSecretStore = registerPlugin<ObSecretStorePlugin>('ObSecretStore');

/** 插件缺席时的退路：进程内有效，退出即失。 */
let memoryPassword: string | null = null;

export function hasPersistentObSecretStore(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('ObSecretStore');
}

export async function readObPassword(): Promise<string> {
  if (!hasPersistentObSecretStore()) return memoryPassword ?? '';
  try {
    const result = await ObSecretStore.read();
    return typeof result?.value === 'string' ? result.value : '';
  } catch {
    return memoryPassword ?? '';
  }
}

export async function writeObPassword(value: string): Promise<void> {
  memoryPassword = value;
  if (!hasPersistentObSecretStore()) return;
  try {
    if (!value) {
      await ObSecretStore.remove();
      return;
    }
    await ObSecretStore.write({ value });
  } catch {
    // 写不进安全存储就算了：留在内存里，本次运行仍可用。
  }
}
