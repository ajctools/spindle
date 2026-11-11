import {museumGLB} from './public/museum-geometry.mjs';
// Export preparation runs in the helper. Phones only receive the bounded mesh.
// Vertex clustering preserves connected broad silhouettes without dependencies.
export function museumShape(input,{triangleLimit=100000,sourceLimit=3000000}={}){
  const source=museumGLB(input,{triangleLimit:sourceLimit,byteLimit:96*1024*1024,indexed:true});
  if(source.triangles<=triangleLimit&&input.byteLength<=20*1024*1024)return {bytes:Buffer.from(input),triangles:source.triangles,originalTriangles:source.triangles,optimized:false};
  const {min,max}=source.bounds,span=Math.max(...max.map((v,c)=>v-min[c]));if(!(span>0))throw new Error('The shape has no usable dimensions.');
  for(const grid of [128,96,64,48,32,24,16,8]){
    const vertices=[],weights=[],indices=[],cells=new Map(),faces=new Set();let overflow=false;
    for(const batch of source.batches){const remap=new Uint32Array(batch.positions.length/3),side=grid+1;for(let i=0;i<batch.positions.length;i+=3){const p=[0,1,2].map(c=>Math.round((batch.positions[i+c]-min[c])*grid/span)),key=p[0]+p[1]*side+p[2]*side*side;let id=cells.get(key);if(id===undefined){id=vertices.length/3;cells.set(key,id);vertices.push(batch.positions[i],batch.positions[i+1],batch.positions[i+2]);weights.push(1);}else{for(let c=0;c<3;c++)vertices[id*3+c]+=batch.positions[i+c];weights[id]++;}remap[i/3]=id;}for(let i=0;i<batch.indices.length;i+=3){const ids=[remap[batch.indices[i]],remap[batch.indices[i+1]],remap[batch.indices[i+2]]];if(ids[0]===ids[1]||ids[0]===ids[2]||ids[1]===ids[2])continue;const key=ids.slice().sort((a,b)=>a-b).join(',');if(faces.has(key))continue;faces.add(key);indices.push(...ids);if(indices.length/3>triangleLimit){overflow=true;break;}}if(overflow)break;}
    if(overflow||!indices.length)continue;
    for(let i=0;i<weights.length;i++)for(let c=0;c<3;c++)vertices[i*3+c]/=weights[i];
    // A restrained Taubin pair removes clustering stair steps without shrinking the silhouette.
    for(const lambda of [.35,-.37,.35,-.37]){const sums=new Float64Array(vertices.length),degree=new Uint32Array(vertices.length/3);for(let i=0;i<indices.length;i+=3)for(let j=0;j<3;j++){const a=indices[i+j],b=indices[i+(j+1)%3],c=indices[i+(j+2)%3];degree[a]+=2;for(let k=0;k<3;k++)sums[a*3+k]+=vertices[b*3+k]+vertices[c*3+k];}for(let i=0;i<degree.length;i++)if(degree[i])for(let k=0;k<3;k++)vertices[i*3+k]+=lambda*(sums[i*3+k]/degree[i]-vertices[i*3+k]);}
    const positions=Buffer.alloc(vertices.length*4),triangles=Buffer.alloc(indices.length*4);vertices.forEach((v,i)=>positions.writeFloatLE(v,i*4));indices.forEach((v,i)=>triangles.writeUInt32LE(v,i*4));
    const json={asset:{version:'2.0',generator:'Spindle museum shape preparation'},buffers:[{byteLength:positions.length+triangles.length}],bufferViews:[{buffer:0,byteOffset:0,byteLength:positions.length},{buffer:0,byteOffset:positions.length,byteLength:triangles.length}],accessors:[{bufferView:0,componentType:5126,count:vertices.length/3,type:'VEC3'},{bufferView:1,componentType:5125,count:indices.length,type:'SCALAR'}],meshes:[{primitives:[{attributes:{POSITION:0},indices:1}]}],nodes:[{mesh:0}],scenes:[{nodes:[0]}],scene:0};
    let encoded=Buffer.from(JSON.stringify(json));encoded=Buffer.concat([encoded,Buffer.alloc((4-encoded.length%4)%4,32)]);const bytes=Buffer.alloc(28+encoded.length+positions.length+triangles.length);bytes.writeUInt32LE(0x46546c67);bytes.writeUInt32LE(2,4);bytes.writeUInt32LE(bytes.length,8);bytes.writeUInt32LE(encoded.length,12);bytes.writeUInt32LE(0x4e4f534a,16);encoded.copy(bytes,20);const at=20+encoded.length;bytes.writeUInt32LE(positions.length+triangles.length,at);bytes.writeUInt32LE(0x004e4942,at+4);positions.copy(bytes,at+8);triangles.copy(bytes,at+8+positions.length);
    const checked=museumGLB(bytes,{triangleLimit});return {bytes,triangles:checked.triangles,originalTriangles:source.triangles,optimized:true};
  }
  throw new Error('The sculpture cannot fit the museum triangle budget.');
}
