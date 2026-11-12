import { createUid } from '../id';
import { createStoredAttachment } from '../../infrastructure/assetStore';
import type { ChatAttachment } from '../../types/domain';

export type StickerRecord = {
  id: string;
  assetId: string;
  name: string;
  fileName: string;
  mimeType: string;
  size: number;
  tags: string[];
  createdAt: number;
};

const STICKER_LIBRARY_KEY = 'polaris-sticker-library-v1';
export const STICKER_LIBRARY_CHANGE_EVENT = 'polaris-sticker-library-change';
const MAX_STICKERS = 120;

function getStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function normalizeText(value: string) {
  return value.trim().toLocaleLowerCase();
}

export function parseStickerFileName(fileName: string) {
  const withoutExtension = fileName.replace(/\.[^.]+$/, '').trim() || 'sticker';
  const [namePart, tagPart = ''] = withoutExtension.split('#', 2);
  const name = namePart.trim() || 'sticker';
  const tags = Array.from(new Set(
    tagPart
      .split(/[,，、|/]+/)
      .map((tag) => tag.trim())
      .filter(Boolean)
  )).slice(0, 12);
  return { name, tags };
}

function normalizeStickerRecord(value: unknown): StickerRecord | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Partial<StickerRecord>;
  if (
    typeof record.id !== 'string'
    || typeof record.assetId !== 'string'
    || typeof record.name !== 'string'
    || typeof record.fileName !== 'string'
    || typeof record.mimeType !== 'string'
    || typeof record.size !== 'number'
    || typeof record.createdAt !== 'number'
  ) {
    return null;
  }
  return {
    id: record.id,
    assetId: record.assetId,
    name: record.name.trim() || 'sticker',
    fileName: record.fileName.trim() || 'sticker',
    mimeType: record.mimeType || 'image/*',
    size: Number.isFinite(record.size) ? Math.max(0, record.size) : 0,
    tags: Array.isArray(record.tags)
      ? Array.from(new Set(record.tags.filter((tag): tag is string => typeof tag === 'string').map((tag) => tag.trim()).filter(Boolean))).slice(0, 12)
      : [],
    createdAt: record.createdAt
  };
}

export function listStickers(): StickerRecord[] {
  const storage = getStorage();
  if (!storage) return [];
  try {
    const parsed = JSON.parse(storage.getItem(STICKER_LIBRARY_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(normalizeStickerRecord)
      .filter((record): record is StickerRecord => Boolean(record))
      .sort((left, right) => right.createdAt - left.createdAt)
      .slice(0, MAX_STICKERS);
  } catch {
    return [];
  }
}

function writeStickers(records: StickerRecord[]) {
  const storage = getStorage();
  if (!storage) return;
  storage.setItem(STICKER_LIBRARY_KEY, JSON.stringify(records.slice(0, MAX_STICKERS)));
  window.dispatchEvent(new Event(STICKER_LIBRARY_CHANGE_EVENT));
}

export function subscribeStickerLibrary(listener: () => void) {
  if (typeof window === 'undefined') return () => undefined;
  window.addEventListener(STICKER_LIBRARY_CHANGE_EVENT, listener);
  return () => window.removeEventListener(STICKER_LIBRARY_CHANGE_EVENT, listener);
}

export function getStickerPromptSnapshot() {
  return {
    available: listStickers().map((sticker) => ({
      id: sticker.id,
      name: sticker.name,
      tags: sticker.tags
    }))
  };
}

export function listStickerAttachments(): ChatAttachment[] {
  return listStickers().map((sticker) => ({
    id: `sticker-ref-${sticker.id}`,
    assetId: sticker.assetId,
    kind: 'image',
    name: sticker.name || sticker.fileName,
    mimeType: sticker.mimeType,
    size: sticker.size
  }));
}

export function stickerToChatAttachment(sticker: StickerRecord): ChatAttachment {
  return {
    id: createUid('sticker-send'),
    assetId: sticker.assetId,
    kind: 'image',
    name: sticker.name || sticker.fileName,
    mimeType: sticker.mimeType,
    size: sticker.size,
    sticker: {
      id: sticker.id,
      name: sticker.name
    }
  };
}

export function resolveStickerTarget(target: string | undefined): StickerRecord | null {
  const raw = target?.trim();
  if (!raw) return null;
  const normalized = normalizeText(raw);
  if (!normalized.startsWith('sticker:')) return null;
  const query = normalizeText(raw.slice('sticker:'.length));
  if (!query) return null;
  const stickers = listStickers();
  return stickers.find((sticker) => normalizeText(sticker.id) === query || normalizeText(sticker.name) === query)
    ?? stickers.find((sticker) => normalizeText(sticker.name).includes(query) || sticker.tags.some((tag) => normalizeText(tag).includes(query)))
    ?? null;
}

export async function addStickersFromFiles(files: FileList | File[]): Promise<StickerRecord[]> {
  const incoming = Array.from(files);
  const added: StickerRecord[] = [];
  const existing = listStickers();
  for (const file of incoming) {
    if (!file.type.toLowerCase().startsWith('image/')) continue;
    const { name, tags } = parseStickerFileName(file.name);
    const attachment = await createStoredAttachment({
      kind: 'image',
      name: file.name,
      mimeType: file.type || 'image/*',
      blob: file
    });
    const record: StickerRecord = {
      id: createUid('sticker'),
      assetId: attachment.assetId,
      name,
      fileName: attachment.name,
      mimeType: attachment.mimeType,
      size: attachment.size,
      tags,
      createdAt: Date.now()
    };
    existing.unshift(record);
    added.unshift(record);
  }
  if (added.length) {
    writeStickers(existing);
  }
  return added;
}

export function renameSticker(stickerId: string, name: string) {
  const nextName = name.trim();
  if (!nextName) return;
  const next = listStickers().map((sticker) =>
    sticker.id === stickerId ? { ...sticker, name: nextName } : sticker
  );
  writeStickers(next);
}

export function removeSticker(stickerId: string) {
  const next = listStickers().filter((sticker) => sticker.id !== stickerId);
  writeStickers(next);
}