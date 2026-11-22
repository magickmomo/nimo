/**
 * Browser-only decision framework test. No external API calls or world writes.
 * Historical exports stay in the browser's memory and are never uploaded.
 */
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

export type LooseRecord = Record<string,any>;
export type ArchiveRecord = {traceId:number;capturedAt?:string;request:{model?:string;input:{role:string;content:string}[]};outcome?:unknown};
export type Choice = {id:string;description:string;toolCall:LooseRecord|null;task:string|null};
export type Stage = {id:string;title:string;status:"done"|"simulated"|"not_run";source:string;input:unknown;output:unknown;note:string};
export type Report = {traceId:number;source:string;choices:Choice[];context:LooseRecord;request:LooseRecord|null;selection:Choice|null;stages:Stage[];counts:{original:number;proposal:number};timestamp:string};

const arr=(v:unknown):any[]=>Array.isArray(v)?v:[];
const clip=(v:unknown,n=180):string=>typeof v==="string"?v.slice(0,n):"";
const sizes=(v:unknown)=>JSON.stringify(v).length;
const asObject=(v:unknown):LooseRecord=>v!==null&&typeof v==="object"&&!Array.isArray(v)?v as LooseRecord:{};
const candidate=(id:string,description:string,toolCall:LooseRecord|null=null,task:string|null=null):Choice=>({id,description,toolCall,task});
const creative=new Set(["write_document","remember_object","start_sketch","draw_strokes","create_project","update_project","ask_oracle","expand_world"]);
export const SAMPLE:ArchiveRecord={
 traceId:10001,capturedAt:"2026-11-22T12:36:51Z",
 request:{model:"gpt-6-luna",input:[
  {role:"system",content:"Archived production instructions (synthetic fixture)."},
  {role:"user",content:JSON.stringify({
   state:{identity:"Nimo",currentGoal:null,currentActivity:"quietly considering what to do",tickCount:5191},
   needsPercent:{fullness:57,curiosity:98,energy:80,happiness:50,boredom:0},
   perception:{position:{x:9,y:12},directions:[{direction:"north",canMove:true,destination:{x:9,y:11}},{direction:"south",canMove:true,destination:{x:9,y:13}},{direction:"east",canMove:true,destination:{x:10,y:12}},{direction:"west",canMove:true,destination:{x:8,y:12}}],visibleObjects:[{id:"garden_nook_001",type:"bench",position:{x:6,y:13},distance:3}]},
   availableActions:[{name:"travel_to"},{name:"eat_fruit",fruits:["red"]},{name:"write_document"},{name:"start_sketch"},{name:"create_project"}],
   food:{inventory:[{fruit:"red"}]},garden:{inventory:[{kind:"watering_can",water_units:0}],inventoryUsed:2,capacity:9,coins:0},
   projects:[{id:2,title:"Revisit the mystery box",status:"paused",next_step:"Wait for new information"}],
   consolidatedMemories:[{subject:"fruit:amber",statement:"Amber fruit can improve fullness.",confidence:0.8},{subject:"experience:art",statement:"Sketches have been an enjoyable way to examine shapes.",confidence:0.7}],
   experience:{recentEvents:[{action:"THINK",content:"A brief pause near the wildflowers felt sufficient."}],meaningfulEvents:[]},
   workspace:[],sketchbook:{owned:true,active:null},oracleHistory:[],creatorRequests:[],
   capabilityCatalogue:[{action:"ask_oracle"},{action:"write_document"},{action:"start_sketch"},{action:"travel_to"}]
  })}
 ]},
 outcome:{status:"selected",decision:{action:"ACT",toolCall:{name:"start_sketch",title:"A Paper Kite",intention:"Sketch a kite."}}}
};

