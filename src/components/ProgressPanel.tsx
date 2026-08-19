import type { NodeId } from "../domain/types";
import { useTranslation } from "../i18n/useTranslation";

interface ProgressPanelProps {
  targetCount: number;
  completedIds: ReadonlySet<NodeId>;
  selectedIds: ReadonlySet<NodeId>;
  onTargetCountChange: (count: number) => void;
  onMarkSelectedComplete: () => void;
  onUndoSelectedCompletion: () => void;
  undoAvailable?: boolean;
}

export function ProgressPanel({
  targetCount,
  completedIds,
  selectedIds,
  onTargetCountChange,
  onMarkSelectedComplete,
  onUndoSelectedCompletion,
  undoAvailable = false,
}: ProgressPanelProps) {
  const { t } = useTranslation();
  const completed = completedIds.size;
  const remaining = Math.max(0, targetCount - completed);
  // Displayed completion is clamped to 100%; the raw overage (how far past
  // today's target the worker has gone) is reported separately rather than
  // folded into the percentage, so "110% done" never appears.
  const completionPct = targetCount > 0 ? Math.min(100, Math.round((completed / targetCount) * 100)) : 0;
  const overTarget = Math.max(0, completed - targetCount);
  const barLabel = `${completionPct}%${overTarget > 0 ? ` (+${overTarget} ${t("progress.overTarget")})` : ""}`;

  return (
    <section className="progress-panel" aria-label={t("progress.title")}>
      <div className="progress-panel__header">
        <h2>{t("progress.title")}</h2>
        <label className="progress-panel__target-field">
          {t("progress.targetLabel")}
          <input
            type="number"
            className="progress-panel__target-input"
            min={1}
            max={100}
            value={targetCount}
            onChange={(e) => {
              const value = Number(e.target.value);
              if (Number.isInteger(value) && value >= 1 && value <= 100) onTargetCountChange(value);
            }}
          />
        </label>
      </div>

      <div className="progress-panel__bar-row">
        <div
          className="progress-panel__bar-track"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={completionPct}
          aria-label={t("progress.completionPct")}
        >
          <div className="progress-panel__bar-fill" style={{ width: `${completionPct}%` }} />
        </div>
        <span className="progress-panel__bar-label">{barLabel}</span>
      </div>

      <dl className="progress-panel__stats">
        <div>
          <dt>{t("progress.completed")}</dt>
          <dd>{completed}</dd>
        </div>
        <div>
          <dt>{t("progress.remaining")}</dt>
          <dd>{remaining}</dd>
        </div>
      </dl>

      {(selectedIds.size > 0 || undoAvailable) && (
        <div className="progress-panel__actions">
          {selectedIds.size > 0 && (
            <button type="button" onClick={onMarkSelectedComplete}>
              {t("progress.markComplete")}
            </button>
          )}
          {undoAvailable && (
            <button type="button" onClick={onUndoSelectedCompletion}>
              {t("progress.undoComplete")}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
