import test from "node:test";
import assert from "node:assert/strict";
import {validateDecision,evaluate} from "./benchmark.mjs";

const w={availableActions:["eat_fruit","travel_to"],inventory:["amber"],coins:3};
test("accepts valid food action",()=>{
 const d={action:"ACT",monologue:"I should eat.",toolCall:{name:"eat_fruit",fruit:"amber"}};
 assert.equal(validateDecision(d,w),null);
 assert.equal(evaluate({expected:"eat_fruit"},d),true);
});
test("rejects invented tools and invalid moves",()=>{
 assert.match(validateDecision({action:"ACT",monologue:"hello",toolCall:{name:"ask_oracle",question:"Why?"}},w),/Unavailable/);
 assert.match(validateDecision({action:"ACT",monologue:"hello",toolCall:{name:"travel_to",x:90,y:2}},w),/Invalid/);
});
test("does not confuse thinking with a tool action",()=>{
 assert.equal(validateDecision({action:"THINK",monologue:"Rest.",toolCall:null},w),null);
 assert.match(validateDecision({action:"THINK",monologue:"Rest.",toolCall:{name:"eat_fruit",fruit:"amber"}},w),/Non-ACT/);
});
