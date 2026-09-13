// v3.171 E2E — ①MAIDOL 스플래시(MY AI IDOL) ②영상 디렉터 대화 진입·곡 목록 ③형식 카드 3종
// ④실제 공유영상 생성 완료(ffmpeg — 무과금) ⑤플레이어 AI 생성 뱃지
const { chromium } = require('/Users/pearl/TripleJ/2_housing/node_modules/playwright');
const fs=require('fs');
const SCRATCH='/Users/pearl/TripleJ/2_housing/scratchpad';
const LOG=SCRATCH+'/v3171e.log';
const log=(...a)=>{const l=`[${new Date().toISOString()}] `+a.map(x=>typeof x==='string'?x:JSON.stringify(x)).join(' ');fs.appendFileSync(LOG,l+'\n');console.log(l);};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  fs.writeFileSync(LOG,'');
  const browser=await chromium.launch({headless:true});
  const page=await (await browser.newContext({viewport:{width:480,height:920}})).newPage();
  const R={};
  const visible=async(t,to=3000,e=true)=>{try{await page.getByText(t,{exact:e}).last().waitFor({state:'visible',timeout:to});return true;}catch{return false;}};
  const clickT=async(t,o={})=>{const l=page.getByText(t,{exact:o.exact!==false}).last();await l.waitFor({state:'visible',timeout:o.timeout||15000});await l.click();log('clicked:',t);};
  const closePopups=async()=>{for(const t of ['✕','닫기','나중에']){try{if(await visible(t,700)){await page.getByText(t,{exact:true}).last().click();await sleep(500);}}catch{}}};

  // ── L1: 스플래시 — MAIDOL 로고(MY AI IDOL) ──
  await page.goto('http://localhost:8081',{timeout:120000});
  const tagline=await visible('MY AI IDOL',15000,true);
  const dol=await visible('DOL',3000,true);
  await page.screenshot({path:SCRATCH+'/v3171e_splash.png'});
  R.L1=tagline&&dol;
  log('L1 MAIDOL 스플래시:',R.L1,{tagline,dol});

  await page.getByText('차트',{exact:true}).first().waitFor({timeout:180000});
  await sleep(3000);await closePopups();await closePopups();
  await clickT('작업실');await sleep(2000);
  if(!(await visible('로그인하고 시작하기',2000))){await page.mouse.click(240,460);await sleep(1200);}
  await clickT('로그인하고 시작하기');await sleep(1800);
  await page.getByPlaceholder('이메일을 입력하세요').fill('teamdev_v228bg_qepfra@test.local');
  await page.getByPlaceholder('비밀번호를 입력하세요').fill('Teamdev1234!');
  await page.getByText('로그인',{exact:true}).last().click();await sleep(4000);await closePopups();

  // ── L2: 영상 디렉터 진입 ──
  await clickT('작업실');await sleep(2500);await closePopups();
  await clickT('영상 디렉터',{timeout:20000});await sleep(3000);
  const hello=await visible('영상 디렉터예요',5000,false);
  const listShown=await visible('커버검증곡',6000,false)||await visible('더 나오려는',4000,false);
  await page.screenshot({path:SCRATCH+'/v3171e_enter.png'});
  R.L2=hello&&listShown;
  log('L2 영상 디렉터 진입·곡 목록:',R.L2,{hello,listShown});

  // ── L3: 곡 선택(공개+커버 보유 픽스처) → 형식 카드 3종 ──
  {const bb=await page.getByText('v3171 영상검증곡',{exact:false}).last().boundingBox();await page.mouse.click(bb.x+bb.width/2,bb.y+bb.height/2);log('clicked(row): v3171 영상검증곡');}
  await sleep(2000);
  const f1=await visible('SNS용 세로',4000,true), f2=await visible('와이드 가로',2000,true), f3=await visible('카톡 프로필 배경',2000,true);
  await page.screenshot({path:SCRATCH+'/v3171e_formats.png'});
  R.L3=f1&&f2&&f3;
  log('L3 형식 카드:',R.L3,{f1,f2,f3});

  // ── L4: SNS용 세로 생성 → 완료 + 저장 버튼 (실생성 — ffmpeg, 최대 5분 대기) ──
  await clickT('SNS용 세로');await sleep(1500);
  const making=await visible('영상을 만들고 있어요',5000,false);
  const done=await visible('완성됐어요',300000,false);
  const saveBtn=await visible('기기에 저장 / 공유하기',5000,false);
  await page.screenshot({path:SCRATCH+'/v3171e_done.png'});
  R.L4=making&&done&&saveBtn;
  log('L4 영상 생성 완료:',R.L4,{making,done,saveBtn});

  // ── L5: 플레이어 AI 생성 뱃지 ──
  await clickT('차트');await sleep(3000);await closePopups();
  await page.screenshot({path:SCRATCH+'/v3171e_chart.png'});
  await page.getByText('냥냥냥',{exact:false}).last().click({timeout:15000});await sleep(4000);
  const badgeSong=await visible('AI 생성',3000,true);
  await clickT('동영상');await sleep(2500);
  const badgeVideo=await visible('AI 생성',3000,true);
  await page.screenshot({path:SCRATCH+'/v3171e_badge.png'});
  R.L5=badgeSong&&badgeVideo;
  log('L5 AI 생성 뱃지:',R.L5,{badgeSong,badgeVideo});

  log('RESULTS:',Object.fromEntries(Object.entries(R).map(([k,v])=>[k,v?'PASS':'FAIL'])));
  await browser.close();
})().catch(e=>{log('SCRIPT ERROR:',String(e&&e.stack||e).slice(0,500));process.exit(1);});
