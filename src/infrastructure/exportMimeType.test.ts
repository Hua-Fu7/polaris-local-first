import { describe, expect, it } from 'vitest';
import { resolveExportMimeType } from './exportMimeType';

describe('resolveExportMimeType', () => {
  it('Blob 自带类型就用它', () => {
    expect(resolveExportMimeType('voice.mp3', 'audio/mpeg')).toBe('audio/mpeg');
    expect(resolveExportMimeType('backup.zip', 'application/zip')).toBe('application/zip');
  });

  it('Blob 没类型时按扩展名推，别再退回 zip', () => {
    expect(resolveExportMimeType('Polaris-voice-20260101.mp3', '')).toBe('audio/mpeg');
    expect(resolveExportMimeType('Polaris-voice-20260101.wav', '')).toBe('audio/wav');
    expect(resolveExportMimeType('Polaris-voice-20260101.opus', '')).toBe('audio/opus');
    expect(resolveExportMimeType('shot.png', '')).toBe('image/png');
  });

  it('octet-stream 也当作没类型处理', () => {
    expect(resolveExportMimeType('voice.mp3', 'application/octet-stream')).toBe('audio/mpeg');
  });

  it('扩展名优先：Blob 自称 zip 也不能信', () => {
    // 实测：从本地资产库读回来的 mp3，Blob 类型是 application/zip，
    // 信它就会给 .mp3 再补一个 .zip。
    expect(resolveExportMimeType('Polaris-voice-20260101.mp3', 'application/zip')).toBe('audio/mpeg');
    expect(resolveExportMimeType('shot.png', 'application/octet-stream')).toBe('image/png');
  });

  it('扩展名不认识时才看 Blob 类型', () => {
    expect(resolveExportMimeType('mystery', 'audio/mpeg')).toBe('audio/mpeg');
    expect(resolveExportMimeType('mystery', '')).toBe('application/octet-stream');
  });
});
