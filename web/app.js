import {measure,BlinkCounter,Smoother,METRIC_KEYS,summarize} from './metrics.js';
import {drawOverlay,drawEye,drawDepth,drawChart,drawBlends} from './render.js';
import {exportSession,download} from './export.js';

const $=id=>document.getElementById(id),video=$('video');
const state={ready:false,source:null,stream:null,url:null,samples:[],events:[],result:null,connections:{},
  shapes:{},lastCaptured:-1,lastTick:0,inFlight:false,generation:0,batch:false,cancelBatch:false,
  calibration:null,calibrating:null,limited:false,lastUi:0,frameCount:0,fpsStart:performance.now()};
const frame=document.createElement('canvas'),blink=new BlinkCounter(),smoother=new Smoother();
let worker,requestId=0,pending=null,lastModelTimestamp=0,lastMediaTime=-1,modelEpoch=0;
const settings=()=>({sample_rate:+$('sampleRate').value,blink_close:blink.close,blink_open:blink.open,
  smoothing_seconds:+$('smoothing').value,include_landmarks:$('rawLandmarks').checked});
const fmt=(n,d=3)=>Number.isFinite(n)?n.toFixed(d):'—';
const clock=n=>`${String(Math.floor((n||0)/60)).padStart(2,'0')}:${String(Math.floor((n||0)%60)).padStart(2,'0')}`;
let toastTimer;
function toast(message,error=false){$('toast').textContent=message;$('toast').classList.toggle('error',error);$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,error?10000:5500);}
function updateButtons(){const loaded=!!state.source,hasData=state.samples.length>0;
  $('camera').disabled=!state.ready||state.batch;$('fileInput').disabled=!state.ready||state.batch;
  $('stop').disabled=!loaded||state.batch;$('play').disabled=!loaded||state.source?.type!=='video'||state.batch;
  $('seek').disabled=$('play').disabled;$('calibrate').disabled=!loaded||!state.result?.faceLandmarks?.length||state.batch;
  $('snapshot').disabled=!loaded;$('batch').disabled=!state.ready||state.source?.type!=='video';
  for(const id of ['save','csv','json','report'])$(id).disabled=!hasData||state.batch;
  for(const id of ['sampleRate','blinkThreshold','rawLandmarks','reset'])$(id).disabled=state.batch;
  $('batch').textContent=state.batch?'Cancel analysis':'Analyze full video';
}
function clearMetrics(){for(const id of ['eyeLeft','eyeRight','mouthValue','yaw','pitch','roll'])$(id).textContent='—';$('gazeValue').textContent='x — / y —';state.shapes={};drawBlends($('blends'),{});}
function clearData({keepCalibration=false}={}){state.samples=[];state.events=[];state.limited=false;state.lastCaptured=-1;blink.reset();smoother.reset();
  if(!keepCalibration){state.calibration=null;state.calibrating=null;blink.close=+$('blinkThreshold').value;blink.open=blink.close+.04;$('neutralStatus').textContent='Canonical model orientation · neutral not set';$('calibrate').textContent='◎ Set neutral';}
  $('blinkCount').textContent='0';$('blinkRate').textContent='Rate available after 5 s';$('sampleInfo').textContent='0 samples · 0 detected';
  drawChart($('timeline'),[],$('chartMode').value,$('chartLegend'));updateButtons();}
function confirmClear(message){return !state.samples.length||window.confirm(message);}
function stopSource(){state.generation++;state.stream?.getTracks().forEach(t=>t.stop());state.stream=null;video.pause();video.srcObject=null;video.removeAttribute('src');video.load();if(state.url)URL.revokeObjectURL(state.url);state.url=null;state.source=null;state.result=null;state.calibrating=null;
  $('calibrate').textContent='◎ Set neutral';$('empty').hidden=false;$('sourceName').textContent='No source selected';$('trackingStatus').textContent='STANDBY';$('trackingStatus').className='chip';$('resolution').textContent='NO INPUT';$('latency').textContent='INFERENCE —';$('fps').textContent='— fps';$('time').textContent='00:00 / 00:00';$('seek').value=0;$('play').textContent='▶ Play';
  $('overlay').getContext('2d').clearRect(0,0,$('overlay').width,$('overlay').height);clearMetrics();for(const side of ['left','right'])drawEye($(side+'Eye'),frame,null,side);drawDepth($('mesh3d'),null,state.connections);updateButtons();}
