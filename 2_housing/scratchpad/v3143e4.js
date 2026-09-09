// v3.143 E4 — 아티스트 상세 목소리 연결 2택(간편/내 목소리) 모달 + 간편 프리셋 연결
const { chromium } = require('/Users/pearl/TripleJ/2_housing/node_modules/playwright');
const fs = require('fs');
const SCRATCH = '/Users/pearl/TripleJ/2_housing/scratchpad';
const LOG = SCRATCH + '/v3143e4.log';
function log(...a){const l=`[${new Date().toISOString()}] `+a.map(x=>typeof x==='string'?x:JSON.stringify(x)).join(' ');fs.appendFileSync(LOG,l+'\n');console.log(l);}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  fs.writeFileSync(LOG,'');
  const browser=await chromium.launch({headless:true});
  const page=await (await browser.newContext({viewport:{width:480,height:920}})).newPage();
  page.on('console',m=>{const t=m.text();if(/ArtistResult|MyArtists/.test(t))log('[console]',t.slice(0,140));});
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
  await closePopups();await closePopups();
  // 마이페이지(헤더 아이콘) → 내 아티스트
  await clickT('차트');await sleep(1500);
  await closePopups();await closePopups();
  try{
    await page.getByLabel('마이페이지').last().click({timeout:8000});
  }catch{
    log('마이페이지 일반 클릭 실패 — force 재시도');
    await page.getByLabel('마이페이지').last().click({force:true});
  }
  log('clicked: 마이페이지 아이콘');await sleep(2500);
  await clickT('내 아티스트',{exact:false});await sleep(2500);
  const cardLabel=await visible('간편 목소리 · 여성 소프트',5000,false);
  log('E4 목록카드 프리셋 표기:',cardLabel);
  // 혹시 열린 confirm 닫기
  try{if(await visible('취소',1200)){await page.getByText('취소',{exact:true}).last().click();await sleep(800);}}catch{}
  // 카드 pressable(조상 tabindex div)을 직접 클릭 — RN-web 텍스트 클릭 인터셉트 회피
  // MyArtists 카드 고유 텍스트(목소리 라벨) 기준으로 조상 pressable 클릭
  await page.getByText('간편 목소리 · 여성 소프트',{exact:false}).last().locator('xpath=ancestor::div[@tabindex="0"][1]').click();
  log('clicked: 리얼검증 카드');await sleep(3000);
  await page.screenshot({path:SCRATCH+'/v3143e4_detail.png'});
  const boxDesc=await visible('간편 목소리(여성 · 소프트)가 연결되어 있어요',6000,false);
  await clickT('목소리 변경');await sleep(1500);
  const twoChoice=(await visible('간편 목소리',3000,true))&&(await visible('내 목소리',3000,true));
  log('E4 2택 모달:',twoChoice,'상세 문구:',boxDesc);
  await page.screenshot({path:SCRATCH+'/v3143e4_choice.png'});
  await clickT('간편 목소리');await sleep(1200);
  const chips=(await visible('남성',2500,true))&&(await visible('파워풀',2500,true));
  await clickT('남성');await clickT('파워풀');await sleep(600);
  await page.screenshot({path:SCRATCH+'/v3143e4_preset.png'});
  await clickT('이 목소리로 연결');await sleep(2500);
  const done=await visible('간편 목소리(남성 · 파워풀)를 연결했어요',5000,false);
  for(const t of ['확인']){try{if(await visible(t,1200)){await page.getByText(t,{exact:true}).last().click();}}catch{}}
  await sleep(1500);
  const updated=await visible('간편 목소리(남성 · 파워풀)가 연결되어 있어요',6000,false);
  await page.screenshot({path:SCRATCH+'/v3143e4_done.png'});
  log('E4 연결완료 팝업:',done,'상세 갱신:',updated);
  log('RESULT E4:',cardLabel&&boxDesc&&twoChoice&&chips&&done&&updated?'PASS':'FAIL');
  await browser.close();
  log('DONE-v3143e4');
})().catch(e=>{log('SCRIPT ERROR:',String(e&&e.stack||e).slice(0,900));process.exit(1);});
