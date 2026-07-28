import { useTranslation } from "../i18n/useTranslation";
import type { TranslationKey } from "../i18n/translations";

export type WorkflowStep = 1 | 2 | 3;

const STEP_LABEL_KEYS: Record<WorkflowStep, TranslationKey> = {
  1: "workflow.step1",
  2: "workflow.step2",
  3: "workflow.step3",
};

export function WorkflowSteps({ step }: { step: WorkflowStep }) {
  const { t } = useTranslation();

  return (
    <ol className="workflow-steps" aria-label={t("workflow.title")}>
      {([1, 2, 3] as const).map((stepNumber) => (
        <li
          key={stepNumber}
          className={`workflow-steps__item${stepNumber === step ? " workflow-steps__item--current" : ""}`}
          aria-current={stepNumber === step ? "step" : undefined}
        >
          <span className="workflow-steps__number">{stepNumber}</span>
          <span className="workflow-steps__label">{t(STEP_LABEL_KEYS[stepNumber])}</span>
        </li>
      ))}
    </ol>
  );
}
