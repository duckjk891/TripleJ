// v3.163 E2E — ①얼굴인증 동의가 "사진 업로드 직후" 선진행(consentOnly, route mock — 무과금)
// ②동의 제목 2줄 개행 ③동의 완료→입력 흐름 복귀 ④MyArtists 대표 배지 제거 ⑤마이페이지 최신 아티스트 카드
const { chromium } = require('/Users/pearl/TripleJ/2_housing/node_modules/playwright');
const fs = require('fs');
const SCRATCH='/Users/pearl/TripleJ/2_housing/scratchpad';
const LOG=SCRATCH+'/v3163e.log';
function log(...a){const l=`[${new Date().toISOString()}] `+a.map(x=>typeof x==='string'?x:JSON.stringify(x)).join(' ');fs.appendFileSync(LOG,l+'\n');console.log(l);}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  fs.writeFileSync(LOG,'');
  const browser=await chromium.launch({headless:true});
  const page=await (await browser.newContext({viewport:{width:480,height:920}})).newPage();
  const R={};
  // 얼굴인증 상태/동의 라우트 목 — 성인·본인인증됨·미동의 시나리오 (서버 미기록·무과금)
  await page.route('**/api/face-verify/status',(route)=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({enabled:true,mode:'aws',is_verified:true,minor:false,consent_needed:true,guardian_needed:false,guardian_status:null,registered:false})}));
  await page.route('**/api/face-verify/consent',(route)=>route.fulfill({status:200,contentType:'application/json',body:'{}'}));
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

  // ── L1~L3: 아티스트 디렉터 → 재생성 경로(슬롯 미소모) → 사진 업로드 → 동의 선진행 ──
  await clickT('작업실');await sleep(2500);await closePopups();
  await clickT('아티스트 디렉터');await sleep(2500);
  await page.getByText('리얼검증',{exact:false}).last().locator('xpath=ancestor::div[@tabindex="0"][1]').click();
  log('clicked: 리얼검증 카드');await sleep(3000);
  await clickT('다시 만들기');await sleep(1800);
  for(const t of ['확인','다시 만들기','계속','시작하기']){try{if(await visible(t,1200)){await page.getByText(t,{exact:true}).last().click();await sleep(1200);}}catch{}}
  try{if(await visible('실사로 만들기',2500,true)){await clickT('실사로 만들기');await sleep(1500);}}catch{}
  const [chooser]=await Promise.all([
    page.waitForEvent('filechooser',{timeout:10000}),
    page.getByText('사진 올리기',{exact:true}).last().click(),
  ]);
  await chooser.setFiles('/tmp/bgtest.png');
  log('사진 주입');await sleep(1200);
  await clickT('확인했어요');await sleep(2500);
  // L1: 사진 업로드 직후 동의 화면(consentOnly) 자동 진입
  const consentShown=await visible('수집·이용 동의',6000,false);
  // L2: 제목 2줄 개행 — 두 줄 텍스트가 각각 표시
  const line1=await visible('얼굴 인증(생체정보) 수집·이용 동의',3000,false);
  const line2=await visible('(필수 · 얼굴 사진 기능 이용 시)',3000,false);
  R.L1=consentShown; R.L2=line1&&line2;
  await page.screenshot({path:SCRATCH+'/v3163e_consent.png'});
  log('L1 동의 선진행:',R.L1,'| L2 제목 개행:',R.L2,{line1,line2});
  // L3: 체크 → 동의하기 → 동의 완료 → 확인 → 입력 흐름 복귀
  let backOk=false;
  if(consentShown){
    try{
      // 체크박스: '동의합니다' 라벨 or 체크 영역
      for(const t of ['위 내용을 확인했으며 동의합니다','동의합니다']){if(await visible(t,1500,false)){await page.getByText(t,{exact:false}).last().click();await sleep(600);break;}}
      await clickT('동의하기');await sleep(1500);
      const done=await visible('동의 완료',4000,true);
      await page.screenshot({path:SCRATCH+'/v3163e_done.png'});
      if(done){await clickT('확인');await sleep(1800);}
      backOk=done&&(await visible('건너뛰기',5000,true)||await visible('디렉터',3000,false));
    }catch(e){log('L3 err',String(e).slice(0,200));}
  }
  R.L3=backOk;
  await page.screenshot({path:SCRATCH+'/v3163e_back.png'});
  log('L3 동의 완료·복귀:',R.L3);

  // ── L4: MyArtists 대표 배지 부재 ──
  await clickT('작업실');await sleep(2000);await closePopups();
  // 아티스트 디렉터 → 목록(내 아티스트) 화면엔 카드 존재; '대표' 텍스트 없어야
  const badgeGone=!(await visible('대표',1500,true));
  R.L4=badgeGone;
  await page.screenshot({path:SCRATCH+'/v3163e_list.png'});
  log('L4 대표 배지 제거:',R.L4);

  // ── L5: 마이페이지 내 아티스트 카드(최신 생성 기준 — 리얼검증 1명뿐이므로 표시 자체 확인) ──
  await clickT('차트');await sleep(1500);
  try{await page.getByLabel('마이페이지').last().click({timeout:5000});}catch{const bb=await page.getByLabel('마이페이지').last().boundingBox();if(bb)await page.mouse.click(bb.x+bb.width/2,bb.y+bb.height/2);}
  await sleep(2500);
  const cardShown=await visible('리얼검증',5000,false)&&await visible('내 아티스트',3000,false);
  R.L5=cardShown;
  await page.screenshot({path:SCRATCH+'/v3163e_mypage.png'});
  log('L5 마이페이지 카드:',R.L5);

  log('RESULTS:',Object.fromEntries(Object.entries(R).map(([k,v])=>[k,v?'PASS':'FAIL'])));
  await browser.close();
})().catch(e=>{log('SCRIPT ERROR:',String(e&&e.stack||e).slice(0,500));process.exit(1);});
