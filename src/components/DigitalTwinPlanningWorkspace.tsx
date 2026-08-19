import type { ReactNode } from "react";
import { useTranslation } from "../i18n/useTranslation";
import {
  WorkspaceUtilityPanel,
  type WorkspacePanel,
} from "./WorkspacePanels";

export function DigitalTwinPlanningWorkspace({
  summary,
  viewport,
  locations,
  route,
  workflow,
  language,
  guidance,
  showWelcome,
  onStart,
  onReopenGuide,
  activePanel,
  onPanelChange,
}: {
  summary: ReactNode;
  viewport: ReactNode;
  locations: ReactNode;
  route: ReactNode;
  workflow: ReactNode;
  language: ReactNode;
  guidance: ReactNode;
  showWelcome: boolean;
  onStart: () => void;
  onReopenGuide: () => void;
  activePanel: WorkspacePanel;
  onPanelChange: (panel: WorkspacePanel) => void;
}) {
  const { t } = useTranslation();
  return (
    <section className="twin twin--planning" aria-labelledby="planning-workspace-title">
      <header className="twin__bar">
        <div className="twin__identity">
          <h1 id="planning-workspace-title">{t("twin.title")}</h1>
          <p>{t("twin.context")}</p>
        </div>
        <div className="workspace-command-center">{workflow}</div>
        <div className="twin__modes">{language}</div>
      </header>
      <div className="twin__body">
        <WorkspaceUtilityPanel
          summary={summary}
          active={activePanel}
          onChange={onPanelChange}
          locations={locations}
          route={route}
        />
        <main className="twin__stage" aria-label={t("twin.viewport")}>
          <article className="route-simulation-viewport route-simulation-viewport--explore">
            <header className="route-simulation-viewport__header">
              <h3>{t("workspace.planningView")}</h3>
              <span className="route-simulation-viewport__status">{t("workspace.plan")}</span>
            </header>
            <div className="route-simulation-viewport__stage workspace-planning-map">{viewport}</div>
          </article>
          {showWelcome ? (
            <div className="workspace-welcome" role="dialog" aria-labelledby="workspace-welcome-title">
              <div className="workspace-welcome__card">
                <span className="workspace-welcome__eyebrow">{t("workspace.welcomeEyebrow")}</span>
                <h2 id="workspace-welcome-title">{t("workspace.welcomeTitle")}</h2>
                <p>{t("workspace.welcomeBody")}</p>
                <button className="workspace-welcome__play" type="button" onClick={onStart}>
                  <span aria-hidden="true">▶</span>
                  {t("workspace.tryDemo")}
                </button>
                <small>{t("workspace.welcomeSteps")}</small>
              </div>
            </div>
          ) : (
            <button className="workspace-guide-reopen" type="button" onClick={onReopenGuide}>
              {t("workspace.guide")}
            </button>
          )}
        </main>
      </div>
      <footer className="twin__timeline twin__timeline--planning">
        <strong>{t("workspace.configureRoute")}</strong>
        <span>{guidance}</span>
      </footer>
    </section>
  );
}
