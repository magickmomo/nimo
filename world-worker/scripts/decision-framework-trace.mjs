/**
 * Offline decision framework trace.
 * Every stage records its precise input, output and provenance; no step implies a
 * model call, a completed tool execution or a verified world outcome.
 */
import {writeFileSync, mkdirSync} from "node:fs";
import {join} from "node:path";

const json=value=>JSON.stringify(value,null,2);
const safeName=value=>String(value).replace(/[^a-zA-Z0-9_-]/g,"_");

export function buildFrameworkTrace(record, result) {
 const selected=result.selection??null;
 const steps=[];
 const add=(id,label,input,output,{status="completed",source="offline_simulation",notes=""}={})=>
   steps.push({index:steps.length+1,id,label,status,source,notes,input,output});

 add("archive","Original decision archive",{
  traceId:record.traceId,capturedAt:record.capturedAt
 },{request:record.request,outcome:record.outcome??null},{
  source:"archived_request",notes:"Exact previous model request and archived outcome, not a new model call."
 });
 add("context","Build current decision context",{
  request:record.request
 },result.context,{
  notes:"Offline projection; some historic data is deliberately summarized or omitted."
 });
 add("choices","Determine eligible choices",{
  availableActions:result.context?.continuity?.capabilities,
  immediateWorld:result.context?.present
 },result.choices,{
  notes:"Choice IDs and concrete tool mappings from the harness. The live world has not revalidated them."
 });
 if(result.request){
  add("decisions_request","Prepare Decisions API request",{
   context:result.context,choices:result.choices
  },result.request,{
   notes:"Exact proposed HTTP JSON body. Not sent to /v1/decisions."
  });
  add("decisions_response","Receive action selection",{
   request:result.request
  },selected?{choice:selected.id}:null,selected?
   {source:"manual_test_choice",notes:"Chosen by --choose, NOT returned by the Decisions API."}:
   {status:"not_run",source:"not_run",notes:"No Decisions API request or model response occurred."});
 }else {
  add("decisions_request","Decisions API bypass",{
   context:result.context,choices:result.choices
  },null,{status:"skipped",source:"not_run",notes:"A pending visitor requires a direct generative reply."});
  add("decisions_response","Selection from mandatory visitor reply",{
   choices:result.choices
  },selected?{choice:selected.id}:null,selected?
   {source:"manual_test_choice",notes:"Visitor reply manually selected."}:
   {status:"not_run",source:"not_run",notes:"No selection made."});
 }
 add("route","Route selected action",{
  selectedChoice:selected?{id:selected.id,description:selected.description}:null,
  choices:result.choices
 },selected?{route:selected.route,toolCall:selected.toolCall??null,task:selected.handoff?.task??null}:null,
 selected?{source:"offline_simulation"}:{status:"not_run",source:"not_run",notes:"Select a choice to simulate routing."});
 add("generation","Prepare generative handoff",{
  selection:selected?.id??null
 },selected?.handoff??null,selected?.route==="responses_generation"?
  {source:"offline_simulation",notes:"Specification only: no /v1/responses request or generated content."}:
  {status:selected?"skipped":"not_run",source:"not_run",notes:"No generative handoff was needed or selected."});
 add("world_execution","Execute world action",{
  toolCall:selected?.toolCall??null,
  task:selected?.handoff?.task??null
 },null,{status:selected?"not_run":"not_run",source:"not_run",notes:"No tools executed; no database/world writes; no validated result."});
 add("feedback","Feed outcome into following context",{
  selection:selected?.id??null
 },result.nextContext?{
  simulatedLastOutcome:result.nextContext.simulatedLastOutcome,
  nextContext:result.nextContext
 }:null,result.nextContext?
 {source:"simulated_feedback",notes:"User-supplied synthetic outcome, not a verified world event."}:
 {status:"not_run",source:"not_run",notes:"No feedback was supplied or generated."});
 return {
  format:"nimo-decision-framework-trace-v1",
  traceId:record.traceId,capturedAt:record.capturedAt,
  mode:"offline",modelCalls:0,worldWrites:0,
  selectionSource:selected?"manual":"none",
  stages:steps
 };
}

export function traceMarkdown(trace){
 const intro=[
  "# Nimo framework trace #"+trace.traceId,
  "",
  "**Captured world snapshot:** "+trace.capturedAt,
  "**Execution:** "+trace.mode+" · "+trace.modelCalls+" model calls · "+trace.worldWrites+" world writes",
  "**Selection:** "+trace.selectionSource,
  "",
  "This is an exact record of the **offline harness's** transformations. Archived request bodies are real historic inputs. A manually selected choice, generated handoff specification or synthetic feedback is **not** an actual model response or verified world outcome.",
  ""
 ];
 for(const step of trace.stages){
  intro.push("## "+step.index+". "+step.label);
  intro.push("Status: **"+step.status+"** · Source: `"+step.source+"`");
  if(step.notes)intro.push(step.notes);
  intro.push("","### Input","```json",json(step.input),"```","",
    "### Output","```json",json(step.output),"```","");
 }
 return intro.join("\n")+"\n";
}

export function writeFrameworkTrace(trace,directory){
 mkdirSync(directory,{recursive:true});
 const filename="framework-trace-"+safeName(trace.traceId);
 const outputs={
  json:join(directory,filename+".json"),
  jsonl:join(directory,filename+".jsonl"),
  markdown:join(directory,filename+".md")
 };
 writeFileSync(outputs.json,json(trace)+"\n");
 writeFileSync(outputs.jsonl,trace.stages.map(step=>JSON.stringify({
  format:trace.format,traceId:trace.traceId,...step
 })).join("\n")+"\n");
 writeFileSync(outputs.markdown,traceMarkdown(trace));
 return outputs;
}
