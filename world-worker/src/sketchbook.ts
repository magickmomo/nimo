/** A genuine, editable vector sketchbook: the model selects its own strokes.
 * No AI image endpoint and no generated SVG/HTML are accepted.
 */
export type SketchStroke={points:[number,number][];color:string;width:number};
export type Sketch={id:number;title:string;intention:string;status:"drawing"|"finished"|"abandoned";strokes_json:string;stroke_count:number;created_at:string;updated_at:string;finished_at:string|null};
const CANVAS_WIDTH=240,CANVAS_HEIGHT=180;
export function validateStrokes(value:unknown):SketchStroke[]{
 if(!Array.isArray(value)||value.length<1||value.length>8)throw Error("Draw 1–8 strokes per action");
 return value.map((raw:unknown)=>{
  if(!raw||typeof raw!=="object"||Array.isArray(raw))throw Error("Invalid stroke");
  const s=raw as Record<string,unknown>;
  if(!Array.isArray(s.points)||s.points.length<2||s.points.length>24)throw Error("Each stroke needs 2–24 points");
  const points=s.points.map((p:unknown)=>{
   if(!Array.isArray(p)||p.length!==2||!p.every(n=>typeof n==="number"&&Number.isInteger(n)&&n>=0&&n<=240))
    throw Error("Invalid stroke coordinates");
   if(p[1]>CANVAS_HEIGHT)throw Error("Y coordinate outside canvas");
   return [p[0],p[1]] as [number,number];
  });
  if(typeof s.color!=="string"||!/^#[0-9a-fA-F]{6}$/.test(s.color))throw Error("Colour must be #RRGGBB");
  if(typeof s.width!=="number"||!Number.isInteger(s.width)||s.width<1||s.width>8)throw Error("Pencil width must be 1–8");
  return {points,color:s.color.toLowerCase(),width:s.width};
 });
}
export async function sketchbookSnapshot(db:D1Database,includeDrawings=false){
 const owned=await db.prepare("SELECT owned_at FROM nimo_sketchbook WHERE id=1").first<{owned_at:string}>();
 if(!owned)return {owned:false,drawings:[],active:null};
 const result=await db.prepare(`SELECT id,title,intention,status,strokes_json,stroke_count,created_at,updated_at,finished_at
 FROM nimo_sketches ORDER BY updated_at DESC LIMIT 60`).all<Sketch>();
 const drawings=result.results.map(s=>({...s,strokes:includeDrawings?JSON.parse(s.strokes_json) as SketchStroke[]:undefined,strokes_json:undefined}));
 return {owned:true,ownedAt:owned.owned_at,drawings,active:drawings.find(s=>s.status==="drawing")??null};
}
export async function buySketchbook(db:D1Database,sourceKey:string){
 const existing=await db.prepare("SELECT owned_at FROM nimo_sketchbook WHERE id=1").first();
 if(existing)return "Already own the sketchbook; no coins deducted";
 const state=await db.prepare("SELECT coins,inspected_at FROM vending_state WHERE id=1").first<{coins:number;inspected_at:string|null}>();
 if(!state?.inspected_at)throw Error("Inspect the vending machine first");
 if(state.coins<3)throw Error("Sketchbook costs 3 coins");
 const result=await db.batch([
  db.prepare(`INSERT OR IGNORE INTO nimo_sketchbook(id,owned_at,purchase_key)
    SELECT 1,strftime('%Y-%m-%dT%H:%M:%fZ','now'),?
    WHERE (SELECT coins FROM vending_state WHERE id=1)>=3`).bind(sourceKey),
  db.prepare("UPDATE vending_state SET coins=coins-3 WHERE id=1 AND coins>=3 AND changes()=1")
 ]);
 if(result[0].meta.changes!==1||result[1].meta.changes!==1)throw Error("Sketchbook purchase conflict");
 return "Bought a sketchbook for 3 coins. You can now plan and draw your own art.";
}
export async function beginSketch(db:D1Database,title:string,intention:string){
 if(!title.trim()||!intention.trim()||title.length>100||intention.length>300)throw Error("Sketch title and intention required");
 if(!(await db.prepare("SELECT id FROM nimo_sketchbook WHERE id=1").first()))throw Error("Sketchbook not owned");
 if(await db.prepare("SELECT id FROM nimo_sketches WHERE status='drawing'").first())throw Error("Finish or abandon the current sketch first");
 const result=await db.prepare("INSERT INTO nimo_sketches(title,intention) VALUES(?,?)")
  .bind(title.trim(),intention.trim()).run();
 if(result.meta.changes!==1)throw Error("Could not create sketch");
 return "Started sketch: "+title.trim()+". Intention: "+intention.trim();
}
export async function drawStrokes(db:D1Database,sketchId:number,input:unknown){
 if(!Number.isSafeInteger(sketchId)||sketchId<1)throw Error("Invalid sketch");
 const strokes=validateStrokes(input);
 const current=await db.prepare("SELECT id,strokes_json,stroke_count FROM nimo_sketches WHERE id=? AND status='drawing'")
  .bind(sketchId).first<Pick<Sketch,"id"|"strokes_json"|"stroke_count">>();
 if(!current)throw Error("Sketch not active");
 if(current.stroke_count+strokes.length>160)throw Error("Sketch limit of 160 strokes reached; finish or abandon");
 const combined=[...(JSON.parse(current.strokes_json) as SketchStroke[]),...strokes];
 const result=await db.prepare(`UPDATE nimo_sketches SET strokes_json=?,stroke_count=?,
 updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='drawing' AND stroke_count=?`)
 .bind(JSON.stringify(combined),combined.length,sketchId,current.stroke_count).run();
 if(result.meta.changes!==1)throw Error("Sketch changed; retry with current version");
 return "Added "+strokes.length+" pencil strokes to sketch #"+sketchId+"; total "+combined.length+".";
}
export async function closeSketch(db:D1Database,id:number,status:"finished"|"abandoned"){
 if(!Number.isSafeInteger(id)||id<1)throw Error("Invalid sketch ID");
 const result=await db.prepare(`UPDATE nimo_sketches SET status=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
 finished_at=CASE WHEN ?='finished' THEN strftime('%Y-%m-%dT%H:%M:%fZ','now') ELSE NULL END
 WHERE id=? AND status='drawing' AND (stroke_count>0 OR ?='abandoned')`).bind(status,status,id,status).run();
 if(result.meta.changes!==1)throw Error("No active nonempty sketch to finish; abandon blank pages");
 return status==="finished"?"Finished drawing #"+id:"Abandoned sketch #"+id;
}
