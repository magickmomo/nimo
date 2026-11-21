/** Nimo's lived, evidence-backed memories. Oracle answers are reference research,
 * retained in oracle_queries instead of competing with world experiences. */
export type MemoryRow = {
  id:number; subject:string; statement:string; category:string; confidence:number;
  status:string; created_at:string; updated_at:string; reviewed_at:string|null;
  evidence_count:number;
  reinforcement_hours:number;
};
export const MAX_ACTIVE_MEMORIES=24;

/** Only lived memories count towards the 24 active slots. Archived research
 * remains accessible through Oracle history, and retired records remain in D1. */
export async function consolidatedMemories(db:D1Database):Promise<MemoryRow[]> {
  const result=await db.prepare(`SELECT m.id,m.subject,m.statement,m.category,m.confidence,m.status,
      m.created_at,m.updated_at,m.reviewed_at,
      (SELECT COUNT(*) FROM memory_evidence_v2 e WHERE e.memory_id=m.id) AS evidence_count,
      (SELECT COUNT(DISTINCT substr(ev.created_at,1,13))
        FROM memory_evidence_v2 me JOIN events ev ON ev.id=me.event_id
        WHERE me.memory_id=m.id) AS reinforcement_hours
      FROM consolidated_memories_v2 m
      WHERE m.status NOT IN ('retired','contradicted') AND m.category!='knowledge'
      ORDER BY m.updated_at DESC,m.id DESC LIMIT ?`)
    .bind(MAX_ACTIVE_MEMORIES).all<MemoryRow>();
  return result.results;
}
export async function memoryEvidence(db:D1Database,id:number) {
  const r=await db.prepare(`SELECT e.id,e.created_at,e.kind,e.action,e.content
    FROM memory_evidence_v2 me JOIN events e ON e.id=me.event_id
    WHERE me.memory_id=? ORDER BY e.id DESC LIMIT 30`).bind(id).all();
  return r.results;
}

/** Retain the strongest 24 active personal memories.
 * The number of distinct UTC hours with linked evidence represents independent
 * opportunities for reinforcement. Ten events from one burst count as one
 * hour; observations across multiple hours provide stronger retention.
 *
 * Score = confidence + 0.06 per additional evidence hour, capped at six extra
 * hours (0.36). The modest, bounded bonus helps reinforced memories survive
 * competition without making them permanently immune to retirement. An
 * unsupported or stale memory can still give way to stronger experiences.
 *
 * Eviction only changes status to 'retired'; the statement and all linked
 * evidence remain in D1. This SQL runs in the SAME transaction as new evidence
 * insertions, including reactivation of an earlier retired subject.
 */
export const pruneOverflowSql=`WITH support AS (
    SELECT m.id,m.confidence,m.updated_at,
      COUNT(DISTINCT substr(e.created_at,1,13)) AS evidence_hours
    FROM consolidated_memories_v2 m
    LEFT JOIN memory_evidence_v2 me ON me.memory_id=m.id
    LEFT JOIN events e ON e.id=me.event_id
    WHERE m.category!='knowledge' AND m.status NOT IN ('retired','contradicted')
    GROUP BY m.id
  ), ranked AS (
    SELECT id,ROW_NUMBER() OVER (
      ORDER BY (confidence + 0.06 * MIN(6,MAX(0,evidence_hours-1))) DESC,
        evidence_hours DESC,updated_at DESC,id DESC
    ) AS rank
    FROM support
  )
  UPDATE consolidated_memories_v2
  SET status='retired',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
  WHERE id IN (SELECT id FROM ranked WHERE rank > ${MAX_ACTIVE_MEMORIES})`;
