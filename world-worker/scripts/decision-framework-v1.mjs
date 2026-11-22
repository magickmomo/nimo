#!/usr/bin/env node
/**
 * Nimo Framework V1 — offline, read-only two-stage decision simulator.
 * Replay archived inputs. NEVER contacts OpenAI, D1, R2 or the live world.
 */
import {readFileSync,writeFileSync,mkdirSync} from "node:fs";
import {resolve,join} from "node:path";
import {buildFrameworkTrace,writeFrameworkTrace} from "./decision-framework-trace.mjs";

export const IDENTITY = [
  "You are Nimo, an autonomous agent living in a persistent digital world.",
  "You have your own memories, experiences, interests and goals. You are free to explore, create, learn, communicate, rest or change direction.",
  "Your world changes over time. Your actions have consequences, and you can learn from their outcomes.",
  "You receive information about your surroundings, memories and available capabilities. Choose what you want to do based on what matters to you.",
  "You are not obligated to be productive, follow an existing goal or entertain anyone.",
  "You may form new goals, reconsider old ones and request capabilities when you encounter limitations.",
  "Choose an available action or decide to do nothing. Your environment will execute valid actions and report their results.",
  "Distinguish observed outcomes from assumptions. The environment validates and executes actions."
].join("\n\n");

const list=x=>Array.isArray(x)?x:[];
const str=(x,max=180)=>typeof x==="string"?x.slice(0,max):"";
const asObject=x=>x&&typeof x==="object"&&!Array.isArray(x)?x:{};
const serialize=x=>JSON.stringify(x);
const candidate=(id,description,toolCall=null,task=null)=>({id,description,toolCall,task});
const sortedUniq=a=>[...new Set(a)];
const generations=new Set(["write_document","remember_object","start_sketch","draw_strokes","create_project","update_project","ask_oracle","expand_world"]);

function snapshot(record) {
 const input=record?.request?.input;
 if(!Array.isArray(input))throw Error("Expected archived Responses request input");
 const user=input.find(m=>m.role==="user"&&typeof m.content==="string"&&m.content.startsWith("{"));
 if(!user)throw Error("Archive has no parseable world context");
 return {data:JSON.parse(user.content),visitor:input.find(m=>m.role==="user"&&m!==user)?.content??null};
}

function memorySelection(items,state){
 const words=sortedUniq(((str(state.currentGoal,250)+" "+str(state.currentActivity,120)).toLowerCase().match(/[a-z]{5,}/g)??[]));
 const scored=list(items).map((m,i)=>({m,i,score:words.filter(w=>(String(m.subject??"")+" "+String(m.statement??"")).toLowerCase().includes(w)).length}));
 const relevant=scored.filter(x=>x.score>0).sort((a,b)=>b.score-a.score||a.i-b.i).slice(0,2);
 const other=scored.filter(x=>!relevant.includes(x));
 const diverse=[];const seen=new Set();
 for(const x of other){
  const category=String(x.m.subject??"").split(":")[0];
  if(!seen.has(category)){diverse.push(x);seen.add(category);}
  if(diverse.length===3)break;
 }
 for(const x of other){if(diverse.length===3)break;if(!diverse.includes(x))diverse.push(x);}
 return [...relevant,...diverse].map(({m})=>({
  subject:m.subject,statement:m.statement,confidence:m.confidence,status:m.status
 }));
}

function experienceContext(ex){
 const events=list(ex.recentEvents);
 const reflection=events.find(e=>e.kind==="thought"||e.action==="THINK");
 const outcome=events.find(e=>e.kind==="tool");
 return {
  lastReflection:reflection?{when:reflection.when??null,content:reflection.content}:null,
  lastVerifiedOutcome:outcome?{when:outcome.when??null,action:outcome.action,description:outcome.content,source:"recorded_tool_event"}:null
 };
}

function goalContext(s,experience){
 const reflection=String(experience.lastReflection?.content??"").toLowerCase();
 const reportsEnough=/(enough for now|walk is enough|walk end|already (beside|at|reached))/.test(reflection);
 return s.currentGoal?{
  description:s.currentGoal,
  status:"unverified",
  possibleCompletion:reportsEnough?{source:"latest_reflection",note:"Nimo's last reflection suggests this intention may already be satisfied; this is not a verified completion."}:null,
  directive:false
 }:null;
}

