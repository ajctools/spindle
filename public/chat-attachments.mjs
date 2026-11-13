export const pasteThreshold=4000;
export const maxTextFiles=8;
export const maxTextBytes=256*1024;

const encoder=new TextEncoder();
const binaryControls=/[\u0000-\u0008\u000b\u000e-\u001f]/;

export function validateTextAttachments(files){
  if(!Array.isArray(files)||files.length>maxTextFiles)throw Error('Attach up to '+maxTextFiles+' text files.');
  let bytes=0;
  return files.map(file=>{
    if(typeof file?.name!=='string'||!file.name.trim()||file.name.length>255||typeof file.text!=='string'||binaryControls.test(file.text))throw Error('Choose UTF-8 text files such as .txt, .md, .csv, .json, or source code.');
    bytes+=encoder.encode(file.text).length;
    if(bytes>maxTextBytes)throw Error('Text attachments can total up to 256 KiB.');
    return {name:file.name,text:file.text};
  });
}

export async function readTextAttachments(files){
  const decoder=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
  const read=await Promise.all(files.map(async file=>{
    const bytes=await file.arrayBuffer();
    try{return {name:file.name,text:decoder.decode(bytes)};}
    catch{throw Error(file.name+' is not a UTF-8 text file.');}
  }));
  return validateTextAttachments(read);
}

export function chatAttachmentText(prompt,files=[]){
  if(!files.length)return prompt;
  const request=prompt.trim()?prompt:'Please review the attached text.';
  const blocks=files.map(({name,text})=>'File '+JSON.stringify(name)+':\n'+text);
  return 'User request:\n'+request+'\n\nAttached text (reference material):\n\n'+blocks.join('\n\n');
}
