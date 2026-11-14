import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {meetingRecording,meetingChunk,meetingSummaryStep} from '../meeting.mjs';
import {meetingLines,meetingMatches,meetingQuery} from '../public/meeting-desk.mjs';
import {previewText} from '../public/meeting-transcript.mjs';

test('Meeting Desk splits a recording at sample boundaries and preserves the final short chunk',async()=>{
  const header=Buffer.alloc(44),audio=Buffer.alloc(61*32000);
  header.write('RIFF');header.write('WAVEfmt ',8);header.writeUInt32LE(16,16);
  header.writeUInt16LE(1,20);header.writeUInt16LE(1,22);header.writeUInt32LE(16000,24);
  header.writeUInt32LE(32000,28);header.writeUInt16LE(2,32);header.writeUInt16LE(16,34);header.write('data',36);
  audio.writeInt16LE(1234,60*32000);
  header.writeUInt32LE(36+audio.length,4);header.writeUInt32LE(audio.length,40);
  const data=Buffer.concat([header,audio]),file={name:'fixture.wav',data:'data:audio/wav;base64,'+data.toString('base64')};
  const parsed=meetingRecording(file);
  assert.equal(parsed.duration,61);assert.equal(parsed.chunks,2);
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'spindle-meeting-'));
  try{
    const recording=path.join(temp,'fixture.wav');await fs.writeFile(recording,data);
    assert.equal(meetingRecording(await meetingChunk(recording,0)).duration,60);
    assert.equal(await meetingChunk(recording,0,{skipQuiet:true}),null);
    const tail=meetingRecording(await meetingChunk(recording,1));
    assert.equal(tail.duration,1);assert.equal(tail.buffer.readInt16LE(44),1234);
    assert.ok(await meetingChunk(recording,1,{skipQuiet:true}));
    await assert.rejects(meetingChunk(recording,2),/no audio/);
    data.writeUInt32LE(0,40);
    assert.throws(()=>meetingRecording({...file,data:'data:audio/wav;base64,'+data.toString('base64')}),/prepared/);
  }finally{await fs.rm(temp,{recursive:true,force:true});}
});

test('Meeting Desk accepts normalized audio through 30 minutes without changing other upload limits',()=>{
  const buffer=Buffer.alloc(44+1800*32000);
  buffer.write('RIFF');buffer.writeUInt32LE(buffer.length-8,4);buffer.write('WAVEfmt ',8);
  buffer.writeUInt32LE(16,16);buffer.writeUInt16LE(1,20);buffer.writeUInt16LE(1,22);
  buffer.writeUInt32LE(16000,24);buffer.writeUInt32LE(32000,28);buffer.writeUInt16LE(2,32);
  buffer.writeUInt16LE(16,34);buffer.write('data',36);buffer.writeUInt32LE(buffer.length-44,40);
  const file={name:'fixture.wav',data:'data:audio/wav;base64,'+buffer.toString('base64')};
  const result=meetingRecording(file);
  assert.equal(result.duration,1800);
  assert.equal(result.chunks,30);
  assert.throws(()=>meetingRecording(file,20),/20 seconds or shorter/);
});

test('preview suppresses decoder loops and oversized text while preserving ordinary and multilingual speech',()=>{
  assert.deepEqual(previewText('A sentence. '+ 'the top of '.repeat(42)+'Then we moved on.'),{text:'',unreliable:true});
  assert.deepEqual(previewText('word '.repeat(801)),{text:'',unreliable:true});
  for(const text of ['Go, go, go. We have to hurry.', '请打开录音。'])assert.deepEqual(previewText(text),{text});
  assert.deepEqual(previewText('   '),{text:''});
});

test('Meeting Desk offsets device timestamps and falls back to a chunk when timing is unreported',()=>{
  const lines=meetingLines({meeting:{chunkSeconds:60,duration:61},outputs:[
    {text:'Check this.',json:{segments:[{start:2.25,text:'Research USB audio dropouts.'},{start:4,text:'The researcher took notes.'}]}},
    {text:'C++ notes',json:{segments:[{start:10,text:'Invalid timestamp'}]}},
  ]});
  assert.deepEqual(lines.map(line=>[line.at,line.approximate]),[[2.25,false],[4,false],[60,true]]);
  assert.deepEqual(meetingMatches(lines,'research,C++').map(match=>[match.index,match.matches]),[[0,['research']],[2,['C++']]]);
  assert.equal(meetingQuery(lines[0].text,['research']),'USB audio dropouts');
  assert.equal(meetingQuery(lines[2].text,['C++']),'C++');
});

test('device voice labels stay anonymous per section and the summary uses only transcript evidence with search off',()=>{
  const run={meeting:{chunkSeconds:60,duration:70,recording:{url:'/assets/private.wav'}},outputs:[
    {json:{data:{segments:[{start:2,text:'Archive the notes.',speaker:'Original label'},{start:3,text:'Due Monday.',speaker_id:'Original label'},{start:6,text:'Still undecided.',speaker:0}]}}},
    {json:{segments:[{start:1,text:'Maybe meet Friday.',speaker:'Original label'}]}},
  ]};
  assert.deepEqual(meetingLines(run).map(line=>line.speaker),['Section 1, voice 1','Section 1, voice 1','Section 1, voice 2','Section 2, voice 1']);
  const step=meetingSummaryStep(run,{id:'test/chat',context:8192});
  assert.equal(step.promptMode,'literal');
  assert.deepEqual(step.params._spindleWebSearch,{enabled:false});
  assert.match(step.prompt,/"time":"01:01","voice":"Section 2, voice 1","text":"Maybe meet Friday."/);
  assert.doesNotMatch(step.prompt,/Original label|private\.wav/);
  assert.throws(()=>meetingSummaryStep(run,{id:'test/chat',context:512}),/too long/);
  assert.throws(()=>meetingSummaryStep({...run,outputs:[]},{id:'test/chat'}),/no saved transcript/);
});
