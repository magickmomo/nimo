import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";

const read=path=>readFileSync(new URL(path,import.meta.url),"utf8");

test("action toasts are overlaid inside world viewport, separate from zoom controls",()=>{
 const page=read("../../web/app/world/page.tsx");
 const map=read("../../web/app/world/isometric-world.tsx");
 assert.doesNotMatch(page,/className="world-card world-action-monitor"/);
 assert.match(page,/actionTrace=\{isOwner \? recentActionToasts : \[\]\}/);
 assert.match(map,/className="nimo-map-bottom-bar"/);
 assert.ok(map.indexOf('className="nimo-action-stack"') < map.indexOf('className="nimo-map-bottom-bar"'),"Toasts must sit outside the control bar");
 assert.match(map,/className="nimo-map-controls"/);
 assert.match(map,/actionTrace\.slice\(0,4\)/);
 assert.match(map,/nimo-action-age-/);
});

test("upward fade shows newest and two preceding, revealing a third predecessor on hover or focus",()=>{
 const css=read("../../web/app/world/world.css");
 assert.match(css,/\.nimo-action-age-0\{bottom:0;opacity:1/);
 assert.match(css,/\.nimo-action-age-1\{bottom:66px;opacity:\.56/);
 assert.match(css,/\.nimo-action-age-2\{bottom:132px;opacity:\.3/);
 assert.match(css,/\.nimo-action-age-3\{bottom:198px;opacity:0/);
 assert.match(css,/\.nimo-action-stack:hover \.nimo-action-toast/);
 assert.match(css,/\.nimo-action-stack\{position:absolute;top:12px;left:14px/);
 assert.match(css,/\.nimo-map-bottom-bar\{display:flex;justify-content:flex-end/);
 assert.match(css,/\.nimo-action-stack:focus-within \.nimo-action-toast/);
 assert.match(css,/prefers-reduced-motion:reduce/);
});

test("fast refresh supplies actual public actions rather than technical decisions",()=>{
 const worker=read("../src/index.ts");
 const page=read("../../web/app/world/page.tsx");
 assert.match(worker,/events:await publicEvents\(env\.DB,24\)/);
 assert.match(page,/event\.kind === "thought"/);
 assert.match(page,/\["ACT","THINK","OBSERVE","REMEMBER"\]/);
 assert.match(page,/showActionToasts=\{isOwner\}/);
});
