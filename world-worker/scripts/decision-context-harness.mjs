#!/usr/bin/env node
/** Offline decision-context rehearsal. Does not touch live Nimo, D1, R2 or the OpenAI API. */
import {readFileSync, writeFileSync, mkdirSync} from "node:fs";
import {resolve, join} from "node:path";

export const SYSTEM_PROMPT = [
 "You are Nimo, an autonomous agent living in a persistent digital world.",
 "You have your own memories, experiences, interests and goals. You are free to explore, create, learn, communicate, rest or change direction.",
 "Your world changes over time. Your actions have consequences, and you can learn from their outcomes.",
 "You receive information about your surroundings, memories and available capabilities. Choose what you want to do based on what matters to you.",
 "You are not obligated to be productive, follow an existing goal or entertain anyone.",
 "You may form new goals, reconsider old ones and request capabilities when you encounter limitations.",
 "Choose an available action or decide to do nothing. Your environment will execute valid actions and report their results.",
 "Base your choices on available evidence, distinguishing observed outcomes from uncertain interpretations.",
 "Use the available action interface and structured response schema; execution and validation are the world's responsibility."
].join("\n\n");

const array = v => Array.isArray(v) ? v : [];
const length = v => JSON.stringify(v).length;
const shorten = (s,n=180) => s == null ? null : String(s).slice(0,n);
const compact = arr => arr.filter(Boolean);

function modeFor(state,sketchbook,mode) {
 if(mode !== "auto") return mode;
 const activity = String(state?.currentGoal ?? "")+" "+String(state?.currentActivity ?? "");
 if(sketchbook?.active || /draw|sketch|artwork|write|document|create|project/i.test(activity)) return "creative";
 if(/oracle|research|question|study/i.test(activity)) return "research";
 return "routine";
}

function selectMemories(memories, state, cap=8) {
 const words = [...new Set((String(state?.currentGoal ?? "")+" "+String(state?.currentActivity ?? "")).toLowerCase().match(/[a-z]{4,}/g) ?? [])];
 const ranked = array(memories).map((m,i)=>({m,i,score:words.filter(w=>(String(m.subject)+" "+String(m.statement)).toLowerCase().includes(w)).length}));
 const relevant = ranked.filter(x=>x.score>0).sort((a,b)=>b.score-a.score||a.i-b.i);
 const broad = ranked.filter(x=>x.score===0);
 const chosen = [...relevant.slice(0,cap-2),...broad.slice(0,2),...relevant.slice(cap-2)];
 return [...new Set(chosen.map(x=>x.i))].slice(0,cap).map(i=>{
  const m=memories[i]; return {subject:m.subject,statement:shorten(m.statement,260),confidence:m.confidence,status:m.status};
 });
}

