import test from 'node:test';
import assert from 'node:assert/strict';
import {eyeAspectRatio,EYES,matrixEuler,irisPosition,BlinkCounter,Smoother,measure,summarize,toCSV} from '../web/metrics.js';
import {reportHTML} from '../web/export.js';

const approx=(a,b,epsilon=1e-6)=>assert.ok(Math.abs(a-b)<epsilon,`${a} != ${b}`);
function eyeFixture(width,height){const points=Array.from({length:478},()=>({x:.5,y:.5,z:0}));const coords=[[100,100],[120,90],[140,90],[160,100],[140,110],[120,110]];EYES.right.forEach((id,i)=>{points[id]={x:coords[i][0]/width,y:coords[i][1]/height,z:0};});points[468]={x:130/width,y:100/height,z:0};return points;}
test('EAR is invariant to frame aspect ratio and uses pixel-space distances',()=>{for(const [w,h] of [[200,200],[1920,1080],[720,960]])approx(eyeAspectRatio(eyeFixture(w,h),EYES.right,w,h),1/3);});
test('iris centered between eye corners has x=.5 and y=0',()=>{const p=irisPosition(eyeFixture(720,960),'right',720,960);approx(p.x,.5);approx(p.y,0);});
test('degenerate eye width returns null',()=>{const p=eyeFixture(200,200);p[133]=p[33];assert.equal(eyeAspectRatio(p,EYES.right,200,200),null);});
test('identity transformation has zero pose',()=>{assert.deepEqual(matrixEuler({data:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]}),{yaw:-0,pitch:0,roll:0});});
test('known column-major yaw with uniform scale produces expected angle',()=>{const a=Math.PI/6,c=Math.cos(a)*2,s=Math.sin(a)*2;const pose=matrixEuler({data:[c,0,-s,0,0,2,0,0,s,0,c,0,10,20,-50,1]});approx(pose.yaw,30);approx(pose.pitch,0);approx(pose.roll,0);});
test('known pitch and roll matrices produce positive right-handed angles',()=>{const a=Math.PI/4,c=Math.cos(a),s=Math.sin(a);approx(matrixEuler({data:[1,0,0,0,0,c,s,0,0,-s,c,0,0,0,0,1]}).pitch,45);approx(matrixEuler({data:[c,s,0,0,-s,c,0,0,0,0,1,0,0,0,0,1]}).roll,45);});
test('missing face is not represented by fabricated zero measurements',()=>{assert.equal(measure({faceLandmarks:[]},640,480),null);});
test('blink hysteresis counts exactly once on reopening',()=>{const b=new BlinkCounter();b.update(0,.3,.3);b.update(.1,.15,.15);b.update(.2,.21,.21);const e=b.update(.3,.3,.3);assert.equal(e.type,'blink');assert.equal(b.count,1);b.update(.4,.3,.3);assert.equal(b.count,1);});
test('unilateral closing is not a bilateral blink',()=>{const b=new BlinkCounter();b.update(0,.3,.3);b.update(.1,.1,.3);b.update(.2,.3,.3);assert.equal(b.count,0);});
test('tracking loss invalidates unfinished blink',()=>{const b=new BlinkCounter();b.update(0,.1,.1);b.update(.1,undefined,undefined);b.update(.2,.3,.3);assert.equal(b.count,0);});
test('long gaps and backward timestamps invalidate unfinished blink',()=>{for(const t of [2,-.1]){const b=new BlinkCounter();b.update(0,.1,.1);b.update(t,.3,.3);assert.equal(b.count,0);}});
test('long eye closure is a separate event',()=>{const b=new BlinkCounter();b.update(0,.1,.1);for(let t=.1;t<1;t+=.1)b.update(t,.1,.1);const e=b.update(1.1,.3,.3);assert.equal(e.type,'extended_closure');assert.equal(b.count,0);});
test('blink rate excludes no-face spans and requires five seconds',()=>{const b=new BlinkCounter();for(let i=0;i<=50;i++)b.update(i/10,.3,.3);approx(b.trackedSeconds,5);for(let i=51;i<=100;i++)b.update(i/10,null,null);approx(b.trackedSeconds,5);assert.equal(b.rate,0);});
test('smoothing resets across discontinuities',()=>{const s=new Smoother();s.update({eye_left:.3},0);s.update({eye_left:.1},.1);approx(s.update({eye_left:.9},2).eye_left,.9);});
test('summary excludes no-face rows from metric means',()=>{const s=summarize([{time:0,detected:true,eye_left:.3},{time:1,detected:false,eye_left:null}]);approx(s.eye_left.mean,.3);approx(s.tracking_percent,50);});
test('CSV exports actual values and empty missing measurements',()=>{const csv=toCSV([{time:0,detected:false,eye_left:null,blendshapes:{}},{time:1,detected:true,eye_left:.25,blendshapes:{jawOpen:.4}}]);assert.match(csv,/blend_jawOpen/);assert.match(csv,/"0.25"/);assert.ok(!csv.includes('undefined'));});
test('report escapes filenames and custom session names',()=>{const html=reportHTML({name:'<script>alert(1)</script>',source:{name:'<img onerror="x">'},samples:[],events:[]});assert.ok(!html.includes('<script>'));assert.match(html,/&lt;script&gt;/);});
