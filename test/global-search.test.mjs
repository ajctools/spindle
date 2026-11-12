import test from 'node:test';
import assert from 'node:assert/strict';
import {searchItems,localMatches} from '../public/global-search.mjs';

test('local search ranks titles, finds old chat replies and opens the matching transcript timestamp',()=>{
  const sources={
    pages:[{type:'page',id:'models',title:'Models'}],
    runs:[
      {id:'chat',name:'Chat',createdAt:'2020-01-01',steps:[{task:'chat',prompt:'How is rainfall measured?'}],outputs:[{text:'A calibrated rain gauge.'}]},
      {id:'meeting',name:'Meeting · Equipment',createdAt:'2020-02-01',meeting:{chunkSeconds:60,duration:5},outputs:[
        {json:{segments:[{start:2.5,text:'Check the calibrated rain gauge.'}]}},
      ]},
    ],
    workflows:[{id:'workflow',name:'Calibrated rain gauge',steps:[{prompt:'Station inspection'}]}],
    prompts:[{id:'recipe',title:'Weather table',tags:['Forecast'],template:'Return dates and highs.'}],
    models:[{id:'fixture/cumulus',name:'Cumulus',type:'Text Generation',loaded:true}],
  };
  const matches=query=>localMatches(searchItems(sources),query);
  assert.deepEqual(matches(' Calibrated  Rain Gauge ').map(({id,type,at})=>({id,type,at})),[
    {id:'workflow',type:'workflow',at:undefined},{id:'meeting',type:'meeting',at:2.5},{id:'chat',type:'chat',at:undefined},
  ]);
  assert.match(matches('rainfall')[0].snippet,/How is rainfall measured/);
  assert.equal(matches('station inspection')[0].id,'workflow');
  assert.equal(matches('forecast')[0].id,'recipe');
  assert.equal(matches('fixture/cumulus')[0].id,'fixture/cumulus');
});

test('search never indexes files, hidden reasoning, generated application source, or search credentials',()=>{
  const runs=[{id:'chat',name:'Chat',steps:[{task:'chat',file:{data:'binaryneedle'},params:{key:'keyneedle',_spindleWebSearch:{query:'queryneedle'}}}],outputs:[
    {text:'Safe <b>literal</b> text',reasoning:'reasonneedle',json:{hidden:'jsonneedle'}},
    {text:'sourceneedle',authorKind:'code'},
  ]}];
  const matches=query=>localMatches(searchItems({runs}),query);
  assert.deepEqual(matches('needle'),[]);
  assert.match(matches('<b>')[0].snippet,/<b>literal<\/b>/);
});
