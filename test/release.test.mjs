import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {RELEASE_FILES,buildRelease,scanReleaseFile} from '../scripts/release.mjs';

test('release scanning catches private values, non-example addresses and hidden media metadata',()=>{
  const known=[{label:'fixture private value',value:['private','release','secret'].join('-')}];
  assert.ok(scanReleaseFile('example.txt',Buffer.from(known[0].value),known).includes('fixture private value'));
  assert.ok(scanReleaseFile('example.txt',Buffer.from(Buffer.from(known[0].value).toString('base64')),known).length);
  assert.ok(scanReleaseFile('example.txt',Buffer.from(['10','20','30','40'].join('.'))).includes('non-documentation IP address'));
  assert.equal(scanReleaseFile('example.txt',Buffer.from('http://192.0.2.10 http://127.0.0.1')).length,0);
  const png=Buffer.alloc(24);png.writeUInt32BE(4,8);png.write('tEXt',12);assert.ok(scanReleaseFile('example.png',png).includes('image metadata requiring manual review'));
  const binary=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.from(['sample','outside.invalid'].join('@'))]);
  assert.equal(scanReleaseFile('example.png',binary).length,0);assert.ok(scanReleaseFile('example.png',binary,[{label:'known secret',value:'sample'}]).includes('known secret'));
  assert.ok(scanReleaseFile('example.jpg',Buffer.from([255,216,255,225,0,4,0,0,255,217])).includes('image metadata requiring manual review'));
});
test('release manifest excludes runtime, credentials, screenshots and unlisted files',async()=>{
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),temp=await fs.mkdtemp(path.join(root,'test','.runtime-'));
  try{
    const output=path.join(temp,'release'),manifest=await buildRelease({root,output});
    assert.equal(manifest.files.length,RELEASE_FILES.length);assert.ok(manifest.files.every(r=>!/^(?:data|work)\//.test(r.path)&&r.path!=='.env'));
    assert.ok(!RELEASE_FILES.some(name=>name.includes('screenshot')||name.includes('catalog.json')));
    assert.equal(JSON.parse(await fs.readFile(path.join(output,'RELEASE-MANIFEST.json'),'utf8')).version,JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8')).version);
    await assert.rejects(buildRelease({root,output}),/never overwritten/);
  }finally{assert.ok(temp.startsWith(path.join(root,'test')+path.sep));await fs.rm(temp,{recursive:true,force:true});}
});
