import { useEffect, useState, type DragEvent } from "react";
import type { NodeId } from "../domain/types";
import { useTranslation } from "../i18n/useTranslation";

interface ManualRouteEditorProps {
  stopIds: NodeId[];
  labels: Map<NodeId, string>;
  onMoveUp: (index: number) => void;
  onMoveDown: (index: number) => void;
  onMove: (fromIndex: number, toIndex: number) => void;
  onRemove: (id: NodeId) => void;
  onClear: () => void;
  onGenerate: () => void;
  recommendationValid?: boolean;
  interactionVersion?: number;
}

export function ManualRouteEditor({
  stopIds,
  labels,
  onMoveUp,
  onMoveDown,
  onMove,
  onRemove,
  onClear,
  onGenerate,
  recommendationValid = false,
  interactionVersion = 0,
}: ManualRouteEditorProps) {
  const { t } = useTranslation();
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [attentionActive, setAttentionActive] = useState(false);
  const eligible = stopIds.length >= 2 && !recommendationValid;

  useEffect(() => {
    setAttentionActive(false);
    if (!eligible) return;
    const timer = window.setTimeout(() => setAttentionActive(true), 3_500);
    return () => window.clearTimeout(timer);
  }, [eligible, interactionVersion, stopIds]);

  function interact(action: () => void) {
    setAttentionActive(false);
    action();
  }

  function startDrag(event: DragEvent<HTMLLIElement>, index: number) {
    setAttentionActive(false);
    setDraggedIndex(index);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(index));
  }

  function dropAt(event: DragEvent<HTMLLIElement>, index: number) {
    event.preventDefault();
    const encoded = event.dataTransfer.getData("text/plain");
    const fromIndex = draggedIndex ?? Number(encoded);
    if (Number.isInteger(fromIndex)) interact(() => onMove(fromIndex, index));
    setDraggedIndex(null);
  }

  return (
    <section className="manual-route-editor" aria-label={t("manualRoute.title")}>
      <h2>{t("manualRoute.title")}</h2>
      <p className="manual-route-editor__instruction">{t("manualRoute.instruction")}</p>

      <ol className="manual-route-editor__list">
        <li className="manual-route-editor__office" aria-current="location">
          <span className="manual-route-editor__sequence">0</span>
          <span className="manual-route-editor__label">{t("manualRoute.office")}</span>
        </li>

        {stopIds.map((id, index) => (
          <li
            key={id}
            draggable
            className={draggedIndex === index ? "manual-route-editor__row--dragging" : undefined}
            onDragStart={(event) => startDrag(event, index)}
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
            }}
            onDrop={(event) => dropAt(event, index)}
            onDragEnd={() => setDraggedIndex(null)}
          >
            <span className="manual-route-editor__drag" aria-hidden="true">⠿</span>
            <span className="manual-route-editor__sequence">{index + 1}</span>
            <span className="manual-route-editor__label">{labels.get(id) ?? id}</span>
            <div className="manual-route-editor__a11y-actions">
              <button type="button" onClick={() => interact(() => onMoveUp(index))} disabled={index === 0}>
                {t("manualRoute.moveUp")}
              </button>
              <button
                type="button"
                onClick={() => interact(() => onMoveDown(index))}
                disabled={index === stopIds.length - 1}
              >
                {t("manualRoute.moveDown")}
              </button>
            </div>
            <button
              type="button"
              className="manual-route-editor__remove"
              onClick={() => interact(() => onRemove(id))}
              aria-label={t("manualRoute.removeNamed", { label: labels.get(id) ?? id })}
            >
              <span aria-hidden="true">×</span>
            </button>
          </li>
        ))}
      </ol>

      {stopIds.length === 0 && <p className="manual-route-editor__empty">{t("manualRoute.empty")}</p>}

      {stopIds.length < 2 && (
        <p className="manual-route-editor__minimum" role="status">{t("manualRoute.minimum")}</p>
      )}

      <div className="manual-route-editor__footer">
        <button type="button" className="manual-route-editor__reset" onClick={() => interact(onClear)} disabled={stopIds.length === 0}>
          {t("manualRoute.clear")}
        </button>
        <div className="manual-route-editor__primary-action">
          <p className="manual-route-editor__generate-hint">{t("manualRoute.generateHint")}</p>
          <button
            type="button"
            className={`manual-route-editor__generate${eligible ? " manual-route-editor__generate--eligible" : ""}${attentionActive ? " manual-route-editor__generate--attention" : ""}`}
            onClick={() => interact(onGenerate)}
            disabled={stopIds.length < 2}
          >
            <span aria-hidden="true">→</span>
            {t("manualRoute.generate")}
          </button>
        </div>
      </div>
    </section>
  );
}
