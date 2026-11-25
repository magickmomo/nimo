/**
 * World 004 autonomous decision adapter.
 *
 * Select using Strategy E on a compact view of the *current* Worker inputs,
 * then generate a legacy-compatible structured Decision for the existing,
 * authoritative World 003 executor. No additional D1/R2 reads or writes.
 *
 * Rollout is gated by WORLD_004_MODE and WORLD_004_ENABLED in index.ts.
 */
import {validateDecision,type Decision} from "./decision-schema";

type R=Record<string,unknown>;
type Message={role:string;content:string};
type Selection={id:string;description:string;tool:string|null};
const asObj=(x:unknown):R=>x&&typeof x==="object"&&!Array.isArray(x)?x as R:{};
const rows=(x:unknown):R[]=>Array.isArray(x)?x.filter(v=>v&&typeof v==="object"&&!Array.isArray(v)) as R[]:[];
const clip=(x:unknown,n=180)=>typeof x==="string"?x.slice(0,n):"";
const tokenSet=(value:string)=>new Set((value.toLowerCase().match(/[a-z]{4,}/g)??[]).filter(x=>!["about","that","this","with","from","into","have","been","will"].includes(x)));
const score=(haystack:string,terms:Set<string>)=>{let n=0;const v=haystack.toLowerCase();for(const t of terms)if(v.includes(t))n++;return n;};

/** A deliberately lean, deterministic Strategy E view. Original factual world context
 * remains available ONLY to the selected-action generation handoff. */
export function world004Context(w:R){
 const state=asObj(w.state),p=asObj(w.perception),food=asObj(w.food),garden=asObj(w.garden);
 const exp=asObj(w.experience),sketch=asObj(w.sketchbook);
 const recent=rows(exp.recentEvents).slice(0,5);
 const goal=clip(state.currentGoal,250);
 const terms=tokenSet([goal,clip(state.currentActivity),...rows(p.visibleObjects).map(o=>clip(o.type))].join(" "));
 const ranked=rows(w.consolidatedMemories).map((m,i)=>({m,i,rank:score(clip(m.subject)+" "+clip(m.statement,500),terms)}))
  .sort((a,b)=>b.rank-a.rank||a.i-b.i);
 const memories=ranked.slice(0,5).map(({m})=>({subject:m.subject,statement:clip(m.statement,240),confidence:m.confidence,status:m.status}));
 const projects=rows(w.projects).filter(q=>q.status==="active"||q.status==="paused").slice(0,4)
  .map(q=>({id:q.id,title:clip(q.title,100),status:q.status,nextStep:clip(q.next_step,170)}));
 const latestVerified=recent.find(e=>e.kind==="tool")??null;
 return {
  self:{identity:clip(state.identity,260),currentIntention:goal?{description:goal,directive:false}:null,
   currentActivity:clip(state.currentActivity),pendingIntent:state.pendingIntent??null,needs:w.needsPercent},
  present:{position:asObj(p.position),directions:rows(p.directions).map(d=>({direction:d.direction,canMove:d.canMove,canInspect:d.canInspect})),
   visibleObjects:rows(p.visibleObjects).map(o=>({id:o.id,type:o.type,position:o.position,distance:o.distance})),
   wildflowers:rows(p.wildflowers).map(o=>({id:o.id,x:o.x,y:o.y,blooms:o.blooms,directlyAdjacent:o.directlyAdjacent})),
   inventory:{fruit:rows(food.inventory).map(x=>x.fruit),other:rows(garden.inventory).map(x=>x.kind),
    coins:garden.coins??null,used:garden.inventoryUsed,capacity:garden.capacity}},
  continuity:{projects,memories,unfinishedSketch:sketch.active?{id:asObj(sketch.active).id,title:asObj(sketch.active).title}:null,
   recentExperience:recent.map(e=>({kind:e.kind,action:e.action,content:clip(e.content,170)})),
   lastVerifiedOutcome:latestVerified?{action:latestVerified.action,description:clip(latestVerified.content,170)}:null},
  adaptiveKnowledge:{retrieval:"Relevant memories, unfinished work, and verified recent events. No forced activity diversification."},
  availableActions:rows(w.availableActions).map(o=>({...o})),
  visitorMessage:w.pendingVisitorMessage??null,
 };
}

export function world004Choices(w:R,hasVisitor:boolean):Selection[]{
 if(hasVisitor)return [{id:"reply",description:"Reply to the waiting visitor; no tool execution.",tool:null}];
 const actions:Selection[]=[
  {id:"observe",description:"Observe the current surroundings.",tool:null},
  {id:"think",description:"Reflect, reconsider or change a goal.",tool:null},
  {id:"request",description:"Ask the creator for help, or request a capability.",tool:null}
 ];
 for(const a of rows(w.availableActions)){
  const name=a.name;
  if(typeof name!=="string"||!/^[a-z_]{2,50}$/.test(name))continue;
  const targets=Object.entries(a).filter(([k,v])=>k!=="name"&&Array.isArray(v))
   .map(([k,v])=>k+": "+JSON.stringify(v).slice(0,230)).join("; ");
  actions.push({id:name,tool:name,description:"Use available "+name+" action"+(targets?"; eligible "+targets:"")});
 }
 if(actions.length>255)throw Error("World 004 action list exceeds 255 choices");
 return actions;
}

