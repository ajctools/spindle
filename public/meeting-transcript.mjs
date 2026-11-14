export const meetingClock=seconds=>[Math.floor(seconds/60),Math.floor(seconds%60)].map(value=>String(value).padStart(2,'0')).join(':');

// A conservative near-silence check, in 20 ms frames at 16 kHz.
export function quietAudio(length,sampleAt){
  let energy=0;
  for(let i=0;i<length;i++){
    const sample=sampleAt(i);
    energy+=sample*sample;
    if((i+1)%320===0||i===length-1){
      if(energy/((i%320)+1)>=0.002**2)return false;
      energy=0;
    }
  }
  return true;
}

export function previewText(text){
  if(typeof text!=='string'||!text.trim())return {text:''};
  if(text.length>4000)return {text:'',unreliable:true};
  const words=text.toLowerCase().match(/[\p{L}\p{M}\p{N}]+/gu)||[];
  for(let width=1;width<=8;width++){
    let same=0;
    for(let i=width;i<words.length;i++){
      same=words[i]===words[i-width]?same+1:0;
      if(same>=7*width)return {text:'',unreliable:true};
    }
  }
  return {text:text.trim()};
}

export function meetingLines(run){
  if(!run?.meeting)return [];
  return (run.outputs||[]).flatMap((output,index)=>{
    const {chunkSeconds,duration}=run.meeting;
    const offset=index*chunkSeconds,length=Math.min(chunkSeconds,duration-offset);
    const segments=output.json?.segments??output.json?.data?.segments??output.json?.result?.segments;
    const timed=Array.isArray(segments)?segments.filter(row=>Number.isFinite(row?.start)&&row.start>=0&&row.start<length&&typeof row.text==='string'&&row.text.trim()):[];
    if(timed.length){
      const voices=new Map();
      return timed.map(row=>{
        const id=row.speaker??row.speaker_id;
        let speaker;
        if((typeof id==='string'&&id.trim()&&id.length<=100)||Number.isSafeInteger(id)){
          const key=String(id).trim();
          if(!voices.has(key))voices.set(key,voices.size+1);
          speaker=(duration>chunkSeconds?`Section ${index+1}, voice `:'Voice ')+voices.get(key);
        }
        return {at:offset+row.start,text:row.text.trim(),approximate:false,...(speaker?{speaker}:{})};
      });
    }
    const text=typeof output.text==='string'?output.text.trim():'';
    return text?[{at:offset,text,approximate:true}]:[];
  });
}
