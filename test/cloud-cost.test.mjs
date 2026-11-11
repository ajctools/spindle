import test from 'node:test';import assert from 'node:assert/strict';
import {cloudUsage,cloudEstimate,formatCloudCost} from '../public/cloud-cost.mjs';
import {summarize} from '../metrics.mjs';
const row=(extra={})=>({id:'example',task:'chat',status:'completed',inputTokens:1000000,outputTokens:200000,reasoningTokens:50000,profile:{hasFile:false},...extra});
test('cloud comparison uses both reported text directions and never double-counts reasoning',()=>{
 const usage=cloudUsage([row()]);assert.deepEqual(usage,{inputTokens:1000000,outputTokens:200000,covered:1,completed:1,excluded:0});assert.equal(cloudEstimate(usage,3,15),6);
});
test('cloud comparison excludes failed, media, image-input and uncertain usage without assuming zeros',()=>{
 const usage=cloudUsage([row({status:'failed'}),row({task:'image'}),row({profile:{hasFile:true}}),row({profile:{hasFile:null}}),row({inputTokens:null}),row({outputTokens:undefined}),row({inputTokens:-1}),row({inputTokens:0,outputTokens:0})]);assert.equal(usage.covered,1);assert.equal(usage.completed,6);assert.equal(cloudEstimate(usage,3,15),0);assert.equal(cloudEstimate(cloudUsage([]),3,15),null);assert.equal(cloudEstimate(usage,NaN,15),null);assert.equal(cloudEstimate(usage,-1,15),null);
});
test('cloud costs use consistent sub-dollar precision and distinguish tiny, zero, and missing estimates',()=>{
 const format=amount=>formatCloudCost(amount,'en-US');
 assert.deepEqual([.05495,.0129475,.00811005,1].map(format),['$0.0550','$0.0129','$0.0081','$1.00']);
 assert.deepEqual([.00001,.0001,0,null].map(format),['<$0.0001','$0.0001','$0.0000','—']);
});
test('cloud aggregation covers the full selected history and follows filters beyond the recent 50',()=>{
 const startedAt=new Date().toISOString(),records=Array.from({length:80},(_,i)=>row({id:String(i),model:i<60?'example/a':'example/b',startedAt,totalTokens:1200000,executionMs:100}));
 const all=summarize(records,{days:0});assert.equal(all.recent.length,50);assert.equal(all.cloudUsage.covered,80);assert.equal(summarize(records,{days:0,model:'example/b'}).cloudUsage.covered,20);assert.equal(summarize(records,{days:0,task:'mesh'}).cloudUsage.covered,0);
});
