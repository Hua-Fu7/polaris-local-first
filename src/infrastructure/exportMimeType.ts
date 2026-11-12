// 导出文件时该告诉系统什么 MIME type。
//
// 起因：从本地资产库读回来的 Blob 经常没带 `type`，`saveVoiceAudio` 那条路就会把
// `application/zip` 传给系统的「保存到文件」。文件管理器看到 zip 就按压缩包显示，
// 甚至自己改名，于是用户下载的语音「不是 mp3」。
//
// 所以：Blob 自己带类型就用它；没带就按扩展名推。两者都没有才退回 octet-stream。

const MIME_BY_EXTENSION: Record<string, string> = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  opus: 'audio/opus',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  flac: 'audio/flac',
  webm: 'audio/webm',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  pdf: 'application/pdf',
  json: 'application/json',
  txt: 'text/plain',
  md: 'text/markdown',
  zip: 'application/zip'
};

export function resolveExportMimeType(fileName: string, blobType?: string | null): string {
  // 扩展名优先：本地资产库里读回来的 Blob 可能被标成 application/zip（实测就是），
  // 信它的话系统会给 .mp3 再补一个 .zip 后缀，文件就"打不开"了。
  const extension = /\.([a-z0-9]+)$/i.exec(fileName.trim())?.[1]?.toLowerCase() ?? '';
  const byExtension = MIME_BY_EXTENSION[extension];
  if (byExtension) return byExtension;

  const normalizedBlobType = (blobType ?? '').trim().toLowerCase();
  if (normalizedBlobType && normalizedBlobType !== 'application/octet-stream') {
    return normalizedBlobType;
  }
  return 'application/octet-stream';
}
