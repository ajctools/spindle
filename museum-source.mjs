import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
const POST=/^[a-zA-Z0-9-]{1,120}$/;
export function sourceText(value,max=6000){return String(value??'').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi,' ').replace(/```[\s\S]*?```/g,' ').replace(/<[^>]*>/g,' ').replace(/&(?:nbsp|amp|lt|gt|quot|#39);/g,s=>({'&nbsp;':' ','&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&#39;':"'"}[s])).replace(/\s+/g,' ').trim().slice(0,max);}
export function sourceImageURL(value){
  let u;try{u=new URL(value,'https://www.tiinyverse.com');}catch{return null;}
  if(u.protocol!=='https:'||u.username||u.password||u.port||u.search||u.hash)return null;
  if(['www.tiinyverse.com','tiinyverse.com'].includes(u.hostname)&&/^\/api\/uploads\/[a-f0-9-]{36}$/i.test(u.pathname))return u;
  if(u.hostname==='tiinyverse.tiiny.cloud'&&/^\/prod\/post-final\/\d{4}\/\d{2}\/[a-f0-9-]{36}\/[a-f0-9-]{36}\.(?:png|jpe?g|webp)$/i.test(u.pathname))return u;
  return null;
}
async function bounded(url,type,limit,{fetcher=fetch,signal}={}){
  const r=await fetcher(url,{redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000),headers:{Accept:type}});
  if(!r.ok)throw new Error('Public source returned HTTP '+r.status);
  const mime=(r.headers.get('content-type') || '').split(';')[0].trim();
  if(type==='application/json'&&mime!=='application/json')throw new Error('Source did not return JSON.');
  if(type==='image/png,image/jpeg,image/webp'&&!['image/png','image/jpeg','image/webp'].includes(mime))throw new Error('Source media is not a supported raster image.');
  if(type==='text/plain'&&!['text/plain','text/markdown','application/vnd.github.raw+json','application/octet-stream'].includes(mime))throw new Error('Documentation is not plain text.');
  const chunks=[];let size=0;const reader=r.body.getReader();try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit)throw new Error('Source exceeds its size limit.');chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}
  return {bytes:Buffer.concat(chunks),mime};
}
function raster(bytes,mime){return mime==='image/png'&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||mime==='image/jpeg'&&bytes[0]===255&&bytes[1]===216||mime==='image/webp'&&bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP';}
export function projectRepository(html){
  for(const match of String(html).matchAll(/https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)/g)){
    const owner=match[1],repo=match[2].replace(/\.git$/i,'');
    if(!/^[a-z\d][a-z\d-]{0,38}$/i.test(owner)||['topics','orgs','users','settings','login','features','marketplace'].includes(owner.toLowerCase())||!repo||repo==='.'||repo==='..'||repo.length>100)continue;
    return {owner,repo};
  }
  return null;
}
export async function refreshMuseumProjects(projects,{assetsDirectory,fetcher=fetch,signal,images=true,documentation=true}={}){
  const refreshed=[];
  for(const original of projects){
    signal?.throwIfAborted();const id=original.source?.split('/').at(-1);if(!POST.test(id || ''))throw new Error('Invalid public project ID.');
    const capturedAt=new Date().toISOString(),warnings=[];let p={...original};
    try{
      const {bytes}=await bounded(new URL('https://www.tiinyverse.com/api/posts/'+id+'/public'),'application/json',2*1024*1024,{fetcher,signal}),d=JSON.parse(bytes.toString()),post=d.post;
      if(d.state!=='available'||post?.status!=='published'||post?.visibility!=='public'||post.id!==id)throw new Error('The original post is no longer publicly available.');
      const body=sourceText(post.bodyText || post.body || post.bodyHtml),imageURLs=(post.images || []).map(sourceImageURL).filter(Boolean).slice(0,6).map(u=>u.href);
      const sourceHash=createHash('sha256').update(JSON.stringify({title:post.title,body,images:imageURLs})).digest('hex');
      p={...p,title:sourceText(post.title,180) || p.title,description:body.slice(0,1400),sourceText:body,author:sourceText(post.author?.nickname,120) || p.author,likes:typeof post.likedCount==='number'&&post.likedCount>=0?post.likedCount:null,comments:typeof post.commentCount==='number'&&post.commentCount>=0?post.commentCount:null,sourceImages:imageURLs,capture:{capturedAt,updatedAt:post.contentEditedAt || post.updatedAt || null,hash:sourceHash,changed:!!original.capture?.hash&&original.capture.hash!==sourceHash,status:'fresh',warnings}};
      // Fetch a repository README as data; no project HTML scripts, JS bundles,
      // executables, embeds, or arbitrary linked resources are requested.
      delete p.documentation;
      const repo=documentation?projectRepository(post.bodyHtml || post.bodyText || post.body):null;
      if(repo){try{const result=await bounded(new URL('https://api.github.com/repos/'+encodeURIComponent(repo.owner)+'/'+encodeURIComponent(repo.repo)+'/readme'),'text/plain',512*1024,{signal,fetcher:async(url,opts)=>fetcher(url,{...opts,headers:{Accept:'application/vnd.github.raw+json'}})});p.documentation={url:'https://github.com/'+repo.owner+'/'+repo.repo,text:sourceText(result.bytes.toString(),4000),capturedAt};}catch{warnings.push('Linked README unavailable; the post remains the source.');}}
      delete p.sourceImage;
      if(images&&imageURLs.length&&assetsDirectory){
        for(const url of imageURLs){try{const result=await bounded(new URL(url),'image/png,image/jpeg,image/webp',8*1024*1024,{fetcher,signal});if(!raster(result.bytes,result.mime))throw new Error('Raster signature mismatch.');
          const ext={'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}[result.mime],name=randomUUID()+'.'+ext;await fs.writeFile(path.join(assetsDirectory,name),result.bytes,{mode:0o600});p.sourceImage={url:'/assets/'+name,mime:result.mime,label:'Source image from the project post',sourceURL:url,capturedAt,hash:createHash('sha256').update(result.bytes).digest('hex')};break;
        }catch{warnings.push('A source image could not be imported.');}}
      }
      p.capture.hash=createHash('sha256').update(JSON.stringify({post:sourceHash,documentation:p.documentation?.text || '',image:p.sourceImage?.hash || ''})).digest('hex');p.capture.changed=!!original.capture?.hash&&original.capture.hash!==p.capture.hash;
    }catch(e){signal?.throwIfAborted();p.capture={...original.capture,capturedAt,status:'unavailable',warnings:['Refresh failed: '+e.message+'. Showing the previous capture.']};}
    refreshed.push(p);
  }
  return refreshed;
}
