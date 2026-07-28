import type { CycleCountLocation, NodeId } from "../domain/types";

interface TargetSelectorProps {
  locations: CycleCountLocation[];
  selected: ReadonlySet<NodeId>;
  onToggle: (id: NodeId) => void;
  onSelectAll: () => void;
  onClearAll: () => void;
}

/**
 * Lets the user choose which cycle-count locations to visit. Only ever
 * lists `locations` (the warehouse's cycle-count catalog) -- the office
 * and walkable aisle nodes are never rendered here and can never become
 * selectable targets.
 */
export function TargetSelector({
  locations,
  selected,
  onToggle,
  onSelectAll,
  onClearAll,
}: TargetSelectorProps) {
  return (
    <fieldset className="target-selector">
      <legend>Cycle-count targets</legend>
      <div className="target-selector__actions">
        <button type="button" onClick={onSelectAll}>
          Select all
        </button>
        <button type="button" onClick={onClearAll}>
          Clear all
        </button>
      </div>
      <ul className="target-selector__list">
        {locations.map((location) => (
          <li key={location.id}>
            <label>
              <input
                type="checkbox"
                checked={selected.has(location.id)}
                onChange={() => onToggle(location.id)}
              />
              <span className="target-selector__label">{location.label}</span>
              <span className="target-selector__id">{location.id}</span>
            </label>
          </li>
        ))}
      </ul>
      <p className="target-selector__count" aria-live="polite">
        {selected.size} of {locations.length} selected
      </p>
    </fieldset>
  );
}
