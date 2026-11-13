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
 return {requests:r.results,pending:r.results.filter(x=>x.status==="pending").length};
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
