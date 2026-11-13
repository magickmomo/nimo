/** Evidence-backed general memories. Food is a category, not a separate memory system. */
export type MemoryRow = {
  id:number; subject:string; statement:string; category:string; confidence:number;
  status:string; created_at:string; updated_at:string; reviewed_at:string|null;
  evidence_count:number;
};
export const MAX_ACTIVE_MEMORIES=24;
export async function consolidatedMemories(db:D1Database):Promise<MemoryRow[]> {
  const result=await db.prepare(`SELECT m.id,m.subject,m.statement,m.category,m.confidence,m.status,
      m.created_at,m.updated_at,m.reviewed_at,
      (SELECT COUNT(*) FROM memory_evidence e WHERE e.memory_id=m.id) AS evidence_count
      FROM consolidated_memories m WHERE m.status!='retired'
      ORDER BY m.updated_at DESC,m.id DESC LIMIT ?`)
    .bind(MAX_ACTIVE_MEMORIES).all<MemoryRow>();
  return result.results;
}
export async function memoryEvidence(db:D1Database,id:number) {
  const r=await db.prepare(`SELECT e.id,e.created_at,e.kind,e.action,e.content
    FROM memory_evidence me JOIN events e ON e.id=me.event_id
    WHERE me.memory_id=? ORDER BY e.id DESC LIMIT 30`).bind(id).all();
  return r.results;
}
/** Record only verified outcomes, not model assertions. A failed or duplicate event never creates evidence. */
export async function recordVerifiedMemory(
  db:D1Database,
  input:{subject:string;statement:string;category:'food'|'object'|'place'|'experience'|'knowledge';confidence:number;eventId:number}
) {
  const {subject,statement,category,eventId}=input;
  if(!subject.trim()||subject.length>100||!statement.trim()||statement.length>600||
    !Number.isSafeInteger(eventId)||eventId<=0)throw Error("Invalid memory evidence");
  const confidence=Math.max(0,Math.min(1,input.confidence));
  // D1 batch is transactional; an event cannot be attached twice.
  // When all slots are full, retire the least-supported memory to retain a 24-entry active bound.
  const already=await db.prepare("SELECT id FROM consolidated_memories WHERE subject=?").bind(subject).first<{id:number}>();
  if(!already) {
    const count=await db.prepare("SELECT COUNT(*) AS n FROM consolidated_memories WHERE status!='retired'").first<{n:number}>();
    if((count?.n??0)>=MAX_ACTIVE_MEMORIES) {
      await db.prepare(`UPDATE consolidated_memories SET status='retired',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE id=(SELECT id FROM consolidated_memories WHERE status!='retired'
          ORDER BY confidence ASC,updated_at ASC,id ASC LIMIT 1)`).run();
    }
  }
  const status=confidence>=0.8?'established':'tentative';
  await db.batch([
    db.prepare(`INSERT INTO consolidated_memories(subject,statement,category,confidence,status,reviewed_at)
      VALUES(?,?,?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      ON CONFLICT(subject) DO UPDATE SET statement=excluded.statement,category=excluded.category,
      confidence=excluded.confidence,status=excluded.status,reviewed_at=excluded.reviewed_at,
      updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')`)
      .bind(subject,statement,category,confidence,status),
    db.prepare(`INSERT OR IGNORE INTO memory_evidence(memory_id,event_id)
      SELECT id,? FROM consolidated_memories WHERE subject=? AND EXISTS(SELECT 1 FROM events WHERE id=?)`)
      .bind(eventId,subject,eventId)
  ]);
}
