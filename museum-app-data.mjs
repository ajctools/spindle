import {museumData} from './museum.mjs';
import {museumGLB} from './public/museum-geometry.mjs';
// Data conversion only. No renderer, shader, scene or navigation code is supplied.
export async function museumAppData(options){
  const payload=await museumData(options);
  for(const e of payload.exhibits){if(!e.sculptureData)continue;const bytes=Buffer.from(e.sculptureData.split(',')[1],'base64'),geometry=museumGLB(bytes,{smooth:true});e.sculptureGeometry={triangles:geometry.triangles,bounds:geometry.bounds,batches:geometry.batches.map(b=>({positions:Buffer.from(b.positions.buffer,b.positions.byteOffset,b.positions.byteLength).toString('base64'),normals:Buffer.from(b.normals.buffer,b.normals.byteOffset,b.normals.byteLength).toString('base64'),count:b.positions.length/3,color:b.color}))};delete e.sculptureData;}
  return payload;
}
