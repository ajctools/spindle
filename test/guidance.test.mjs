import test from 'node:test';
import assert from 'node:assert/strict';
import {tasks} from '../core.mjs';
import {workflowWarnings,recovery} from '../public/guidance.mjs';

test('workflow guidance accepts a valid image-to-video handoff and catches wrong file types before a run',()=>{
  assert.deepEqual(workflowWarnings([{task:'image',prompt:'{{input}}',fileFrom:'none'},{task:'video',prompt:'Animate the scene',fileFrom:'previous'}],tasks),[]);
  assert.deepEqual(workflowWarnings([{task:'asr',fileFrom:'input'},{task:'chat',prompt:'Summarize {{previous.text}}',fileFrom:'none'},{task:'speech',prompt:'{{previous.text}}',fileFrom:'none'}],tasks),[]);
  const text=workflowWarnings([{task:'chat',prompt:'{{input}}'},{task:'video',fileFrom:'previous'}],tasks);assert.equal(text[0].step,1);assert.match(text[0].text,/no image or audio/);
  const wrong=workflowWarnings([{task:'speech'},{task:'ocr',fileFrom:'previous'}],tasks);assert.match(wrong[0].text,/needs an image/);
  assert.match(workflowWarnings([{task:'chat',prompt:'{{previous.text}}'}],tasks)[0].text,/first step/);
  assert.match(workflowWarnings([{task:'asr',fileFrom:'none'}],tasks)[0].text,/Starting file/);
});
test('recovery sends authentication failures to Connection and keeps a precise workflow fix visible',()=>{
  assert.equal(recovery('Tiiny 401: Invalid API key').action,'connection');
  assert.equal(recovery('The configured Tiiny endpoint returned an HTML page instead of an API response (HTTP 200).').action,'connection');
  assert.equal(recovery('Unexpected token \'<\', "<!DOCTYPE "... is not valid JSON').action,'connection');
  const message='Step 2: Transcription needs audio.';assert.equal(recovery(message).text,message);
  assert.equal(recovery('The NPU stayed busy.').action,'models');
});

test('audio recovery identifies the failed stage while keeping authentication guidance',()=>{
  assert.match(recovery('Tiiny 500: The upstream TTS model failed.','speech').title,/speech model/);
  assert.match(recovery('Tiiny 500: The upstream TTS model failed.','voice-reference').title,/Reference-voice/);
  assert.match(recovery('fetch failed','music-generation').title,/Music generation/);
  assert.match(recovery('Tiiny 400: Extra inputs are not permitted in config: lyric_text','music-generation').title,/music runtime rejected/i);
  assert.match(recovery('The operation timed out','music-runtime').title,/runtime check/);
  assert.match(recovery('Tiiny returned no playable audio.','audio-response').title,/Audio response/);
  assert.equal(recovery('Tiiny 401: Invalid API key','music-generation').action,'connection');
});
