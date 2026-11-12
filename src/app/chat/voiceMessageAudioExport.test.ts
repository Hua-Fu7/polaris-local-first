import { afterEach, describe, expect, it, vi } from 'vitest';

const assetMocks = vi.hoisted(() => ({
  getAssetBlob: vi.fn(),
  getAssetMeta: vi.fn()
}));
const exportMocks = vi.hoisted(() => ({
  exportBlobToFile: vi.fn()
}));

vi.mock('../../infrastructure/assetStore', () => ({
  getAssetBlob: assetMocks.getAssetBlob,
  getAssetMeta: assetMocks.getAssetMeta
}));
vi.mock('../../infrastructure/exportBlobFile', () => ({
  exportBlobToFile: exportMocks.exportBlobToFile
}));

afterEach(() => {
  Object.values(assetMocks).forEach((mock) => mock.mockReset());
  Object.values(exportMocks).forEach((mock) => mock.mockReset());
});

describe('exportVoiceMessageAudio', () => {
  it('saves the local audio file that the voice bar plays', async () => {
    const blob = new Blob(['mp3'], { type: 'audio/mpeg' });
    assetMocks.getAssetBlob.mockResolvedValue(blob);
    assetMocks.getAssetMeta.mockResolvedValue({ name: 'Polaris-voice-1.mp3' });
    exportMocks.exportBlobToFile.mockResolvedValue(true);
    const { exportVoiceMessageAudio } = await import('./voiceMessageAudioExport');

    const result = await exportVoiceMessageAudio({ assetId: 'asset-1' });

    expect(exportMocks.exportBlobToFile).toHaveBeenCalledWith(blob, 'Polaris-voice-1.mp3');
    expect(result).toEqual({ ok: true, name: 'Polaris-voice-1.mp3' });
  });

  it('falls back to the attachment name when the asset meta is gone', async () => {
    assetMocks.getAssetBlob.mockResolvedValue(new Blob(['mp3'], { type: 'audio/mpeg' }));
    assetMocks.getAssetMeta.mockResolvedValue(null);
    exportMocks.exportBlobToFile.mockResolvedValue(true);
    const { exportVoiceMessageAudio } = await import('./voiceMessageAudioExport');

    const result = await exportVoiceMessageAudio({ assetId: 'asset-1', fallbackName: 'fallback.mp3' });

    expect(result).toEqual({ ok: true, name: 'fallback.mp3' });
  });

  it('reports a missing audio file instead of saving nothing', async () => {
    assetMocks.getAssetBlob.mockResolvedValue(null);
    assetMocks.getAssetMeta.mockResolvedValue({ name: 'gone.mp3' });
    const { exportVoiceMessageAudio } = await import('./voiceMessageAudioExport');

    const result = await exportVoiceMessageAudio({ assetId: 'asset-1' });

    expect(exportMocks.exportBlobToFile).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.error).toContain('已经不在本机');
  });

  it('treats a cancelled save as a failure', async () => {
    assetMocks.getAssetBlob.mockResolvedValue(new Blob(['mp3'], { type: 'audio/mpeg' }));
    assetMocks.getAssetMeta.mockResolvedValue({ name: 'a.mp3' });
    exportMocks.exportBlobToFile.mockResolvedValue(false);
    const { exportVoiceMessageAudio } = await import('./voiceMessageAudioExport');

    const result = await exportVoiceMessageAudio({ assetId: 'asset-1' });

    expect(result.ok).toBe(false);
  });

  it('refuses an attachment without an asset', async () => {
    const { exportVoiceMessageAudio } = await import('./voiceMessageAudioExport');

    const result = await exportVoiceMessageAudio({ assetId: '   ' });

    expect(result.ok).toBe(false);
    expect(exportMocks.exportBlobToFile).not.toHaveBeenCalled();
  });
});