export function contextOf(record:ArchiveRecord):{world:LooseRecord;visitor:string|null}{
 const messages=record.request?.input;
 if(!Array.isArray(messages))throw Error("Record is missing request.input");
 const context=messages.find(m=>m.role==="user"&&typeof m.content==="string"&&m.content.trimStart().startsWith("{"));
 if(!context)throw Error("No JSON world context found");
 const world=JSON.parse(context.content);
 const visitor=messages.find(m=>m.role==="user"&&m!==context)?.content??null;
 return {world,visitor};
}

export function offerChoices(world:LooseRecord,visitor:string|null):Choice[]{
 if(visitor)return [candidate("reply_to_visitor","Reply to the visitor.",null,"reply")];
 const choices:Choice[]=[
  candidate("idle","Remain still without beginning a new task."),
  candidate("observe","Observe surroundings."),
  candidate("reflect","Think, reconsider an interest or goal.",null,"reflect"),
  candidate("request_capability","Ask the creator for help or a capability.",null,"request")
 ];
 const add=(id:string,description:string,call:LooseRecord|null=null,task:string|null=null)=>choices.push(candidate(id,description,call,task));
 for(const offer of arr(world.availableActions)){
  const n=offer.name;
  if(creative.has(n)){
   if(n==="update_project"){for(const id of arr(offer.projectIds))add("update_project:"+id,"Update project "+id,null,n);}
   else if(n==="draw_strokes"){for(const id of arr(offer.sketchIds))add("draw_strokes:"+id,"Continue drawing "+id,null,n);}
   else add(n,({write_document:"Write or revise a document.",start_sketch:"Begin an original sketch.",remember_object:"Write a note on a known object.",create_project:"Develop a new project.",ask_oracle:"Ask the Oracle a question.",expand_world:"Propose a world change."} as Record<string,string>)[n]??n,null,n);
  }else if(n==="travel_to"){
   for(const d of arr(world.perception?.directions)){
    if(d.canMove===true && Number.isInteger(d.destination?.x)&&Number.isInteger(d.destination?.y))
     add("travel:"+d.direction,"Walk "+d.direction+" to ("+d.destination.x+","+d.destination.y+").",{name:"travel_to",x:d.destination.x,y:d.destination.y});
   }
  }else if(n==="inspect"){for(const direction of arr(offer.directions))add("inspect:"+direction,"Inspect "+direction+".",{name:n,direction});}
  else if(n==="pick_fruit"){for(const treeId of arr(offer.treeIds))add("pick:"+treeId,"Pick fruit from "+treeId+".",{name:n,treeId});}
  else if(n==="pick_flowers"){for(const patchId of arr(offer.patchIds))add("pick_flowers:"+patchId,"Pick flowers at "+patchId+".",{name:n,patchId});}
  else if(n==="plant_wildflower_seed"){for(const direction of arr(offer.directions))add("plant_flower:"+direction,"Plant a seed "+direction+".",{name:n,direction});}
  else if(n==="discard_wildflower"){for(const kind of arr(offer.kinds))add("discard_flower:"+kind,"Discard "+kind+".",{name:n,kind});}
  else if(n==="eat_fruit"||n==="discard_fruit"){for(const fruit of arr(offer.fruits))add(n+":"+fruit,(n==="eat_fruit"?"Eat ":"Discard ")+fruit+" fruit.",{name:n,fruit});}
  else if(n==="buy_item"){for(const itemId of arr(offer.itemIds))add("buy:"+itemId,"Buy "+itemId+".",{name:n,itemId});}
  else if(n==="inspect_artwork"){for(const sketchId of arr(offer.sketchIds))add("inspect_artwork:"+sketchId,"Inspect artwork "+sketchId+".",{name:n,sketchId});}
  else if(n==="finish_sketch"){for(const sketchId of arr(offer.sketchIds)){add("finish_sketch:"+sketchId,"Finish sketch "+sketchId+".",{name:n,sketchId,status:"finished"});add("abandon_sketch:"+sketchId,"Abandon sketch "+sketchId+".",{name:n,sketchId,status:"abandoned"});}}
  else if(["plant_seed","water_plot","harvest_crop"].includes(n)){for(const plotId of arr(offer.plotIds))add(n+":"+plotId,n+" "+plotId+".",{name:n,plotId});}
  else if(n==="sell_item"){for(const item of arr(offer.items))add("sell:"+item,"Sell "+item+".",{name:n,item});}
  else if(["rest","take_can","fill_can"].includes(n))add(n,n.replaceAll("_"," ")+".",{name:n});
 }
 const unique=[...new Map(choices.map(c=>[c.id,c])).values()];
 if(unique.length>255)throw Error("Action list exceeds 255 choices");
 return unique;
}

