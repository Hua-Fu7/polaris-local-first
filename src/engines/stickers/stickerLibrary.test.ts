import { describe, expect, it } from 'vitest';
import {
  parseStickerFileName,
  resolveStickerTarget,
  STICKER_LIBRARY_CHANGE_EVENT
} from './stickerLibrary';

describe('stickerLibrary', () => {
  it('parses a friendly sticker name and tags from the file name', () => {
    expect(parseStickerFileName('开心猫#开心,高兴.png')).toEqual({
      name: '开心猫',
      tags: ['开心', '高兴']
    });
  });

  it('keeps a normal file name as the sticker name', () => {
    expect(parseStickerFileName('思考.webp')).toEqual({
      name: '思考',
      tags: []
    });
  });

  it('exposes a stable change event name', () => {
    expect(STICKER_LIBRARY_CHANGE_EVENT).toBe('polaris-sticker-library-change');
  });

  it('does not treat a normal image target as a sticker', () => {
    expect(resolveStickerTarget('poster.png')).toBeNull();
  });
});