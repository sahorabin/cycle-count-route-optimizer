export class InvalidWalkingDurationInputError extends Error {
  constructor(message: string) {
    super(`Invalid walking-duration input: ${message}`);
    this.name = "InvalidWalkingDurationInputError";
  }
}

/**
 * The application's canonical walking-time rule. Distance is measured in
 * metres, speed in metres per minute, and the result is fractional minutes.
 */
export function calculateWalkingDurationMinutes(
  distanceMeters: number,
  walkingSpeedMetersPerMinute: number,
): number {
  if (!Number.isFinite(distanceMeters) || distanceMeters < 0) {
    throw new InvalidWalkingDurationInputError("distance must be finite and non-negative");
  }
  if (!Number.isFinite(walkingSpeedMetersPerMinute) || walkingSpeedMetersPerMinute <= 0) {
    throw new InvalidWalkingDurationInputError("walking speed must be finite and greater than zero");
  }
  const durationMinutes = distanceMeters / walkingSpeedMetersPerMinute;
  if (!Number.isFinite(durationMinutes)) {
    throw new InvalidWalkingDurationInputError("calculated duration must be finite");
  }
  return durationMinutes;
}
