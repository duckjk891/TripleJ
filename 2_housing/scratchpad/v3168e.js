// v3.168 E2E — 이미지 디렉터: 구도·색감 단계 직접 입력창 노출 및 자유 입력 진행(생성 미시작·무과금)
const { chromium } = require('/Users/pearl/TripleJ/2_housing/node_modules/playwright');
const fs=require('fs');
const SCRATCH='/Users/pearl/TripleJ/2_housing/scratchpad';
const log=(...a)=>{const l=a.map(x=>typeof x==='string'?x:JSON.stringify(x)).join(' ');fs.appendFileSync(SCRATCH+'/v3168e.log',l+'\n');console.log(l);};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  fs.writeFileSync(SCRATCH+'/v3168e.log','');
  const browser=await chromium.launch({headless:true});
  const page=await (await browser.newContext({viewport:{width:480,height:920}})).newPage();
  const visible=async(t,to=3000,e=true)=>{try{await page.getByText(t,{exact:e}).last().waitFor({state:'visible',timeout:to});return true;}catch{return false;}};
  const clickT=async(t,o={})=>{const l=page.getByText(t,{exact:o.exact!==false}).last();await l.waitFor({state:'visible',timeout:o.timeout||15000});await l.click();log('clicked:',t);};
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
  await clickT('작업실');await sleep(2500);await closePopups();
  await clickT('이미지 디렉터');await sleep(2500);
  {const bb=await page.getByText('커버검증곡',{exact:false}).last().boundingBox();await page.mouse.click(bb.x+bb.width/2,bb.y+bb.height/2);log('clicked(row): 커버검증곡');}
  await sleep(2500);
  await clickT('네, 아티스트 포함');await sleep(2500);
  await clickT('이 의상 그대로 갈게요');await sleep(2000);
  await clickT('아니요, 직접 정할게요 (구도·배경·색감)');await sleep(2000);
  // 구도 — 직접 입력창
  const shotInput=await page.getByPlaceholder('직접 입력 (예: 로우앵글에서 올려다본 전신 샷)').isVisible().catch(()=>false);
  await page.screenshot({path:SCRATCH+'/v3168e_shot.png'});
  await page.getByPlaceholder('직접 입력 (예: 로우앵글에서 올려다본 전신 샷)').fill('아주 낮은 로우앵글 테스트');
  await clickT('확인');await sleep(2000);
  // 배경 — 건너뛰기
  await clickT('건너뛰기');await sleep(2000);
  // 색감 — 직접 입력창
  const palInput=await page.getByPlaceholder('직접 입력 (예: 파스텔 톤, 빛바랜 필름 느낌)').isVisible().catch(()=>false);
  await page.screenshot({path:SCRATCH+'/v3168e_palette.png'});
  await page.getByPlaceholder('직접 입력 (예: 파스텔 톤, 빛바랜 필름 느낌)').fill('몽환적인 퍼플 그라데이션');
  await clickT('확인');await sleep(2000);
  const finalStep=await visible('이대로 만들기',5000,false);
  const echoShot=await visible('아주 낮은 로우앵글 테스트',3000,false); // 내 답변 말풍선
  const echoPal=await visible('몽환적인 퍼플 그라데이션',3000,false);
  await page.screenshot({path:SCRATCH+'/v3168e_final.png'});
  const pass=shotInput&&palInput&&finalStep&&echoShot&&echoPal;
  log('RESULTS:',{pass:pass?'PASS':'FAIL',shotInput,palInput,finalStep,echoShot,echoPal});
  await browser.close();
})().catch(e=>{log('ERR',String(e).slice(0,400));process.exit(1);});
