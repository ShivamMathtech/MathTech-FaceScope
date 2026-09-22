/* Classic worker: MediaPipe's WASM loader uses importScripts. */
let landmarker;
self.onmessage = async ({data}) => {
  try {
    if (data.type === 'init') {
      const {FaceLandmarker, FilesetResolver} = await import('./vendor/vision_bundle.mjs');
      const vision = await FilesetResolver.forVisionTasks(new URL('./vendor/wasm',self.location).href);
      landmarker = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: {modelAssetPath: new URL('./models/face_landmarker.task',self.location).href, delegate:'CPU'},
        runningMode:'VIDEO', numFaces:1, outputFaceBlendshapes:true,
        outputFacialTransformationMatrixes:true,
        minFaceDetectionConfidence:0.5, minFacePresenceConfidence:0.5, minTrackingConfidence:0.5,
      });
      self.postMessage({type:'ready', connections:{mesh:FaceLandmarker.FACE_LANDMARKS_TESSELATION,
        contours:FaceLandmarker.FACE_LANDMARKS_CONTOURS,
        irises:[...FaceLandmarker.FACE_LANDMARKS_LEFT_IRIS,...FaceLandmarker.FACE_LANDMARKS_RIGHT_IRIS]}});
    } else if (data.type==='frame') {
      const start=performance.now();
      try {
        const result=landmarker.detectForVideo(data.bitmap,data.timestamp);
        self.postMessage({type:'result',id:data.id,result,inferenceMs:performance.now()-start});
      } finally { data.bitmap.close(); }
    }
  } catch(error) { self.postMessage({type:'error',id:data.id,message:error.message||String(error)}); }
};