async function loadedMetadata(){if(video.readyState>=1)return;await new Promise((resolve,reject)=>{const timer=setTimeout(()=>done(new Error('Video metadata timed out. Try an MP4 H.264 or WebM file.')),15000);const success=()=>done(),error=()=>done(new Error('This browser cannot decode the selected video. Try MP4 H.264 or WebM.'));function done(e){clearTimeout(timer);video.removeEventListener('loadedmetadata',success);video.removeEventListener('error',error);e?reject(e):resolve();}video.addEventListener('loadedmetadata',success,{once:true});video.addEventListener('error',error,{once:true});});}
async function openFile(file){if(!file||!state.ready)return;if(!confirmClear('Opening a source starts a new dataset. Save or export the current data first if needed. Continue?'))return;
  stopSource();clearData();try{state.url=URL.createObjectURL(file);video.src=state.url;await loadedMetadata();if(!Number.isFinite(video.duration)||video.duration<=0)throw new Error('Cannot determine video duration. Please use a finite video file.');
    state.source={type:'video',name:file.name,width:video.videoWidth,height:video.videoHeight,duration:video.duration,bytes:file.size};state.lastSource={...state.source};$('sessionName').value=file.name.replace(/\.[^.]+$/,'')+' analysis';$('mirror').checked=false;sourceReady();await video.play();}catch(error){stopSource();toast(error.message,true);}}
function sourceReady(){state.lastCaptured=-1;$('empty').hidden=true;$('sourceName').textContent=state.source.name;$('resolution').textContent=`${video.videoWidth} × ${video.videoHeight}`;updateButtons();}
async function startCamera(){if(!confirmClear('Starting the camera begins a new dataset. Continue?'))return;stopSource();clearData();try{
    if(!navigator.mediaDevices?.getUserMedia)throw new Error('Camera access needs localhost and a supported browser. Open the address printed by run.py.');
    state.stream=await navigator.mediaDevices.getUserMedia({video:{width:{ideal:1280},height:{ideal:720},facingMode:'user'},audio:false});video.srcObject=state.stream;await loadedMetadata();
    state.source={type:'camera',name:'Webcam',width:video.videoWidth,height:video.videoHeight};state.lastSource={...state.source};$('sessionName').value='Camera '+new Date().toLocaleString();$('mirror').checked=true;sourceReady();await video.play();
    state.stream.getVideoTracks()[0].addEventListener('ended',()=>{stopSource();toast('Camera disconnected. Captured measurements remain available.',true);});
  }catch(error){stopSource();toast(error.name==='NotAllowedError'?'Camera permission was denied. Allow camera access in your browser, or open a video.':error.message,true);}}

function initWorker(){return new Promise((resolve,reject)=>{worker=new Worker('/tracker.worker.js');let initialized=false;const timer=setTimeout(()=>reject(new Error('Vision engine did not start. Confirm that the bundled model and WASM files are present.')),45000);
  worker.onmessage=({data})=>{if(data.type==='ready'){initialized=true;clearTimeout(timer);state.connections=data.connections;resolve();}
    else if(data.type==='result'&&pending?.id===data.id){clearTimeout(pending.timer);const p=pending;pending=null;p.resolve(data);}
    else if(data.type==='error'){const error=new Error(data.message);if(!initialized){clearTimeout(timer);reject(error);}else if(pending){clearTimeout(pending.timer);pending.reject(error);pending=null;}}};
  worker.onerror=event=>{const error=new Error(event.message||'Vision worker failed.');if(!initialized){clearTimeout(timer);reject(error);}if(pending){clearTimeout(pending.timer);pending.reject(error);pending=null;}};
  worker.postMessage({type:'init'});});}
