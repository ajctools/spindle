import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {isIP} from 'node:net';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

export const RELEASE_FILES=[
  '.env.example','.gitignore','.gitattributes','README.md','Start-Spindle.ps1','package.json','server.mjs','core.mjs','connection.mjs','metrics.mjs','security.mjs','chat.mjs','web-search.mjs','creative.mjs','film.mjs','museum.mjs','museum-source.mjs','museum-shape.mjs','museum-media.mjs','museum-author.mjs','museum-runtime.mjs','museum-app-data.mjs','museum-app-check.mjs','museum-author-run.mjs','model-idle.mjs','music.mjs','soundtrack.mjs',
  'LICENSE','SECURITY.md','CONTRIBUTING.md','.github/workflows/ci.yml','docs/SECURITY.md','docs/VALIDATION.md','docs/USAGE.md','docs/MUSEUM.md','scripts/release.mjs','scripts/preview-demo.mjs',
  'docs/images/hero.svg','docs/images/how-it-works.svg','docs/images/chat.jpg','docs/images/dashboard.jpg','docs/images/workbench.jpg','docs/images/workflows.jpg','docs/images/connection.jpg','docs/images/cloud-cost.jpg',
  'public/vendor/three-r187.min.js','public/vendor/three-r187.json','public/vendor/THREE-LICENSE.txt','public/app.js','public/chat-ui.mjs','public/chat-settings.mjs','public/audio.js','public/dashboard.js','public/dashboard.css','public/effects.js','public/experience.css','public/favicon.svg','public/guidance.mjs','public/guidance.css','public/index.html','public/styles.css','public/studio.mjs','public/studio.css','public/workshops.mjs','public/museum-viewer.html','public/museum-engine.js','public/museum-renderer.js','public/museum-geometry.mjs','public/museum-recipes.mjs','public/cloud-cost.mjs','public/cost-panel.mjs','public/activity.mjs','public/mesh-preview.mjs','public/refinements.css',
  'fixtures/document.png','fixtures/speech.wav','fixtures/star.png',
  'test/adapters.test.mjs','test/chat.test.mjs','test/search.test.mjs','test/audio.test.mjs','test/connection.test.mjs','test/guidance.test.mjs','test/integration.test.mjs','test/metrics.test.mjs','test/security.test.mjs','test/release.test.mjs','test/creative.test.mjs','test/workshops.test.mjs','test/museum.test.mjs','test/museum-media.test.mjs','test/museum-recovery.test.mjs','test/music.test.mjs','test/cloud-cost.test.mjs','test/preview.test.mjs','test/museum-author.test.mjs','test/author-route.test.mjs',
];
const patterns=[
  ['private key',/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['credential token',/\b(?:gh[pousr]_[A-Za-z0-9]{24,}|github_pat_[A-Za-z0-9_]{30,}|AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9_-]{24,})\b/],
  ['absolute user path',/(?:[A-Za-z]:[\\/]+Users[\\/]+[^\s"'<>]+|\/(?:Users|home)\/[^\s"'<>]+)/],
  ['network interface address',/\b(?:[0-9a-f]{2}:){5}[0-9a-f]{2}\b/i],
];
export function scanReleaseFile(name,bytes,known=[]){
  const findings=[];
  const jpeg=bytes[0]===255&&bytes[1]===216;
  const binaryImage=jpeg||bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  const binaryAudio=bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WAVE';
  // Compressed pixels/audio are not text: random bytes can resemble emails or IPs.
  // Known-secret byte checks still cover the entire file; metadata is checked below.
  // Raster content itself requires the manual review mandated by the release policy.
  const text=binaryImage||binaryAudio?'':bytes.toString('utf8');
  for(const [label,pattern]of patterns)if(pattern.test(text))findings.push(label);
  for(const email of text.match(/\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g) || [])if(!/(?:@|\.)example(?:\.com|\.org|\.net)?$/i.test(email))findings.push('email address');
  for(const address of text.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g) || []){
    const parts=address.split('.').map(Number);if(parts.some(n=>n>255))continue;
    if(address!=='127.0.0.1'&&!/^(?:192\.0\.2|198\.51\.100|203\.0\.113)\./.test(address))findings.push('non-documentation IP address');
  }
  for(const [address]of text.matchAll(/(?<![\w:])(?:[\da-f]{0,4}:){2,7}[\da-f]{0,4}(?:\.\d{1,3}){0,3}(?![\w:])/gi)){
    if(isIP(address)===6&&!/^::1$|^2001:db8(?=:)/i.test(address))findings.push('non-documentation IP address');
  }
  for(const {label,value}of known){if(typeof value!=='string'||value.length<4)continue;const forms=[Buffer.from(value),Buffer.from(value,'utf16le'),Buffer.from(encodeURIComponent(value)),Buffer.from(Buffer.from(value).toString('base64'))];if(forms.some(v=>bytes.includes(v)))findings.push(label);}
  if(name.endsWith('.png'))for(let p=8;p+12<=bytes.length;){const size=bytes.readUInt32BE(p),kind=bytes.subarray(p+4,p+8).toString();if(['eXIf','tEXt','zTXt','iTXt'].includes(kind))findings.push('image metadata requiring manual review');if(p+size+12>bytes.length)break;p+=size+12;}
  if(jpeg)for(let p=2;p+4<=bytes.length;){if(bytes[p]!==255)break;const marker=bytes[p+1];if(marker===218||marker===217)break;const size=bytes.readUInt16BE(p+2);if([225,237,254].includes(marker))findings.push('image metadata requiring manual review');if(size<2||p+2+size>bytes.length)break;p+=2+size;}
  if(name.endsWith('.wav')&&bytes.subarray(0,4).toString()==='RIFF')for(let p=12;p+8<=bytes.length;){const size=bytes.readUInt32LE(p+4),kind=bytes.subarray(p,p+4).toString();if(!['fmt ','data','JUNK','PAD '].includes(kind))findings.push('audio metadata requiring manual review');if(p+size+8>bytes.length)break;p+=size+8+(size%2);}
  return [...new Set(findings)];
}
export async function localDenyValues(root){
  const values=[{label:'local home path',value:os.homedir()},{label:'local computer name',value:os.hostname()}];
  const addAddress=value=>{
    if(typeof value!=='string'||!value.trim())return;
    values.push({label:'configured device address',value});
    try{
      const host=new URL(value.includes('://')?value:'http://'+value).hostname.replace(/^\[|\]$/g,'');
      if(!['localhost','127.0.0.1','::1'].includes(host))values.push({label:'configured device host',value:host});
    }catch{}
  };
  const username=os.userInfo().username;if(!['root','runner','node','user','admin','administrator','ubuntu','system'].includes(username.toLowerCase()))values.push({label:'local OS account name',value:username});
  try{const config=JSON.parse(await fs.readFile(process.env.TIINY_CONFIG || path.join(os.homedir(),'.local','tiiny','config.json'),'utf8'));addAddress(config.deviceAddress);values.push({label:'configured device key',value:config.account?.authKey});for(const key of ['email','username','displayName','name'])if(config.account?.[key])values.push({label:'configured account identifier',value:config.account[key]});}catch{}
  try{
    const saved=JSON.parse(await fs.readFile(path.join(process.env.SPINDLE_DATA_DIR || path.join(root,'data'),'connection.json'),'utf8'));
    for(const key of ['endpoint','nativeEndpoint','managementEndpoint'])addAddress(saved[key]);
    values.push({label:'remembered Spindle key',value:saved.key});
  }catch{}
  addAddress(process.env.TIINY_HOST);
  values.push({label:'environment device key',value:process.env.TIINY_KEY});
  return values;
}
export async function buildRelease({root,output,known=[]}){
  root=path.resolve(root);output=path.resolve(output);
  try{await fs.lstat(output);throw new Error('Choose a new, empty output path. Existing output is never overwritten.');}catch(e){if(e.code!=='ENOENT')throw e;}
  const rows=[];
  for(const name of RELEASE_FILES){
    let current=root;for(const part of name.split('/')){current=path.join(current,part);if((await fs.lstat(current)).isSymbolicLink())throw new Error('Release symlink rejected: '+name);}
    if(!(await fs.stat(current)).isFile())throw new Error('Expected source file: '+name);
    const raw=await fs.readFile(current),bytes=/\.(?:png|jpg|wav)$/.test(name)?raw:Buffer.from(raw.toString('utf8').replaceAll('\r\n','\n')),findings=scanReleaseFile(name,bytes,known);if(findings.length)throw new Error('Release scan blocked '+name+': '+findings.join(', '));
    rows.push({path:name,bytes,sha256:createHash('sha256').update(bytes).digest('hex')});
  }
  // Validate every byte before creating the release directory.
  await fs.mkdir(output,{recursive:true});
  for(const row of rows){const target=path.join(output,...row.path.split('/'));await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,row.bytes,{flag:'wx'});}
  const manifest={version:JSON.parse(rows.find(r=>r.path==='package.json').bytes.toString()).version,files:rows.map(({path,sha256,bytes})=>({path,sha256,bytes:bytes.length}))};
  await fs.writeFile(path.join(output,'RELEASE-MANIFEST.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});return manifest;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{const i=process.argv.indexOf('--out');if(i<0||!process.argv[i+1])throw new Error('Usage: node scripts/release.mjs --out <new-directory>');const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),manifest=await buildRelease({root,output:process.argv[i+1],known:await localDenyValues(root)});console.log('Release scan passed: '+manifest.files.length+' source files. No runtime data copied.');}
  catch(error){console.error(error.message);process.exitCode=1;}
}
