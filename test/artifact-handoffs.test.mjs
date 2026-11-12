import assert from 'node:assert/strict';
import test from 'node:test';
import {meetingSummaryStep} from '../meeting.mjs';
import {packetMarkdown,packetRows} from '../public/meeting-packet.mjs';
import {cutSheet} from '../public/rough-cut.mjs';
import {facsimileHTML} from '../public/facsimile-book.mjs';

test('minutes resolve model references to saved transcript lines and export only the reviewed draft fields',()=>{
  const lines=[{at:61,approximate:true,text:'Private transcript context.'},{at:78,approximate:false,text:'The public session starts at six.'}];
  const step=meetingSummaryStep({meeting:{duration:80,chunkSeconds:60},outputs:[
    {text:'First section'}, {json:{segments:[{start:18,text:lines[1].text}]}}
  ]},{id:'fixture/chat',context:8192},{packet:true});
  assert.match(step.prompt,/"line":2,"time":"01:18"/);
  assert.equal(step.params._spindleWebSearch.enabled,false);
  const rows=packetRows(JSON.stringify({items:[
    {kind:'decision',text:'Review **this** <script>',line:2},
    {kind:'action',text:'Check the wording',line:1},
    {kind:'question',text:'Is the item supported?',line:999},
    {kind:'__proto__',text:'Invalid',line:1},
    {kind:{toString:null},text:'Invalid',line:1},
  ]}),lines);
  assert.deepEqual(rows.map(row=>row.line),[1,0,null]);
  assert.ok(rows.every(row=>!row.reviewed));
  rows[0].reviewed=true;
  const output=packetMarkdown('Public minutes',rows,lines);
  assert.match(output,/\*\*Reviewed\*\* · 01:18/);
  assert.match(output,/\*\*Unreviewed\*\* · around 01:01/);
  assert.doesNotMatch(output,/<script>|Private transcript context|Invalid/);
  assert.throws(()=>packetRows('Unstructured answer',lines),/readable minutes draft/);
});

test('cut sheet uses the final checkbox decisions and source-relative milliseconds without transcript content',()=>{
  const output=cutSheet([{from:0,to:1.25,cut:true,text:'Private original'},
    {from:59.9998,to:61.002,cut:false,text:'Private retake'}],new Set([1]));
  assert.match(output,/00:00:00\.000 → 00:00:01\.250   KEEP/);
  assert.match(output,/00:01:00\.000 → 00:01:01\.002   CUT/);
  assert.doesNotMatch(output,/Private/);
});

test('booklet escapes text, includes reviewed pages only, and rejects external or executable media',()=>{
  const image='data:image/png;base64,AA==';
  const narration='data:audio/wav;base64,AA==';
  const pages=[
    {title:'A <letter>',original:'Liebe Klara',translation:'</p><script>alert(1)</script>',image,narration,reviewed:true,prompt:'Hidden prompt'},
    {title:'Unreviewed page',original:'Secret scan',translation:'Secret text',image,reviewed:false},
    {title:'Remote page',original:'Remote original',translation:'Remote text',image:'https://example.invalid/image.jpg',reviewed:true},
    {title:'Executable image',original:'X',translation:'Y',image:'data:image/svg+xml;base64,AA==',reviewed:true},
    {title:'Other page',original:'Z',translation:'Z',image,narration:'https://example.invalid/audio.wav',reviewed:true},
  ];
  const output=facsimileHTML('Title </title>',pages,{includeAudio:true});
  assert.match(output,/default-src 'none'/);
  assert.match(output,/&lt;script&gt;alert/);
  assert.match(output,/src="data:audio\/wav;base64,AA=="/);
  assert.doesNotMatch(output,/<script>|Secret|example\.invalid|Executable image|Hidden prompt/);
  assert.doesNotMatch(facsimileHTML('Title',pages),/<audio/);
  assert.throws(()=>facsimileHTML('Title',[pages[1]]),/Review at least one/);
});
