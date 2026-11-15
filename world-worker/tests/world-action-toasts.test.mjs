import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";

const read=path=>readFileSync(new URL(path,import.meta.url),"utf8");

test("last actions are shown next to zoom controls, not in the separate dashboard card",()=>{
 const page=read("../../web/app/world/page.tsx");
 const map=read("../../web/app/world/isometric-world.tsx");
 assert.doesNotMatch(page,/className="world-card world-action-monitor"/);
 assert.match(page,/actionTrace=\{isOwner \? recentActions : \[\]\}/);
 assert.match(map,/className="nimo-map-bottom-bar"/);
 assert.match(map,/className="nimo-map-controls"/);
 assert.match(map,/actionTrace\.slice\(0,4\)/);
 assert.match(map,/nimo-action-age-/);
});

test("upward fade shows newest and two preceding, revealing a third predecessor on hover or focus",()=>{
 const css=read("../../web/app/world/world.css");
 assert.match(css,/\.nimo-action-age-0\{bottom:0;opacity:1/);
 assert.match(css,/\.nimo-action-age-1\{bottom:48px;opacity:\.56/);
 assert.match(css,/\.nimo-action-age-2\{bottom:96px;opacity:\.3/);
 assert.match(css,/\.nimo-action-age-3\{bottom:144px;opacity:0/);
 assert.match(css,/\.nimo-action-stack:hover \.nimo-action-toast/);
 assert.match(css,/\.nimo-action-stack:focus-within \.nimo-action-toast/);
 assert.match(css,/prefers-reduced-motion:reduce/);
});

test("fast refresh contains actions while public users do not receive owner trace",()=>{
 const worker=read("../src/index.ts");
 const live=read("../../web/app/api/world/live/route.ts");
 assert.match(worker,/actionTrace:await recentTrace\(env\.DB\)/);
 assert.match(live,/delete body\.actionTrace/);
});
