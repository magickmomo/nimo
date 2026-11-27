import {withinOracleInteractionArea, type Point} from "../../web/lib/world-map";

export type OracleSource={title:string;url:string};
type OracleRow={id:number;question:string;status:string;started_at:string|null;response_id:string|null;attempts:number};
export const ORACLE_ID="oracle_001";
export const ORACLE_COST=10;
const MAX_ANSWER=1500;
const MAX_QUESTION=500;

// Keep interaction permissions identical to the ground glow in the map.
export function adjacentToOracle(position:Point):boolean {
 return withinOracleInteractionArea(position);
}
export function oracleInvitation(firstArrival:boolean,status:string|null):string|null {
 if(!firstArrival)return null;
 if(status==="pending"||status==="researching")
   return "The Oracle hums: 'Your question travels beyond this world. Wander if you wish; I will keep searching.'";
 if(status==="answered"||status==="unsourced")
   return "The Oracle murmurs: 'One answer has returned. Beyond it lie other things you have not yet wondered about.'";
 return "The Oracle stirs: 'Beyond this small world are countless things to learn. What have you wondered about? You may ask me, or simply pass by.'";
}
export async function askOracle(db:D1Database,position:Point,question:string,free=false) {
  if(!adjacentToOracle(position))throw Error("Stand within two steps of the Oracle monument");
  if(!question.trim()||question.length>MAX_QUESTION)throw Error("Ask a question of 1–500 characters");
  // Only one unanswered research request may be in flight. This is a
  // concurrency guard, not question deduplication or a daily usage limit.
  const busy=await db.prepare("SELECT id FROM oracle_queries WHERE status IN ('pending','researching') LIMIT 1").first();
  if(busy)throw Error("The Oracle is already researching a question");
  const balance=await db.prepare("SELECT coins FROM vending_state WHERE id=1").first<{coins:number}>();
  if(!free&&(!balance||balance.coins<ORACLE_COST))throw Error(`The Oracle costs ${ORACLE_COST} coins; available: ${balance?.coins??0}`);
  // Migration 022 atomically deducts the price on insert and refunds failed research.
  const row=await db.prepare("INSERT INTO oracle_queries(question) VALUES(?) RETURNING id")
    .bind(question.trim()).first<{id:number}>();
  if(!row)throw Error("Oracle could not record the question");
  return row.id;
}
export async function recentOracle(db:D1Database,limit=30){
  const result=await db.prepare(`SELECT id,question,status,asked_at,started_at,answered_at,answer,sources_json,memory_id,error,attempts
    FROM oracle_queries ORDER BY id DESC LIMIT ?`).bind(limit).all<{
    id:number;question:string;status:string;asked_at:string;started_at:string|null;answered_at:string|null;attempts:number;
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

const API="https://api.openai.com/v1/responses";
const MAX_ATTEMPTS=3;
const LOST_SUBMISSION_MS=2*60_000;
const RESEARCH_DEADLINE_MS=8*60_000;
export function oracleResearchOverdue(startedAt:string|null,now:Date):boolean {
 const started=startedAt?Date.parse(startedAt):NaN;
 return Number.isFinite(started)&&now.getTime()-started>RESEARCH_DEADLINE_MS;
}
const requestHeaders=(key:string)=>({Authorization:"Bearer "+key,"Content-Type":"application/json"});
const oraclePrompt="You are a research instrument in a small autonomous digital world. Answer the visitor's question directly and accurately, using web research where appropriate. Cite trustworthy external sources when stating external facts. You are NOT Nimo, have no authority over Nimo's choices, and must not make up facts about his private simulation. Keep the answer under about 220 words. If the answer is unknown or can't be substantiated, explain that plainly.";
function failureReason(data:unknown):string {
 const obj=data as {error?:{message?:string};incomplete_details?:{reason?:string};status?:string};
 return String(obj.error?.message||obj.incomplete_details?.reason||obj.status||"Unknown research failure").slice(0,300);
}
async function markOracle(db:D1Database,id:number,status:"failed"|"answered"|"unsourced",error:string|null,answer:string|null=null,sources:OracleSource[]=[],responseId:string|null=null) {
 await db.prepare("UPDATE oracle_queries SET status=?,answered_at=?,error=?,answer=?,sources_json=? WHERE id=? AND status='researching' AND response_id IS ?")
  .bind(status,new Date().toISOString(),error,answer,JSON.stringify(sources),id,responseId).run();
}
// Long research executes on the Responses API. Cron only starts and polls jobs.
export async function researchOracleQuestion(env:{DB:D1Database;OPENAI_API_KEY:string;ORACLE_MODEL?:string}) {
 const now=new Date();
 const cutoff=new Date(now.getTime()-LOST_SUBMISSION_MS).toISOString();
 const row=await env.DB.prepare("SELECT id,question,status,started_at,response_id,attempts FROM oracle_queries WHERE status IN ('pending','researching') ORDER BY id ASC LIMIT 1").first<OracleRow>();
 if(!row)return {status:"idle" as const};
 if(row.status==="researching"&&row.response_id){
   // Poll first: research may have completed since the previous cron run,
   // even when the eight-minute deadline has passed.
   try {
     const response=await fetch(API+"/"+encodeURIComponent(row.response_id),{
       method:"GET",headers:requestHeaders(env.OPENAI_API_KEY),signal:AbortSignal.timeout(20_000)
     });
     if(!response.ok){
       if(response.status>=500||response.status===429)return {status:"researching" as const,id:row.id};
       throw Error("Oracle poll returned HTTP "+response.status);
     }
     const output=await response.json() as {status?:string};
     if(output.status==="queued"||output.status==="in_progress"){
       if(oracleResearchOverdue(row.started_at,now)){
         await markOracle(env.DB,row.id,"failed","Oracle research exceeded the eight-minute deadline",null,[],row.response_id);
         return {status:"failed" as const,id:row.id};
       }
       return {status:"researching" as const,id:row.id};
     }
     if(output.status!=="completed"){
       await markOracle(env.DB,row.id,"failed",failureReason(output),null,[],row.response_id);
       return {status:"failed" as const,id:row.id};
     }
     const answer=extractAnswer(output),sources=citedSources(output);
     if(!answer){
       await markOracle(env.DB,row.id,"failed","Oracle completed without answer text",null,[],row.response_id);
       return {status:"failed" as const,id:row.id};
     }
     const status=sources.length?"answered" as const:"unsourced" as const;
     // Save the result before optional journal/memory indexing.
     await markOracle(env.DB,row.id,status,null,answer,sources,row.response_id);
     // An answer is a completed research outcome; submitting a question is not.
     // Only the first answered instance of an identical question gets a
     // curiosity discovery signal. A zero-point reward serves as durable,
     // idempotent evidence for the next autonomous decision.
     try {
       const prior=await env.DB.prepare(`SELECT id FROM oracle_queries
         WHERE id<? AND lower(trim(question))=lower(trim(?))
         AND status IN ('answered','unsourced') LIMIT 1`)
         .bind(row.id,row.question).first();
       if(!prior)await env.DB.prepare(`INSERT OR IGNORE INTO world_rewards
         (source_key,action,points,detail) VALUES(?,'oracle_answered',0,?)`)
         .bind("oracle:answered:"+row.id,"Oracle returned a result for question #"+row.id).run();
     }catch(noveltyError){console.error("Oracle curiosity evidence unavailable",noveltyError);}
     try {
       const event=await env.DB.prepare("INSERT INTO events(kind,content,action) VALUES('tool',?,'ORACLE_ANSWER') RETURNING id")
         .bind("ORACLE #"+row.id+": Q: "+row.question+" A: "+answer.slice(0,950)+" Sources: "+sources.map(s=>s.url).join(", ").slice(0,550))
         .first<{id:number}>();
       // The Oracle answer is already durable in oracle_queries, with its question,
       // sources and journal event. Do not create another general memory entry:
       // reference research must never evict lessons Nimo learned in his world.
       if(event)await env.DB.prepare("UPDATE oracle_queries SET event_id=?,memory_id=NULL WHERE id=?")
         .bind(event.id,row.id).run();
     }catch(indexError){console.error("Oracle answer saved; indexing failed",indexError);}
     return {status,id:row.id};
   }catch(err){
     const message=err instanceof Error?err.message:String(err);
     if(/timeout|abort|fetch failed/i.test(message))return {status:"researching" as const,id:row.id};
     await markOracle(env.DB,row.id,"failed",message.slice(0,300),null,[],row.response_id);
     return {status:"failed" as const,id:row.id};
   }
 }
 if(row.status==="researching"&&row.started_at&&row.started_at>cutoff)
   return {status:"starting" as const,id:row.id};
 if(row.attempts>=MAX_ATTEMPTS){
   await env.DB.prepare("UPDATE oracle_queries SET status='failed',answered_at=?,error=? WHERE id=? AND response_id IS NULL")
     .bind(now.toISOString(),"Oracle could not start research after three attempts",row.id).run();
   return {status:"failed" as const,id:row.id};
 }
 const stamp=now.toISOString();
 await env.DB.prepare("UPDATE oracle_queries SET status='researching',started_at=?,attempts=attempts+1,error=NULL WHERE id=? AND response_id IS NULL AND (status='pending' OR (status='researching' AND started_at<?))")
   .bind(stamp,row.id,cutoff).run();
 const claimed=await env.DB.prepare("SELECT status,started_at,response_id FROM oracle_queries WHERE id=?").bind(row.id)
   .first<{status:string;started_at:string;response_id:string|null}>();
 if(claimed?.status!=="researching"||claimed.started_at!==stamp||claimed.response_id)
   return {status:"busy" as const,id:row.id};
 try{
   const response=await fetch(API,{
     method:"POST",headers:requestHeaders(env.OPENAI_API_KEY),
     body:JSON.stringify({
       model:env.ORACLE_MODEL||"gpt-6-luna",background:true,store:true,
       reasoning:{effort:"low"},tools:[{type:"web_search",search_context_size:"low"}],
       input:[{role:"system",content:oraclePrompt},{role:"user",content:row.question}],
       max_output_tokens:1300
     }),signal:AbortSignal.timeout(20_000)
   });
   if(!response.ok){
     const errorBody=(await response.text()).slice(0,250);
     throw Error("Oracle research API HTTP "+response.status+": "+errorBody);
   }
   const created=await response.json() as {id?:string};
   if(typeof created.id!=="string"||!created.id.startsWith("resp_"))throw Error("Oracle research response ID missing");
   await env.DB.prepare("UPDATE oracle_queries SET response_id=? WHERE id=? AND status='researching' AND started_at=? AND response_id IS NULL")
     .bind(created.id,row.id,stamp).run();
   return {status:"researching" as const,id:row.id};
 }catch(err){
   const message=err instanceof Error?err.message:String(err);
   await env.DB.prepare("UPDATE oracle_queries SET status='failed',answered_at=?,error=? WHERE id=? AND started_at=? AND response_id IS NULL")
     .bind(new Date().toISOString(),message.slice(0,300),row.id,stamp).run();
   return {status:"failed" as const,id:row.id};
 }
}