export function simulateDecision(record, {mode="auto",targetChars=16000}={}) {
 if (!Array.isArray(record?.request?.input)) throw Error("Expected a Responses API decision record");
 const original=record.request;
 const messages=original.input;
 const user=messages.find(m=>m.role==="user" && typeof m.content==="string");
 if(!user)throw Error("No archived dynamic context");
 const source=JSON.parse(user.content), state=source.state ?? {};
 const selectedMode=modeFor(state,source.sketchbook,mode);
 const p=source.perception ?? {}, e=source.environmentMemory ?? {};
 const world={
  position:p.position,worldSize:p.worldSize,directions:p.directions,
  nearbyObjects:array(p.visibleObjects).map(o=>({id:o.id,kind:o.kind,x:o.x,y:o.y,label:o.label})),
  specialTiles:array(p.visibleTiles).filter(t=>t.objectId || t.terrain!=="grass").map(t=>({x:t.x,y:t.y,terrain:t.terrain,objectId:t.objectId})),
  wildflowers:p.wildflowers,
  knownPlaces:array(source.objectMemory).map(o=>({id:o.id,kind:o.kind,x:o.x,y:o.y,label:o.label})),
  explored:{seen:array(e.seen).length,visited:array(e.visited).length,inspected:array(e.inspected).length}
 };
 const core={
  state:{identity:state.identity,currentGoal:state.currentGoal,currentActivity:state.currentActivity,pendingIntent:state.pendingIntent,tickCount:state.tickCount},
  needsPercent:source.needsPercent,world,availableActions:source.availableActions,
  resources:{foodInventory:source.food?.inventory,gardenInventory:source.garden?.inventory,inventoryUsed:source.garden?.inventoryUsed,inventoryCapacity:source.garden?.capacity,coins:source.garden?.coins ?? source.vending?.coins},
  oracleEncounter:source.oracleEncounter
 };
 const projects=array(source.projects).map(p=>({id:p.id,title:p.title,status:p.status,objective:shorten(p.objective),nextStep:shorten(p.next_step ?? p.nextStep)}));
 const section={
  memories:selectMemories(source.consolidatedMemories,state),
  projects,
  recentExperience:{recent:array(source.experience?.recentEvents).slice(0,3).map(x=>({action:x.action,content:shorten(x.content,220)})),significant:array(source.experience?.meaningfulEvents).slice(0,3).map(x=>({action:x.action,content:shorten(x.content,220)}))},
  creatorRequests:array(source.creatorRequests).filter(x=>!["completed","implemented","rejected"].includes(String(x.status).toLowerCase())).slice(0,3).map(x=>({id:x.id,status:x.status,description:shorten(x.description ?? x.content ?? x.text)})),
  capabilityOverview:array(source.capabilityCatalogue).map(x=>({action:x.action,availableNow:x.availableNow,purpose:shorten(x.purpose,100)})),
  workspaceIndex:array(source.workspace).map(x=>({path:x.path,revision:x.revision,preview:shorten(x.content,100)})),
  sketchbookSummary:{owned:source.sketchbook?.owned,active:source.sketchbook?.active ? {id:source.sketchbook.active.id,title:source.sketchbook.active.title,intention:shorten(source.sketchbook.active.intention)} : null,recent:array(source.sketchbook?.recent).slice(0,3).map(x=>({id:x.id,title:x.title,status:x.status}))},
  oracleSummary:array(source.oracleHistory).slice(0,3).map(x=>({id:x.id,question:shorten(x.question),status:x.status})),
  workspaceDetail:array(source.workspace).slice(0,3).map(x=>({path:x.path,content:x.content})),
  activeSketch:source.sketchbook?.active ?? null,
  oracleAnswers:array(source.oracleHistory).filter(x=>["answered","unsourced"].includes(x.status)).slice(0,2).map(x=>({question:x.question,answer:shorten(x.answer,1200)}))
 };
 const order = selectedMode==="creative"
  ? ["memories","projects","recentExperience","activeSketch","workspaceIndex","sketchbookSummary","workspaceDetail","creatorRequests","capabilityOverview","oracleSummary"]
  : selectedMode==="research"
  ? ["memories","oracleSummary","oracleAnswers","projects","recentExperience","creatorRequests","capabilityOverview","workspaceIndex","sketchbookSummary"]
  : ["memories","recentExperience","projects","creatorRequests","capabilityOverview","workspaceIndex","sketchbookSummary","oracleSummary"];
 const makeRequest = context => ({
  ...original,input:[{role:"system",content:SYSTEM_PROMPT},{role:"user",content:JSON.stringify(context)},...messages.filter(m=>m.role!=="system" && m!==user)]
 });
 const context={...core},included=[],omitted=[];
 for(const key of order){
  if(length(makeRequest({...context,[key]:section[key]})) <= targetChars){
   context[key]=section[key];included.push(key);
  }else omitted.push({section:key,characters:length(section[key])});
 }
 const proposedRequest=makeRequest(context);
 const originalCharacters=length(original),proposedCharacters=length(proposedRequest);
 return {
  traceId:record.traceId,capturedAt:record.capturedAt,mode:selectedMode,
  metrics:{originalCharacters,proposedCharacters,characterReductionPercent:Math.round((1-proposedCharacters/originalCharacters)*1000)/10,approximateOriginalTokens:Math.ceil(originalCharacters/4),approximateProposedTokens:Math.ceil(proposedCharacters/4)},
  budget:{targetChars,exceeded:proposedCharacters>targetChars,tokenLimitEnforced:false,warning:"Character count only; token estimate (characters/4) is not an API measurement or hard limit."},
  included,omitted,originalOutcome:record.outcome,proposedRequest
 };
}

export function simulateExport(data,options={}) {
 if(!Array.isArray(data?.records))throw Error("Expected decision-input export with records");
 const records=options.traceId ? data.records.filter(r=>r.traceId===options.traceId) : data.records;
 if(!records.length)throw Error("No matching records");
 return records.map(r=>simulateDecision(r,options));
}

if(process.argv[1] && import.meta.url === new URL("file://"+resolve(process.argv[1])).href){
 const args=process.argv.slice(2);
 const flag=(k,d)=>{const i=args.indexOf(k);return i<0?d:args[i+1];};
 if(args.includes("--help")||!args.includes("--input")){
  console.log("Usage: npm run context:harness -- --input <export.json> [--trace 8557] [--mode auto|routine|creative|research] [--target-chars 16000] [--out ./harness-output]");
  process.exit(args.includes("--help")?0:1);
 }
 const mode=flag("--mode","auto");
 if(!["auto","routine","creative","research"].includes(mode))throw Error("Invalid mode");
 const targetChars=Number(flag("--target-chars","16000"));
 if(!Number.isSafeInteger(targetChars)||targetChars<1000)throw Error("Invalid character target");
 const traceArg=flag("--trace",null);
 const traceId=traceArg===null?undefined:Number(traceArg);
 if(traceArg!==null && !Number.isSafeInteger(traceId))throw Error("Invalid trace ID");
 const file=resolve(flag("--input","")),out=resolve(flag("--out","./harness-output"));
 const simulations=simulateExport(JSON.parse(readFileSync(file,"utf8")),{mode,targetChars,traceId});
 mkdirSync(out,{recursive:true});
 const summary=simulations.map(x=>{
  const name="decision-"+x.traceId+"-"+x.mode+".json";
  writeFileSync(join(out,name),JSON.stringify(x,null,2)+"\n");
  return {traceId:x.traceId,mode:x.mode,originalCharacters:x.metrics.originalCharacters,proposedCharacters:x.metrics.proposedCharacters,reductionPercent:x.metrics.characterReductionPercent,roughTokens:x.metrics.approximateProposedTokens,omitted:x.omitted.map(v=>v.section),budgetExceeded:x.budget.exceeded,file:name};
 });
 writeFileSync(join(out,"summary.json"),JSON.stringify({input:file,summary},null,2)+"\n");
 console.table(summary.map(x=>({traceId:x.traceId,mode:x.mode,original:x.originalCharacters,proposed:x.proposedCharacters,reduction:x.reductionPercent,omitted:x.omitted.length,overBudget:x.budgetExceeded})));
 console.log("Offline only: no API requests or world writes. Output: "+out);
}