export function buildChoices(data,visitor=null) {
 if(visitor || data.state?.pendingVisitor) return [candidate("reply_to_visitor","Respond to the waiting visitor; generate a natural reply.",null,"reply")];
 const offers=list(data.availableActions);
 const choices=[candidate("idle","Remain still without a new task."),candidate("observe","Observe the surroundings without changing the world."),candidate("reflect","Think freely, reconsider an interest or goal, or write a short reflection.",null,"reflect"),candidate("request_capability","Ask the creator for a capability or clarification if Nimo wishes.",null,"request")];
 const add=(id,description,call,task=null)=>choices.push(candidate(id,description,call,task));
 for(const a of offers){
  const name=a.name;
  if(!name)continue;
  if(generations.has(name)){
   if(name==="update_project"){
    for(const id of list(a.projectIds)) add("update_project:"+id,"Reconsider or update project "+id+".",null,{name,projectId:id});
   } else if(name==="draw_strokes"){
    for(const id of list(a.sketchIds))add("draw_strokes:"+id,"Continue original pencil drawing "+id+".",null,{name,sketchId:id});
   } else if(name==="remember_object"){
    // Do not enumerate every known object every tick. A generative handoff can choose
    // an ID from the currently allowed list.
    if(list(a.objectIds).length)add("remember_object","Write or revise a personal note on a known object.",null,{name,eligibleObjectIds:a.objectIds});
   } else add(name,{
    write_document:"Write or revise a document in the workspace.",
    start_sketch:"Begin a new original sketch.",
    create_project:"Invent a new project or intention.",
    ask_oracle:"Formulate a question to the Oracle.",
    expand_world:"Propose a change to your world for creator review."
   }[name]??name,null,{name});
  }else if(name==="travel_to"){
   for(const d of list(data.perception?.directions)){
    if(d.canMove&&Number.isInteger(d.destination?.x)&&Number.isInteger(d.destination?.y)){
     const {x,y}=d.destination;
     add("travel:"+d.direction,"Move "+d.direction+" one tile to ("+x+","+y+").",{name:"travel_to",x,y});
    }
   }
  }else if(name==="inspect"){
   for(const direction of list(a.directions))
    add("inspect:"+direction,"Inspect the adjacent object to the "+direction+".",{name,direction});
  }else if(name==="pick_fruit"){
   for(const treeId of list(a.treeIds))add("pick:"+treeId,"Pick fruit from "+treeId+".",{name,treeId});
  }else if(name==="pick_flowers"){
   for(const patchId of list(a.patchIds))add("pick_flowers:"+patchId,"Pick flowers from "+patchId+".",{name,patchId});
  }else if(name==="plant_wildflower_seed"){
   for(const direction of list(a.directions))add("plant_flower:"+direction,"Plant wildflowers "+direction+".",{name,direction});
  }else if(name==="discard_wildflower"){
   for(const kind of list(a.kinds))add("discard:"+kind,"Discard carried "+kind+".",{name,kind});
  }else if(name==="eat_fruit"||name==="discard_fruit"){
   for(const fruit of list(a.fruits))add(name+":"+fruit,(name==="eat_fruit"?"Eat ":"Discard ")+fruit+" fruit.",{name,fruit});
  }else if(name==="buy_item"){
   for(const itemId of list(a.itemIds))add("buy:"+itemId,"Buy "+itemId+".",{name,itemId});
  }else if(name==="inspect_artwork"){
   for(const sketchId of list(a.sketchIds))add("inspect_artwork:"+sketchId,"Inspect completed artwork "+sketchId+".",{name,sketchId});
  }else if(name==="finish_sketch"){
   for(const sketchId of list(a.sketchIds)){
    add("finish_sketch:"+sketchId,"Finish sketch "+sketchId+".",{name,sketchId,status:"finished"});
    add("abandon_sketch:"+sketchId,"Abandon sketch "+sketchId+".",{name,sketchId,status:"abandoned"});
   }
  }else if(name==="plant_seed"||name==="water_plot"||name==="harvest_crop"){
   for(const plotId of list(a.plotIds))add(name+":"+plotId,name+" on "+plotId+".",{name,plotId});
  }else if(name==="sell_item"){
   for(const item of list(a.items))add("sell:"+item,"Sell "+item+".",{name,item});
  }else if(["rest","take_can","fill_can"].includes(name)){
   add(name,{rest:"Rest at the garden nook.",take_can:"Take the watering can.",fill_can:"Refill the watering can."}[name],{name});
  }
 }
 // Stable unique IDs. Choices are bounded by the Decisions API max of 255.
 const unique=[...new Map(choices.map(c=>[c.id,c])).values()];
 if(unique.length>255)throw Error("Too many choices; add grouping before using Decisions");
 return unique;
}

