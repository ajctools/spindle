import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

// Standard third-party rendering, environment and post-processing utilities.
// No custom museum scene, exhibit layout, visitor controls or app is supplied.
export const RUNTIME_MARKER='__SPINDLE_THREE_R187__';
export const RUNTIME_INFO=JSON.parse(readFileSync(new URL('./public/vendor/three-r187.json',import.meta.url),'utf8'));
const code=readFileSync(new URL('./public/vendor/three-r187.min.js',import.meta.url),'utf8');
if(createHash('sha256').update(code).digest('hex')!==RUNTIME_INFO.sha256)throw new Error('The bundled Three.js runtime failed its integrity check.');
const license=readFileSync(new URL('./public/vendor/THREE-LICENSE.txt',import.meta.url),'utf8');
export const RUNTIME_SCRIPT='<script id="spindle-runtime" data-library="three.js '+RUNTIME_INFO.version+'">/*\n'+license.replace(/\*\//g,'* /')+'\n*/\n'+code+'</script>';
export const RUNTIME_SLOT='<script id="spindle-runtime" type="application/x-spindle-runtime">'+RUNTIME_MARKER+'</script>';
export const runtimeSlot=source=>[...source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)].filter(m=>/\bid\s*=\s*["']spindle-runtime["']/i.test(m[1]));
