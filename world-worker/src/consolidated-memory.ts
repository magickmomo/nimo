/** Nimo's lived, evidence-backed memories. Oracle answers are reference research,
 * retained in oracle_queries instead of competing with world experiences. */
export type MemoryRow = {
  id:number; subject:string; statement:string; category:string; confidence:number;
  status:string; created_at:string; updated_at:string; reviewed_at:string|null;
  evidence_count:number;
};
export const MAX_ACTIVE_MEMORIES=24;

/** Only lived memories count towards the 24 active slots. Archived research
 * remains accessible through Oracle history, and retired records remain in D1. */
export async function consolidatedMemories(db:D1Database):Promise<MemoryRow[]> {
  const result=await db.prepare(`SELECT m.id,m.subject,m.statement,m.category,m.confidence,m.status,
      m.created_at,m.updated_at,m.reviewed_at,
      (SELECT COUNT(*) FROM memory_evidence_v2 e WHERE e.memory_id=m.id) AS evidence_count
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

/** Keep the most useful 24 personal records. Food and other actual experiences
 * out-rank neither science trivia nor other research because research isn't in
 * this pool at all. Displaced entries are retired, never deleted.
 *
 * SQLite window-function pruning is executed within the SAME D1 transaction as
 * the insert/update, so an existing retired subject being reactivated cannot
 * accidentally increase the active count beyond 24.
 */
const pruneOverflowSql=`UPDATE consolidated_memories_v2
  SET status='retired',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
  WHERE id IN (
    SELECT id FROM (
      SELECT id,ROW_NUMBER() OVER (
        ORDER BY confidence DESC,updated_at DESC,id DESC
      ) AS rank
      FROM consolidated_memories_v2
      WHERE category!='knowledge' AND status NOT IN ('retired','contradicted')
    ) WHERE rank > ${MAX_ACTIVE_MEMORIES}
  )`;

/** Record only outcomes grounded in a real event, not model assertions. */
export async function recordVerifiedMemory(
  db:D1Database,
  input:{subject:string;statement:string;category:'food'|'object'|'place'|'experience';confidence:number;eventId:number}
) {
  const {subject,statement,category,eventId}=input;
  if(!subject.trim()||subject.length>100||!statement.trim()||statement.length>600||
    !Number.isSafeInteger(eventId)||eventId<=0)throw Error("Invalid memory evidence");
  const confidence=Math.max(0,Math.min(1,input.confidence));
  const status=confidence>=0.8?'established':'tentative';
  await db.batch([
    db.prepare(`INSERT INTO consolidated_memories_v2(subject,statement,category,confidence,status,reviewed_at)
      VALUES(?,?,?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      ON CONFLICT(subject) DO UPDATE SET
      confidence=MAX(consolidated_memories_v2.confidence,excluded.confidence),
      status=CASE WHEN consolidated_memories_v2.status='retired'
        THEN excluded.status ELSE consolidated_memories_v2.status END,
      reviewed_at=excluded.reviewed_at,
      updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')`)
      .bind(subject,statement,category,confidence,status),
    db.prepare(`INSERT OR IGNORE INTO memory_evidence_v2(memory_id,event_id)
      SELECT id,? FROM consolidated_memories_v2 WHERE subject=? AND EXISTS(SELECT 1 FROM events WHERE id=?)`)
      .bind(eventId,subject,eventId),
    db.prepare(pruneOverflowSql)
  ]);
}
