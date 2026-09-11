// v3.164 E2E — ①아티스트 상세: 이름·나이·성별 병기 ②생성 질문에 나이 질문·연령 칩
// ③체형 질문에 골격 타입(스트레이트/웨이브/내추럴) 칩. 생성은 시작하지 않음(무과금).
const { chromium } = require('/Users/pearl/TripleJ/2_housing/node_modules/playwright');
const fs = require('fs');
const SCRATCH='/Users/pearl/TripleJ/2_housing/scratchpad';
const LOG=SCRATCH+'/v3164e.log';
function log(...a){const l=`[${new Date().toISOString()}] `+a.map(x=>typeof x==='string'?x:JSON.stringify(x)).join(' ');fs.appendFileSync(LOG,l+'\n');console.log(l);}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  fs.writeFileSync(LOG,'');
  const browser=await chromium.launch({headless:true});
  const page=await (await browser.newContext({viewport:{width:480,height:920}})).newPage();
  const R={};
  const visible=async(t,to=3000,e=true)=>{try{await page.getByText(t,{exact:e}).last().waitFor({state:'visible',timeout:to});return true;}catch{return false;}};
  const clickT=async(t,o={})=>{const l=page.getByText(t,{exact:o.exact!==false}).last();await l.waitFor({state:'visible',timeout:o.timeout||15000});await l.click();log('clicked:',t);};
  const clickXY=async(t)=>{const bb=await page.getByText(t,{exact:true}).last().boundingBox();if(!bb)throw new Error('no bb: '+t);await page.mouse.click(bb.x+bb.width/2,bb.y+bb.height/2);log('clicked(xy):',t);};
  const closePopups=async()=>{for(const t of ['✕','닫기','나중에']){try{if(await visible(t,700)){await page.getByText(t,{exact:true}).last().click();await sleep(500);}}catch{}}};

  await page.goto('http://localhost:8081',{timeout:120000});
  await page.getByText('차트',{exact:true}).first().waitFor({timeout:180000});
  await sleep(3000);await closePopups();await closePopups();
  await clickT('작업실');await sleep(2000);
  if(!(await visible('로그인하고 시작하기',2000))){await page.mouse.click(240,460);await sleep(1200);}
  await clickT('로그인하고 시작하기');await sleep(1800);
  await page.getByPlaceholder('이메일을 입력하세요').fill('teamdev_v228bg_qepfra@test.local');
  await page.getByPlaceholder('비밀번호를 입력하세요').fill('Teamdev1234!');
  await page.getByText('로그인',{exact:true}).last().click();await sleep(4000);await closePopups();

  // ── L1: 아티스트 상세 — "리얼검증 · 23세 · 여성" ──
  await clickT('작업실');await sleep(2500);await closePopups();
  await clickT('아티스트 디렉터');await sleep(2500);
  await page.getByText('리얼검증',{exact:false}).last().locator('xpath=ancestor::div[@tabindex="0"][1]').click();
  await sleep(3000);
  const triple=await visible('리얼검증 · 23세 · 여성',5000,false);
  R.L1=triple;
  await page.screenshot({path:SCRATCH+'/v3164e_detail.png'});
  log('L1 이름·나이·성별:',R.L1);

  // ── L2/L3: 재생성 진입 → 사진 없이 → 질문 순회(나이 질문·골격 칩) — 생성 시작 안 함 ──
  await clickT('다시 만들기');await sleep(1800);
  for(const t of ['확인','다시 만들기','계속','시작하기']){try{if(await visible(t,1200)){await page.getByText(t,{exact:true}).last().click();await sleep(1200);}}catch{}}
  try{if(await visible('실사로 만들기',2500,true)){await clickT('실사로 만들기');await sleep(1500);}}catch{}
  {
    const bb=await page.getByText('사진 없이 만들기',{exact:true}).last().boundingBox();
    await page.mouse.click(bb.x+bb.width/2, bb.y+bb.height/2);
    log('clicked(xy): 사진 없이 만들기');
  }
  await sleep(2500);
  await page.screenshot({path:SCRATCH+'/v3164e_afterphoto.png'});
  // 성별(1/9)·이름(2/9) 건너뛰기 → 나이(3/9)
  await clickXY('건너뛰기');await sleep(1300);
  await clickXY('건너뛰기');await sleep(1300);
  const ageQ=await visible('나이는 몇 살로',4000,false);
  const ageChip=await visible('20대 초반',3000,true);
  R.L2=ageQ&&ageChip;
  await page.screenshot({path:SCRATCH+'/v3164e_ageq.png'});
  log('L2 나이 질문·칩:',R.L2,{ageQ,ageChip});
  // 나이→머리→얼굴→피부 건너뛰기 → 체형(7/9)
  for(let i=0;i<4;i++){await clickXY('건너뛰기');await sleep(1200);}
  const bodyQ=await visible('골격 타입',4000,false);
  const c1=await visible('스트레이트',2500,true), c2=await visible('웨이브',2000,true), c3=await visible('내추럴',2000,true);
  R.L3=bodyQ&&c1&&c2&&c3;
  await page.screenshot({path:SCRATCH+'/v3164e_bodyq.png'});
  log('L3 체형 골격 칩:',R.L3,{bodyQ,c1,c2,c3});
  // 생성 미진행 — 작업실 탭으로 이탈
  await clickT('차트');await sleep(1000);

  log('RESULTS:',Object.fromEntries(Object.entries(R).map(([k,v])=>[k,v?'PASS':'FAIL'])));
  await browser.close();
})().catch(e=>{log('SCRIPT ERROR:',String(e&&e.stack||e).slice(0,500));process.exit(1);});