function infer(bitmap,mediaTime){return new Promise((resolve,reject)=>{const id=++requestId;
  // Preserve media-time deltas during slow batch inference. Offset new timelines
  // so MediaPipe still sees strictly increasing timestamps after a seek/source change.
  if(mediaTime<=lastMediaTime)modelEpoch=lastModelTimestamp+1000/+$('sampleRate').value-mediaTime*1000;
  lastModelTimestamp=Math.max(modelEpoch+mediaTime*1000,lastModelTimestamp+.001);lastMediaTime=mediaTime;
  const timer=setTimeout(()=>{pending=null;reject(new Error('Frame analysis timed out. Reload the app to restart the engine.'));},20000);pending={id,resolve,reject,timer};worker.postMessage({type:'frame',id,bitmap,timestamp:lastModelTimestamp},[bitmap]);});}

function calibrateSample(raw){if(!state.calibrating)return;const c=state.calibrating;if(raw.eye_left<.13||raw.eye_right<.13)return;c.push(raw);$('calibrate').textContent=`Hold still ${c.length}/30`;
  if(c.length>=30){const median=k=>c.map(s=>s[k]).filter(Number.isFinite).sort((a,b)=>a-b)[Math.floor(c.length/2)];state.calibration=Object.fromEntries(METRIC_KEYS.map(k=>[k,median(k)]));const ear=(state.calibration.eye_left+state.calibration.eye_right)/2;blink.close=ear*.68;blink.open=ear*.83;$('blinkThreshold').value=blink.close.toFixed(3);state.calibrating=null;$('calibrate').textContent='◎ Reset neutral';$('neutralStatus').textContent='Neutral reference active · display uses pose / iris offsets';clearData({keepCalibration:true});toast('Neutral reference set. A new calibrated dataset has started.');}}
function processResult(data,time){state.result=data.result;const raw=measure(data.result,frame.width,frame.height),detected=!!raw;
  const shapes=Object.fromEntries((data.result.faceBlendshapes?.[0]?.categories||[]).map(c=>[c.categoryName,c.score]));state.shapes=shapes;
  $('trackingStatus').textContent=detected?'FACE TRACKED':'NO FACE';$('trackingStatus').className='chip'+(detected?' tracked':'');$('latency').textContent=`INFERENCE ${data.inferenceMs.toFixed(0)} ms`;
  const limit=$('rawLandmarks').checked?1200:18000;
  if(!state.limited&&state.samples.length>=limit){state.limited=true;toast(`Capture limit reached (${limit} samples). Save or export, then clear data for a new capture.`,true);}
  const event=state.limited?null:blink.update(time,raw?.eye_left,raw?.eye_right);if(event)state.events.push(event);
  let sample={time,detected,...Object.fromEntries(METRIC_KEYS.map(k=>[k,raw?.[k]??null])),blink_count:blink.count,blinks_per_min:blink.rate,inference_ms:data.inferenceMs,blendshapes:shapes};
  if($('rawLandmarks').checked&&detected){sample.landmarks=data.result.faceLandmarks[0].map(({x,y,z})=>[x,y,z]);sample.transform=data.result.facialTransformationMatrixes?.[0]?.data;}
  if(!state.limited&&state.samples.length<limit){const previous=state.samples.at(-1);if(!previous||time>previous.time)state.samples.push(sample);}
  if(raw){const smoothed=smoother.update(raw,time,+$('smoothing').value);$('eyeLeft').textContent=fmt(smoothed.eye_left);$('eyeRight').textContent=fmt(smoothed.eye_right);$('mouthValue').textContent=fmt(smoothed.mouth);
    for(const k of ['yaw','pitch','roll'])$(k).textContent=fmt(smoothed[k]-(state.calibration?.[k]||0),1)+'°';$('gazeValue').textContent=`x ${fmt(smoothed.iris_x-(state.calibration?.iris_x||0),2)} / y ${fmt(smoothed.iris_y-(state.calibration?.iris_y||0),2)}`;calibrateSample(raw);
  }else{clearMetrics();smoother.reset();if(state.calibrating)state.calibrating=[];}
  $('blinkCount').textContent=String(blink.count);$('blinkRate').textContent=blink.rate===null?'Rate available after 5 s':`${blink.rate.toFixed(1)} / tracked minute`;
  renderFrame();state.frameCount++;const now=performance.now();
  if(now-state.fpsStart>1000){$('fps').textContent=(state.frameCount*1000/(now-state.fpsStart)).toFixed(1)+' fps';state.frameCount=0;state.fpsStart=now;}
  if(now-state.lastUi>180||state.batch){state.lastUi=now;drawChart($('timeline'),state.samples,$('chartMode').value,$('chartLegend'));drawBlends($('blends'),state.shapes,$('blendSearch').value);const detectedCount=state.samples.reduce((n,s)=>n+Number(s.detected),0);$('sampleInfo').textContent=`${state.samples.length.toLocaleString()} samples · ${detectedCount.toLocaleString()} detected${state.limited?' · capture stopped':''}`;}
  updateButtons();}
