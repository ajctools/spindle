const canvas=document.getElementById('spindle-field'),ctx=canvas.getContext('2d');
const reduce=matchMedia('(prefers-reduced-motion: reduce)');
let enabled=localStorage.getItem('spindle-motion')!=='off'&&!reduce.matches,w=0,h=0,time=0,last=0,raf=0,activity=false,px=0,py=0;
function resize(){const d=Math.min(devicePixelRatio || 1,1.5);w=innerWidth;h=innerHeight;canvas.width=w*d;canvas.height=h*d;canvas.style.width=w+'px';canvas.style.height=h+'px';ctx.setTransform(d,0,0,d,0,0);if(!enabled)draw(0);}
function project(x,y,z,t){const ry=t*.09+px*.1,rx=-.38+py*.1;const a=x*Math.cos(ry)+z*Math.sin(ry),b=-x*Math.sin(ry)+z*Math.cos(ry),c=y*Math.cos(rx)-b*Math.sin(rx),d=y*Math.sin(rx)+b*Math.cos(rx);return [a,c,d];}
function draw(t){
  ctx.clearRect(0,0,w,h);const cx=w<700?w*.82:w*.79,cy=w<700?170:235,r=Math.min(w*.24,250),pulse=activity?1.06:1;
  const halo=ctx.createRadialGradient(cx,cy,0,cx,cy,r*1.5);halo.addColorStop(0,'rgba(130,93,255,.13)');halo.addColorStop(.55,'rgba(64,197,210,.055)');halo.addColorStop(1,'rgba(60,40,130,0)');ctx.fillStyle=halo;ctx.fillRect(0,0,w,h);
  ctx.globalCompositeOperation='lighter';
  // Sixty curved threads form a rotating, breathing field rather than a flat particle wallpaper.
  for(let line=0;line<60;line++){
    const lat=(line/59-.5)*Math.PI,sl=Math.sin(lat),cl=Math.cos(lat),wave=Math.sin(t*.3+line*.2)*.015;
    ctx.beginPath();let depth=0;
    for(let k=0;k<=84;k++){const a=k/84*Math.PI*2;const twist=a+sl*.9+Math.sin(a*3+t*.18)*.065;const v=project(Math.cos(twist)*cl,sl+Math.sin(a*2+t*.12)*.025,Math.sin(twist)*cl,t);const x=cx+v[0]*r*pulse,y=cy+v[1]*r*.81*pulse;depth+=v[2];if(!k)ctx.moveTo(x,y);else ctx.lineTo(x,y);}
    const hue=165+line*1.9;ctx.strokeStyle=`hsla(${hue},85%,73%,${.12+Math.abs(cl)*.1+wave})`;ctx.lineWidth=line%6===0?1.15:.55;ctx.stroke();
  }
  for(let j=0;j<3;j++){
    ctx.beginPath();for(let k=0;k<=160;k++){const a=k/160*Math.PI*2,tilt=.35+j*.62;const v=project(Math.cos(a)*(1.12+j*.06),Math.sin(a)*Math.sin(tilt),Math.sin(a)*Math.cos(tilt),t*.8+j);const x=cx+v[0]*r,y=cy+v[1]*r*.81;if(!k)ctx.moveTo(x,y);else ctx.lineTo(x,y);}ctx.strokeStyle=j===0?'rgba(194,243,154,.32)':'rgba(164,150,255,.2)';ctx.lineWidth=.7;ctx.stroke();
    const a=t*(activity?.6:.13)+j*2,tilt=.35+j*.62,v=project(Math.cos(a)*(1.12+j*.06),Math.sin(a)*Math.sin(tilt),Math.sin(a)*Math.cos(tilt),t*.8+j),x=cx+v[0]*r,y=cy+v[1]*r*.81;
    ctx.shadowBlur=15;ctx.shadowColor=j===0?'#d5ff9a':'#b3a3ff';ctx.fillStyle=j===0?'#e0ffb4':'#c7bbff';ctx.beginPath();ctx.arc(x,y,2.7,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;
  }
  for(let n=0;n<46;n++){const x=((n*271.71)%w),y=((n*131.17)%h),a=.08+.13*(.5+.5*Math.sin(t*.4+n));ctx.fillStyle=`rgba(204,207,255,${a})`;ctx.fillRect(x,y,n%8===0?2:1,n%8===0?2:1);}
  ctx.globalCompositeOperation='source-over';
}
function frame(now){if(!enabled||document.hidden){raf=0;return;}if(now-last>33){time+=Math.min((now-last)/1000,.1);last=now;draw(time);}raf=requestAnimationFrame(frame);}
function update(){document.body.classList.toggle('still',!enabled);const b=document.getElementById('motion-toggle');b.textContent=enabled?'✧ Ambient motion':'✧ Still mode';b.setAttribute('aria-pressed',String(enabled));if(enabled&&!raf){last=performance.now();raf=requestAnimationFrame(frame);}if(!enabled)draw(time);}
document.getElementById('motion-toggle').onclick=()=>{enabled=!enabled;localStorage.setItem('spindle-motion',enabled?'on':'off');update();};
document.addEventListener('pointermove',e=>{px=e.clientX/innerWidth-.5;py=e.clientY/innerHeight-.5;},{passive:true});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)update();});
window.addEventListener('resize',resize);window.addEventListener('spindle:activity',e=>{activity=!!e.detail;document.body.classList.toggle('is-working',activity);});reduce.addEventListener('change',e=>{if(e.matches){enabled=false;update();}});
resize();update();
