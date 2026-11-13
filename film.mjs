import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

const ffmpeg=()=>process.env.SPINDLE_FFMPEG || 'ffmpeg';
const ffprobe=()=>process.env.SPINDLE_FFPROBE || 'ffprobe';
export const NATIVE_CLIP_MAX_SECONDS=5;
export const nativeClipToolsNote='Request one Tiiny clip of 1–5 seconds. Its actual length depends on the model. Longer films and exact trimming need FFmpeg and FFprobe on the helper.';
export async function mediaCommand(command,args,{signal,timeout=120000}={}){
  const combined=AbortSignal.any([AbortSignal.timeout(timeout),...(signal?[signal]:[])]);
  combined.throwIfAborted();
  return new Promise((resolve,reject)=>{
    const child=spawn(command,args,{windowsHide:true,shell:false,signal:combined,stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='';
    child.stdout.on('data',b=>{stdout=(stdout+b).slice(-1000000);});
    child.stderr.on('data',b=>{stderr=(stderr+b).slice(-16000);});
    child.on('error',e=>reject(e.code==='ENOENT'?new Error('Install FFmpeg and FFprobe on this computer, then try again. Image creation works without them.'):e));
    child.on('close',code=>code===0?resolve({stdout,stderr}):reject(new Error(combined.aborted?'Local video processing stopped.':'Local video processing failed: '+stderr.slice(-1600))));
  });
}
export async function filmTools(){
  try{await Promise.all([mediaCommand(ffmpeg(),['-version'],{timeout:10000}),mediaCommand(ffprobe(),['-version'],{timeout:10000})]);return {available:true};}
  catch{return {available:false,note:'Install FFmpeg and FFprobe on this computer to extract frames and stitch video. Image creation works without them.'};}
}
// Prefer reported native frame counts. Some Tiiny H3 firmware omits them; in
// that case use the gateway's documented seconds interface, not an invented
// model-specific frame lattice. The gateway adds its reference boundary frame.
export function planFilm(info,seconds,source={},{nativeClip=false}={}){
  if(info.family!=='minimax_h3')throw new Error('This workflow needs a runtime reporting the minimax_h3 video family.');
  const fps=Number(info.fps);
  if(!Number.isFinite(fps)||fps<1||fps>120)throw new Error('The video runtime did not report a usable frame rate.');
  const reported=info.frame_options || info.frames_options || info.num_frames_options || info.supported_frames;
  let options=Array.isArray(reported)?reported.filter(n=>Number.isSafeInteger(n)&&n>1):[];
  if(Array.isArray(reported)&&reported.length&&!options.length)throw new Error('The video runtime reported invalid supported frame counts. Check Runtime info.');
  if(!options.length&&Number.isSafeInteger(info.default_frames)&&info.default_frames>1)options=[info.default_frames];
  options=[...new Set(options)].sort((a,b)=>a-b);
  const mode=options.length?'frames':'duration';
  const canvases=(info.canvases || []).filter(c=>Number.isSafeInteger(c.width)&&Number.isSafeInteger(c.height)&&c.width>0&&c.height>0&&c.width%2===0&&c.height%2===0);
  if(!canvases.length)throw new Error('The video runtime did not report a supported canvas.');
  const ratio=source.width&&source.height?source.width/source.height:16/9;
  canvases.sort((a,b)=>Math.abs(Math.log(a.width/a.height/ratio))-Math.abs(Math.log(b.width/b.height/ratio))||a.width*a.height-b.width*b.height);
  const canvas={width:canvases[0].width,height:canvases[0].height};
  const stepOptions=(info.step_options || []).filter(n=>Number.isSafeInteger(n)&&n>0);
  const steps=stepOptions.includes(info.default_steps)?info.default_steps:stepOptions[0] || (Number.isSafeInteger(info.default_steps)&&info.default_steps>0?info.default_steps:null);
  if(!steps)throw new Error('The video runtime did not report a supported generation step count.');
  const maxClipFrames=Math.round(NATIVE_CLIP_MAX_SECONDS*fps),totalFrames=Math.round(seconds*fps),segments=[];
  const chunk=mode==='frames'?Math.min(maxClipFrames,options.at(-1)-(nativeClip?0:1)):maxClipFrames;
  if(nativeClip&&totalFrames>chunk)throw new Error('This model needs multiple clips for that length. Try a shorter duration, or install FFmpeg and FFprobe on the helper.');
  for(let remaining=totalFrames;remaining>0;){
    const outputFrames=Math.min(chunk,remaining),skip=segments.length?1:0;
    const request=mode==='frames'?{frames:options.find(n=>n>=outputFrames+skip)}:{requestSeconds:Math.max(1,Math.ceil((outputFrames+skip-1.5)/fps))};
    segments.push({...request,outputFrames,skip,seconds:outputFrames/fps});remaining-=outputFrames;
    if(segments.length>120)throw new Error('This runtime only offers very short clips. Choose a shorter total duration.');
  }
  return {mode,fps,...canvas,steps,totalFrames,seconds,segments};
}
export function filmSegmentParams(plan,segment){
  return {fps:plan.fps,steps:plan.steps,...(segment.frames!==undefined
    ?{frames:segment.frames,width:plan.width,height:plan.height}
    :{seconds:segment.requestSeconds,size:plan.width+'x'+plan.height})};
}
function localAsset(directory,url){
  if(!/^\/assets\/[a-f0-9-]+\.(?:mp4|png|jpg|webp)$/.test(url||''))throw new Error('Choose an image or clip saved in this Spindle library.');
  return path.join(directory,path.basename(url));
}
export async function probeVideo(directory,url,{signal}={}){
  const {stdout}=await mediaCommand(ffprobe(),['-v','error','-protocol_whitelist','file,pipe','-select_streams','v:0','-count_frames','-show_entries','stream=width,height,nb_read_frames,r_frame_rate:format=duration','-of','json',localAsset(directory,url)],{signal});
  const data=JSON.parse(stdout),v=data.streams?.[0];
  if(!v||!Number.isFinite(Number(v.nb_read_frames)))throw new Error('The generated clip has no readable video frames.');
  return {width:v.width,height:v.height,frames:Number(v.nb_read_frames),seconds:Number(data.format?.duration)};
}
export async function normalizeClip(directory,url,plan,index,{signal}={}){
  const segment=plan.segments[index],input=localAsset(directory,url),name=randomUUID()+'.mp4',output=path.join(directory,name);
  const meta=await probeVideo(directory,url,{signal});
  // A shorter-than-requested result must not silently become a successful film.
  if(meta.frames<segment.outputFrames+segment.skip){const error=new Error('Segment '+(index+1)+' returned too few frames. Its original clip is saved; resuming retries this segment.');error.code='FILM_SHORT_CLIP';throw error;}
  const {stdout}=await mediaCommand(ffprobe(),['-v','error','-protocol_whitelist','file,pipe','-select_streams','a','-show_entries','stream=index','-of','json',input],{signal});
  const audio=JSON.parse(stdout).streams?.length>0;
  const video=`fps=${plan.fps},trim=start_frame=${segment.skip}:end_frame=${segment.skip+segment.outputFrames},setpts=PTS-STARTPTS,scale=${plan.width}:${plan.height}:force_original_aspect_ratio=decrease,pad=${plan.width}:${plan.height}:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p`;
  const args=['-v','error','-nostdin','-y','-protocol_whitelist','file,pipe','-i',input];
  if(!audio)args.push('-f','lavfi','-i','anullsrc=channel_layout=stereo:sample_rate=48000');
  args.push('-map','0:v:0','-map',audio?'0:a:0':'1:a:0','-vf',video,'-af',`atrim=start=${segment.skip/plan.fps},asetpts=PTS-STARTPTS,apad`,'-t',String(segment.seconds),'-frames:v',String(segment.outputFrames),'-c:v','libx264','-preset','veryfast','-crf','18','-c:a','aac','-ar','48000','-ac','2','-map_metadata','-1','-movflags','+faststart',output);
  try{
    await mediaCommand(ffmpeg(),args,{signal});
    const result=await probeVideo(directory,'/assets/'+name,{signal});
    if(result.frames!==segment.outputFrames)throw new Error('The processed segment has an unexpected frame count. Its original clip is saved.');
    return {url:'/assets/'+name,mime:'video/mp4',label:'Segment '+(index+1),metadata:{...result,fps:plan.fps,seconds:segment.seconds}};
  }catch(e){await fs.rm(output,{force:true});throw e;}
}
export async function lastFrame(directory,url,{signal}={}){
  const meta=await probeVideo(directory,url,{signal}),name=randomUUID()+'.png',output=path.join(directory,name);
  try{await mediaCommand(ffmpeg(),['-v','error','-nostdin','-y','-protocol_whitelist','file,pipe','-i',localAsset(directory,url),'-vf',`select=eq(n\\,${meta.frames-1})`,'-frames:v','1','-update','1','-map_metadata','-1',output],{signal});
    return {name,data:'data:image/png;base64,'+(await fs.readFile(output)).toString('base64')};
  }finally{await fs.rm(output,{force:true});}
}
export async function stitchFilm(directory,clips,plan,{signal}={}){
  if(clips.length!==plan.segments.length)throw new Error('Finish every segment before stitching the film.');
  const name=randomUUID()+'.mp4',output=path.join(directory,name),listName=randomUUID()+'.txt',listPath=path.join(directory,listName);
  // Generated basenames only: no shell, arbitrary paths, or user-authored concat lists.
  const contents=clips.map((c,i)=>"file '"+path.basename(localAsset(directory,c.url))+"'\nduration "+plan.segments[i].seconds).join('\n');
  await fs.writeFile(listPath,contents,{mode:0o600});
  try{
    await mediaCommand(ffmpeg(),['-v','error','-nostdin','-y','-protocol_whitelist','file,pipe','-f','concat','-safe','1','-i',listPath,'-vf',`fps=${plan.fps},setpts=N/(${plan.fps}*TB)`,'-frames:v',String(plan.totalFrames),'-t',String(plan.seconds),'-af','aresample=async=1:first_pts=0','-c:v','libx264','-preset','veryfast','-crf','18','-c:a','aac','-map_metadata','-1','-movflags','+faststart',output],{signal,timeout:300000});
    const meta=await probeVideo(directory,'/assets/'+name,{signal});
    if(meta.frames!==plan.totalFrames)throw new Error('The stitched video has an unexpected frame count. All completed segments are saved.');
    return {url:'/assets/'+name,mime:'video/mp4',label:'Complete film',metadata:{...meta,fps:plan.fps,seconds:plan.seconds}};
  }catch(e){await fs.rm(output,{force:true});throw e;}
  finally{await fs.rm(listPath,{force:true});}
}