function renderFrame(){if(!frame.width||!state.source)return;drawOverlay($('overlay'),frame,state.result,state.connections,{mesh:$('mesh').checked,contours:$('contours').checked,iris:$('iris').checked,mirror:$('mirror').checked});const points=state.result?.faceLandmarks?.[0];for(const side of ['left','right'])drawEye($(side+'Eye'),frame,points,side);drawDepth($('mesh3d'),points,state.connections,video.currentTime*.4,frame.width,frame.height);}
async function analyzeFrame(time){if(state.inFlight||!state.ready||video.readyState<2)return;state.inFlight=true;const gen=state.generation;
  try{const maxSize=1280,scale=Math.min(1,maxSize/Math.max(video.videoWidth,video.videoHeight));frame.width=Math.round(video.videoWidth*scale);frame.height=Math.round(video.videoHeight*scale);frame.getContext('2d').drawImage(video,0,0,frame.width,frame.height);
    const bitmap=await createImageBitmap(frame);if(gen!==state.generation){bitmap.close();return;}const data=await infer(bitmap,time);if(gen===state.generation)processResult(data,time);
  }finally{state.inFlight=false;}}
async function loop(now){try{if(state.ready&&state.source&&!state.batch&&!state.inFlight&&!video.paused&&!video.seeking&&video.readyState>=2&&now-state.lastTick>=1000/+$('sampleRate').value&&video.currentTime!==state.lastCaptured){state.lastTick=now;state.lastCaptured=video.currentTime;await analyzeFrame(video.currentTime);}
    if(state.source?.type==='video'){$('time').textContent=`${clock(video.currentTime)} / ${clock(video.duration)}`;if(!state.scrubbing)$('seek').value=video.duration?video.currentTime/video.duration*100:0;$('play').textContent=video.paused?'▶ Play':'Ⅱ Pause';}
  }catch(error){video.pause();toast(error.message,true);}requestAnimationFrame(loop);}
async function seekTo(time){if(Math.abs(video.currentTime-time)<.0001&&video.readyState>=2)return;await new Promise((resolve,reject)=>{const timer=setTimeout(()=>done(new Error('Video seek timed out. Try another video encoding.')),10000);const seeked=()=>done();function done(e){clearTimeout(timer);video.removeEventListener('seeked',seeked);e?reject(e):resolve();}video.addEventListener('seeked',seeked,{once:true});video.currentTime=time;});}
async function waitIdle(){while(state.inFlight)await new Promise(r=>setTimeout(r,20));}
async function analyzeVideo(){if(state.batch){state.cancelBatch=true;return;}if(!confirmClear('Full-video analysis starts a new dataset. Continue?'))return;
  state.batch=true;state.cancelBatch=false;state.generation++;video.pause();$('progress').value=0;$('progressText').textContent='Starting scan…';updateButtons();await waitIdle();clearData({keepCalibration:true});$('batchProgress').hidden=false;
  const rate=+$('sampleRate').value,total=Math.ceil(video.duration*rate),limit=$('rawLandmarks').checked?1200:18000;let completed=0;
  try{if(total>limit)throw new Error(`This scan needs ${total} samples; the limit is ${limit}. Lower the sample rate${$('rawLandmarks').checked?' or disable landmark export':''}, or use a shorter clip.`);
    for(let i=0;i<total&&!state.cancelBatch;i++){const t=i/rate;await seekTo(t);await analyzeFrame(t);completed++;$('progress').value=100*completed/total;$('progressText').textContent=`${completed} / ${total} samples`;if(i%4===0)await new Promise(r=>setTimeout(r,0));}
    toast(state.cancelBatch?`Analysis canceled. ${completed} samples retained.`:`Analysis complete: ${completed} sampled frames.`);
  }catch(error){toast(error.message,true);}finally{state.batch=false;state.lastCaptured=video.currentTime;updateButtons();}}