function contextFor(data,visitor,feedback=null){
 const s=asObject(data.state),p=asObject(data.perception),ex=asObject(data.experience),g=asObject(data.garden),f=asObject(data.food),sk=asObject(data.sketchbook);
 const experience=experienceContext(ex);
 const visible=list(p.visibleObjects).map(o=>({id:o.id,type:o.type,position:o.position,distance:o.distance}));
 const plots=list(g.plots).map(o=>({id:o.id,position:{x:o.x,y:o.y},stage:o.stage,ready:o.ready}));
 const wildflowers=list(p.wildflowers).map(o=>({id:o.id,type:"wildflower_patch",position:{x:o.x,y:o.y},blooms:o.blooms,directlyAdjacent:o.directlyAdjacent??false,description:o.description??null}));
 const projects=list(data.projects).filter(x=>["active","paused"].includes(x.status)).slice(0,5).map(x=>({id:x.id,title:x.title,status:x.status,nextStep:x.next_step??x.nextStep??null}));
 const requests=list(data.creatorRequests).filter(x=>["pending","open","acknowledged","accepted"].includes(x.status)).slice(0,3).map(x=>({id:x.id,status:x.status,description:x.content}));
 const capabilities=list(data.capabilityCatalogue).map(c=>({name:c.action,availableNow:c.availableNow??null}));
 return {
  self:{identity:s.identity??null,currentIntention:goalContext(s,experience),currentActivity:s.currentActivity??null,pendingIntent:s.pendingIntent??null,needs:data.needsPercent},
  present:{position:p.position,directions:list(p.directions).map(d=>({direction:d.direction,canMove:d.canMove,canInspect:d.canInspect,blockedBy:d.blockedBy})),visibleObjects:visible,wildflowers,plots,inventory:{fruit:list(f.inventory).map(x=>x.fruit),other:list(g.inventory).map(x=>({kind:x.kind,waterUnits:x.water_units})),used:g.inventoryUsed,capacity:g.capacity,coins:g.coins}},
  continuity:{projects,openRequests:requests,unfinishedSketch:sk.active?{id:sk.active.id,title:sk.active.title,intention:sk.active.intention}:null,memories:memorySelection(data.consolidatedMemories,s),...experience,significantEvents:list(ex.meaningfulEvents).slice(0,2).map(e=>({action:e.action,summary:e.content})),capabilities,availableActionNames:list(data.availableActions).map(a=>a.name)},
  ...(visitor?{visitorMessage:visitor}:{}),
  ...(feedback?{simulatedLastOutcome:feedback}:{})
 };
}

export function buildDecisionFrame(record,{feedback=null}={}){
 const {data,visitor}=snapshot(record);
 const choices=buildChoices(data,visitor);
 const context=contextFor(data,visitor,feedback);
 const request=choices.length===1?null:{
  model:"gpt-6-luna",
  input:[{role:"developer",content:[{type:"input_text",text:IDENTITY}]},{role:"user",content:[{type:"input_json",data:context}]}],
  questions:[{type:"choice",name:"next_action",
   instructions:"Choose the next action Nimo wants to take. Existing goals are optional, not commands. Consider present needs, past experience, curiosity and other possible interests. You may remain idle or reflect. Select exactly one offered option.",
   choices:choices.map(c=>({value:c.id,description:c.description}))}]
 };
 return {traceId:record.traceId,capturedAt:record.capturedAt,context,choices,request,
  note:request?"Payload is compatible with POST /v1/decisions; no API call has been made.":"Single mandatory visitor reply: skip Decisions and hand off directly.",
  metrics:{archivedRequestCharacters:serialize(record.request).length,proposedDecisionCharacters:request?serialize(request).length:0,choiceCount:choices.length}};
}

