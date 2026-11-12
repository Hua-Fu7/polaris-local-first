import { getAssetBlob, getAssetMeta } from '../../infrastructure/assetStore';
import { exportBlobToFile } from '../../infrastructure/exportBlobFile';

export type VoiceAudioExportResult =
  | { ok: true; name: string }
  | { ok: false; error: string };

/**
 * 把一条语音条的音频存成文件。
 *
 * 只读本地资产：不再调一次语音接口，也不花额度——存的就是聊天里听的那份。
 */
export async function exportVoiceMessageAudio(args: {
  assetId: string;
  fallbackName?: string;
}): Promise<VoiceAudioExportResult> {
  const assetId = args.assetId.trim();
  if (!assetId) {
    return { ok: false, error: '这条语音没有本地音频文件。' };
  }

  try {
    const [blob, meta] = await Promise.all([getAssetBlob(assetId), getAssetMeta(assetId)]);
    if (!blob) {
      return { ok: false, error: '这段语音的音频文件已经不在本机了。' };
    }
    const name = meta?.name?.trim() || args.fallbackName?.trim() || 'Polaris-voice.mp3';
    // 资产里读回来的 Blob 可能没带类型：补上，否则系统保存时会当成 zip。
    const typedBlob = blob.type
      ? blob
      : new Blob([blob], { type: meta?.mimeType?.trim() || 'audio/mpeg' });
    const exported = await exportBlobToFile(typedBlob, name);
    return exported ? { ok: true, name } : { ok: false, error: '保存语音文件时被取消了。' };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? `保存语音失败：${error.message}` : '保存语音失败。'
    };
  }
}
