import type { NodeId } from "../domain/types";
import { useTranslation } from "../i18n/useTranslation";

interface ManualRouteEditorProps {
  stopIds: NodeId[];
  labels: Map<NodeId, string>;
  onMoveUp: (index: number) => void;
  onMoveDown: (index: number) => void;
  onRemove: (id: NodeId) => void;
  onClear: () => void;
  onGenerate: () => void;
}

export function ManualRouteEditor({
  stopIds,
  labels,
  onMoveUp,
  onMoveDown,
  onRemove,
  onClear,
  onGenerate,
}: ManualRouteEditorProps) {
  const { t } = useTranslation();

  return (
    <section className="manual-route-editor" aria-label={t("manualRoute.title")}>
      <h2>{t("manualRoute.title")}</h2>

      <ol className="manual-route-editor__list">
        <li className="manual-route-editor__office" aria-current="location">
          <span className="manual-route-editor__sequence">0</span>
          <span className="manual-route-editor__label">{t("manualRoute.office")}</span>
        </li>

        {stopIds.map((id, index) => (
          <li key={id}>
            <span className="manual-route-editor__sequence">{index + 1}</span>
            <span className="manual-route-editor__label">{labels.get(id) ?? id}</span>
            <div className="manual-route-editor__actions">
              <button type="button" onClick={() => onMoveUp(index)} disabled={index === 0}>
                {t("manualRoute.moveUp")}
              </button>
              <button
                type="button"
                onClick={() => onMoveDown(index)}
                disabled={index === stopIds.length - 1}
              >
                {t("manualRoute.moveDown")}
              </button>
              <button type="button" onClick={() => onRemove(id)}>
                {t("manualRoute.remove")}
              </button>
            </div>
          </li>
        ))}
      </ol>

      {stopIds.length === 0 && <p className="manual-route-editor__empty">{t("manualRoute.empty")}</p>}

      <div className="manual-route-editor__footer">
        <button type="button" onClick={onClear} disabled={stopIds.length === 0}>
          {t("manualRoute.clear")}
        </button>
        <button
          type="button"
          className="manual-route-editor__generate"
          onClick={onGenerate}
          disabled={stopIds.length < 2}
        >
          {t("manualRoute.generate")}
        </button>
      </div>
    </section>
  );
}
