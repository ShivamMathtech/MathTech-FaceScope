/** Pure measurement functions. Image coordinates are always unmirrored. */
export const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
export const EYES = {right: [33, 160, 158, 133, 153, 144], left: [362, 385, 387, 263, 373, 380]};
export const METRIC_KEYS = ['eye_left', 'eye_right', 'mouth', 'yaw', 'pitch', 'roll', 'iris_x', 'iris_y'];
const pixel = (p, w, h) => ({x: p.x * w, y: p.y * h});
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export function eyeAspectRatio(points, ids, width, height) {
  const p = ids.map(i => pixel(points[i], width, height));
  const horizontal = distance(p[0], p[3]);
  return horizontal > 1e-6 ? (distance(p[1], p[5]) + distance(p[2], p[4])) / (2 * horizontal) : null;
}

export function irisPosition(points, side, width, height) {
  const ids = EYES[side];
  let a = pixel(points[ids[0]], width, height), b = pixel(points[ids[3]], width, height);
  if (a.x > b.x) [a, b] = [b, a];
  const iris = pixel(points[side === 'right' ? 468 : 473], width, height);
  const vx = b.x-a.x, vy=b.y-a.y, len2=vx*vx+vy*vy;
  if (len2 < 1e-6) return null;
  const dx=iris.x-a.x, dy=iris.y-a.y;
  // Horizontal position between eye corners, and vertical offset in eye-width units.
  return {x: (dx*vx+dy*vy)/len2, y: (dy*vx-dx*vy)/len2};
}

export function matrixEuler(matrix) {
  const m = matrix?.data;
  if (!m || m.length !== 16) return {yaw: null, pitch: null, roll: null};
  // MediaPipe JS returns column-major data. Remove uniform scale from the 3x3.
  const scale = Math.hypot(m[0], m[1], m[2]);
  if (scale < 1e-8) return {yaw: null, pitch: null, roll: null};
  const r00=m[0]/scale, r10=m[1]/scale, r20=m[2]/scale;
  const r21=m[6]/scale, r22=m[10]/scale;
  // R = Rz(roll) Ry(yaw) Rx(pitch), right-handed canonical model coordinates.
  const yaw=Math.asin(clamp(-r20,-1,1));
  const gimbal=Math.abs(Math.cos(yaw)) < 1e-5;
  return {yaw: yaw*180/Math.PI,
    pitch: (gimbal ? Math.atan2(-m[9],m[5]) : Math.atan2(r21,r22))*180/Math.PI,
    roll: (gimbal ? 0 : Math.atan2(r10,r00))*180/Math.PI};
}

export function measure(result, width, height) {
  const points=result.faceLandmarks?.[0];
  if (!points || points.length < 478) return null;
  const left=irisPosition(points,'left',width,height), right=irisPosition(points,'right',width,height);
  const mouthWidth=distance(pixel(points[61],width,height),pixel(points[291],width,height));
  return {
    eye_left: eyeAspectRatio(points,EYES.left,width,height),
    eye_right: eyeAspectRatio(points,EYES.right,width,height),
    mouth: mouthWidth > 1e-6 ? distance(pixel(points[13],width,height),pixel(points[14],width,height))/mouthWidth : null,
    ...matrixEuler(result.facialTransformationMatrixes?.[0]),
    iris_x: left && right ? (left.x+right.x)/2 : null,
    iris_y: left && right ? (left.y+right.y)/2 : null,
  };
}

export class BlinkCounter {
  constructor(close=0.20, open=0.24) { this.close=close; this.open=open; this.reset(); }
  reset() { this.closedAt=null; this.count=0; this.longClosures=0; this.lastTime=null; this.lastValid=false; this.trackedSeconds=0; }
  update(time, left, right) {
    const valid=Number.isFinite(left)&&Number.isFinite(right);
    const delta=this.lastTime===null ? 0 : time-this.lastTime;
    if (!valid || delta<0 || delta>0.5) this.closedAt=null;
    if (valid && this.lastValid && delta>0 && delta<=0.5) this.trackedSeconds+=delta;
    this.lastValid=valid; this.lastTime=time;
    if (!valid) return null;
    if (left<this.close && right<this.close && this.closedAt===null) this.closedAt=time;
    if ((left>this.open || right>this.open) && this.closedAt!==null) {
      const duration=time-this.closedAt; this.closedAt=null;
      if (duration>=0.05 && duration<=0.8) { this.count++; return {type:'blink',time,duration}; }
      if (duration>0.8) { this.longClosures++; return {type:'extended_closure',time,duration}; }
    }
    return null;
  }
  get rate() { return this.trackedSeconds>=5 ? this.count*60/this.trackedSeconds : null; }
}

export class Smoother {
  constructor() { this.reset(); }
  reset() { this.values={}; this.lastTime=null; }
  update(raw, time, tau=0.08) {
    const dt=this.lastTime===null ? 10 : time-this.lastTime;
    const alpha=tau<=0 || dt<=0 || dt>0.5 ? 1 : 1-Math.exp(-dt/tau);
    this.lastTime=time;
    for (const k of METRIC_KEYS) {
      const value=raw[k];
      this.values[k]=Number.isFinite(value) ? (Number.isFinite(this.values[k]) ? this.values[k]+alpha*(value-this.values[k]) : value) : null;
    }
    return {...this.values};
  }
}

export function summarize(samples, events=[]) {
  const valid=samples.filter(s=>s.detected), count=samples.length;
  const summary={samples:count, detected:valid.length, tracking_percent:count ? valid.length/count*100 : 0,
    duration:count>1 ? samples.at(-1).time-samples[0].time : 0,
    blinks:events.filter(e=>e.type==='blink').length};
  for (const k of METRIC_KEYS) {
    const values=valid.map(s=>s[k]).filter(Number.isFinite);
    summary[k]=values.length ? {mean:values.reduce((a,b)=>a+b,0)/values.length,
      min:values.reduce((a,b)=>Math.min(a,b),Infinity),max:values.reduce((a,b)=>Math.max(a,b),-Infinity)} : null;
  }
  return summary;
}

export function toCSV(samples) {
  const blendKeys=[...new Set(samples.flatMap(s=>Object.keys(s.blendshapes||{})))].sort();
  const keys=['time','detected',...METRIC_KEYS,'blink_count','blinks_per_min','inference_ms',...blendKeys.map(k=>'blend_'+k)];
  const quote=v => v==null ? '' : '"'+String(v).replaceAll('"','""')+'"';
  return [keys.join(','),...samples.map(s=>keys.map(k=>quote(k.startsWith('blend_')?s.blendshapes?.[k.slice(6)]:s[k])).join(','))].join('\r\n');
}