function sessionPayload(){return {schema_version:1,name:$('sessionName').value.trim()||'FaceScope analysis',created_at:new Date().toISOString(),engine:{name:'MediaPipe Face Landmarker',version:'0.10.32',delegate:'CPU',num_faces:1},source:state.lastSource,settings:settings(),calibration:state.calibration,samples:state.samples,events:state.events,summary:summarize(state.samples,state.events)};}
async function api(path,options={}){const response=await fetch('/api'+path,{...options,headers:{'Content-Type':'application/json','X-FaceScope':'1',...options.headers}});const data=await response.json();if(!response.ok)throw new Error(data.error||'Request failed.');return data;}
function switchView(name){document.querySelectorAll('.view').forEach(el=>el.hidden=el.id!==name);document.querySelectorAll('.nav').forEach(el=>el.classList.toggle('active',el.dataset.view===name));if(name==='sessions')loadSessions();}
async function loadSessions(){try{const {sessions}=await api('/sessions');$('sessionList').replaceChildren();if(!sessions.length){const p=document.createElement('p');p.className='muted';p.textContent='No sessions saved yet. Analyze a video or camera stream, then choose Save session.';$('sessionList').append(p);}
  for(const session of sessions){const card=document.createElement('article');card.className='panel session-card';const title=document.createElement('h2');title.textContent=session.name;const description=document.createElement('p');description.textContent=`${new Date(session.created_at).toLocaleString()} · ${session.sample_count} samples · ${session.summary.tracking_percent}% tracked`;card.append(title,description);
    for(const [label,action] of [['Review',async()=>reviewSession(await api('/sessions/'+session.id))],['JSON ↓',async()=>exportSession(await api('/sessions/'+session.id),'json')],['Delete',async()=>{if(!window.confirm('Delete this saved session permanently?'))return;await api('/sessions/'+session.id,{method:'DELETE'});$('sessionDetail').hidden=true;loadSessions();}]]){const b=document.createElement('button');b.textContent=label;if(label==='Delete')b.className='delete';b.onclick=()=>action().catch(e=>toast(e.message,true));card.append(b);}$('sessionList').append(card);}
  }catch(error){toast(error.message,true);}}
function reviewSession(session){const container=$('sessionDetail');container.hidden=false;container.replaceChildren();const title=document.createElement('h2');title.textContent=session.name;container.append(title);const summary=summarize(session.samples,session.events),p=document.createElement('p');p.className='muted';p.textContent=`${summary.duration.toFixed(1)} s · ${summary.blinks} blink events · ${summary.tracking_percent.toFixed(1)}% tracking coverage`;container.append(p);
  const table=document.createElement('table'),header=table.insertRow();for(const value of ['Metric','Mean','Minimum','Maximum']){const th=document.createElement('th');th.textContent=value;header.append(th);}for(const key of METRIC_KEYS){const row=table.insertRow();for(const value of [key,fmt(summary[key]?.mean),fmt(summary[key]?.min),fmt(summary[key]?.max)])row.insertCell().textContent=value;}container.append(table);
  const chart=document.createElement('canvas');chart.width=1000;chart.height=190;chart.style.width='100%';const legend=document.createElement('div');legend.className='legend';container.append(chart,legend);drawChart(chart,session.samples,'eyes',legend);
  for(const format of ['csv','json','report']){const b=document.createElement('button');b.textContent='Download '+format.toUpperCase();b.onclick=()=>exportSession(session,format);container.append(b);}container.scrollIntoView({behavior:'smooth',block:'start'});}

