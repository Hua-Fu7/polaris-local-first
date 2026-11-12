import type { CollectionFileCard } from '../../../app/collection/collectionFileCards';
import { useI18n } from '../../../i18n';
import { useAssetObjectUrl } from '../../useAssetObjectUrl';
import { ArtifactRow } from '../artifact/ArtifactRow';
import { CollectionEmptyStateWhisper } from '../grid/CollectionEmptyStateWhisper';
import { Icon, type IconName } from '../../Icon';

type FileCollectionSectionProps = {
  cardsExpanded: boolean;
  cards: CollectionFileCard[];
  showLead?: boolean;
  onOpenFileSource: (card: CollectionFileCard) => void;
};

function formatAttachmentSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatFileTypeLabel(mimeType: string, name: string) {
  const extension = name.trim().split('.').pop()?.toUpperCase();
  if (extension && extension !== name.trim().toUpperCase()) return extension;
  if (mimeType.includes('pdf')) return 'PDF';
  if (mimeType.includes('zip')) return 'ZIP';
  if (mimeType.includes('json')) return 'JSON';
  if (mimeType.includes('markdown')) return 'MD';
  if (mimeType.includes('text')) return 'TXT';
  return 'FILE';
}

function resolveFileIcon(mimeType: string, name: string): IconName {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.includes('pdf')) return 'fileText';
  if (mimeType.includes('zip') || mimeType.includes('archive')) return 'folder';
  return 'fileText';
}

/** 我发的附件：一行一个，跟作品列表同一种行，只是图标和类型不同。 */
function FileRow({
  card,
  onOpenFileSource
}: {
  card: CollectionFileCard;
  onOpenFileSource: (card: CollectionFileCard) => void;
}) {
  const { t } = useI18n();
  const assetUrl = useAssetObjectUrl(card.assetId);
  const canOpenFile = Boolean(assetUrl);

  return (
    <ArtifactRow
      fileName={card.name}
      icon={resolveFileIcon(card.mimeType, card.name)}
      kindLabel={formatFileTypeLabel(card.mimeType, card.name)}
      language={formatAttachmentSize(card.size)}
      activateLabel={t('collection.files.openAria', { name: card.name })}
      openLabel={t('collection.files.download')}
      onActivate={() => {
        if (assetUrl) window.open(assetUrl, '_blank', 'noreferrer');
        else onOpenFileSource(card);
      }}
      onOpen={canOpenFile ? () => {
        const anchor = document.createElement('a');
        anchor.href = assetUrl ?? '';
        anchor.download = card.name;
        anchor.rel = 'noreferrer';
        anchor.click();
      } : () => onOpenFileSource(card)}
      trailing={(
        <button
          type="button"
          aria-label={t('collection.files.backToChat')}
          onClick={() => onOpenFileSource(card)}
        >
          <Icon name="chevron" size={13} />
        </button>
      )}
    />
  );
}

export function FileCollectionSection({
  cards,
  showLead = true,
  onOpenFileSource
}: FileCollectionSectionProps) {
  const { t, formatNumber } = useI18n();

  if (cards.length === 0) {
    return (
      <CollectionEmptyStateWhisper
        as="div"
        className="code-collection-filter-empty"
        title={t('collection.files.emptyTitle')}
        hint={t('collection.files.emptyHint')}
      />
    );
  }

  return (
    <section className="collection-file-section">
      {showLead ? (
        <div className="collection-file-section-lead" aria-label={t('collection.files.leadAria')}>
          <span>{t('collection.files.leadTitle')}</span>
          <small>{t('collection.files.leadCount', { count: formatNumber(cards.length) })}</small>
        </div>
      ) : null}
      <div className="code-artifact-list">
        {cards.map((card) => (
          <FileRow key={card.id} card={card} onOpenFileSource={onOpenFileSource} />
        ))}
      </div>
    </section>
  );
}
