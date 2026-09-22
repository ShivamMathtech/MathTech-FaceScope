import {EYES, clamp} from './metrics.js';
const COLORS=['#73e3c0','#71b9fc','#eebe86'];
export function drawOverlay(canvas, frame, result, connections, options) {
  const w=frame.width,h=frame.height;
  if (canvas.width!==w || canvas.height!==h) {canvas.width=w;canvas.height=h;}
  const ctx=canvas.getContext('2d'); ctx.clearRect(0,0,w,h);ctx.save();
  if (options.mirror) {ctx.translate(w,0);ctx.scale(-1,1);}
  ctx.drawImage(frame,0,0);
  const points=result?.faceLandmarks?.[0];
  if (points) {
    for (const [key,color,lineWidth] of [['mesh','#65e4c045',0.65],['contours','#8ff8d8cc',1.3],['irises','#ffd27bee',1.8]]) {
      if (!(key==='irises'?options.iris:options[key])) continue;
      ctx.strokeStyle=color;ctx.lineWidth=lineWidth*Math.max(1,w/900);ctx.beginPath();
      for (const {start,end} of connections[key]||[]) {const a=points[start],b=points[end];ctx.moveTo(a.x*w,a.y*h);ctx.lineTo(b.x*w,b.y*h);}
      ctx.stroke();
    }
    if (options.iris) for(const i of [468,473]) {const p=points[i];ctx.fillStyle='#ffd27b';ctx.beginPath();ctx.arc(p.x*w,p.y*h,2.5,0,Math.PI*2);ctx.fill();}
  }
  ctx.restore();
}

export function drawEye(canvas, frame, points, side) {
  const ctx=canvas.getContext('2d'),w=canvas.width,h=canvas.height;
  ctx.fillStyle='#09141c';ctx.fillRect(0,0,w,h);
  if (!points) return;
  const ids=EYES[side],xs=ids.map(i=>points[i].x*frame.width),ys=ids.map(i=>points[i].y*frame.height);
  const eyeWidth=Math.max(...xs)-Math.min(...xs),bw=Math.max(eyeWidth*1.65,20),bh=bw*h/w;
  const cx=(Math.max(...xs)+Math.min(...xs))/2,cy=(Math.max(...ys)+Math.min(...ys))/2;
  const x=cx-bw/2,y=cy-bh/2;
  ctx.drawImage(frame,x,y,bw,bh,0,0,w,h);
  const p=points[side==='left'?473:468],px=(p.x*frame.width-x)*w/bw,py=(p.y*frame.height-y)*h/bh;
  ctx.strokeStyle='#73e3c0';ctx.lineWidth=1.3;ctx.beginPath();ctx.moveTo(px-12,py);ctx.lineTo(px+12,py);ctx.moveTo(px,py-12);ctx.lineTo(px,py+12);ctx.stroke();
}

export function drawDepth(canvas, points, connections, phase=0,sourceWidth=640,sourceHeight=480) {
  const ctx=canvas.getContext('2d'),w=canvas.width,h=canvas.height;ctx.clearRect(0,0,w,h);
  ctx.strokeStyle='#263c49';ctx.beginPath();ctx.moveTo(25,h-20);ctx.lineTo(w-25,h-20);ctx.stroke();
  ctx.fillStyle='#698897';ctx.font='9px monospace';ctx.fillText('RELATIVE DEPTH · NOT TO SCALE',14,15);
  if (!points) return;
  const center=points[168],yaw=0.6+Math.sin(phase)*0.18;
  const projected=points.map(p=>{const x=(p.x-center.x)*sourceWidth,y=(p.y-center.y)*sourceHeight,z=(p.z-center.z)*sourceWidth;
    return [x*Math.cos(yaw)+z*Math.sin(yaw),y];});
  const minX=Math.min(...projected.map(p=>p[0])),maxX=Math.max(...projected.map(p=>p[0]));
  const minY=Math.min(...projected.map(p=>p[1])),maxY=Math.max(...projected.map(p=>p[1]));
  const scale=Math.min((w-50)/Math.max(1,maxX-minX),(h-36)/Math.max(1,maxY-minY));
  const project=i=>[w/2+(projected[i][0]-(minX+maxX)/2)*scale,h/2+8+(projected[i][1]-(minY+maxY)/2)*scale];
  ctx.strokeStyle='#73e3c064';ctx.lineWidth=.55;ctx.beginPath();
  for (const {start,end} of connections.mesh||[]) {const a=project(start),b=project(end);ctx.moveTo(...a);ctx.lineTo(...b);}
  ctx.stroke();
}

