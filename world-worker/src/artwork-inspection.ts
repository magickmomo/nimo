import type {SketchStroke} from "./sketchbook";

export const ARTWORK_INSPECTION_COST=10;
export const ARTWORK_INSPECTION_MODEL="gpt-4.1-mini";
const WIDTH=240,HEIGHT=180;
export const ARTWORK_CLAIM_LEASE_MS=120_000;

function u32(value:number){return Uint8Array.of((value>>>24)&255,(value>>>16)&255,(value>>>8)&255,value&255);}
function join(parts:readonly Uint8Array[]){const out=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let i=0;for(const p of parts){out.set(p,i);i+=p.length;}return out;}
function crc32(input:Uint8Array){let c=0xffffffff;for(const b of input){c^=b;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return(c^0xffffffff)>>>0;}
function chunk(type:string,data:Uint8Array){const label=new TextEncoder().encode(type);return join([u32(data.length),label,data,u32(crc32(join([label,data])))]);}
function brush(pixels:Uint8Array,x:number,y:number,width:number,r:number,g:number,b:number){
 const radius=Math.max(.5,width/2);
 for(let py=Math.floor(y-radius);py<=Math.ceil(y+radius);py++){
  if(py<0||py>=HEIGHT)continue;
  for(let px=Math.floor(x-radius);px<=Math.ceil(x+radius);px++){
   if(px<0||px>=WIDTH||(px-x)**2+(py-y)**2>(radius+.25)**2)continue;
   const at=(py*WIDTH+px)*4;pixels[at]=r;pixels[at+1]=g;pixels[at+2]=b;
  }
 }
}
/** Rasterize the saved polyline exactly as an image, not as text for the vision model. */
export async function artworkPng(strokes:readonly SketchStroke[]):Promise<Uint8Array>{
 const pixels=new Uint8Array(WIDTH*HEIGHT*4);
 for(let i=0;i<pixels.length;i+=4){pixels[i]=250;pixels[i+1]=245;pixels[i+2]=233;pixels[i+3]=255;}
 for(const stroke of strokes){
  if(!/^#[0-9a-f]{6}$/i.test(stroke.color))continue;
  const r=parseInt(stroke.color.slice(1,3),16),g=parseInt(stroke.color.slice(3,5),16),b=parseInt(stroke.color.slice(5,7),16);
  for(let i=1;i<stroke.points.length;i++){
   const [ax,ay]=stroke.points[i-1],[bx,by]=stroke.points[i];
   const steps=Math.max(1,Math.ceil(Math.hypot(bx-ax,by-ay)*2));
   for(let t=0;t<=steps;t++)brush(pixels,ax+(bx-ax)*t/steps,ay+(by-ay)*t/steps,stroke.width,r,g,b);
  }
 }
 const raw=new Uint8Array(HEIGHT*(1+WIDTH*4));
 for(let y=0;y<HEIGHT;y++)raw.set(pixels.subarray(y*WIDTH*4,(y+1)*WIDTH*4),y*(WIDTH*4+1)+1);
 const stream=new Blob([raw]).stream().pipeThrough(new CompressionStream("deflate"));
 const compressed=new Uint8Array(await new Response(stream).arrayBuffer());
 const ihdr=join([u32(WIDTH),u32(HEIGHT),Uint8Array.of(8,6,0,0,0)]);
 return join([Uint8Array.of(137,80,78,71,13,10,26,10),chunk("IHDR",ihdr),chunk("IDAT",compressed),chunk("IEND",new Uint8Array())]);
}
function base64(bytes:Uint8Array){let raw="";for(let i=0;i<bytes.length;i+=8192)raw+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(raw);}
function responseText(data:unknown){
 const d=data as {output?:{content?:{type?:string;text?:string}[]}[]};
 return (d.output??[]).flatMap(o=>o.content??[]).filter(c=>c.type==="output_text").map(c=>c.text??"").join("\n").trim().slice(0,1600);
}
/** One paid visual inspection per finished drawing. A failed call refunds the charge. */
export async function inspectArtwork(env:{DB:D1Database;OPENAI_API_KEY:string;ARTWORK_VISION_MODEL?:string},sketchId:number){
 const db=env.DB;
 if(!Number.isSafeInteger(sketchId)||sketchId<1)throw Error("Invalid sketch ID");
 const sketch=await db.prepare("SELECT id,title,intention,status,strokes_json FROM nimo_sketches WHERE id=? AND status='finished'")
  .bind(sketchId).first<{id:number;title:string;intention:string;status:string;strokes_json:string}>();
 if(!sketch)throw Error("Only finished drawings can be inspected");
 // A prior Worker may have died after taking coins. Recover a claim only after
 // its lease expires, refunding once in the same D1 transaction. A late owner
 // cannot complete or refund a replacement claim because each attempt has a token.
 const recovered=await db.batch([
  db.prepare(`UPDATE nimo_artwork_inspections SET status='failed',
     error='Inspection lease expired; coins refunded',expires_at=NULL
     WHERE sketch_id=? AND status='pending' AND expires_at<=?`)
   .bind(sketchId,new Date().toISOString()),
  db.prepare("UPDATE vending_state SET coins=coins+? WHERE id=1 AND changes()=1")
   .bind(ARTWORK_INSPECTION_COST),
 ]);
 // The refund statement is contingent on precisely one successful expiry claim.
 if(recovered[0].meta.changes!==recovered[1].meta.changes)
  throw Error("Could not reconcile an expired inspection claim");
 const saved=await db.prepare("SELECT status,description FROM nimo_artwork_inspections WHERE sketch_id=?").bind(sketchId)
  .first<{status:string;description:string|null}>();
 if(saved?.status==="completed")return "Drawing #"+sketchId+" was already inspected: "+saved.description;
 if(saved?.status==="pending")throw Error("A visual inspection is already underway for this drawing");
 const claimToken=crypto.randomUUID();
 const expiresAt=new Date(Date.now()+ARTWORK_CLAIM_LEASE_MS).toISOString();
 // Both statements in a D1 batch execute transactionally. The debit depends on
 // the insertion/update succeeding, so a refused claim never charges coins.
 const claim=await db.batch([
  db.prepare(`INSERT INTO nimo_artwork_inspections(sketch_id,status,claim_token,expires_at)
    SELECT ?,'pending',?,? WHERE EXISTS(SELECT 1 FROM nimo_sketches WHERE id=? AND status='finished')
      AND (SELECT coins FROM vending_state WHERE id=1)>=?
    ON CONFLICT(sketch_id) DO UPDATE SET status='pending',claim_token=excluded.claim_token,
      expires_at=excluded.expires_at,description=NULL,error=NULL,inspected_at=NULL
      WHERE nimo_artwork_inspections.status='failed'
        AND (SELECT coins FROM vending_state WHERE id=1)>=?`)
     .bind(sketchId,claimToken,expiresAt,sketchId,ARTWORK_INSPECTION_COST,ARTWORK_INSPECTION_COST),
  db.prepare("UPDATE vending_state SET coins=coins-? WHERE id=1 AND coins>=? AND changes()=1")
   .bind(ARTWORK_INSPECTION_COST,ARTWORK_INSPECTION_COST)
 ]);
 if(claim[0].meta.changes!==1||claim[1].meta.changes!==1)
  throw Error("Inspection unavailable: already in progress or requires 10 coins");
 try{
  const strokes=JSON.parse(sketch.strokes_json) as SketchStroke[];
  const png=await artworkPng(strokes);
  const res=await fetch("https://api.openai.com/v1/responses",{
   method:"POST",headers:{Authorization:"Bearer "+env.OPENAI_API_KEY,"Content-Type":"application/json"},
   body:JSON.stringify({
    model:env.ARTWORK_VISION_MODEL||ARTWORK_INSPECTION_MODEL,
    max_output_tokens:550,
    input:[{role:"system",content:"You are an objective visual observer for a simple digital drawing. Describe only what is actually visible in the attached image: lines, shapes, arrangements, colors, and possible visual impression. Do not invent objects that are not visible. Compare with the artist's intention carefully and say plainly where it does or does not seem evident. Do not decide whether the art is good or bad. Respond in under 180 words."},
     {role:"user",content:[{type:"input_text",text:"Title: "+sketch.title+"\nArtist intention: "+sketch.intention+"\nPlease examine the actual image and provide visual feedback."},
       {type:"input_image",image_url:"data:image/png;base64,"+base64(png),detail:"high"}]}]
   }),signal:AbortSignal.timeout(45000)
  });
  if(!res.ok)throw Error("Vision API HTTP "+res.status+": "+(await res.text()).slice(0,200));
  const description=responseText(await res.json());
  if(!description)throw Error("Vision model returned no description");
  const update=await db.prepare(`UPDATE nimo_artwork_inspections SET status='completed',description=?,
    expires_at=NULL,inspected_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE sketch_id=? AND status='pending' AND claim_token=? AND expires_at>?`)
   .bind(description,sketchId,claimToken,new Date().toISOString()).run();
  if(update.meta.changes!==1)throw Error("Inspection lease expired or superseded; visual result discarded");
  return "VISUAL INSPECTION OF #"+sketchId+" (10 coins spent): "+description;
 }catch(error){
  // Only the owner of the current pending token can refund it. A stale
  // invocation must not interfere with a newer claim or double-credit coins.
  // If this transaction cannot complete, the expiring claim remains recoverable.
  try {
   const refund=await db.batch([
    db.prepare(`UPDATE nimo_artwork_inspections SET status='failed',expires_at=NULL,error=?
       WHERE sketch_id=? AND status='pending' AND claim_token=?`)
     .bind(String(error).slice(0,300),sketchId,claimToken),
    db.prepare("UPDATE vending_state SET coins=coins+? WHERE id=1 AND changes()=1")
     .bind(ARTWORK_INSPECTION_COST)
   ]);
   if(refund[0].meta.changes!==refund[1].meta.changes)
    throw Error("Artwork inspection refund reconciliation failed");
  } catch(refundError) {
   console.error("Artwork refund failed; expiring claim will allow recovery",refundError);
  }
  throw error;
 }
}
