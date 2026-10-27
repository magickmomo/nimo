import {NextResponse} from "next/server";
export const runtime="nodejs";
type Message={role:"user"|"assistant";content:string};
export async function POST(request:Request){
  const key=process.env.OPENAI_API_KEY;
  if(!key)return NextResponse.json({error:"LLM API key not configured on the server."},{status:503});
  let body:unknown;try{body=await request.json()}catch{return NextResponse.json({error:"Invalid JSON"},{status:400})}
  const data=body as {messages?:unknown};
  if(!Array.isArray(data?.messages)||data.messages.length===0||data.messages.length>30||!data.messages.every((m:unknown)=>{if(!m||typeof m!=="object")return false;const v=m as Record<string,unknown>;return (v.role==="user"||v.role==="assistant")&&typeof v.content==="string"&&v.content.length<=1200;}))return NextResponse.json({error:"Invalid messages"},{status:400});
  const messages=data.messages as Message[];
  if(messages.at(-1)?.role!=="user")return NextResponse.json({error:"Last message must be from user"},{status:400});
  try{const response=await fetch("https://api.openai.com/v1/chat/completions",{method:"POST",headers:{"Authorization":`Bearer ${key}`,"Content-Type":"application/json"},body:JSON.stringify({model:process.env.OPENAI_MODEL||"gpt-4.1-mini",max_tokens:300,messages:[{role:"system",content:"You are Nimo, a small curious companion robot in development. You are warm, playful, observant and concise. You are not human or conscious; never pretend to have sensors, movement, memory, or real-world awareness you do not possess. You can chat, and you are excited to learn about the world with your human. Avoid making up device status."},...messages]})});const result=await response.json();if(!response.ok)return NextResponse.json({error:"LLM provider request failed"},{status:502});const reply=result?.choices?.[0]?.message?.content;if(typeof reply!=="string")return NextResponse.json({error:"No response generated"},{status:502});return NextResponse.json({reply});}catch{return NextResponse.json({error:"LLM service unavailable"},{status:502})}
}
