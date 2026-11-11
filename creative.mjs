// Built-in creative workflow contracts. Model choices come from the live catalog.
export const creativeModels={
  text:'Qwen/Qwen-Image-2.1-PE-T2I',edit:'Qwen/Qwen-Image-2.1-PE-I2I',
  image:'Qwen/Qwen-Image-2.1',video:'lightx2v/MiniMax-H3-Turbo'
};
export function creativeModel(models,id,task){
  const exact=models.find(m=>m.id===id&&m.tasks.includes(task));
  if(exact)return exact;
  const name=id.split('/').at(-1).toLowerCase();
  return models.find(m=>m.id.split('/').at(-1).toLowerCase()===name&&m.tasks.includes(task));
}
export function requireCreativeModel(models,id,task){
  const model=models.find(m=>m.id===id&&m.tasks.includes(task));
  if(!model?.installed)throw new Error('Download a compatible '+task+' model in Models first: '+id);
  return model;
}
export function imageRecipe({prompt,hasImage,enhancer,image}){
  if(typeof prompt!=='string'||!prompt.trim())throw new Error(hasImage?'Describe the change you want to make.':'Start with a phrase or image idea.');
  return [{task:'chat',model:enhancer,prompt:'{{input}}',fileFrom:hasImage?'input':'none',params:{_spindleEnhancer:hasImage?'edit':'text',_spindleWebSearch:{enabled:false}}},
    {task:'image',model:image,prompt:'{{previous.text}}',fileFrom:hasImage?'input':'none',params:{}}];
}
export function enhancerInstruction(kind){
  if(!['text','edit'].includes(kind))throw new Error('Unknown prompt enhancer mode.');
  return kind==='edit'
    ? 'Rewrite the user\'s image editing instruction for Qwen Image. Ground the instruction in the supplied image. Specify the requested changes clearly and preserve the subject identity and all unrequested content. Preserve exact requested visible text in its original language. Return only JSON with rewritten_prompt (one paragraph), wh_ratio (W:H or empty), and ratio_follow ("<image1>" when retaining the source proportions, otherwise empty).'
    : 'Expand the user\'s image idea into a coherent, detailed visual description for Qwen Image. Preserve all specified subjects, counts, colors, composition and exact visible text in its original language. Describe the medium, placement, materials, lighting and overall composition. Return only JSON with rewritten_prompt (one English paragraph) and wh_ratio (W:H). Do not put dimensions or aspect ratios into rewritten_prompt.';
}
export function enhancedPrompt(text){
  const source=String(text||'').trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
  let value;try{value=JSON.parse(source);}catch{throw new Error('The prompt enhancer did not return valid JSON. Review its output before trying again.');}
  if(typeof value.rewritten_prompt!=='string'||!value.rewritten_prompt.trim())throw new Error('The prompt enhancer returned no rewritten_prompt.');
  return {text:value.rewritten_prompt.trim(),enhancement:{whRatio:typeof value.wh_ratio==='string'?value.wh_ratio:'',ratioFollow:typeof value.ratio_follow==='string'?value.ratio_follow:''}};
}
export function filmDuration(seconds,acknowledged=false){
  if(!Number.isSafeInteger(seconds)||seconds<1||seconds>60)throw new Error('Choose a whole-number video duration from 1 to 60 seconds.');
  if(seconds>30&&acknowledged!==true)throw new Error('Videos longer than 30 seconds can take a very long time and may fail. Acknowledge the long-run warning to continue.');
  return seconds;
}
