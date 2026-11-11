// Representative standard API text rates, verified against the linked first-party pages.
// This is a dated, editable illustration, never a quote or a model-quality equivalence.
export const priceDate='2026-11-10';
export const cloudRates=[
  {provider:'Anthropic',model:'Claude Sonnet 5.5',input:2,output:10,url:'https://platform.claude.com/docs/en/about-claude/pricing'},
  {provider:'Google',model:'Gemini 3.5 Flash-Lite',input:.3,output:2.5,url:'https://ai.google.dev/gemini-api/docs/pricing#gemini-3.5-flash-lite'},
  {provider:'OpenRouter',model:'Qwen3.5-27B',input:.195,output:1.56,url:'https://openrouter.ai/qwen/qwen3.5-27b',note:'Example route · Alibaba Cloud'},
];
const count=n=>Number.isSafeInteger(n)&&n>=0;
export function cloudUsage(records){
  const chat=records.filter(r=>r.task==='chat'&&r.status==='completed');
  const eligible=chat.filter(r=>r.profile?.hasFile===false&&count(r.inputTokens)&&count(r.outputTokens));
  return {inputTokens:eligible.reduce((n,r)=>n+r.inputTokens,0),outputTokens:eligible.reduce((n,r)=>n+r.outputTokens,0),covered:eligible.length,completed:chat.length,excluded:chat.length-eligible.length};
}
export function cloudEstimate(usage,input,output){
  if(!usage?.covered||!count(usage.inputTokens)||!count(usage.outputTokens)||![input,output].every(v=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=100000))return null;
  return (usage.inputTokens*input+usage.outputTokens*output)/1000000;
}
export function formatCloudCost(amount,locale){
  if(amount===null)return '—';
  const digits=amount<1?4:2;
  const format=new Intl.NumberFormat(locale,{style:'currency',currency:'USD',minimumFractionDigits:digits,maximumFractionDigits:digits});
  const minimum=0.0001;
  return amount>0&&amount<minimum?'<'+format.format(minimum):format.format(amount);
}
