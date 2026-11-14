import {recordVerifiedMemory} from "./consolidated-memory";
import {nearObject} from "./garden";
import type {Point} from "../../web/lib/world-map";

export type OracleSource={title:string;url:string};
type OracleRow={id:number;question:string;status:string;started_at:string|null};
export const ORACLE_ID="oracle_001";
const MAX_ANSWER=1500;
const MAX_QUESTION=500;

export function adjacentToOracle(position:Point):boolean {
  // The physical monument occupies a 2x2 footprint. Its edges are reachable.
  for(const x of [1,2])for(const y of [13,14]){
    if(Math.abs(position.x-x)+Math.abs(position.y-y)===1)return true;
  }
  return false;
}
export async function askOracle(db:D1Database,position:Point,question:string) {
  if(!adjacentToOracle(position))throw Error("Stand next to the Oracle");
  if(!question.trim()||question.length>MAX_QUESTION)throw Error("Ask a question of 1–500 characters");
  // Only one unanswered research request may be in flight. This is a
  // concurrency guard, not question deduplication or a daily usage limit.
  const busy=await db.prepare("SELECT id FROM oracle_queries WHERE status IN ('pending','researching') LIMIT 1").first();
  if(busy)throw Error("The Oracle is already researching a question");
  const row=await db.prepare("INSERT INTO oracle_queries(question) VALUES(?) RETURNING id")
    .bind(question.trim()).first<{id:number}>();
  if(!row)throw Error("Oracle could not record the question");
  return row.id;
}
export async function recentOracle(db:D1Database,limit=30){
  const result=await db.prepare(`SELECT id,question,status,asked_at,answered_at,answer,sources_json,memory_id,error
    FROM oracle_queries ORDER BY id DESC LIMIT ?`).bind(limit).all<{
    id:number;question:string;status:string;asked_at:string;answered_at:string|null;
    answer:string|null;sources_json:string;memory_id:number|null;error:string|null
  }>();
  return result.results.map(row=>({...row,sources:JSON.parse(row.sources_json) as OracleSource[],sources_json:undefined}));
}
function citedSources(output:unknown):OracleSource[]{
  const sourceMap=new Map<string,OracleSource>();
  const data=output as {output?:{content?:{annotations?:{type?:string;url?:string;title?:string}[]}[]}[]};
  for(const message of data.output??[])for(const part of message.content??[]){
    for(const a of part.annotations??[]){
      if(a.type!=="url_citation"||typeof a.url!=="string")continue;
      try{
        const url=new URL(a.url);
        if(url.protocol!=="https:"&&url.protocol!=="http:")continue;
        const normalized=url.toString();
        if(sourceMap.size<12)sourceMap.set(normalized,{url:normalized,title:String(a.title||url.hostname).slice(0,180)});
      }catch{/* ignore malformed sources */}
    }
  }
  return [...sourceMap.values()];
}
function extractAnswer(output:unknown):string {
  const data=output as {output?:{content?:{type?:string;text?:string}[]}[]};
  return (data.output??[]).flatMap(o=>o.content??[])
    .filter(c=>c.type==="output_text"&&typeof c.text==="string")
    .map(c=>c.text).join("\n").trim().slice(0,MAX_ANSWER);
}
export async function researchOracleQuestion(env:{
  DB:D1Database;OPENAI_API_KEY:string;ORACLE_MODEL?:string
}) {
  // Recover abandoned jobs (e.g. Worker terminated mid-search).
  const candidate=await env.DB.prepare(`SELECT id,question,status,started_at FROM oracle_queries
    WHERE status='pending' OR (status='researching' AND started_at<?)
    ORDER BY id ASC LIMIT 1`).bind(new Date(Date.now()-5*60_000).toISOString()).first<OracleRow>();
  if(!candidate)return {status:"idle" as const};
  const claimed=await env.DB.prepare(`UPDATE oracle_queries SET status='researching',started_at=?,error=NULL
    WHERE id=? AND (status='pending' OR (status='researching' AND started_at<?))`)
    .bind(new Date().toISOString(),candidate.id,new Date(Date.now()-5*60_000).toISOString()).run();
  if(claimed.meta.changes!==1)return {status:"busy" as const};
  try{
    const response=await fetch("https://api.openai.com/v1/responses",{
      method:"POST",
      headers:{Authorization:`Bearer ${env.OPENAI_API_KEY}`,"Content-Type":"application/json"},
      body:JSON.stringify({
        model:env.ORACLE_MODEL||"gpt-6-astra",
        reasoning:{effort:"low"},
        tools:[{type:"web_search",search_context_size:"low"}],
        input:[
          {role:"system",content:"You are a research instrument in a small autonomous digital world. Answer the visitor's question directly and accurately, using web research where appropriate. Cite trustworthy external sources when stating external facts. You are NOT Nimo, have no authority over Nimo's choices, and must not make up facts about his private simulation. Keep the answer under about 220 words. If the answer is unknown or can't be substantiated, explain that plainly."},
          {role:"user",content:candidate.question}
        ],
        max_output_tokens:1300
      }),
      signal:AbortSignal.timeout(90_000)
    });
    if(!response.ok)throw Error(`Oracle research API returned HTTP ${response.status}`);
    const output=await response.json() as unknown;
    const answer=extractAnswer(output);
    const sources=citedSources(output);
    if(!answer)throw Error("Oracle research returned no answer");
    // A sourced answer may become existing evidence-backed knowledge.
    // A response without citations is still recorded, but not elevated to fact.
    const sourced=sources.length>0;
    const event=await env.DB.prepare("INSERT INTO events(kind,content,action) VALUES('tool',?,'ORACLE_ANSWER') RETURNING id")
      .bind(`ORACLE #${candidate.id}: Q: ${candidate.question} A: ${answer.slice(0,950)} Sources: ${sources.map(s=>s.url).join(", ").slice(0,550)}`)
      .first<{id:number}>();
    let memoryId:number|null=null;
    if(sourced&&event){
      // Reuse the canonical consolidated-memory store and evidence links.
      // No duplicate-question matching: memory consolidation can handle it later.
      await recordVerifiedMemory(env.DB,{
        subject:`oracle:question:${candidate.id}`,
        statement:answer.slice(0,600),
        category:"knowledge",confidence:0.8,eventId:event.id
      });
      const saved=await env.DB.prepare("SELECT id FROM consolidated_memories_v2 WHERE subject=?")
        .bind(`oracle:question:${candidate.id}`).first<{id:number}>();
      memoryId=saved?.id??null;
    }
    await env.DB.prepare(`UPDATE oracle_queries SET status=?,answered_at=?,answer=?,sources_json=?,event_id=?,memory_id=?
      WHERE id=? AND status='researching'`)
      .bind(sourced?"answered":"unsourced",new Date().toISOString(),answer,JSON.stringify(sources),event?.id??null,memoryId,candidate.id).run();
    return {status:sourced?"answered" as const:"unsourced" as const,id:candidate.id};
  }catch(err){
    const message=err instanceof Error?err.message:String(err);
    await env.DB.prepare("UPDATE oracle_queries SET status='failed',answered_at=?,error=? WHERE id=?")
      .bind(new Date().toISOString(),message.slice(0,300),candidate.id).run();
    return {status:"failed" as const,id:candidate.id};
  }
}
