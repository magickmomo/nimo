// Pure world clock functions: time is milliseconds since the Unix epoch.
export function completedStepIndex(
  startedAtMs: number, nowMs: number, stepMs: number, routeLength: number, alreadyCompleted = 0,
): number {
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(nowMs) ||
      !Number.isFinite(stepMs) || stepMs <= 0 ||
      !Number.isInteger(routeLength) || routeLength < 2)
    throw new Error("Invalid journey clock");
  return Math.min(routeLength - 1,
    Math.max(alreadyCompleted, Math.floor(Math.max(0,nowMs-startedAtMs)/stepMs)));
}
export function resumeStartTime(startedAtMs: number, pausedAtMs: number, resumedAtMs: number): number {
  if (![startedAtMs,pausedAtMs,resumedAtMs].every(Number.isFinite))
    throw new Error("Invalid paused journey timestamps");
  return startedAtMs+Math.max(0,resumedAtMs-pausedAtMs);
}
