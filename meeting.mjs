import fs from 'node:fs/promises';
import {parseDataUrl,validatePCM} from './core.mjs';

export const meetingLimitSeconds=30*60;
export const meetingChunkSeconds=60;
const bytesPerSecond=32000,headerBytes=44;

export function meetingRecording(file){
  validatePCM(file);
  const {buffer}=parseDataUrl(file);
  if(buffer.length<=headerBytes||buffer.toString('ascii',36,40)!=='data'
    ||buffer.readUInt32LE(16)!==16||buffer.readUInt32LE(40)!==buffer.length-headerBytes
    ||(buffer.length-headerBytes)%2)throw Error('Choose a recording prepared by Meeting Desk.');
  const duration=(buffer.length-headerBytes)/bytesPerSecond;
  if(duration>meetingLimitSeconds)throw Error('Choose a recording up to 30 minutes long.');
  return {buffer,duration,chunks:Math.ceil(duration/meetingChunkSeconds)};
}

export async function meetingChunk(path,index){
  const source=await fs.open(path,'r');
  try{
    const {size}=await source.stat();
    const offset=headerBytes+index*meetingChunkSeconds*bytesPerSecond;
    const length=Math.min(size-offset,meetingChunkSeconds*bytesPerSecond);
    if(length<=0)throw Error('The recording has no audio for this segment.');
    const header=Buffer.alloc(headerBytes),data=Buffer.alloc(length);
    if((await source.read(header,0,headerBytes,0)).bytesRead!==headerBytes
      ||(await source.read(data,0,length,offset)).bytesRead!==length)throw Error('The recording could not be read.');
    header.writeUInt32LE(36+length,4);header.writeUInt32LE(length,40);
    return {name:'meeting-'+(index+1)+'.wav',data:'data:audio/wav;base64,'+Buffer.concat([header,data]).toString('base64')};
  }finally{await source.close();}
}
