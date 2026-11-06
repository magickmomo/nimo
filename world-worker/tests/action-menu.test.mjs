import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import ts from "typescript";

const source=readFileSync(new URL("../src/action-menu.ts",import.meta.url),"utf8");
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {buildActionMenu,decisionResponseFormat}=await import("data:text/javascript;base64,"+Buffer.from(js).toString("base64"));
const policy={mode:"seek_novelty",blockedInspectIds:["rock_002"],blockedNoteIds:["rock_002"]};
const directions=[
 {direction:"north",canInspect:true,objectId:"rock_002"},
 {direction:"east",canInspect:true,objectId:"tree_003"},
 {direction:"south",canInspect:false,objectId:null},
 {direction:"west",canInspect:false,objectId:null},
];
const objects=[{id:"rock_002"},{id:"tree_003"}];

test("only eligible tools and object targets reach the model",()=>{
 const menu=buildActionMenu(policy,directions,["rock_002","tree_003"],objects);
 assert.deepEqual(menu.inspectDirections,["east"]);
 assert.deepEqual(menu.noteObjectIds,["tree_003"]);
 assert.deepEqual(menu.tools,["write_document","travel_to","inspect","remember_object"]);
 const schema=decisionResponseFormat(menu).json_schema.schema;
 const variants=schema.properties.toolCall.anyOf;
 assert.deepEqual(variants.find(v=>v.properties?.name?.enum?.[0]==="inspect").properties.direction.enum,["east"]);
 assert.deepEqual(variants.find(v=>v.properties?.name?.enum?.[0]==="remember_object").properties.objectId.enum,["tree_003"]);
 assert.equal(JSON.stringify(schema).includes("rock_002"),false);
});

test("unavailable tool names disappear entirely when no target qualifies",()=>{
 const menu=buildActionMenu(policy,[directions[0]],["rock_002"],objects);
 assert.deepEqual(menu.tools,["write_document","travel_to"]);
 const schema=decisionResponseFormat(menu).json_schema.schema;
 const toolNames=schema.properties.toolCall.anyOf.flatMap(v=>v.properties?.name?.enum??[]);
 assert.deepEqual(toolNames,["write_document","travel_to"]);
});

test("visitor turn exposes no executable tools",()=>{
 const menu=buildActionMenu(policy,directions,["rock_002","tree_003"],objects,true);
 assert.deepEqual(menu.tools,[]);
 const schema=decisionResponseFormat(menu,true).json_schema.schema;
 assert.deepEqual(schema.properties.action.enum,["REPLY"]);
 assert.deepEqual(schema.properties.toolCall.anyOf,[{type:"null"}]);
});

test("normal mode offers adjacent inspections and seen object notes",()=>{
 const normal={mode:"normal",blockedInspectIds:[],blockedNoteIds:[]};
 const menu=buildActionMenu(normal,directions,["rock_002"],objects);
 assert.deepEqual(menu.inspectDirections,["north","east"]);
 assert.deepEqual(menu.noteObjectIds,["rock_002"]);
});