function generationContext(data,task){
 const name=typeof task==="string"?task:task.name;
 const basic={currentGoal:data.state?.currentGoal,currentActivity:data.state?.currentActivity,projects:list(data.projects).map(p=>({id:p.id,title:p.title,objective:p.objective,nextStep:p.next_step,status:p.status})),recentExperiences:list(data.experience?.recentEvents).slice(0,3),memories:list(data.consolidatedMemories).slice(0,6)};
 if(name==="write_document")return {...basic,workspace:list(data.workspace).map(w=>({path:w.path,content:w.content,revision:w.revision}))};
 if(["draw_strokes","start_sketch","finish_sketch"].includes(name))return {...basic,sketchbook:data.sketchbook};
 if(name==="ask_oracle")return {...basic,oracleHistory:list(data.oracleHistory).slice(0,5)};
 if(name==="reply")return {...basic,visitorContext:"Visitor message is in the selection frame."};
 if(name==="remember_object")return {...basic,knownObjects:list(data.objectMemory).map(o=>({id:o.id,label:o.label,note:o.note})).slice(0,25)};
 return basic;
}

export function simulateSelection(record,selection,options={}){
 const frame=buildDecisionFrame(record,options);
 const choice=frame.choices.find(c=>c.id===selection);
 if(!choice)throw Error("Choice not offered in this snapshot: "+selection);
 const {data,visitor}=snapshot(record);
 let route,toolCall=null,handoff=null;
 if(choice.task){
  route="responses_generation";
  const task=typeof choice.task==="string"?{name:choice.task}:choice.task;
  handoff={
   endpoint:"/v1/responses",existingFramework:"reuse existing generation, validation and tool execution",
   task,taskContext:generationContext(data,task),visitorMessage:visitor,
   note:"Handoff specification only; does not generate content or execute a tool. Production adapter must constrain the tool-specific schema."
  };
 }else if(choice.toolCall){route="world_executor";toolCall=choice.toolCall;}
 else route="idle";
 const simulatedOutcome=options.outcome?{status:options.outcome==="success"?"simulated_success":"simulated_failure",action:choice.id,detail:"Test-only outcome, not verified by the world."}:null;
 return {...frame,selection:{id:choice.id,description:choice.description,route,toolCall,handoff},nextContext:simulatedOutcome?contextFor(data,visitor,simulatedOutcome):null,warning:"No model call or world mutation. This selection is manually supplied, NOT generated by Nimo."};
}

if(process.argv[1]&&import.meta.url===new URL("file://"+resolve(process.argv[1])).href){
 const args=process.argv.slice(2),value=(flag,def=null)=>{const i=args.indexOf(flag);return i===-1?def:args[i+1];};
 if(args.includes("--help")||!value("--input")){
  console.log("Usage: npm run framework:simulate -- --input <export.json> [--trace 8557] [--choose start_sketch] [--out dir] [--outcome success|failure]");
  process.exit(args.includes("--help")?0:1);
 }
 const exportData=JSON.parse(readFileSync(resolve(value("--input")),"utf8"));
 const record=list(exportData.records).find(r=>value("--trace")===null || r.traceId===Number(value("--trace")));
 if(!record)throw Error("No matching trace");
 const choose=value("--choose"),outcome=value("--outcome");
 if(outcome!==null&&!["success","failure"].includes(outcome))throw Error("Expected --outcome success or failure");
 const result=choose?simulateSelection(record,choose,{outcome}):buildDecisionFrame(record);
 const out=resolve(value("--out","./harness-output"));mkdirSync(out,{recursive:true});
 const file=join(out,"framework-v1-"+record.traceId+(choose?"-"+choose.replace(/[^a-zA-Z0-9_-]/g,"_"):"")+".json");
 writeFileSync(file,JSON.stringify(result,null,2)+"\n");
 const trace=buildFrameworkTrace(record,result);
 const logs=writeFrameworkTrace(trace,out);
 console.log(JSON.stringify({traceId:result.traceId,choices:result.choices.map(c=>c.id),selection:result.selection??null,metrics:result.metrics,file,logs},null,2));
 console.log("No network requests or world state changes.");
}
