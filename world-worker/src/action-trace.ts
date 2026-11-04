export type TraceKind = "perceive"|"recall"|"decide"|"inspect"|"travel"|"write"|"label"|"reply"|"observe"|"think"|"remember"|"request";
export async function startTrace(db:D1Database,kind:TraceKind,detail:string,metadata:unknown=null):Promise<number> {
  const result=await db.prepare("INSERT INTO action_trace(kind,status,detail,metadata) VALUES(?,'running',?,?)")
    .bind(kind,detail,metadata==null?null:JSON.stringify(metadata)).run();
  return Number(result.meta.last_row_id);
}
export async function finishTrace(db:D1Database,id:number,status:"completed"|"failed",result:string) {
  await db.prepare(`UPDATE action_trace SET status=?,result=?,
    finished_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='running'`)
    .bind(status,result.slice(0,1000),id).run();
}
export async function traced<T>(db:D1Database,kind:TraceKind,detail:string,run:()=>Promise<T>,describe:(out:T)=>string):Promise<T> {
  const id=await startTrace(db,kind,detail);
  try {const output=await run();await finishTrace(db,id,"completed",describe(output));return output;}
  catch(e) {await finishTrace(db,id,"failed",e instanceof Error?e.message:String(e));throw e;}
}
export async function recentTrace(db:D1Database) {
  const result=await db.prepare(`SELECT id,started_at,finished_at,kind,status,detail,result,metadata
    FROM action_trace ORDER BY id DESC LIMIT 24`).all<{
      id:number;started_at:string;finished_at:string|null;kind:TraceKind;
      status:string;detail:string;result:string|null;metadata:string|null
    }>();
  return result.results.map(({metadata,...row})=>({...row,metadata:metadata?JSON.parse(metadata):null}));
}
