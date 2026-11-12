import { canUseNativeSystemBackupFiles, exportFileViaSystemFiles } from '../native/systemBackupFiles';

/**
 * 把一段二进制存成文件。
 *
 * 手机上走系统「保存到文件」；网页里先试分享面板（可以选保存到相册/文件），
 * 都不行就退回浏览器下载。
 */
export async function exportBlobToFile(blob: Blob, fileName: string): Promise<boolean> {
  if (canUseNativeSystemBackupFiles()) {
    return await exportFileViaSystemFiles(blob, fileName);
  }

  if (typeof File !== 'undefined' && typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    const file = new File([blob], fileName, { type: blob.type || 'application/octet-stream' });
    const shareData: ShareData = { files: [file], title: fileName };
    if (typeof navigator.canShare !== 'function' || navigator.canShare(shareData)) {
      await navigator.share(shareData);
      return true;
    }
  }

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}