export function compactContext(w:LooseRecord,visitor:string|null){
 const s=asObject(w.state),p=asObject(w.perception),g=asObject(w.garden),e=asObject(w.experience);
 const currentWords=[...new Set((String(s.currentGoal??"")+" "+String(s.currentActivity??"")).toLowerCase().match(/[a-z]{5,}/g)??[])];
 const ranked=arr(w.consolidatedMemories).map((m,i)=>({m,i,score:currentWords.filter(x=>(String(m.subject??"")+" "+String(m.statement??"")).toLowerCase().includes(x)).length}));
 const relevant=ranked.filter(x=>x.score>0).sort((a,b)=>b.score-a.score||a.i-b.i).slice(0,2);
 const others=ranked.filter(x=>!relevant.includes(x));
 const diverse:typeof ranked=[];const categories=new Set<string>();
 for(const item of others){
  const category=String(item.m.subject??"").split(":")[0];
  if(!categories.has(category)){diverse.push(item);categories.add(category);}
  if(diverse.length===3)break;
 }
 for(const item of others){if(diverse.length===3)break;if(!diverse.includes(item))diverse.push(item);}
 const recent=arr(e.recentEvents);
 const thought=recent.find(x=>x.kind==="thought"||x.action==="THINK");
 const outcome=recent.find(x=>x.kind==="tool");
 const lastReflection=thought?{when:thought.when??null,content:thought.content}:null;
 const reportedEnough=/(enough for now|walk is enough|walk end|already (beside|at|reached))/.test(String(thought?.content??"").toLowerCase());
 return {
  self:{identity:s.identity??null,currentIntention:s.currentGoal?{
   description:s.currentGoal,status:"unverified",directive:false,
   possibleCompletion:reportedEnough?{source:"latest_reflection",note:"Nimo's last reflection suggests this intention may be satisfied; this is not verified."}:null
  }:null,currentActivity:s.currentActivity??null,pendingIntent:s.pendingIntent??null,needs:w.needsPercent},
  present:{position:p.position,directions:arr(p.directions).map(d=>({direction:d.direction,canMove:d.canMove,canInspect:d.canInspect,blockedBy:d.blockedBy})),
   visibleObjects:arr(p.visibleObjects).map(o=>({id:o.id,type:o.type,position:o.position,distance:o.distance})),
   wildflowers:arr(p.wildflowers).map(o=>({id:o.id,type:"wildflower_patch",position:{x:o.x,y:o.y},blooms:o.blooms,directlyAdjacent:o.directlyAdjacent??false,description:o.description??null})),
   plots:arr(g.plots).map(o=>({id:o.id,position:{x:o.x,y:o.y},stage:o.stage,ready:o.ready})),
   inventory:{fruit:arr(w.food?.inventory).map(x=>x.fruit),other:arr(g.inventory).map(x=>({kind:x.kind,waterUnits:x.water_units})),used:g.inventoryUsed,capacity:g.capacity,coins:g.coins}},
  continuity:{projects:arr(w.projects).filter(x=>["active","paused"].includes(x.status)).slice(0,5).map(x=>({id:x.id,title:x.title,status:x.status,nextStep:x.next_step??x.nextStep??null})),
   memories:[...relevant,...diverse].map(({m})=>({subject:m.subject,statement:m.statement,confidence:m.confidence,status:m.status})),
   lastReflection,lastVerifiedOutcome:outcome?{when:outcome.when??null,action:outcome.action,description:outcome.content,source:"recorded_tool_event"}:null,
   capabilities:arr(w.capabilityCatalogue).map(c=>({name:c.action,availableNow:c.availableNow??null})),
   availableActionNames:arr(w.availableActions).map(a=>a.name),
   unfinishedSketch:w.sketchbook?.active?{id:w.sketchbook.active.id,title:w.sketchbook.active.title}:null},
  ...(visitor?{visitorMessage:visitor}:{})
 };
}

