export type CreatorRequest={
  id:number;source_event_id:number;last_event_id:number;content:string;
  status:"pending"|"acknowledged"|"accepted"|"rejected"|"implemented";
  times_asked:number;created_at:string;updated_at:string;resolved_at:string|null;
};
const statuses=["pending","acknowledged","accepted","rejected","implemented"] as const;
export async function requestInbox(db:D1Database) {
 const r=await db.prepare(`SELECT id,source_event_id,last_event_id,content,status,times_asked,
    created_at,updated_at,resolved_at FROM creator_requests ORDER BY
    CASE WHEN status='pending' THEN 0 ELSE 1 END,id DESC LIMIT 150`).all<CreatorRequest>();
 const responses=await db.prepare(`SELECT request_id,status,message,created_at
   FROM creator_request_responses ORDER BY id DESC LIMIT 250`)
   .all<{request_id:number;status:string;message:string;created_at:string}>();
 const byRequest=new Map<number,{status:string;message:string;created_at:string}[]>();
 for(const reply of responses.results){
  const existing=byRequest.get(reply.request_id)??[];
  existing.push({status:reply.status,message:reply.message,created_at:reply.created_at});
  byRequest.set(reply.request_id,existing);
 }
 return {requests:r.results.map(item=>({...item,responses:byRequest.get(item.id)??[]})),
   pending:r.results.filter(x=>x.status==="pending").length};
}
export async function requestContext(db:D1Database){
 const r=await db.prepare(`SELECT id,content,status,times_asked FROM creator_requests
    ORDER BY id DESC LIMIT 20`).all<Pick<CreatorRequest,"id"|"content"|"status"|"times_asked">>();
 return r.results;
}
export async function recordCreatorRequest(db:D1Database,eventId:number,content:string){
 const key=content.trim().toLowerCase().slice(0,240);
 if(!key)return;
 const result=await db.prepare(`INSERT INTO creator_requests
    (source_event_id,dedupe_key,content,last_event_id) VALUES(?,?,?,?)
    ON CONFLICT(dedupe_key) DO UPDATE SET last_event_id=excluded.last_event_id,
    times_asked=creator_requests.times_asked+1,
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')`)
   .bind(eventId,key,content.slice(0,1800),eventId).run();
 return result.meta.changes;
}
export async function changeRequestStatus(db:D1Database,id:number,status:string){
 if(!Number.isSafeInteger(id)||id<1||!statuses.includes(status as typeof statuses[number]))
  throw Error("Invalid request ID or status");
 const result=await db.prepare(`UPDATE creator_requests
   SET status=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
   resolved_at=CASE WHEN ? IN ('rejected','implemented')
     THEN strftime('%Y-%m-%dT%H:%M:%fZ','now') ELSE NULL END WHERE id=?`)
  .bind(status,status,id).run();
 if(!result.meta.changes)throw Error("Request not found");
 return {ok:true};
}

/** Update a request and deliver the creator's own words as an ordinary visitor
 * message. Nimo's existing pending-message path will force a grounded REPLY
 * during his next autonomous decision (or after waking up).
 * All changes share one D1 transaction, with retry-safe event insertion.
 */
export async function respondToCreatorRequest(
 db:D1Database,id:number,status:string,message:string,idempotencyKey:string
){
 if(!Number.isSafeInteger(id)||id<1||!statuses.includes(status as typeof statuses[number]))
  throw Error("Invalid request or status");
 const content=message.trim();
 if(!content||content.length>1000)throw Error("Reply must contain 1–1000 characters");
 if(!/^[a-zA-Z0-9-]{20,80}$/.test(idempotencyKey))throw Error("Invalid reply key");
 const existingRequest=await db.prepare("SELECT id FROM creator_requests WHERE id=?")
   .bind(id).first<{id:number}>();
 if(!existingRequest)throw Error("Request not found");
 const existingReply=await db.prepare("SELECT request_id FROM creator_request_responses WHERE idempotency_key=?")
   .bind(idempotencyKey).first<{request_id:number}>();
 if(existingReply&&existingReply.request_id!==id)throw Error("Reply key belongs to another request");
 const action="REQUEST_RESPONSE:"+idempotencyKey;
 const results=await db.batch([
  db.prepare(`INSERT OR IGNORE INTO creator_request_responses
     (request_id,idempotency_key,status,message) VALUES(?,?,?,?)`)
     .bind(id,idempotencyKey,status,content),
  db.prepare(`INSERT INTO events(kind,content,action)
     SELECT 'visitor','Regarding your request #' || CAST(request_id AS TEXT) ||
       ' (status: ' || status || '). Creator says: ' || message,?
     FROM creator_request_responses
     WHERE idempotency_key=?
       AND NOT EXISTS(SELECT 1 FROM events WHERE action=?)`)
     .bind(action,idempotencyKey,action),
  db.prepare(`UPDATE creator_requests SET
      status=(SELECT status FROM creator_request_responses WHERE idempotency_key=?),
      updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
      resolved_at=CASE WHEN (SELECT status FROM creator_request_responses WHERE idempotency_key=?)
        IN ('rejected','implemented')
        THEN strftime('%Y-%m-%dT%H:%M:%fZ','now') ELSE NULL END
      WHERE id=?`)
    .bind(idempotencyKey,idempotencyKey,id)
 ]);
 if(results[2].meta.changes!==1)throw Error("Could not update request");
 return {ok:true,delivered:true,duplicate:results[0].meta.changes===0};
}
