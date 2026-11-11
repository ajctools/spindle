import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {mediaCommand,probeVideo} from './film.mjs';
const ffmpeg=()=>process.env.SPINDLE_FFMPEG || 'ffmpeg',ffprobe=()=>process.env.SPINDLE_FFPROBE || 'ffprobe';
function local(directory,url,kind){
  const pattern=kind==='video'?/^\/assets\/[a-f0-9-]+\.mp4$/:/^\/assets\/[a-f0-9-]+\.(?:wav|mp3)$/;
  if(!pattern.test(url || ''))throw new Error('Choose a saved '+kind+' asset from this Spindle library.');return path.join(directory,path.basename(url));
}
export function soundOptions(value={}){
  const originalVolume=value.originalVolume ?? 0,musicVolume=value.musicVolume ?? .15,offset=value.offset ?? 0;
  if(typeof originalVolume!=='number'||!Number.isFinite(originalVolume)||originalVolume<0||originalVolume>1||typeof musicVolume!=='number'||!Number.isFinite(musicVolume)||musicVolume<0||musicVolume>1||typeof offset!=='number'||!Number.isFinite(offset)||offset<0||offset>60)throw new Error('Use audio levels from 0 to 1 and a voice offset from 0 to 60 seconds.');
  return {originalVolume,musicVolume,offset,fit:value.fit===true};
}
async function audioInfo(file,signal){
  const {stdout}=await mediaCommand(ffprobe(),['-v','error','-protocol_whitelist','file,pipe','-select_streams','a:0','-show_entries','stream=index,duration:format=duration','-of','json',file],{signal});
  const data=JSON.parse(stdout);return {exists:!!data.streams?.length,seconds:Number(data.streams?.[0]?.duration || data.format?.duration)};
}
export async function extractSoundtrack(directory,url,{signal}={}){
  const input=local(directory,url,'video'),name=randomUUID()+'.wav',output=path.join(directory,name),info=await audioInfo(input,signal);
  if(!info.exists)throw new Error('This video has no audio track. Enter the intended words directly.');
  if(!Number.isFinite(info.seconds)||info.seconds>900)throw new Error('Transcribe a video of up to 15 minutes.');
  try{await mediaCommand(ffmpeg(),['-v','error','-nostdin','-y','-protocol_whitelist','file,pipe','-i',input,'-vn','-ac','1','-ar','16000','-c:a','pcm_s16le','-map_metadata','-1',output],{signal});return {url:'/assets/'+name,mime:'audio/wav',label:'Original soundtrack for transcription'};}
  catch(e){await fs.rm(output,{force:true});throw e;}
}
export async function replaceSoundtrack(directory,{video,voice,music,options},{signal}={}){
  const settings=soundOptions(options),input=local(directory,video,'video'),speech=local(directory,voice,'audio'),meta=await probeVideo(directory,video,{signal}),spoken=await audioInfo(speech,signal);
  if(!spoken.exists||!Number.isFinite(spoken.seconds)||spoken.seconds<=0)throw new Error('The speech model did not return usable audio.');
  const remaining=meta.seconds-settings.offset;if(remaining<=0)throw new Error('The voice starts after the video ends. Choose an earlier offset.');
  const speed=Math.max(1,spoken.seconds/remaining);
  if(speed>1.005&&!settings.fit)throw new Error('The speech is '+spoken.seconds.toFixed(1)+'s, but only '+remaining.toFixed(1)+'s is available. Shorten the script or enable gentle timing adjustment. The generated voice is saved.');
  if(settings.fit&&speed>1.35)throw new Error('The script needs more than 1.35× speed to fit. Shorten it for intelligible speech. The generated voice is saved.');
  const original=await audioInfo(input,signal),name=randomUUID()+'.mp4',output=path.join(directory,name),args=['-v','error','-nostdin','-y','-protocol_whitelist','file,pipe','-i',input,'-protocol_whitelist','file,pipe','-i',speech],filters=[];
  let index=2;const beds=[];
  if(settings.originalVolume>0&&original.exists){filters.push('[0:a:0]aresample=48000,volume='+settings.originalVolume+',apad,atrim=duration='+meta.seconds+'[original]');beds.push('[original]');}
  if(music){const bed=local(directory,music,'audio'),track=await audioInfo(bed,signal);if(!track.exists)throw new Error('The selected background file has no audio track.');args.push('-stream_loop','-1','-protocol_whitelist','file,pipe','-i',bed);filters.push('['+index+':a:0]aresample=48000,volume='+settings.musicVolume+',atrim=duration='+meta.seconds+'[music]');beds.push('[music]');index++;}
  filters.push('[1:a:0]aresample=48000,'+(settings.fit&&speed>1?'atempo='+speed+',':'')+'loudnorm=I=-16:TP=-1.5:LRA=11,adelay='+Math.round(settings.offset*1000)+':all=1,apad,atrim=duration='+meta.seconds+'[spoken]');
  if(beds.length){if(beds.length>1)filters.push(beds.join('')+'amix=inputs='+beds.length+':duration=longest:normalize=0[bed]');else filters.push(beds[0]+'anull[bed]');filters.push('[spoken]asplit=2[sidechain][voice]','[bed][sidechain]sidechaincompress=threshold=0.02:ratio=8:attack=20:release=300[ducked]','[voice][ducked]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95[out]');}
  else filters.push('[spoken]alimiter=limit=0.95[out]');
  args.push('-filter_complex',filters.join(';'),'-map','0:v:0','-map','[out]','-c:v','copy','-c:a','aac','-ar','48000','-ac','2','-t',String(meta.seconds),'-map_metadata','-1','-movflags','+faststart',output);
  try{await mediaCommand(ffmpeg(),args,{signal,timeout:180000});const result=await probeVideo(directory,'/assets/'+name,{signal});if(result.frames!==meta.frames)throw new Error('Soundtrack replacement changed the video frame count. Original media is preserved.');return {url:'/assets/'+name,mime:'video/mp4',label:'Video with replacement soundtrack',metadata:result};}
  catch(e){await fs.rm(output,{force:true});throw e;}
}