export function runPreview(record:ArchiveRecord,choiceId:string|null):Report{
 const {world,visitor}=contextOf(record);
 const choices=offerChoices(world,visitor),context=compactContext(world,visitor);
 const request=visitor?null:{model:"gpt-6-luna",input:[{role:"developer",content:[{type:"input_text",text:IDENTITY}]},{role:"user",content:[{type:"input_json",data:context}]}],
  questions:[{type:"choice",name:"next_action",instructions:"Select Nimo's next desired action. Existing goals are optional; remaining idle and reflecting are allowed.",choices:choices.map(c=>({value:c.id,description:c.description}))}]};
 const selection=choiceId===null?null:choices.find(c=>c.id===choiceId)??null;
 if(choiceId!==null&&!selection)throw Error("Selected action is unavailable for this snapshot");
 const generation=selection?.task?{endpoint:"/v1/responses",task:selection.task,taskContext:{
  currentGoal:world.state?.currentGoal,projects:world.projects,
  ...(selection.task==="write_document"?{workspace:world.workspace}:{}),
  ...(selection.task.includes("sketch")?{sketchbook:world.sketchbook}:{}),
  ...(selection.task==="ask_oracle"?{oracleHistory:arr(world.oracleHistory).slice(0,5)}:{}),
  memories:arr(world.consolidatedMemories).slice(0,6),recentExperiences:arr(world.experience?.recentEvents).slice(0,3)}
 }:null;
 const stages:Stage[]=[];
 const push=(id:string,title:string,input:unknown,output:unknown,status:Stage["status"],source:string,note:string)=>stages.push({id,title,input,output,status,source,note});
 push("archive","Historical input",{traceId:record.traceId},record.request,"done","archived","Actual archived input, or synthetic sample when using demo.");
 push("context","Compact context",{historicalContext:world},context,"done","browser_simulation","Selected and summarized entirely in the browser.");
 push("choices","Eligible actions",{availableActions:world.availableActions,perception:world.perception},choices,"done","browser_simulation","Targets derived from recorded action menu.");
 push("decisions_request","Decisions request",{context,choices},request,request?"done":"not_run","browser_simulation","Proposed request only. Not sent to the API.");
 push("decisions_response","Decisions response",{request},selection?{choice:selection.id}:null,selection?"simulated":"not_run",selection?"manual_choice":"not_run","Selection came from the dropdown, not an AI model.");
 push("route","Handoff",{selected:selection?.id??null},selection?{route:generation?"responses":selection.toolCall?"world_executor":"idle",toolCall:selection.toolCall,task:selection.task}:null,selection?"simulated":"not_run","browser_simulation","Routing proposal only.");
 push("generation","Generation input",{selection:selection?.id??null},generation,generation?"simulated":"not_run",generation?"browser_simulation":"not_run","Task context only; no generative call.");
 push("execution","World execution",{toolCall:selection?.toolCall??null},null,"not_run","not_run","World state is not modified.");
 push("feedback","Verified result",{selection:selection?.id??null},null,"not_run","not_run","No world action or verified outcome.");
 return {traceId:record.traceId,source:record.traceId===SAMPLE.traceId?"synthetic_demo":"uploaded_archive",choices,context,request,selection,stages,counts:{original:sizes(record.request),proposal:sizes(request)},timestamp:new Date().toISOString()};
}
