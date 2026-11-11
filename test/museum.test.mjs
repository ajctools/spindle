import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {refreshMuseumProjects,sourceImageURL,sourceText,projectRepository} from '../museum-source.mjs';
import {museumGLB} from '../public/museum-geometry.mjs';
import {museumShape} from '../museum-shape.mjs';
import {museumBrief,museumDesign,museumBuildPlan,museumMeshParams,museumMaterialPrompt,sculptureReferencePrompt} from '../public/museum-recipes.mjs';
const project={id:'example',title:'Before',description:'Previous public text',source:'https://www.tiinyverse.com/posts/example',author:'Example Maker',publishedAt:'2026-01-01T00:00:00Z',likes:null,comments:0};
const upload='https://www.tiinyverse.com/api/uploads/11111111-1111-4111-8111-111111111111';
test('source captures request only public JSON, a fixed README endpoint, and allowlisted raster images',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'spindle-source-')),png=await fs.readFile(new URL('../fixtures/star.png',import.meta.url));let text='A local project with a repository https://github.com/example/example-project',image=png;const requested=[];
  const fetcher=async(url,options)=>{requested.push(String(url));assert.equal(options.redirect,'error');assert.equal(options.headers.Authorization,undefined);assert.equal(options.headers.Cookie,undefined);
    if(url.pathname==='/api/posts/example/public')return Response.json({state:'available',post:{id:'example',status:'published',visibility:'public',title:'Current title',bodyText:text,bodyHtml:text,author:{nickname:'Example Maker',accountId:'never-copy'},likedCount:0,images:[upload,'https://example.com/unsafe.svg','https://example.com/runtime.js']}});
    if(url.hostname==='api.github.com'){assert.equal(url.pathname,'/repos/example/example-project/readme');return new Response('# Documentation\n```js\nexecuteBadStuff()\n```\nUseful public description.<script>bad()</script>',{headers:{'content-type':'text/plain'}});}
    assert.equal(String(url),upload);return new Response(image,{headers:{'content-type':'image/png'}});
  };
  try{const [p]=await refreshMuseumProjects([project],{assetsDirectory:dir,fetcher});assert.equal(p.capture.status,'fresh');assert.equal(p.sourceText,text);assert.equal(p.capture.changed,false);assert.equal(p.likes,0);assert.equal(p.comments,null);assert.equal(p.publishedAt,project.publishedAt);assert.equal(p.sourceImages.length,1);assert.match(p.sourceImage.url,/\.png$/);assert.ok(!JSON.stringify(p).includes('never-copy'));assert.ok(!p.documentation.text.includes('executeBadStuff'));assert.ok(!p.documentation.text.includes('bad()'));
    const [same]=await refreshMuseumProjects([p],{assetsDirectory:dir,fetcher});assert.equal(same.capture.hash,p.capture.hash);assert.equal(same.capture.changed,false);
    text+=' Edited.';const [changed]=await refreshMuseumProjects([same],{assetsDirectory:dir,fetcher});assert.equal(changed.capture.changed,true);
    image=Buffer.concat([png,Buffer.from('different-static-image')]);const [pixels]=await refreshMuseumProjects([changed],{assetsDirectory:dir,fetcher});assert.equal(pixels.capture.changed,true);assert.notEqual(pixels.capture.hash,changed.capture.hash);
    assert.ok(requested.every(u=>!u.endsWith('.js')&&!u.endsWith('.svg')));
    const [missing]=await refreshMuseumProjects([pixels],{assetsDirectory:dir,fetcher:async()=>Response.json({state:'unavailable'})});assert.equal(missing.capture.status,'unavailable');assert.equal(missing.sourceText,pixels.sourceText);assert.equal(missing.sourceImage.url,pixels.sourceImage.url);
    const [forged]=await refreshMuseumProjects([project],{assetsDirectory:dir,fetcher:async(url,opts)=>url.pathname.includes('/posts/')?fetcher(url,opts):new Response('<script>no</script>',{headers:{'content-type':'image/png'}})});assert.equal(forged.sourceImage,undefined);assert.ok(forged.capture.warnings.length>0);
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('source allowlist and text extraction exclude scripts, external hosts, credentials and redirects',()=>{
  for(const value of ['https://github.com/../example','https://github.com/example/..','https://github.com/example/...git'])assert.equal(projectRepository(value),null);
  assert.deepEqual(projectRepository('https://github.com/example/example-project.git'),{owner:'example',repo:'example-project'});
  const credentialURL=new URL(upload);credentialURL.username='name';credentialURL.password='pass';
  for(const value of ['https://example.com/image.png','https://www.tiinyverse.com/app.js','https://www.tiinyverse.com/api/uploads/11111111-1111-4111-8111-111111111111?redirect=1',credentialURL.href,'http://www.tiinyverse.com/api/uploads/11111111-1111-4111-8111-111111111111','javascript:alert(1)'])assert.equal(sourceImageURL(value),null);
  assert.equal(sourceImageURL(upload).href,upload);assert.equal(sourceText('<style>bad</style><script>bad()</script><p>Useful &amp; safe</p>'),'Useful & safe');
  assert.match(museumBrief(undefined,'archive'),/limestone/);assert.throws(()=>museumBrief('', 'unknown'),/available/);assert.match(sculptureReferencePrompt({title:'Local invention'}),/broad solid/);
  assert.deepEqual(museumDesign(undefined,{preset:'vault',brief:'Keep this custom direction.'}),{preset:'vault',brief:'Keep this custom direction.'});assert.match(museumDesign({preset:'archive'},{preset:'vault',brief:'Old vault brief'}).brief,/limestone/);
  assert.match(museumMaterialPrompt('floor'),/limestone/);assert.match(museumMaterialPrompt('floor','observatory'),/basalt/);assert.match(museumMaterialPrompt('timber'),/walnut/);assert.match(museumMaterialPrompt('floor'),/no baked shadows/);assert.throws(()=>museumMaterialPrompt('script'),/material/);
  assert.equal(museumBuildPlan({count:6,sculpture:true,voice:true,ambient:true}).calls,18);assert.equal(museumBuildPlan({count:24,sculpture:true,voice:true,ambient:true}).stages[0].calls,4);assert.equal(museumBuildPlan({artPolicy:'missing'}).upTo,true);assert.throws(()=>museumBuildPlan({count:25}),/exhibits/);
  assert.throws(()=>museumMeshParams({stage_specs:{shape:{params:{pipeline_type:{enum:['512']}}}}},{pipeline_type:'1024'}),/not reported/);assert.deepEqual(museumMeshParams({}),{});assert.deepEqual(museumMeshParams({data:{stage_specs:{shape:{params:{pipeline_type:{anyOf:[{enum:['512','1024']},{type:'null'}]}}}}}}),{pipeline_type:'512'});assert.deepEqual(museumMeshParams({data:{stage_specs:{shape:{params:{pipeline_type:{enum:['512','1024']}}}}}},{pipeline_type:'1024'}),{pipeline_type:'1024'});
});
function glb(change=()=>{},extraBinary=0){const json={asset:{version:'2.0'},buffers:[{byteLength:36+extraBinary}],bufferViews:[{buffer:0,byteOffset:0,byteLength:36}],accessors:[{bufferView:0,componentType:5126,count:3,type:'VEC3'}],meshes:[{primitives:[{attributes:{POSITION:0}}]}],nodes:[{mesh:0}],scenes:[{nodes:[0]}]};change(json);let encoded=Buffer.from(JSON.stringify(json));encoded=Buffer.concat([encoded,Buffer.alloc((4-encoded.length%4)%4,32)]);const bin=Buffer.alloc(36+extraBinary);[0,0,0,1,0,0,0,1,0].forEach((v,i)=>bin.writeFloatLE(v,i*4));const bytes=Buffer.alloc(12+8+encoded.length+8+bin.length);bytes.writeUInt32LE(0x46546c67);bytes.writeUInt32LE(2,4);bytes.writeUInt32LE(bytes.length,8);bytes.writeUInt32LE(encoded.length,12);bytes.writeUInt32LE(0x4e4f534a,16);encoded.copy(bytes,20);const at=20+encoded.length;bytes.writeUInt32LE(bin.length,at);bytes.writeUInt32LE(0x004e4942,at+4);bin.copy(bytes,at+8);return bytes;}
test('offline sculpture reader accepts bounded embedded triangles and rejects unsafe or unsupported geometry',()=>{
  const shape=museumGLB(glb());assert.equal(shape.triangles,1);assert.deepEqual(shape.bounds,{min:[0,0,0],max:[1,1,0]});assert.equal(shape.batches[0].normals[2],1);
  assert.throws(()=>museumGLB(glb(j=>j.buffers[0].uri='https://example.com/shape.bin')),/embedded/);assert.throws(()=>museumGLB(glb(j=>j.images=[{uri:'file:///private'}])),/embedded/);assert.throws(()=>museumGLB(glb(j=>j.extensionsRequired=['KHR_draco_mesh_compression'])),/uncompressed/);
  assert.throws(()=>museumGLB(glb(j=>j.nodes[0].children=[0])),/Cyclic/);assert.throws(()=>museumGLB(glb(j=>j.accessors[0].count=3000000)),/accessor/);assert.throws(()=>museumGLB(glb(),{triangleLimit:0}),/budget/);assert.throws(()=>museumGLB(glb(j=>j.nodes[0].scale=[1e300,1e300,1e300])),/coordinate/);assert.throws(()=>museumGLB(glb().subarray(0,25)),/GLB/);
});
test('museum shape preparation reduces redundant dense geometry and keeps the original input intact',()=>{
  const original=glb(j=>j.meshes[0].primitives.push({attributes:{POSITION:0}})),copy=Buffer.from(original),prepared=museumShape(original,{triangleLimit:1});assert.equal(prepared.optimized,true);assert.equal(prepared.originalTriangles,2);assert.equal(prepared.triangles,1);assert.equal(museumGLB(prepared.bytes).triangles,1);assert.deepEqual(original,copy);assert.equal(museumShape(glb()).optimized,false);assert.throws(()=>museumShape(original,{sourceLimit:1}),/budget/);
});
test('helper-only indexed decoding reduces large originals while the browser byte budget remains bounded',()=>{
  const large=glb(()=>{},21*1024*1024);assert.throws(()=>museumGLB(large),/oversized/);const indexed=museumGLB(large,{byteLimit:96*1024*1024,indexed:true});assert.equal(indexed.batches[0].positions.length,9);assert.deepEqual([...indexed.batches[0].indices],[0,1,2]);assert.equal(indexed.batches[0].normals,undefined);const packed=museumShape(large);assert.equal(packed.optimized,true);assert.equal(packed.triangles,1);assert.ok(packed.bytes.length<2000);assert.equal(museumGLB(packed.bytes).triangles,1);
});
