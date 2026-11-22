import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";

const panel=readFileSync(new URL("../app/world/world-requests-panel.tsx",import.meta.url),"utf8");
const css=readFileSync(new URL("../app/world/world.css",import.meta.url),"utf8");

test("Requests popup has separate active and implemented tabs",()=>{
 assert.match(panel,/role="tablist" aria-label="Request status groups"/);
 assert.match(panel,/role="tab" id="nimo-requests-active-tab"/);
 assert.match(panel,/role="tab" id="nimo-requests-implemented-tab"/);
 assert.match(panel,/role="tabpanel"/);
 assert.match(panel,/aria-selected={tab==="active"}/);
 assert.match(panel,/aria-selected={tab==="implemented"}/);
});

test("implemented requests are excluded from the active tab without removing them from the inbox",()=>{
 assert.match(panel,/const implemented=items\.filter\(x=>x\.status==="implemented"\)\.length/);
 assert.match(panel,/const active=items\.length-implemented/);
 assert.match(panel,/visibleItems=items\.filter\(item=>tab==="implemented"\?item\.status==="implemented":item\.status!=="implemented"\)/);
 assert.match(panel,/visibleItems\.map\(item=>/);
 assert.match(panel,/No implemented requests yet/);
 assert.match(panel,/No active requests/);
});

test("existing request status editing and reply actions remain available in both tabs",()=>{
 assert.match(panel,/<option value="implemented">Implemented<\/option>/);
 assert.match(panel,/onClick=\{\(\)=>void submit\(item,false\)\}/);
 assert.match(panel,/onClick=\{\(\)=>void submit\(item,true\)\}/);
 assert.match(panel,/await load\(\)/);
});

test("tabs have a responsive and visible selected state",()=>{
 assert.match(css,/\.nimo-request-tabs button\.is-active/);
 assert.match(css,/\.nimo-request-tabs button:focus-visible/);
 assert.match(css,/@media\(max-width:600px\)\{\.nimo-request-tabs/);
});
