import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {filmTools,mediaCommand} from './film.mjs';
// Keep original model outputs. Small MP3 copies make spoken tours portable.
export async function museumAudio(asset,directory,{signal,cache={},channels=1}={}){
  if(!asset||asset.mime!=='audio/wav'||!/^\/assets\/[a-f0-9-]+\.wav$/.test(asset.url))return asset;
  const original=path.join(directory,path.basename(asset.url));if((await fs.stat(original)).size<1024*1024)return asset;
  const saved=cache[asset.url];if(saved&&(saved.channels || 1)===channels&&saved.mime==='audio/mpeg'&&/^\/assets\/[a-f0-9-]+\.mp3$/.test(saved.url)){try{await fs.access(path.join(directory,path.basename(saved.url)));return saved;}catch{}}
  const tools=await filmTools();if(!tools.available)return asset;
  signal?.throwIfAborted();const name=randomUUID()+'.mp3',target=path.join(directory,name);
  try{await mediaCommand(process.env.SPINDLE_FFMPEG || 'ffmpeg',['-v','error','-y','-i',original,'-vn','-ac',channels===2?'2':'1','-codec:a','libmp3lame','-b:a',channels===2?'128k':'96k',target],{signal});const packed={url:'/assets/'+name,mime:'audio/mpeg',label:'Museum audio · portable copy',originalUrl:asset.url,channels:channels===2?2:1};cache[asset.url]=packed;return packed;}catch(e){signal?.throwIfAborted();return asset;}
}