$('camera').onclick=startCamera;$('fileInput').onchange=()=>{openFile($('fileInput').files[0]);$('fileInput').value='';};$('stop').onclick=stopSource;
$('play').onclick=async()=>{try{if(video.paused){if(video.ended){if(!confirmClear('Replay starts a new dataset. Continue?'))return;clearData({keepCalibration:true});video.currentTime=0;}await video.play();}else video.pause();}catch(e){toast(e.message,true);}};
$('seek').oninput=()=>state.scrubbing=true;
$('seek').onchange=async()=>{if(state.batch)return;const target=+$('seek').value/100*video.duration;state.generation++;video.pause();await waitIdle();clearData({keepCalibration:true});try{await seekTo(target);await analyzeFrame(target);toast('Moved to selected frame. A new dataset has started.');}catch(e){toast(e.message,true);}finally{state.scrubbing=false;}};
$('speed').onchange=()=>video.playbackRate=+$('speed').value;
for(const id of ['mesh','contours','iris','mirror'])$(id).onchange=renderFrame;
$('chartMode').onchange=()=>drawChart($('timeline'),state.samples,$('chartMode').value,$('chartLegend'));
$('blendSearch').oninput=()=>drawBlends($('blends'),state.shapes,$('blendSearch').value);
$('calibrate').onclick=()=>{state.calibrating=[];$('calibrate').textContent='Hold still 0/30';toast('Face forward with eyes open for 30 tracked samples. Play the video if it is paused.');};
$('blinkThreshold').onchange=()=>{const value=+$('blinkThreshold').value;if(!Number.isFinite(value)||value<.08||value>.35){$('blinkThreshold').value=blink.close;toast('Use a threshold between 0.08 and 0.35.',true);return;}clearData({keepCalibration:true});blink.close=value;blink.open=value+.04;toast('Blink threshold changed. New dataset started.');};
for(const id of ['sampleRate','rawLandmarks'])$(id).onchange=()=>{clearData({keepCalibration:true});toast('Analysis settings changed. New dataset started.');};
$('reset').onclick=()=>{if(confirmClear('Clear the current measurements? Saved sessions will remain.')){state.generation++;clearData();toast('Current data cleared.');}};
$('batch').onclick=analyzeVideo;
for(const format of ['csv','json','report'])$(format).onclick=()=>exportSession(sessionPayload(),format);
$('snapshot').onclick=()=>{$('overlay').toBlob(blob=>{if(blob)download(blob,'facescope-snapshot.png','image/png');});};
$('save').onclick=()=>$('saveDialog').showModal();$('cancelSave').onclick=()=>$('saveDialog').close();
$('saveForm').onsubmit=async e=>{e.preventDefault();const b=e.submitter;b.disabled=true;try{await api('/sessions',{method:'POST',body:JSON.stringify(sessionPayload())});$('saveDialog').close();toast('Session saved. Find it under Saved sessions.');}catch(error){toast(error.message,true);}finally{b.disabled=false;}};
document.querySelectorAll('[data-view]').forEach(el=>el.onclick=()=>switchView(el.dataset.view));$('refresh').onclick=loadSessions;
window.addEventListener('beforeunload',()=>{state.stream?.getTracks().forEach(t=>t.stop());worker?.terminate();});
clearData();drawDepth($('mesh3d'),null,{});updateButtons();
try{await initWorker();state.ready=true;$('modelStatus').textContent='● Vision engine ready';$('modelStatus').classList.add('ready');updateButtons();requestAnimationFrame(loop);}catch(error){$('modelStatus').textContent='Engine unavailable';toast(error.message,true);worker?.terminate();}
