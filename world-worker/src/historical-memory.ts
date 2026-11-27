import { eligibleEvent, type VerifiedEvent } from "./personal-memory-consolidation";

export async function searchHistoricalMemory(db: D1Database, query: string) {
  const terms = [...new Set(query.toLowerCase().match(/[a-z0-9_-]+/g))].slice(0,6);
  if (!terms.length) throw Error("Search needs words");
  const sources = [
    ["memory", "SELECT id,subject,statement,category,status,memory_kind FROM consolidated_memories_v2", "subject || ' ' || statement", "1"],
    ["episodic", "SELECT id,created_at,kind,action,content FROM events", "action || ' ' || content", "kind='tool' AND action NOT IN ('RETRIEVAL_OK','TRAVEL_START','ORACLE_ASK','ORACLE_ANSWER')"],
    ["document", "SELECT path AS id,revision,content FROM documents", "path || ' ' || content", "1"],
    ["artwork", "SELECT s.id,s.title,s.intention,s.status,i.description FROM nimo_sketches s LEFT JOIN nimo_artwork_inspections i ON i.sketch_id=s.id AND i.status='completed'", "s.title || ' ' || coalesce(s.intention,'') || ' ' || coalesce(i.description,'')", "1"],
    ["oracle", "SELECT id,question,answer FROM oracle_queries", "question || ' ' || coalesce(answer,'')", "status IN ('answered','unsourced')"],
  ];
  const hits = await Promise.all(sources.map(async ([source,sql,body,where])=>{
    const match = terms.map(()=>`instr(lower(${body}),?)>0`).join(" OR ");
    const {results} = await db.prepare(`${sql} WHERE (${where}) AND (${match}) ORDER BY id DESC LIMIT 12`)
      .bind(...terms).all<{id:number|string}>();
    return results.filter(row=>source!=="episodic" || eligibleEvent(row as VerifiedEvent)).map(row=>{
      const text = JSON.stringify(row);
      return {source,id:row.id,text:text.slice(0,650),score:terms.filter(t=>text.toLowerCase().includes(t)).length};
    });
  }));
  return hits.flat().sort((a,b)=>b.score-a.score).slice(0,3).map(({source,id,text})=>({source,id,text}));
}
