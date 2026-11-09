import test from 'node:test';
import assert from 'node:assert/strict';
import {transcriptionPCM,validatePCM,parseDataUrl} from '../core.mjs';
test('stereo 24 kHz workflow audio becomes mono 16 kHz without changing duration or signal level',()=>{
  const b=Buffer.alloc(44+24000*4);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(2,22);b.writeUInt32LE(24000,24);b.writeUInt32LE(96000,28);b.writeUInt16LE(4,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(96000,40);
  for(let i=0;i<24000;i++){b.writeInt16LE(8000,44+i*4);b.writeInt16LE(4000,46+i*4);}
  const out=transcriptionPCM({name:'voice.wav',data:'data:audio/wav;base64,'+b.toString('base64')});validatePCM(out);
  const wav=parseDataUrl(out).buffer;assert.equal(wav.length,32044);assert.equal(wav.readInt16LE(44),6000);assert.equal(wav.readInt16LE(wav.length-2),6000);
});
