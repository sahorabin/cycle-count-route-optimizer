import type { ReactElement } from "react";
import { useTranslation } from "../i18n/useTranslation";
import type { TranslationKey } from "../i18n/translations";
import type { WarehouseCameraPreset } from "../ui/warehouse3dCamera";

interface CameraToolbarProps {
  preset: WarehouseCameraPreset;
  onSelectPreset: (preset: WarehouseCameraPreset) => void;
  onReset: () => void;
}

const PRESET_LABEL_KEYS: Record<WarehouseCameraPreset, TranslationKey> = {
  overview: "replay.camera.overview",
  top: "replay.camera.top",
  aisle: "replay.camera.aisle",
  worker: "replay.camera.worker",
};

/** Small inline glyphs -- no icon dependency, no external assets. */
const PRESET_GLYPHS: Record<WarehouseCameraPreset, ReactElement> = {
  overview: <path d="M2 9 L8 5 L14 9 L8 13 Z" />,
  top: <path d="M3 3 H7 V7 H3 Z M9 3 H13 V7 H9 Z M3 9 H7 V13 H3 Z M9 9 H13 V13 H9 Z" />,
  aisle: <path d="M3 2 H6 V14 H3 Z M10 2 H13 V14 H10 Z" />,
  worker: <path d="M8 3 a2 2 0 1 1 0 4 a2 2 0 1 1 0 -4 Z M5 14 v-3 a3 3 0 0 1 6 0 v3 Z" />,
};

function ToolbarButton({ label, pressed, onClick, children }: {
  label: string;
  pressed?: boolean;
  onClick: () => void;
  children: ReactElement;
}) {
  return (
    <button
      type="button"
      className="camera-toolbar__button"
      aria-pressed={pressed}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">{children}</svg>
      <span className="camera-toolbar__caption">{label}</span>
    </button>
  );
}

/**
 * Vertical view rail, in the spirit of a CAD/digital-twin tool. Each action is a
 * real camera operation that already exists; nothing here is decorative.
 */
export function CameraToolbar({ preset, onSelectPreset, onReset }: CameraToolbarProps) {
  const { t } = useTranslation();

  return (
    <nav className="camera-toolbar" aria-label={t("twin.cameraTools")}>
      {(["overview", "top", "aisle", "worker"] as const).map((candidate) => (
        <ToolbarButton
          key={candidate}
          label={t(PRESET_LABEL_KEYS[candidate])}
          pressed={preset === candidate}
          onClick={() => onSelectPreset(candidate)}
        >
          {PRESET_GLYPHS[candidate]}
        </ToolbarButton>
      ))}
      <ToolbarButton label={t("replay.camera.reset")} onClick={onReset}>
        <path d="M8 3 a5 5 0 1 0 5 5 h-2 a3 3 0 1 1 -3 -3 v2 l3 -3 l-3 -3 Z" />
      </ToolbarButton>
    </nav>
  );
}
