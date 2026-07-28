import { useMemo, useState } from "react";
import type { CycleCountLocation, NodeId } from "../domain/types";
import { useTranslation } from "../i18n/useTranslation";

interface TargetSelectorProps {
  locations: CycleCountLocation[];
  selected: ReadonlySet<NodeId>;
  search: string;
  zone: string;
  onSearchChange: (value: string) => void;
  onZoneChange: (value: string) => void;
  onToggle: (id: NodeId) => void;
  onSelectVisible: (ids: NodeId[]) => void;
  onClearAll: () => void;
  onContinueToRoute: () => void;
}

export function TargetSelector({
  locations,
  selected,
  search,
  zone,
  onSearchChange,
  onZoneChange,
  onToggle,
  onSelectVisible,
  onClearAll,
  onContinueToRoute,
}: TargetSelectorProps) {
  const { t } = useTranslation();
  const [selectedOnly, setSelectedOnly] = useState(false);
  const [trayExpanded, setTrayExpanded] = useState(false);

  const zones = useMemo(
    () => [...new Set(locations.map((l) => l.zone).filter((z): z is string => Boolean(z)))],
    [locations],
  );

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return locations.filter((location) => {
      if (zone && location.zone !== zone) return false;
      if (selectedOnly && !selected.has(location.id)) return false;
      if (term && !location.label.toLowerCase().includes(term) && !location.id.toLowerCase().includes(term)) {
        return false;
      }
      return true;
    });
  }, [locations, search, zone, selectedOnly, selected]);

  const selectedLocations = useMemo(
    () => locations.filter((l) => selected.has(l.id)),
    [locations, selected],
  );
  // Beyond this many chips, the tray switches to an explicit "N more"
  // expand/collapse control instead of relying on a scrollbar the worker
  // might not notice -- and even expanded, it stays height-bounded so it
  // can never push the rest of the workflow far down the page.
  const TRAY_COLLAPSED_LIMIT = 6;
  const hiddenCount = Math.max(0, selectedLocations.length - TRAY_COLLAPSED_LIMIT);
  const visibleChips =
    trayExpanded || hiddenCount === 0 ? selectedLocations : selectedLocations.slice(0, TRAY_COLLAPSED_LIMIT);

  return (
    <fieldset className="target-selector">
      <legend>{t("selector.title")}</legend>
      <p className="target-selector__explain">{t("selector.explain")}</p>

      <div className="target-selector__filters">
        <input
          type="text"
          className="target-selector__search"
          placeholder={t("selector.searchPlaceholder")}
          aria-label={t("selector.searchPlaceholder")}
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
        />
        <select
          aria-label="zone"
          className="target-selector__zone"
          value={zone}
          onChange={(e) => onZoneChange(e.target.value)}
        >
          <option value="">{t("selector.zoneAll")}</option>
          {zones.map((z) => (
            <option key={z} value={z}>
              {z}
            </option>
          ))}
        </select>
      </div>

      <div className="target-selector__actions">
        <button type="button" onClick={() => onSelectVisible(visible.map((l) => l.id))}>
          {t("selector.selectVisible")}
        </button>
        <button type="button" onClick={onClearAll}>
          {t("selector.clearSelection")}
        </button>
        <label className="target-selector__toggle">
          <input
            type="checkbox"
            aria-label={t("selector.selectedOnly")}
            checked={selectedOnly}
            onChange={(e) => setSelectedOnly(e.target.checked)}
          />
          {t("selector.selectedOnly")}
        </label>
      </div>

      <ul className="target-selector__list" role="list">
        {visible.map((location) => (
          <li key={location.id}>
            <label>
              <input
                type="checkbox"
                checked={selected.has(location.id)}
                onChange={() => onToggle(location.id)}
              />
              <span className="target-selector__label">{location.label}</span>
            </label>
          </li>
        ))}
      </ul>

      <p className="target-selector__count" aria-live="polite">
        {t("selector.selectedCount", { count: selected.size, total: locations.length })}
      </p>

      <div className="target-selector__tray">
        <h3 className="target-selector__tray-title">{t("selector.trayTitle")}</h3>
        {selectedLocations.length === 0 ? (
          <p className="target-selector__tray-empty">{t("selector.trayEmpty")}</p>
        ) : (
          <>
            <ul
              className={`target-selector__tray-chips${
                trayExpanded ? " target-selector__tray-chips--expanded" : ""
              }`}
            >
              {visibleChips.map((location) => (
                <li key={location.id} className="target-selector__chip">
                  {location.label}
                  <button
                    type="button"
                    className="target-selector__chip-remove"
                    onClick={() => onToggle(location.id)}
                    aria-label={t("selector.removeLocation", { label: location.label })}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
            {hiddenCount > 0 && (
              <button
                type="button"
                className="target-selector__tray-toggle"
                onClick={() => setTrayExpanded((v) => !v)}
              >
                {trayExpanded ? t("selector.trayShowLess") : t("selector.trayMore", { count: hiddenCount })}
              </button>
            )}
          </>
        )}
        <button
          type="button"
          className="target-selector__continue"
          onClick={onContinueToRoute}
          disabled={selected.size === 0}
        >
          {t("selector.continueToRoute")}
        </button>
      </div>
    </fieldset>
  );
}
