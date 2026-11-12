import { useEffect, useRef } from 'react';
import type { useThemeStudioController } from '../../../../app/theme/useThemeStudioController';
import { RoomThemeTuneSection } from './RoomThemeTuneSection';

type ThemeStudioController = ReturnType<typeof useThemeStudioController>;

type RoomThemeLibrarySectionProps = {
  controller: ThemeStudioController;
};

export function RoomThemeLibrarySection({ controller }: RoomThemeLibrarySectionProps) {
  const clearedHistoryRef = useRef(false);

  useEffect(() => {
    if (clearedHistoryRef.current) return;
    clearedHistoryRef.current = true;
    if (controller.theme.skinHistory.length > 0) {
      controller.themeSession.clearSkinHistory();
    }
  }, [controller.theme.skinHistory.length, controller.themeSession]);

  return (
    <div className="room-theme-library-page">
      <RoomThemeTuneSection
        theme={controller.theme}
        onChangeCustomCSS={controller.themeSession.setCustomCSS}
        onSaveCurrentSkin={() => {
          const nextName = controller.saveName.trim() || controller.defaultSkinName;
          controller.saveCurrentSkin(nextName);
          controller.resetSaveName();
        }}
      />
    </div>
  );
}
