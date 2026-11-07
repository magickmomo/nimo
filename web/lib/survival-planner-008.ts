import {actions008,key008,travelCost008,type Action008,type Fruit008,type Memory008,type State008,type Tree008} from "./survival-008";
const relief=(m:Memory008|undefined)=>m?.mean!=null?Math.max(0,-m.mean):m?.minimumRelief??0;
/** Hunger-only policy: uses observed outcomes, not hidden fruit effects/stock. */
export function localDecision008(s:State008,rate=1):{action:Action008;reason:string}{
 const menu=actions008(s),can=(a:Action008)=>menu.some(v=>key008(v)===key008(a));
 const wait=(seconds:number,reason:string)=>({action:{type:"wait",seconds:([1,5,10,20] as const).find(x=>x>=seconds)??20} as Action008,reason});
 const carried=s.inventory.map(f=>({fruit:f,value:relief(s.memory[f]),memory:s.memory[f]}));
 const good=carried.filter(x=>x.value>0).sort((a,b)=>b.value-a.value)[0];
 const harmful=carried.find(x=>x.memory?.harmful&&!x.value);
 if(harmful)return{action:{type:"discard",fruit:harmful.fruit},reason:"Discard fruit with observed harmful effects."};
 const untested=carried.find(x=>!x.memory);
 if(untested&&s.hunger>=38)return{action:{type:"eat",fruit:untested.fruit},reason:"Test unknown fruit at an informative hunger level."};
 if(good){const threshold=Math.max(12,Math.ceil(good.value-rate));
  if(s.hunger>=threshold)return{action:{type:"eat",fruit:good.fruit},reason:"Eat reliable food when relief won't be wasted."};
  if(s.inventory.length===3){
   const backup=s.trees.filter(t=>!t.seenFruit).sort((a,b)=>travelCost008(s,a)-travelCost008(s,b))[0];
   if(backup&&s.hunger<Math.min(60,threshold)){const cost=travelCost008(s,backup);
    if(cost===0)return{action:{type:"inspect",treeId:backup.id},reason:"Investigate backup food while carrying provisions."};
    if(Number.isFinite(cost)&&s.hunger+rate*(cost+2)<threshold)
     return{action:{type:"travel",treeId:backup.id},reason:"Explore while carrying enough food for the journey."};}
   return wait(Math.max(1,Math.min(20,Math.ceil((threshold-s.hunger)/Math.max(rate,.1)))),"Save food until it is worthwhile.");
  }
 }
 const knownGood=s.trees.filter(t=>t.seenFruit&&relief(s.memory[t.seenFruit])>0);
 const available=knownGood.filter(t=>(t.seenStock??0)>0).sort((a,b)=>travelCost008(s,a)-travelCost008(s,b));
 if(s.inventory.length<3&&available.length){const t=available[0],cost=travelCost008(s,t);
  if(cost===0&&can({type:"pick",treeId:t.id}))return{action:{type:"pick",treeId:t.id},reason:"Store reliable food as a reserve."};
  if(cost<=3||s.inventory.length===0)return{action:{type:"travel",treeId:t.id},reason:"Travel to known reliable food."};
 }
 if(s.inventory.length<3&&!knownGood.length){
  const samples=s.trees.filter(t=>t.seenFruit&&!s.memory[t.seenFruit]&&(t.seenStock??0)>0)
   .sort((a,b)=>travelCost008(s,a)-travelCost008(s,b));
  if(samples.length){const t=samples[0],cost=travelCost008(s,t);
   return{action:cost===0?{type:"pick",treeId:t.id}:{type:"travel",treeId:t.id},
    reason:"Try fruit whose effects are not yet known."};}
 }
 if(s.inventory.length>0&&s.hunger<65){
  const other=s.trees.filter(t=>!t.seenFruit).sort((a,b)=>travelCost008(s,a)-travelCost008(s,b))[0];
  if(other){const cost=travelCost008(s,other);
   if(cost===0)return{action:{type:"inspect",treeId:other.id},reason:"Identify alternative food."};
   if(Number.isFinite(cost)&&s.hunger+rate*(cost+3)<85)
    return{action:{type:"travel",treeId:other.id},reason:"Look for alternatives before food runs out."};}
 }
 if(untested)return{action:{type:"eat",fruit:untested.fruit},reason:"Learn the consequences of carried unknown fruit."};
 if(good){const threshold=Math.max(12,Math.ceil(good.value-rate));
  return wait(Math.max(1,Math.min(20,Math.ceil((threshold-s.hunger)/Math.max(rate,.1)))),"Keep food until needed.");}
 const unknown=s.trees.filter(t=>!t.seenFruit).sort((a,b)=>travelCost008(s,a)-travelCost008(s,b));
 if(unknown.length){const t=unknown[0];return{action:travelCost008(s,t)===0?
  {type:"inspect",treeId:t.id}:{type:"travel",treeId:t.id},reason:"Discover a food source."};}
 // All known supplies appeared depleted when last observed. That is historical
 // evidence, not a permanent fact: visit the most promising known food source
 // and inspect it again. Never read its hidden current stock or regrowth timer.
 // Nearby checks are preferred; otherwise travel to the shortest reachable tree.
 const recovery=knownGood.map(t=>({tree:t,distance:travelCost008(s,t),
  age:s.seconds-(t.seenAt??s.seconds)}))
  .filter(x=>Number.isFinite(x.distance))
  .sort((a,b)=>a.distance-b.distance||b.age-a.age||a.tree.id.localeCompare(b.tree.id));
 if(recovery.length){
  const candidate=recovery[0];
  if(candidate.distance===0){
   // Inspecting every second would just replace one stalled baseline with
   // a costly inspection loop. Recheck after a short interval instead.
   if(candidate.tree.seenStock===0&&candidate.age<5)
    return wait(5,"Nearby beneficial tree was just checked; allow time before checking again.");
   return {action:{type:"inspect",treeId:candidate.tree.id},
    reason:"Recheck previously depleted beneficial tree; last observation may be stale."};
  }
  return {action:{type:"travel",treeId:candidate.tree.id},
   reason:"Revisit beneficial tree because previously empty stock may have replenished."};
 }
 return wait(5,"No reachable known helpful fruit; wait briefly and reassess.");
}
