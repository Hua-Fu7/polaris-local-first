import { Capacitor } from '@capacitor/core';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getAssetBlob } from '../../../infrastructure/assetStore';
import { reportPersistenceError } from '../../../infrastructure/persistenceDiagnostics';
import { formatAttachmentSize } from '../../../engines/attachmentFormat';
import type { ChatAttachment } from '../../../types/domain';
import { useAssetObjectUrl } from '../../useAssetObjectUrl';
import { useI18n, type I18nTranslator } from '../../../i18n';

type ChatAttachmentStripProps = {
  attachments: ChatAttachment[] | undefined;
  tone: 'pending' | 'message' | 'sticker';
  onRemove?: (attachmentId: string) => void;
  onSaveImage?: (attachment: ChatAttachment) => void;
};

type AttachmentChipProps = {
  attachment: ChatAttachment;
  tone: 'pending' | 'message' | 'sticker';
  onRemove?: (attachmentId: string) => void;
  onSaveImage?: (attachment: ChatAttachment) => void;
  onOpenImage?: (image: ChatImagePreview) => void;
};

type ChatImagePreview = {
  src: string;
  name: string;
  size: string;
};

const FILE_PREVIEW_MAX_CHARS = 180;

export function canOpenImagePreviewLink() {
  return !Capacitor.isNativePlatform();
}

function resolveFileSecondaryText(attachment: ChatAttachment, t: I18nTranslator['t']) {
  const sizeLabel = formatAttachmentSize(attachment.size);
  if (attachment.clearedAt) return t('chat.attachment.cleared', { size: sizeLabel });
  const previewSource = attachment.textContent?.slice(0, FILE_PREVIEW_MAX_CHARS);
  const previewText = previewSource?.replace(/\s+/g, ' ').trim();
  if (!previewText) return sizeLabel;
  return `${sizeLabel} · ${previewText}${attachment.textContent && attachment.textContent.length > FILE_PREVIEW_MAX_CHARS ? '...' : ''}`;
}

export function useNearViewportAssetLoading() {
  const ref = useRef<HTMLDivElement>(null);
  const [shouldLoad, setShouldLoad] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element || shouldLoad) return;

    if (typeof IntersectionObserver === 'undefined') {
      setShouldLoad(true);
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      setShouldLoad(true);
      observer.disconnect();
    }, {
      root: null,
      rootMargin: '600px 0px'
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, [shouldLoad]);

  return { ref, shouldLoad };
}

async function downloadAttachment(attachment: ChatAttachment) {
  if (!attachment.assetId || attachment.clearedAt) return;
  let objectUrl: string | null = null;
  try {
    const blob = await getAssetBlob(attachment.assetId);
    if (!blob) return;
    objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = attachment.name;
    anchor.rel = 'noreferrer';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } catch (error) {
    reportPersistenceError({ label: '[asset:download]', store: 'asset', operation: 'read-download' }, error);
  } finally {
    if (objectUrl) {
      const urlToRevoke = objectUrl;
      window.setTimeout(() => URL.revokeObjectURL(urlToRevoke), 0);
    }
  }
}

function AttachmentChip({
  attachment,
  tone,
  onRemove,
  onSaveImage,
  onOpenImage
}: AttachmentChipProps) {
  const { t } = useI18n();
  const { ref, shouldLoad } = useNearViewportAssetLoading();
  const imageAssetId = attachment.kind === 'image' && shouldLoad && !attachment.clearedAt ? attachment.assetId : undefined;
  const assetUrl = useAssetObjectUrl(imageAssetId, true);
  const imageSecondaryText = attachment.clearedAt
    ? t('chat.attachment.cleared', { size: formatAttachmentSize(attachment.size) })
    : formatAttachmentSize(attachment.size);

  const renderFileChip = (
    <>
      <div className="attachment-file-icon">{attachment.mimeType.includes('zip') ? 'ZIP' : t('chat.attachment.documentIcon')}</div>
      <div className="attachment-copy">
        <strong>{attachment.name}</strong>
        <span>{resolveFileSecondaryText(attachment, t)}</span>
      </div>
    </>
  );
  const renderImagePlaceholder = (
    <>
      <div className="attachment-file-icon">{t('chat.attachment.imageIcon')}</div>
      {tone === 'message' ? null : (
        <div className="attachment-copy">
          <strong>{attachment.name}</strong>
          <span>{imageSecondaryText}</span>
        </div>
      )}
    </>
  );

  return (
    <div ref={ref} key={attachment.id} className={`attachment-chip ${attachment.kind} ${tone}${attachment.clearedAt ? ' cleared' : ''}`}>
      {attachment.kind === 'image' && assetUrl ? (
        <button
          type="button"
          className="attachment-preview-link"
          aria-label={t('chat.attachment.openAria', { name: attachment.name })}
          title={attachment.name}
          onClick={() => onOpenImage?.({ src: assetUrl, name: attachment.name, size: imageSecondaryText })}
        >
          <img src={assetUrl} alt={attachment.name} className="attachment-thumb" />
          {tone === 'message' || tone === 'sticker' ? null : (
            <div className="attachment-copy">
              <strong>{attachment.name}</strong>
              <span>{imageSecondaryText}</span>
            </div>
          )}
        </button>
      ) : attachment.kind === 'image' ? (
        renderImagePlaceholder
      ) : attachment.assetId && !attachment.clearedAt ? (
        <button
          type="button"
          className="attachment-preview-link"
          aria-label={t('chat.attachment.downloadAria', { name: attachment.name })}
          title={attachment.name}
          onClick={() => { void downloadAttachment(attachment); }}
        >
          {renderFileChip}
        </button>
      ) : (
        renderFileChip
      )}
      {onRemove && (
        <button
          type="button"
          className="attachment-remove-btn"
          onClick={() => onRemove(attachment.id)}
          aria-label={t('chat.attachment.removeAria', { name: attachment.name })}
        >
          ✕
        </button>
      )}
    </div>
  );
}

export function ChatAttachmentStrip({
  attachments,
  tone,
  onRemove,
  onSaveImage
}: ChatAttachmentStripProps) {
  const [previewImage, setPreviewImage] = useState<ChatImagePreview | null>(null);

  useEffect(() => {
    if (!previewImage) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPreviewImage(null);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [previewImage]);

  if (!attachments?.length) return null;

  const previewOverlay = previewImage && typeof document !== 'undefined' ? createPortal(
    <div
      className="chat-image-preview-layer"
      role="dialog"
      aria-modal="true"
      aria-label={previewImage.name}
      onClick={() => setPreviewImage(null)}
    >
      <button
        type="button"
        className="chat-image-preview-close"
        aria-label="关闭"
        onClick={() => setPreviewImage(null)}
      >
        ×
      </button>
      <img
        src={previewImage.src}
        alt={previewImage.name}
        onClick={(event) => event.stopPropagation()}
      />
      <span className="chat-image-preview-size">{previewImage.size}</span>
    </div>,
    document.body
  ) : null;

  return (
    <>
      <div className={`attachment-strip ${tone}`}>
        {attachments.map((attachment) => (
          <AttachmentChip
            key={attachment.id}
            attachment={attachment}
            tone={tone}
            onRemove={onRemove}
            onSaveImage={onSaveImage}
            onOpenImage={setPreviewImage}
          />
        ))}
      </div>
      {previewOverlay}
    </>
  );
}

