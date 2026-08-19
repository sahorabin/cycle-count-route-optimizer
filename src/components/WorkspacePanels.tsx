import type { ReactNode } from "react";
import { useTranslation } from "../i18n/useTranslation";

export type WorkspacePanel = "locations" | "route" | null;

function UtilitySection({ panel, step, title, active, onChange, children }: {
  panel: Exclude<WorkspacePanel, null>;
  step: number;
  title: string;
  active: WorkspacePanel;
  onChange: (panel: WorkspacePanel) => void;
  children: ReactNode;
}) {
  const expanded = active === panel;
  return (
    <section data-workspace-panel={panel} className={`workspace-utility__section${expanded ? " workspace-utility__section--open" : ""}`}>
      <button
        className="workspace-utility__trigger"
        type="button"
        aria-expanded={expanded}
        aria-controls={`workspace-${panel}-content`}
        onClick={() => onChange(expanded ? null : panel)}
      >
        <span className="workspace-utility__step" aria-hidden="true">{step}</span>
        <span>{title}</span>
        <span className="workspace-utility__chevron" aria-hidden="true">⌄</span>
      </button>
      {expanded ? (
        <div className="workspace-utility__content" id={`workspace-${panel}-content`}>
          {children}
        </div>
      ) : null}
    </section>
  );
}

/** One obvious workflow rail: summary first, then explicitly collapsible tasks. */
export function WorkspaceUtilityPanel({ summary, active, onChange, locations, route }: {
  summary: ReactNode;
  active: WorkspacePanel;
  onChange: (panel: WorkspacePanel) => void;
  locations: ReactNode;
  route: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <aside className="workspace-utility" aria-label={t("workspace.workflowPanel")}>
      <div className="workspace-utility__summary">{summary}</div>
      <UtilitySection panel="locations" step={1} title={t("workspace.locations")} active={active} onChange={onChange}>
        {locations}
      </UtilitySection>
      <UtilitySection panel="route" step={2} title={t("workspace.routeOrder")} active={active} onChange={onChange}>
        {route}
      </UtilitySection>
    </aside>
  );
}