const CHARTS={eyes:{keys:['eye_left','eye_right'],labels:['Left eye EAR','Right eye EAR'],min:0,max:.5},pose:{keys:['yaw','pitch','roll'],labels:['Yaw °','Pitch °','Roll °'],min:-60,max:60},mouth:{keys:['mouth'],labels:['Mouth ratio'],min:0,max:1},iris:{keys:['iris_x','iris_y'],labels:['Iris horizontal','Iris vertical'],min:-.25,max:1}};
export function drawChart(canvas,samples,mode,legend) {
  const config=CHARTS[mode],ctx=canvas.getContext('2d'),w=canvas.width,h=canvas.height;
  const pad={left:48,right:15,top:10,bottom:28};ctx.clearRect(0,0,w,h);
  ctx.font='10px monospace';ctx.fillStyle='#7993a4';ctx.strokeStyle='#23353f';ctx.lineWidth=1;
  const latest=samples.at(-1)?.time||0,start=Math.max(0,latest-30),end=Math.max(start+5,latest);
  const plot=samples.filter(s=>s.time>=start);
  const x=t=>pad.left+(t-start)/(end-start)*(w-pad.left-pad.right);
  const y=v=>pad.top+(config.max-v)/(config.max-config.min)*(h-pad.top-pad.bottom);
  for(let i=0;i<=4;i++){const v=config.min+(config.max-config.min)*i/4;ctx.beginPath();ctx.moveTo(pad.left,y(v));ctx.lineTo(w-pad.right,y(v));ctx.stroke();ctx.fillText(v.toFixed(mode==='pose'?0:2),7,y(v)+3);}
  for(let i=0;i<=5;i++){const t=start+(end-start)*i/5;ctx.fillText(t.toFixed(1)+'s',x(t)-10,h-7);}
  config.keys.forEach((key,i)=>{ctx.strokeStyle=COLORS[i];ctx.lineWidth=2;ctx.beginPath();let pen=false,last=null;
    for(const s of plot){const v=s[key];if(!s.detected||!Number.isFinite(v)){pen=false;continue;}
      if(last!==null&&s.time-last>.5)pen=false;
      const px=x(s.time),py=y(clamp(v,config.min,config.max));if(pen)ctx.lineTo(px,py);else ctx.moveTo(px,py);pen=true;last=s.time;}
    ctx.stroke();});
  legend.replaceChildren(...config.labels.map((label,i)=>{const span=document.createElement('span'),dot=document.createElement('i');dot.style.background=COLORS[i];span.append(dot,document.createTextNode(label));return span;}));
}

export function drawBlends(container,shapes,filter='') {
  const list=Object.entries(shapes).filter(([key])=>key.toLowerCase().includes(filter.toLowerCase())).sort((a,b)=>b[1]-a[1]);
  if (!list.length) {container.textContent=Object.keys(shapes).length?'No matching channels.':'Channels appear when a face is tracked.';return;}
  // Reuse channel rows to avoid replacing focused / scrolled DOM on each frame.
  const existing=new Map([...container.querySelectorAll('.blend')].map(el=>[el.dataset.channel,el]));
  for (const [name,value] of list) {
    let row=existing.get(name);
    if (!row) {row=document.createElement('div');row.className='blend';row.dataset.channel=name;
      const header=document.createElement('div'),label=document.createElement('span'),number=document.createElement('span'),bar=document.createElement('div'),fill=document.createElement('i');label.textContent=name;header.append(label,number);bar.className='bar';bar.append(fill);row.append(header,bar);}
    row.querySelector('div span:last-child').textContent=value.toFixed(3);row.querySelector('i').style.width=clamp(value*100,0,100)+'%';container.append(row);existing.delete(name);
  }
  for(const row of existing.values())row.remove();
  for(const el of [...container.childNodes])if(el.nodeType===3||el.nodeName==='P')el.remove();
}
