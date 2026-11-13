export type Project={
 id:number;title:string;objective:string;next_step:string;progress_note:string;
 status:"active"|"paused"|"completed"|"abandoned";created_at:string;updated_at:string;
 completed_at:string|null;
};
export async function projectList(db:D1Database){
 const r=await db.prepare(`SELECT id,title,objective,next_step,progress_note,status,
   created_at,updated_at,completed_at FROM nimo_projects ORDER BY
   CASE WHEN status='active' THEN 0 WHEN status='paused' THEN 1 ELSE 2 END,
   updated_at DESC LIMIT 30`).all<Project>();
 return r.results;
}
export async function createProject(db:D1Database,title:string,objective:string,nextStep:string){
 if(!title.trim()||!objective.trim()||!nextStep.trim())throw Error("Project details required");
 const count=await db.prepare("SELECT COUNT(*) AS n FROM nimo_projects WHERE status IN ('active','paused')").first<{n:number}>();
 if((count?.n??0)>=3)throw Error("Maximum three unfinished projects. Finish or abandon an existing one first");
 await db.prepare("INSERT INTO nimo_projects(title,objective,next_step) VALUES(?,?,?)")
  .bind(title.slice(0,100),objective.slice(0,400),nextStep.slice(0,300)).run();
 return "Created project: "+title.slice(0,100);
}
export async function updateProject(db:D1Database,id:number,nextStep:string,progressNote:string,status:Project["status"]){
 if(!Number.isSafeInteger(id)||id<1||!["active","paused","completed","abandoned"].includes(status))
  throw Error("Invalid project update");
 const prior=await db.prepare("SELECT id,status FROM nimo_projects WHERE id=?").bind(id).first<{id:number;status:string}>();
 if(!prior)throw Error("Project not found");
 if(["completed","abandoned"].includes(prior.status))throw Error("Closed project cannot be changed");
 if(status==="active" && prior.status==="paused"){
  const count=await db.prepare("SELECT COUNT(*) AS n FROM nimo_projects WHERE status='active'").first<{n:number}>();
  if((count?.n??0)>=3)throw Error("Too many active projects");
 }
 await db.prepare(`UPDATE nimo_projects SET next_step=?,progress_note=?,status=?,
   updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
   completed_at=CASE WHEN ? IN ('completed','abandoned')
     THEN strftime('%Y-%m-%dT%H:%M:%fZ','now') ELSE NULL END WHERE id=?`)
 .bind(nextStep.slice(0,300),progressNote.slice(0,500),status,status,id).run();
 return "Updated project #"+id+" to "+status;
}
