export async function transcriptionFile(file,maxSeconds=900){
  const decode=new OfflineAudioContext(1,1,16000);
  let audio;try{audio=await decode.decodeAudioData(await file.arrayBuffer());}catch{throw new Error('This browser could not decode the audio. Try WAV, MP3, M4A, or WebM.');}
  if(audio.duration>maxSeconds)throw new Error(maxSeconds<60?'Choose a recording up to '+maxSeconds+' seconds long.':'Split recordings longer than '+maxSeconds/60+' minutes into smaller files.');
  const frames=Math.ceil(audio.duration*16000),render=new OfflineAudioContext(1,frames,16000),source=render.createBufferSource();source.buffer=audio;source.connect(render.destination);source.start();
  const mono=(await render.startRendering()).getChannelData(0),buffer=new ArrayBuffer(44+mono.length*2),view=new DataView(buffer),str=(offset,s)=>{for(let i=0;i<s.length;i++)view.setUint8(offset+i,s.charCodeAt(i));};
  str(0,'RIFF');view.setUint32(4,36+mono.length*2,true);str(8,'WAVE');str(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,16000,true);view.setUint32(28,32000,true);view.setUint16(32,2,true);view.setUint16(34,16,true);str(36,'data');view.setUint32(40,mono.length*2,true);
  for(let i=0;i<mono.length;i++){const v=Math.max(-1,Math.min(1,mono[i]));view.setInt16(44+i*2,v<0?v*32768:v*32767,true);}
  const bytes=new Uint8Array(buffer);let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
  return {name:file.name.replace(/\.[^.]+$/,'')+'.wav',data:'data:audio/wav;base64,'+btoa(binary)};
}
