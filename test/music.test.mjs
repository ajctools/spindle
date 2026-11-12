import test from 'node:test';import assert from 'node:assert/strict';import {musicRequest,musicNeedsTopLevel,musicSchemaFallback} from '../music.mjs';
test('music adapters use reported modes and native lyric_text while pinning the model',()=>{const model={id:'fixture/music'},info={model_info:{model:{supported_generation_types:['mixed']}},default_config:{generation_type:'mixed'}};assert.deepEqual(musicRequest(model,'Calm instrumental',{},info),{model:model.id,config:{caption:'Calm instrumental',generation_type:'mixed',lyric_text:'[instrumental]'}});const lyrical=musicRequest(model,'A melody',{lyrics:'The supplied words',duration:20},info);assert.equal(lyrical.config.lyric_text,'The supplied words');assert.equal(lyrical.config.lyrics,undefined);assert.equal(lyrical.config.duration,20);assert.equal(musicRequest(model,'Ambient',{},{}).config.generation_type,'bgm');});
test('Foundation uses top-level prompt and omits incompatible generic controls',()=>{const model={id:'fixture/Foundation-1'},body=musicRequest(model,'A gentle museum soundscape',{generation_type:'bgm',duration:30});assert.deepEqual(body,{model:model.id,prompt:'A gentle museum soundscape',config:{duration:30}});assert.throws(()=>musicRequest(model,'Song',{lyrics:'Sing these words'}),/lyric-capable/);assert.equal(musicRequest({id:'fixture/custom'},'Sound',{}, {family:'Foundation'}).prompt,'Sound');});
test('schema adaptation is limited to explicit native top-level-prompt validation errors',()=>{assert.equal(musicNeedsTopLevel(new Error('Tiiny 422: {"detail":[{"loc":["body","prompt"],"type":"missing"},{"loc":["body","config","caption"],"type":"extra_forbidden"}]}')),true);for(const message of ['Tiiny 500: worker stopped','Tiiny 401: unauthorized','Tiiny 422: invalid duration'])assert.equal(musicNeedsTopLevel(message),false);});
test('the reported lyric alias preserves instrumental intent and supplied lyrics after the matching rejection',()=>{
  const error=new Error('Tiiny 400: Extra inputs are not permitted in config: lyric_text');
  const request={model:'fixture/music',config:{caption:'Gentle piano',generation_type:'mixed',seconds_total:10,lyric_text:'[instrumental]'}};
  const reported={default_config:{lyrics:''}};
  assert.deepEqual(musicSchemaFallback(request,error,reported),{...request,config:{caption:'Gentle piano',generation_type:'mixed',seconds_total:10,lyrics:'[instrumental]'}});
  assert.equal(request.config.lyric_text,'[instrumental]');
  const lyricRequest={...request,config:{...request.config,lyric_text:'Keep my lyrics'}};
  assert.deepEqual(musicSchemaFallback(lyricRequest,error,reported),
    {...request,config:{caption:'Gentle piano',generation_type:'mixed',seconds_total:10,lyrics:'Keep my lyrics'}});
  assert.equal(musicSchemaFallback(request,error),null);
  assert.equal(musicSchemaFallback(request,error,{default_config:{lyrics:'',lyric_text:''}}),null);
  assert.equal(musicSchemaFallback(request,'Tiiny 400: Extra inputs are not permitted in config: seconds_total',reported),null);
  assert.equal(musicSchemaFallback(request,'Tiiny 500: Extra inputs are not permitted in config: lyric_text',reported),null);
});
