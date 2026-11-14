import {csvCell} from './security.mjs';
export const tasks = {
  chat: { label: 'Chat & vision', types: ['Text Generation','Image-Text-to-Text'], input: 'text', output: 'text', route: '/v1/chat/completions', transport: 'openai' },
  image: { label: 'Images', types: ['Text-to-Image'], input: 'text', output: 'image', route: '/v1/image/generate' },
  asr: { label: 'Transcribe', types: ['ASR','Speech Recognition (ASR)'], input: 'audio', output: 'text', route: '/v1/audio/transcriptions', transport: 'openai' },
  speech: { label: 'Speech', types: ['Text-to-Speech'], input: 'text', output: 'audio', route: '/v1/audio/speech', transport: 'openai' },
  music: { label: 'Music', types: ['Music Generation'], input: 'text', output: 'audio', route: '/v1/music/generate/wav' },
  video: { label: 'Video', types: ['Text-to-Video','Image-to-Video'], input: 'text', output: 'video', route: '/v1/videos' },
  ocr: { label: 'Read documents', types: ['Image-to-Text'], input: 'image', output: 'text', route: '/v1/ocr' },
  mesh: { label: '3D objects', types: ['Image-to-3D'], input: 'image', output: 'model', route: '/v1/3d/tasks' },
  decision: { label: 'Classify & route', types: ['Text Classification'], input: 'text', output: 'json', route: '/v1/systemone' },
  embed: { label: 'Embeddings', types: ['Text Embedding'], input: 'text', output: 'json', route: '/v1/embeddings', transport: 'openai' },
  rerank: { label: 'Rank documents', types: ['Text Reranking'], input: 'text', output: 'json', route: '/v1/rerank', transport: 'openai' }
};
export function list(d) { return Array.isArray(d) ? d : (Array.isArray(d?.data) ? d.data : []); }
export function normalize(store, local, loaded) {
  const nonnegative=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0?v:null;
  const by = new Map();
  for (const m of list(store)) by.set(m.model_id || m.fullname || m.id, { store: m });
  for (const m of list(local)) { const id=m.model_id || m.fullname || m.id; by.set(id, { ...by.get(id), local: m }); }
  const running = new Map(list(loaded).map(m => [m.id || m.model_id, m]));
  return [...by].map(([id, {store:s, local:l}]) => {
    const m={...s,...l}; const active=running.get(id); const tag=s?.tags?.[0];
    return { id, name:m.display_name || m.name || id, type:m.type || 'Unknown',
      tasks:Object.keys(tasks).filter(k=>tasks[k].types.includes(m.type)),
      installed:!!l, loaded:!!active, available:!!s, source:l?.owned_by || (s?'Model store':'Custom'),
      npu:nonnegative(m.npu_usage), storeNpu:nonnegative(s?.npu_usage), size:nonnegative(m.total_size || m.size || tag?.size),
      params:m.params || null, input:m.input || null, output:m.output || null,
      capabilities:m.capabilities || [], supported:m.supported || [], thinking:active?.thinking || m.thinking || null,
      reasoningLevels:active?.reasoning_levels || m.reasoning_levels || [], context:active?.context_window || m.context_window || null,
      updated:m.udpate_time || m.updated_time || null, version:m.version_label || tag?.version || null,
      updateAvailable:!!m.need_update, description:m.desc || '',
      evidence:'Device-reported metadata; inference support requires runtime validation' };
  }).sort((a,b)=>Number(b.loaded)-Number(a.loaded)||Number(b.installed)-Number(a.installed)||a.name.localeCompare(b.name));
}
export function csv(models) {
  const keys=['id','name','type','installed','loaded','available','source','npu','storeNpu','size','params','input','output','capabilities','supported','context','version','updated','evidence'];
  const esc=csvCell;
  return [keys.map(esc).join(','),...models.map(m=>keys.map(k=>esc(m[k])).join(','))].join('\r\n');
}
export function parseDataUrl(file,maxBytes=40*1024*1024,sizeError='Files must be under 40 MiB.') {
  const match=/^data:([^;,]+);base64,([A-Za-z0-9+/=\r\n]+)$/.exec(file?.data || '');
  if(!match) throw new Error('Select a valid file first.');
  const buffer=Buffer.from(match[2],'base64');
  if(buffer.length>maxBytes) throw new Error(sizeError);
  return {mime:match[1],buffer,name:file.name || 'input'};
}
export function validatePCM(file) {
  const {buffer:b}=parseDataUrl(file);
  if(b.toString('ascii',0,4)!=='RIFF'||b.toString('ascii',8,12)!=='WAVE')throw new Error('Transcription needs a PCM WAV file, mono, 16 kHz, 16-bit.');
  let fmt=false;
  for(let i=12;i+8<=b.length;) {const size=b.readUInt32LE(i+4);if(b.toString('ascii',i,i+4)==='fmt '&&size>=16&&i+24<=b.length) {fmt=true;if(b.readUInt16LE(i+8)!==1||b.readUInt16LE(i+10)!==1||b.readUInt32LE(i+12)!==16000||b.readUInt16LE(i+22)!==16)throw new Error('Convert audio to mono 16 kHz, 16-bit PCM WAV before transcription.');break;}i+=8+size+(size%2);}
  if(!fmt)throw new Error('This WAV file has no valid PCM format header.');
}
export function transcriptionPCM(file){
  const {buffer:b}=parseDataUrl(file);let fmt=null,data=null;
  if(b.toString('ascii',0,4)!=='RIFF'||b.toString('ascii',8,12)!=='WAVE')return file;
  for(let i=12;i+8<=b.length;){const n=b.readUInt32LE(i+4),kind=b.toString('ascii',i,i+4);if(kind==='fmt '&&n>=16&&i+24<=b.length)fmt={tag:b.readUInt16LE(i+8),channels:b.readUInt16LE(i+10),rate:b.readUInt32LE(i+12),bits:b.readUInt16LE(i+22)};if(kind==='data')data=b.subarray(i+8,Math.min(i+8+n,b.length));i+=8+n+(n%2);}
  if(!fmt||!data||fmt.tag!==1||fmt.bits!==16||!fmt.channels||!fmt.rate)return file;
  if(fmt.channels===1&&fmt.rate===16000)return file;
  const sourceFrames=Math.floor(data.length/(fmt.channels*2)),frames=Math.floor(sourceFrames*16000/fmt.rate),out=Buffer.alloc(44+frames*2);
  out.write('RIFF');out.writeUInt32LE(36+frames*2,4);out.write('WAVEfmt ',8);out.writeUInt32LE(16,16);out.writeUInt16LE(1,20);out.writeUInt16LE(1,22);out.writeUInt32LE(16000,24);out.writeUInt32LE(32000,28);out.writeUInt16LE(2,32);out.writeUInt16LE(16,34);out.write('data',36);out.writeUInt32LE(frames*2,40);
  const sample=frame=>{let v=0;for(let c=0;c<fmt.channels;c++)v+=data.readInt16LE((Math.min(sourceFrames-1,frame)*fmt.channels+c)*2);return v/fmt.channels;};
  for(let i=0;i<frames;i++){const position=i*fmt.rate/16000,left=Math.floor(position),fraction=position-left;out.writeInt16LE(Math.max(-32768,Math.min(32767,Math.round(sample(left)*(1-fraction)+sample(left+1)*fraction))),44+i*2);}
  return {name:(file.name || 'audio').replace(/\.[^.]+$/,'')+'.wav',data:'data:audio/wav;base64,'+out.toString('base64')};
}
export function expandPrompt(template, input, previous) {
  return String(template || '{{previous.text}}').replaceAll('{{input}}', input || '').replaceAll('{{previous.text}}', previous?.text || '');
}