export function world004ActionMatches(choice:Selection,decision:Decision):boolean{
 if(choice.tool)return decision.action==="ACT"&&decision.toolCall?.name===choice.tool;
 if(choice.id==="reply")return decision.action==="REPLY"&&decision.toolCall===null;
 if(choice.id==="request")return decision.action==="REQUEST"&&decision.toolCall===null;
 if(choice.id==="observe")return decision.action==="OBSERVE"&&decision.toolCall===null;
 return choice.id==="think"&&decision.action==="THINK"&&decision.toolCall===null;
}

type Args={
 apiKey:string; model:string; originalMessages:Message[]; responseFormat:R; hasVisitor:boolean;
 onUsage:(usage:Record<string,number>)=>void; onRequest:(payload:unknown)=>void;
 onSelection:(stage:{request:unknown;response:unknown;selectedAction:string|null;durationMs:number})=>void;
};
const usageOf=(r:R)=>{const u=asObj(r.usage);const cached=asObj(u.input_tokens_details);
 return {input_tokens:Number(u.input_tokens??0),cached_input_tokens:Number(cached.cached_tokens??0),output_tokens:Number(u.output_tokens??0)};
};
const responseText=(r:R)=>rows(r.output).flatMap(o=>rows(o.content))
 .filter(t=>t.type==="output_text").map(t=>clip(t.text,10000)).join("");

export async function decideWorld004(args:Args):Promise<Decision>{
 const source=args.originalMessages.find(m=>m.role==="user"&&m.content.trim().startsWith("{"));
 if(!source)throw Error("World 004 current world context is absent");
 const world=asObj(JSON.parse(source.content));
 const options=world004Choices(world,args.hasVisitor);
 const context=world004Context(world);
 const selectionPayload={
  model:args.model,
  input:[
   {role:"developer",content:[{type:"input_text",text:"You are Nimo. Choose independently from the actual available world actions. Do not optimise for variety, productivity or a particular outcome. Keep verified events distinct from guesses. Existing goals are optional and may be revised."}]},
   {role:"user",content:[{type:"input_json",data:context}]}
  ],
  questions:[{type:"choice",name:"next_action",instructions:"Choose one next action based on current interests, needs, verified world state, and real executable choices. Only offered actions may execute.",choices:options.map(o=>({value:o.id,description:o.description}))}]
 };
 const selectionStarted=Date.now();
 const selected=await fetch("https://api.openai.com/v1/decisions",{
  method:"POST",headers:{Authorization:"Bearer "+args.apiKey,"Content-Type":"application/json"},
  body:JSON.stringify(selectionPayload),signal:AbortSignal.timeout(25000)
 });
 const choiceResponse=asObj(await selected.json());
 if(!selected.ok)throw Error("World 004 selection API returned HTTP "+selected.status+": "+clip(asObj(choiceResponse.error).message,150));
 const rawChoice=rows(choiceResponse.answers).find(x=>x.name==="next_action");
 const id=rawChoice?.type==="choice"?rawChoice.choice:null;
 args.onSelection({request:selectionPayload,response:choiceResponse,selectedAction:typeof id==="string"?id:null,durationMs:Date.now()-selectionStarted});
 const choice=options.find(o=>o.id===id);
 if(!choice)throw Error("World 004 selector returned invalid choice");
 const selectionUsage=usageOf(choiceResponse);
 // Existing real-world output schema and validator remain authoritative.
 // This is a structured generation step, not a second unconstrained selection.
 const generationPayload={
  model:args.model,
  input:[...args.originalMessages,{
   role:"developer",
   content:"World 004 has selected this action: "+choice.id+
    ". Generate ONLY the selected decision's required compatible fields, plus a concise public monologue, activity, goal, identityUpdate:null, replyIntent and intentDisposition. "+
    (choice.tool?"The ACT toolCall.name MUST be exactly "+choice.tool+".":"This is a non-tool "+choice.id+" action. toolCall MUST be null.")+
    " Obey the actual availableActions list. Do not invent outcomes or change the selection."
  }],
  reasoning:{effort:"low"},
  max_output_tokens:4000,
  text:{format:{...asObj(asObj(args.responseFormat).json_schema),type:"json_schema"}},
 };
 args.onRequest(generationPayload);
 const generated=await fetch("https://api.openai.com/v1/responses",{
  method:"POST",headers:{Authorization:"Bearer "+args.apiKey,"Content-Type":"application/json"},
  body:JSON.stringify(generationPayload),signal:AbortSignal.timeout(60000)
 });
 const genResponse=asObj(await generated.json());
 const generationUsage=usageOf(genResponse);
 args.onUsage({input_tokens:selectionUsage.input_tokens+generationUsage.input_tokens,
  cached_input_tokens:selectionUsage.cached_input_tokens+generationUsage.cached_input_tokens,
  output_tokens:selectionUsage.output_tokens+generationUsage.output_tokens});
 if(!generated.ok)throw Error("World 004 generator returned HTTP "+generated.status+": "+clip(asObj(genResponse.error).message,150));
 const raw=responseText(genResponse);
 if(!raw)throw Error("World 004 generation returned empty output");
 const result=validateDecision(JSON.parse(raw),args.hasVisitor);
 if(!world004ActionMatches(choice,result))throw Error("World 004 generation diverged from selected choice: "+choice.id);
 return result;
}
