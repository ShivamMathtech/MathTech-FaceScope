/** Optional integration test: node tests/browser_e2e.cjs /absolute/path/to/video.mp4
 * Install Playwright separately; set BROWSER_PATH for an existing Chromium binary.
 * Uses a temporary database and never stores the input video in the application.
 */
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const {spawn}=require('node:child_process');
const {mkdtemp,readFile,writeFile,mkdir,rm}=require('node:fs/promises');
const os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const video=process.argv[2];
if(!video)throw new Error('Pass a video path as the first argument.');
const root=path.resolve(__dirname,'..'),output=process.env.TEST_OUTPUT||path.join(os.tmpdir(),'facescope-test-output');
(async()=>{const temp=await mkdtemp(path.join(os.tmpdir(),'facescope-e2e-'));await mkdir(output,{recursive:true});
  const server=spawn(process.env.PYTHON||'python',['run.py','--port','0','--no-browser','--data-dir',temp],{cwd:root,stdio:['ignore','pipe','pipe']});
  const url=await new Promise((resolve,reject)=>{let buffer='';server.stdout.on('data',d=>{buffer+=d;const match=buffer.match(/http:\/\/127\.0\.0\.1:\d+/);if(match)resolve(match[0]);});server.on('exit',c=>reject(new Error('Server exited '+c)));});
  let browser;const errors=[],externalRequests=[];
  try{browser=await chromium.launch({headless:true,...(process.env.BROWSER_PATH?{executablePath:process.env.BROWSER_PATH}:{}),args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
    const page=await browser.newPage({viewport:{width:1440,height:1050}});page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url())&&!r.url().startsWith(url))externalRequests.push(r.url());});page.on('dialog',d=>d.accept());
    await page.goto(url);await page.waitForFunction(()=>document.querySelector('#modelStatus').textContent.includes('ready'),null,{timeout:60000});console.log('Engine ready.');
    await page.locator('#fileInput').setInputFiles(video);await page.waitForFunction(()=>document.querySelector('#trackingStatus').textContent==='FACE TRACKED',null,{timeout:30000});
    assert.notEqual(await page.locator('#eyeLeft').textContent(),'—');console.log('Video decoded; face tracked.');
    await page.locator('#play').click();await page.screenshot({path:path.join(output,'analysis-desktop.png'),fullPage:true});
    await page.locator('#calibrate').click();await page.locator('#play').click();await page.waitForFunction(()=>document.querySelector('#neutralStatus').textContent.includes('active'),null,{timeout:30000});console.log('Neutral calibration passed.');
    await page.locator('#batch').click();await page.waitForFunction(()=>document.querySelector('#batch').textContent==='Analyze full video'&&+document.querySelector('#progress').value===100,null,{timeout:240000});
    console.log('Full-video analysis:',await page.locator('#sampleInfo').textContent());
    let downloadPromise=page.waitForEvent('download');await page.locator('#json').click();let dl=await downloadPromise;const jsonPath=path.join(output,'reference-analysis.json');await dl.saveAs(jsonPath);const session=JSON.parse(await readFile(jsonPath,'utf8'));
    assert.ok(session.samples.length>100);assert.ok(session.samples.filter(s=>s.detected).length>50);assert.equal(Object.keys(session.samples.find(s=>s.detected).blendshapes).length,52);
    assert.ok(session.samples.every((s,i,a)=>i===0||s.time>a[i-1].time));assert.ok(session.samples.some(s=>Math.abs(s.yaw)>3));
    for(const id of ['csv','report','snapshot']){downloadPromise=page.waitForEvent('download');await page.locator('#'+id).click();dl=await downloadPromise;await dl.saveAs(path.join(output,dl.suggestedFilename()));}
    await page.locator('#save').click();await page.locator('#sessionName').fill('Reference video integration test');await page.locator('#saveForm button[type=submit]').click();await page.waitForFunction(()=>!document.querySelector('#saveDialog').open);
    await page.locator('[data-view=sessions]').click();await page.locator('.session-card button').filter({hasText:'Review'}).click();await page.waitForSelector('#sessionDetail:not([hidden])');assert.ok((await page.locator('#sessionDetail').textContent()).includes('tracking coverage'));console.log('Save, review, and exports passed.');
    await page.reload();await page.waitForFunction(()=>document.querySelector('#modelStatus').textContent.includes('ready'),null,{timeout:60000});await page.locator('[data-view=sessions]').click();await page.waitForSelector('.session-card');assert.equal(await page.locator('.session-card').count(),1);
    await page.locator('.delete').click();await page.waitForFunction(()=>document.querySelectorAll('.session-card').length===0);
    await page.locator('[data-view=workspace]').click();await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(output,'analysis-mobile.png'),fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
    assert.deepEqual(errors,[]);assert.deepEqual(externalRequests,[]);
    const results={passed:true,engine:'Chromium',tests:['engine initialization','video decode','face detection','neutral calibration','full-video scan','strict timestamp ordering','52 blendshape channels','JSON/CSV/report/snapshot export','session save/review/reload/delete','mobile width 390 px','no external requests'],sample_count:session.samples.length,summary:session.summary,page_errors:errors,external_requests:externalRequests};
    await writeFile(path.join(output,'browser-results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
  }finally{await browser?.close();server.kill();await rm(temp,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
