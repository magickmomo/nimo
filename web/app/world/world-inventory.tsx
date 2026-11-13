"use client";

type Fruit = {id:number;fruit:"amber"|"blue"|"red"};
type Supply = {id:number;kind:string;water_units:number};
type Item = {key:string;name:string;kind:string;variant?:string;water?:number};

function ItemIcon({item}:{item:Item}) {
  if(item.kind==="fruit")return <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">
    <path d="M16 11 C10 4 4 10 6 19 C8 29 14 29 16 26 C18 29 25 29 27 19 C29 10 22 5 16 11Z" fill={item.variant==="amber"?"#e5ad45":item.variant==="blue"?"#6a9fd6":"#d66561"} stroke="#58412c" strokeWidth="1.5"/>
    <path d="M16 12 C16 8 17 5 20 3" stroke="#62513b" strokeWidth="2" fill="none" strokeLinecap="round"/>
    <path d="M17 7 Q24 2 27 8 Q22 12 17 7Z" fill="#55966e" stroke="#365e47" strokeWidth="1"/>
    <circle cx="12" cy="15" r="2.5" fill="#fff" opacity=".35"/>
  </svg>;
  if(item.kind==="watering_can")return <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">
    <path d="M7 13 H22 L20 27 H9Z" fill="#75a6b0" stroke="#344f5b" strokeWidth="1.8" strokeLinejoin="round"/>
    <path d="M22 16 L29 12 M24 19 L30 16 M9 13 V9 Q9 3 15 3 Q21 3 21 10" stroke="#344f5b" strokeWidth="2.5" fill="none" strokeLinecap="round"/>
    <path d="M14 17 V22 M11.5 19.5 H16.5" stroke="#e1f3ea" strokeWidth="1.8"/>
  </svg>;
  if(item.kind==="seed_packet")return <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">
    <path d="M7 5 H25 V28 H7Z" fill="#e4c592" stroke="#77583f" strokeWidth="1.8"/>
    <path d="M10 10 H22" stroke="#b18e60" strokeWidth="1.5"/>
    <path d="M16 25 V17 M16 20 C10 20 10 15 10 15 C15 14 16 17 16 20 M16 18 C16 13 21 13 22 13 C22 17 19 19 16 18" stroke="#47764d" strokeWidth="1.6" fill="#75ae72" strokeLinejoin="round"/>
  </svg>;
  if(item.kind==="crop")return <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">
    <path d="M16 28 V8 M16 22 L8 15 M16 16 L24 8" stroke="#527a4b" strokeWidth="2.4" fill="none"/>
    <path d="M15 18 Q4 19 5 10 Q14 9 15 18 M17 13 Q18 3 27 5 Q27 13 17 13 M17 26 Q27 24 26 17 Q18 17 17 26" fill="#7bb475" stroke="#527a4b" strokeWidth="1.3"/>
  </svg>;
  return <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">
    <rect x="7" y="8" width="18" height="18" rx="3" fill="#9eaeb3" stroke="#435d61" strokeWidth="1.8"/>
    <path d="M11 12 H21 M11 16 H21" stroke="#edf1eb" strokeWidth="1.5"/>
  </svg>;
}

export default function WorldInventory({fruits,supplies,capacity}:{fruits:Fruit[];supplies:Supply[];capacity:number}) {
  const items:Item[]=[
    ...fruits.map(f=>({key:"fruit-"+f.id,kind:"fruit",variant:f.fruit,name:f.fruit+" fruit"})),
    ...supplies.map(s=>({key:"supply-"+s.id,kind:s.kind,water:s.water_units,
      name:s.kind==="watering_can"?"Watering can ("+s.water_units+"/3 water)":s.kind==="seed_packet"?"Seed packet":s.kind==="crop"?"Harvested crop":s.kind.replaceAll("_"," ")}))
  ];
  const slots=Array.from({length:Math.max(capacity,items.length)},(_,index)=>items[index]??null);
  return <aside className="nimo-inventory-rail" aria-label={"Inventory: "+items.length+" of "+capacity+" slots occupied"}>
    <div className="nimo-inventory-heading">Bag <span>{items.length}/{capacity}</span></div>
    <div className="nimo-inventory-slots">
      {slots.map((item,index)=><div key={item?.key??"empty-"+index}
        className={"nimo-inventory-slot"+(item?" is-filled":"")}
        tabIndex={item?0:undefined}
        aria-label={item?("Slot "+(index+1)+": "+item.name):("Slot "+(index+1)+": empty")}
        title={item?.name??"Empty slot"}>
        {item&&<><ItemIcon item={item}/><span className="nimo-inventory-tooltip" role="tooltip">{item.name}</span></>}
      </div>)}
    </div>
  </aside>;
}
