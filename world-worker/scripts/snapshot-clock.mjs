// Preserve stored needs and the remaining duration of physical timers.
// Historical timestamps and daily ledgers stay in their original calendar.
export function initialiseSnapshotClock(sqlite, capturedAt, startedAt) {
  const capture = Date.parse(capturedAt);
  const start = Date.parse(startedAt);
  if (!Number.isFinite(capture) || !Number.isFinite(start) || start<capture) {
    throw Error("Invalid snapshot clock");
  }
  const delta = start-capture;
  const stamp = new Date(start).toISOString();
  const shift = value => value===null ? null : new Date(Date.parse(value)+delta).toISOString();
  sqlite.exec("BEGIN");
  try {
    sqlite.prepare("UPDATE world SET state=json_set(state,'$.lastTick',?),next_tick=? WHERE id=1").run(stamp,stamp);
    sqlite.exec("UPDATE world_control SET autonomous_enabled=1 WHERE id=1");
    sqlite.prepare("UPDATE world_food_trees SET regrow_at=regrow_at+? WHERE regrow_at IS NOT NULL").run(delta);
    sqlite.prepare("UPDATE wildflower_patches SET regrow_at=regrow_at+? WHERE regrow_at IS NOT NULL").run(delta);
    sqlite.prepare("UPDATE garden_plots SET planted_at=planted_at+?,watered_at=watered_at+?").run(delta,delta);
    const journey = sqlite.prepare("SELECT status,started_at,paused_at FROM world_journey WHERE id=1").get();
    if (journey.status!=="idle") {
      sqlite.prepare("UPDATE world_journey SET started_at=?,paused_at=? WHERE id=1").run(
        shift(journey.started_at),shift(journey.paused_at));
    }
    const review = sqlite.prepare("SELECT updated_at FROM personal_memory_cursor WHERE id=1").get();
    sqlite.prepare("UPDATE personal_memory_cursor SET updated_at=? WHERE id=1").run(shift(review.updated_at));
    // The copied process cannot own an active consolidation lease.
    sqlite.exec("UPDATE personal_memory_batch_lock SET token=NULL,expires_at=NULL WHERE id=1");
    const claims = sqlite.prepare("SELECT sketch_id,expires_at FROM nimo_artwork_inspections WHERE status='pending' AND expires_at IS NOT NULL").all();
    const shiftClaim = sqlite.prepare("UPDATE nimo_artwork_inspections SET expires_at=? WHERE sketch_id=?");
    for (const claim of claims) shiftClaim.run(shift(claim.expires_at),claim.sketch_id);
    sqlite.exec("COMMIT");
  } catch (error) {
    sqlite.exec("ROLLBACK");
    throw error;
  }
  return {policy:"stored-needs-and-active-timers-v1",capturedAt,startedAt:stamp,deltaMs:delta};
}
