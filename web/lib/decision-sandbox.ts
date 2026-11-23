/**
 * Explicitly isolated replay sandbox. Shares Nimo's real map/pathfinding
 * and the archived action offers, but NEVER claims to execute the D1 worker.
 * Only locally emulated actions are supported. No persistence/network here.
 */
import {shortestPath,modelPerception,objectById} from "./world-map";
import {offerChoices,compactContext,type Choice,type LooseRecord} from "./decision-harness";

export type SandboxResult={
 status:"simulated_success"|"simulated_failure"|"unsupported";
 action:string;summary:string;before:unknown;after:unknown;
 route?:{x:number;y:number}[];legacyDecision:LooseRecord|null;
};
export type SandboxState={world:LooseRecord;step:number;history:SandboxResult[]};
const clone=<T,>(v:T):T=>JSON.parse(JSON.stringify(v)) as T;
const list=(v:unknown):LooseRecord[]=>Array.isArray(v)?v:[];
const str=(v:unknown):string=>typeof v==="string"?v:"";
const inverse=(p:{x:number;y:number})=>({x:p.x-1,y:p.y-1});
function worldOffers(world:LooseRecord):Choice[]{return offerChoices(world,null);}
export function createSandbox(world:LooseRecord):SandboxState{
 const state=clone(world);
 if(!state.perception?.position||!state.state)throw Error("Snapshot lacks position or world state");
 return {world:state,step:0,history:[]};
}
export function sandboxFrame(state:SandboxState){
 return {context:compactContext(state.world,null),choices:worldOffers(state.world),step:state.step};
}
export function supportsSandboxChoice(choice:Choice):boolean{
 return ["idle","observe","reflect","request_capability"].includes(choice.id)||
  !!choice.toolCall&&["travel_to","eat_fruit","discard_fruit","discard_wildflower","rest"].includes(str(choice.toolCall.name))||
  !!choice.task&&["start_sketch","draw_strokes","finish_sketch","write_document","create_project","update_project","remember_object","expand_world"].includes(choice.task);
}
function safeLegacy(choice:Choice,call:LooseRecord|null,generated:LooseRecord|null,goal:string|null,activity:string):LooseRecord{
 const passive=choice.id==="observe"?"OBSERVE":choice.id==="request_capability"?"REQUEST":"THINK";
 return {action:call?"ACT":passive,monologue:generated?.monologue??("I choose "+choice.description),
  activity:generated?.activity??activity,goal:generated?.goal??goal,identityUpdate:null,
  toolCall:call,replyIntent:null,intentDisposition:generated?.intentDisposition??"keep"};
}
function refreshContext(world:LooseRecord){
 const position=world.perception.position as {x:number;y:number};
 const perceived=modelPerception(inverse(position));
 world.perception={...world.perception,...perceived,
  wildflowers:list(world.perception.wildflowers).map(f=>({
   ...f,directlyAdjacent:Math.abs(Number(f.x)-position.x)+Math.abs(Number(f.y)-position.y)===1
  }))};
 const inventory=list(world.food?.inventory).map(f=>str(f.fruit));
 // Recalculate only eligibility that can be proved by the local replay.
 // Other tools are dropped after physical movement, never speculatively offered.
 const old=list(world.availableActions);
 const names=new Set(["travel_to","write_document","expand_world","create_project","update_project","start_sketch"]);
 world.availableActions=old.filter(o=>names.has(str(o.name))||
  (["eat_fruit","discard_fruit"].includes(str(o.name))&&inventory.length>0)).map(o=>{
   if(o.name==="eat_fruit"||o.name==="discard_fruit")return {...o,fruits:[...new Set(inventory)]};
   return o;
 });
}
function generatedCall(choice:Choice,generated:LooseRecord|null):LooseRecord|null{
 if(choice.toolCall)return clone(choice.toolCall);
 if(!choice.task||!generated)return null;
 const task=choice.task;
 if(task==="reflect"||task==="request")return null;
 if(task==="update_project")return {name:"update_project",projectId:Number(choice.id.split(":")[1]),...generated};
 if(task==="draw_strokes")return {name:"draw_strokes",sketchId:Number(choice.id.split(":")[1]),...generated};
 if(task==="finish_sketch")return {name:"finish_sketch",sketchId:Number(choice.id.split(":")[1]),...generated};
 return {name:task,...generated};
}
export function stepSandbox(state:SandboxState,choiceId:string,generated:LooseRecord|null=null):SandboxState{
 if(state.step>=30)throw Error("Replay is limited to 30 actions. Reset the sandbox to continue.");
 const prior=state.world;
 const choice=worldOffers(prior).find(c=>c.id===choiceId);
 if(!choice)throw Error("Action is no longer offered by this sandbox snapshot");
 const before={position:prior.perception.position,inventoryUsed:prior.garden?.inventoryUsed,goal:prior.state.currentGoal};
 const world=clone(prior);
 let status:SandboxResult["status"]="simulated_success";
 let summary="";
 let route:SandboxResult["route"];
 const call=generatedCall(choice,generated);
 const task=choice.task;
 const pos=world.perception.position as {x:number;y:number};
 const fruits=list(world.food?.inventory);
 const inventory=list(world.garden?.inventory);
 const actionName=str(call?.name);
 const cap=Number(world.garden?.capacity??9);
 try{
  if(!supportsSandboxChoice(choice))throw Error("Not implemented in isolated replay; no state was changed.");
  if(task&&!choice.toolCall&&task!=="reflect"&&task!=="request"&&!generated)throw Error("This choice needs a Responses generation handoff.");
  if(actionName==="travel_to"){
   const target={x:Number(call?.x),y:Number(call?.y)};
   const planned=shortestPath(inverse(pos),inverse(target));
   if(!planned)throw Error("No walkable path to destination");
   route=planned.map(p=>({x:p.x+1,y:p.y+1}));
   world.perception.position=target;
   refreshContext(world);
   summary="Sandbox path of "+(planned.length-1)+" verified map steps to ("+target.x+","+target.y+").";
  }else if(actionName==="eat_fruit"){
   const index=fruits.findIndex(f=>f.fruit===call?.fruit);
   if(index<0)throw Error("Fruit is not carried");
   // The real DB holds fruit-specific effects. Avoid inventing one from a generic archive.
   summary="Fruit removed from sandbox inventory. Fullness unchanged: effect requires the real food rules/data.";
   fruits.splice(index,1);world.food.inventory=fruits;
   world.garden.inventoryUsed=Math.max(0,Number(world.garden.inventoryUsed??0)-1);
   refreshContext(world);
  }else if(actionName==="discard_fruit"){
   const index=fruits.findIndex(f=>f.fruit===call?.fruit);
   if(index<0)throw Error("Fruit is not carried");
   fruits.splice(index,1);world.food.inventory=fruits;
   world.garden.inventoryUsed=Math.max(0,Number(world.garden.inventoryUsed??0)-1);
   refreshContext(world);summary="Discarded carried "+call?.fruit+" fruit in isolated state.";
  }else if(actionName==="discard_wildflower"){
   const index=inventory.findIndex(o=>o.kind===call?.kind);
   if(index<0)throw Error("Flower is not carried in archived inventory");
   inventory.splice(index,1);world.garden.inventory=inventory;
   world.garden.inventoryUsed=Math.max(0,Number(world.garden.inventoryUsed??0)-1);
   summary="Discarded flower in isolated state.";
  }else if(actionName==="start_sketch"){
   if(world.sketchbook?.active)throw Error("An unfinished sketch already exists");
   if(!str(call?.title).trim()||!str(call?.intention).trim()||str(call?.title).length>100||str(call?.intention).length>300)throw Error("Invalid sketch parameters");
   const owned=Boolean(world.sketchbook?.owned);
   if(!owned)throw Error("Sketchbook not owned");
   const active={id:1000+state.step,title:call?.title,intention:call?.intention,strokes:[],status:"drawing"};
   world.sketchbook.active=active;
   world.availableActions=list(world.availableActions).filter(o=>o.name!=="start_sketch");
   world.availableActions.push({name:"draw_strokes",sketchIds:[active.id]},{name:"finish_sketch",sketchIds:[active.id]});
   summary="Started isolated sketch "+str(call?.title)+".";
  }else if(actionName==="draw_strokes"){
   const active=world.sketchbook?.active;
   if(!active||active.id!==call?.sketchId)throw Error("No matching active sketch");
   const strokes=Array.isArray(call?.strokes)?call.strokes:[];
   if(!strokes.length||strokes.length>8)throw Error("Expected 1-8 strokes");
   for(const stroke of strokes){
    if(!Array.isArray(stroke.points)||stroke.points.length<2||stroke.points.length>24||!/^#[a-f0-9]{6}$/i.test(str(stroke.color))||!Number.isInteger(stroke.width)||stroke.width<1||stroke.width>8||!stroke.points.every((p:unknown)=>Array.isArray(p)&&p.length===2&&p.every((n:unknown,i:number)=>Number.isInteger(n)&&(n as number)>=0&&(n as number)<=(i?180:240))))throw Error("Invalid sketch strokes");
   }
   active.strokes=[...list(active.strokes),...clone(strokes)];
   summary="Added "+strokes.length+" strokes to isolated sketch.";
  }else if(actionName==="write_document"){
   if(!/^[a-z0-9][a-z0-9_-]{0,39}\.txt$/.test(str(call?.path))||str(call?.content).length>2000)throw Error("Invalid document");
   const files=list(world.workspace),idx=files.findIndex(f=>f.path===call?.path);
   if(idx<0&&files.length>=12)throw Error("Workspace full");
   if(idx>=0)files[idx]={...files[idx],content:call?.content};
   else files.push({path:call?.path,content:call?.content});
   world.workspace=files;summary="Saved isolated document "+str(call?.path)+".";
  }else if(actionName==="create_project"){
   if(!str(call?.title).trim()||!str(call?.objective).trim()||!str(call?.nextStep).trim())throw Error("Project fields required");
   const projects=list(world.projects);
   if(projects.filter(p=>p.status==="active"||p.status==="paused").length>=3)throw Error("Project limit reached");
   const id=Math.max(0,...projects.map(p=>Number(p.id)||0))+1;
   projects.push({id,title:call?.title,objective:call?.objective,next_step:call?.nextStep,status:"active"});
   world.projects=projects;summary="Created isolated project #"+id+".";
  }else if(actionName==="update_project"){
   const project=list(world.projects).find(p=>p.id===call?.projectId);
   if(!project)throw Error("Project not found");
   project.next_step=call?.nextStep;project.status=call?.status;
   project.progressNote=call?.progressNote;
   summary="Updated isolated project #"+call?.projectId+".";
  }else if(actionName==="remember_object"){
   if(!objectById(str(call?.objectId)))throw Error("Unknown object");
   world.objectMemory=Array.isArray(world.objectMemory)?world.objectMemory:[];
   world.objectMemory.push({id:call?.objectId,label:call?.label,note:call?.note});
   summary="Recorded isolated object note.";
  }else if(actionName==="expand_world"){
   world.creatorRequests=list(world.creatorRequests);
   world.creatorRequests.push({id:1000+state.step,status:"pending",content:call?.description});
   summary="Queued a simulated expansion request. No world change.";
  }else if(!call){
   summary=choice.id==="idle"?"Remained idle.":choice.id==="observe"?"Observed surroundings.":generated?.monologue??"Reflected.";
   if(task==="reflect"&&generated){
    const disposition=str(generated.intentDisposition)||"keep";
    if(!["keep","complete","abandon","replace"].includes(disposition))throw Error("Invalid intention disposition");
    const oldGoal=world.state.currentGoal??null;
    if(disposition==="replace"){
     if(!str(generated.goal).trim())throw Error("Replacement intention is missing");
     world.state.currentGoal=generated.goal;
    }else if(disposition==="complete"||disposition==="abandon"){
     world.state.currentGoal=null;
    }else if(typeof generated.goal==="string"&&generated.goal.trim()){
     world.state.currentGoal=generated.goal;
    }
    world.state.lastIntentOutcome={disposition,previousGoal:oldGoal,
      newGoal:world.state.currentGoal??null,evidence:summary,source:"simulated_reflection",
      step:state.step+1};
    summary="Reflection "+disposition+": "+summary;
   }else if(task==="request"&&(typeof generated?.goal==="string"||generated?.goal===null)){
    world.state.currentGoal=generated.goal;
   }
  }else if(actionName==="rest"){
   summary="Paused beside the garden nook in isolated replay (no meter changes).";
  }else throw Error("No isolated executor for "+actionName);
 }catch(err){
  status=str((err as Error).message).startsWith("Not implemented")?"unsupported":"simulated_failure";
  summary=(err as Error).message;
 }
 if(status!=="simulated_success"){
  return {...state,step:state.step+1,history:[...state.history,{action:choice.id,status,summary,before,after:before,legacyDecision:null}]};
 }
 const legacyDecision=safeLegacy(choice,call,generated,world.state.currentGoal??null,world.state.currentActivity??"");
 world.state.currentActivity=generated?.activity??choice.description;
 world.experience=world.experience??{};
 world.experience.recentEvents=[
  {kind:"tool",action:actionName?"SANDBOX_"+actionName.toUpperCase():"SANDBOX_THOUGHT",content:summary,when:new Date().toISOString()},
  ...list(world.experience.recentEvents)
 ].slice(0,12);
 // For creative actions preserve only offers whose prerequisites still hold.
 if(actionName==="start_sketch"||actionName==="create_project") {
  world.availableActions=list(world.availableActions).filter(o=>!(o.name==="create_project"&&list(world.projects).filter(p=>["active","paused"].includes(str(p.status))).length>=3));
 }
 const after={position:world.perception.position,inventoryUsed:world.garden?.inventoryUsed,goal:world.state.currentGoal};
 const result:SandboxResult={action:choice.id,status,summary,before,after,route,legacyDecision};
 return {world,step:state.step+1,history:[...state.history,result]};
}
