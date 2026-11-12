import { describe, expect, it } from 'vitest';
import { createTranslator } from '../../../i18n';
import { buildVisibleCollectionShelfNavItems } from './collectionShelfNav';

describe('buildVisibleCollectionShelfNavItems', () => {
  const { t } = createTranslator('zh-CN');

  it('puts files first and keeps information as the last utility page', () => {
    const items = buildVisibleCollectionShelfNavItems(
      {
        dialogue: true,
        info: true,
        code: true,
        project: true,
        image: false
      },
      t
    );

    expect(items.map((item) => item.shelf)).toEqual(['code', 'project', 'dialogue', 'info']);
  });

  it('reveals shelves only when their real content exists', () => {
    const items = buildVisibleCollectionShelfNavItems(
      {
        dialogue: true,
        info: true,
        code: true,
        project: true,
        image: true
      },
      t
    );

    expect(items.map((item) => item.shelf)).toEqual(['code', 'project', 'dialogue', 'image', 'info']);
  });
});
