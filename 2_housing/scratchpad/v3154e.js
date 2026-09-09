// v3.154 E2E — 얼굴 인증 이식: 실사+사진 생성 → 403(route mock) → FaceVerify 화면 진입.
// generate-sheet-async는 라우트 목으로 403 face_verification_required 반환(서버 미호출·무과금).
// FaceVerify의 GET /face-verify/status는 실서버 — 테스트 계정 is_verified=false → need_identity 안내 검증.
const { chromium } = require('/Users/pearl/TripleJ/2_housing/node_modules/playwright');
const fs = require('fs');
const SCRATCH = '/Users/pearl/TripleJ/2_housing/scratchpad';
const LOG = SCRATCH + '/v3154e.log';
function log(...a){const l=`[${new Date().toISOString()}] `+a.map(x=>typeof x==='string'?x:JSON.stringify(x)).join(' ');fs.appendFileSync(LOG,l+'\n');console.log(l);}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  fs.writeFileSync(LOG,'');
  const browser=await chromium.launch({headless:true});
  const page=await (await browser.newContext({viewport:{width:480,height:920}})).newPage();
  await page.route('**/api/character/generate-sheet-async',(route)=>{
    log('[route] generate-sheet-async → 403 face_verification_required (mock)');
    return route.fulfill({status:403,contentType:'application/json',body:JSON.stringify({error:'face_verification_required',message:'얼굴 인증이 필요합니다.'})});
  });
  page.on('console',m=>{const t=m.text();if(/FaceVerify|ArtistLoading|ArtistInput/.test(t))log('[console]',t.slice(0,140));});
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
  await page.getByText('로그인',{exact:true}).last().click();await sleep(4000);
  await closePopups();
  await clickT('작업실');await sleep(2500);await closePopups();
  await clickT('아티스트 디렉터');await sleep(2500);
  // 슬롯 가득 → 재생성 경로(리얼검증 카드 → 다시 만들기, 슬롯 미소모)
  await page.getByText('간편 목소리 · 여성 소프트',{exact:false}).last().locator('xpath=ancestor::div[@tabindex="0"][1]').click();
  log('clicked: 리얼검증 카드');await sleep(3000);
  await clickT('다시 만들기');await sleep(1800);
  for(const t of ['확인','다시 만들기','계속','시작하기']){try{if(await visible(t,1200)){await page.getByText(t,{exact:true}).last().click();await sleep(1200);}}catch{}}
  await page.screenshot({path:SCRATCH+'/v3154e_enter.png'});
  // forceKind(재생성)면 카드 없이 사진 단계 — 있으면 실사 카드 선택
  try{if(await visible('실사로 만들기',2500,true)){await clickT('실사로 만들기');await sleep(1500);}}catch{}
  // 사진 올리기 — filechooser로 PNG 주입
  const [chooser]=await Promise.all([
    page.waitForEvent('filechooser',{timeout:10000}),
    page.getByText('사진 올리기',{exact:true}).last().click(),
  ]);
  await chooser.setFiles('/tmp/bgtest.png');
  log('사진 주입 완료');await sleep(1200);
  await clickT('확인했어요');await sleep(1500);
  // 질문 단계 — 전부 건너뛰기 (최대 12회)
  for(let i=0;i<12;i++){
    if(!(await visible('건너뛰기',2500,true)))break;
    await page.getByText('건너뛰기',{exact:true}).last().click();
    log('질문 건너뛰기',i+1);await sleep(1200);
  }
  await sleep(1500);
  const codyShown=await visible('이 옷으로 만들기',6000,false);
  await page.screenshot({path:SCRATCH+'/v3154e_cody.png'});
  log('Cody 도달:',codyShown);
  await page.getByText('이 옷으로 만들기',{exact:false}).last().click();log('clicked: 이 옷으로 만들기');await sleep(1500);
  for(const t of ['확인','만들기','시작']){try{if(await visible(t,1200)){await page.getByText(t,{exact:true}).last().click();await sleep(1000);}}catch{}}
  await sleep(3500);
  // FaceVerify 진입 + need_identity 안내(테스트 계정 is_verified=false)
  const faceHeader=await visible('얼굴 인증',6000,true);
  const needIdentity=await visible('본인인증 후 이용할 수 있어요',6000,false);
  await page.screenshot({path:SCRATCH+'/v3154e_faceverify.png'});
  log('L1 FaceVerify 헤더:',faceHeader,'need_identity 안내:',needIdentity);
  // 닫기 → 이전 화면 복귀(중단 안내)
  await clickT('닫기');await sleep(2000);
  const backOk=!(await visible('본인인증 후 이용할 수 있어요',1500,false));
  log('L2 닫기 복귀:',backOk);
  await page.screenshot({path:SCRATCH+'/v3154e_closed.png'});
  log('RESULTS:',{L1:faceHeader&&needIdentity?'PASS':'FAIL',L2:backOk?'PASS':'FAIL'});
  await browser.close();
  log('DONE-v3154e');
})().catch(e=>{log('SCRIPT ERROR:',String(e&&e.stack||e).slice(0,900));process.exit(1);});
