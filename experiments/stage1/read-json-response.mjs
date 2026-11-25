/** Consume an HTTP JSON response exactly once, retaining original response bytes. */
export async function readJsonResponse(response,path){
  if(!response.ok){
    const detail=(await response.text()).slice(0,180);
    throw new Error(`HTTP ${response.status} exporting ${path}: ${detail}`);
  }
  const bytes=Buffer.from(await response.arrayBuffer());
  if(bytes.length===0)throw new Error('Empty export: '+path);
  return {bytes,parsed:JSON.parse(bytes.toString('utf8'))};
}
