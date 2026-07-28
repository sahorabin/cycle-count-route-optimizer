export interface PersistedState {
  targetCount: number;
  completedIds: string[];
  language: "ko" | "en";
  walkingSpeed: number;
  selectedIds: string[];
  manualRouteStopIds: string[];
  comparisonRequested: boolean;
}

export const DEFAULT_PERSISTED_STATE: PersistedState = {
  targetCount: 20,
  completedIds: [],
  language: "ko",
  walkingSpeed: 60,
  selectedIds: [],
  manualRouteStopIds: [],
  comparisonRequested: false,
};

const STORAGE_KEY = "cycle-count-route-optimizer:v1";

function isValidTargetCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 100;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((id) => typeof id === "string");
}

function isValidLanguage(value: unknown): value is "ko" | "en" {
  return value === "ko" || value === "en";
}

function isValidWalkingSpeed(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isValidBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

/**
 * Reads and validates each field independently: a single malformed field
 * (wrong type, out of range) falls back to that field's default without
 * discarding the rest of an otherwise-valid stored object. `completedIds`,
 * `selectedIds`, and `manualRouteStopIds` are only type-validated here
 * (string[]) -- cross-checking those ids against the current 100-location
 * fixture (and, for `manualRouteStopIds`, against the restored selection)
 * is the caller's job (App.tsx), since this module must stay
 * fixture-agnostic and easily testable.
 */
export function loadPersistedState(storage: Pick<Storage, "getItem">): PersistedState {
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return DEFAULT_PERSISTED_STATE;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_PERSISTED_STATE;
  }

  if (typeof parsed !== "object" || parsed === null) return DEFAULT_PERSISTED_STATE;
  const candidate = parsed as Record<string, unknown>;

  return {
    targetCount: isValidTargetCount(candidate.targetCount)
      ? candidate.targetCount
      : DEFAULT_PERSISTED_STATE.targetCount,
    completedIds: isStringArray(candidate.completedIds)
      ? candidate.completedIds
      : DEFAULT_PERSISTED_STATE.completedIds,
    language: isValidLanguage(candidate.language) ? candidate.language : DEFAULT_PERSISTED_STATE.language,
    walkingSpeed: isValidWalkingSpeed(candidate.walkingSpeed)
      ? candidate.walkingSpeed
      : DEFAULT_PERSISTED_STATE.walkingSpeed,
    selectedIds: isStringArray(candidate.selectedIds)
      ? candidate.selectedIds
      : DEFAULT_PERSISTED_STATE.selectedIds,
    manualRouteStopIds: isStringArray(candidate.manualRouteStopIds)
      ? candidate.manualRouteStopIds
      : DEFAULT_PERSISTED_STATE.manualRouteStopIds,
    comparisonRequested: isValidBoolean(candidate.comparisonRequested)
      ? candidate.comparisonRequested
      : DEFAULT_PERSISTED_STATE.comparisonRequested,
  };
}

/** Never throws: a full/disabled localStorage must not crash the app. */
export function savePersistedState(storage: Pick<Storage, "setItem">, state: PersistedState): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage unavailable or full -- persistence is best-effort only.
  }
}
