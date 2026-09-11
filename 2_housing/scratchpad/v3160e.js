// v3.160 E2E — ①커버 풀블리드+하단 토글 보존(920/760 두 높이) ②헤더 아래화살표→미니플레이어
// ③가사 공유(웹=클립보드 폴백 알럿) ④동영상 탭 풀블리드 ⑤채널 아티스트 탭(실적·최신곡커버·곡 펼침)
const { chromium } = require('/Users/pearl/TripleJ/2_housing/node_modules/playwright');
const fs = require('fs');
const SCRATCH='/Users/pearl/TripleJ/2_housing/scratchpad';
const LOG=SCRATCH+'/v3160e.log';
function log(...a){const l=`[${new Date().toISOString()}] `+a.map(x=>typeof x==='string'?x:JSON.stringify(x)).join(' ');fs.appendFileSync(LOG,l+'\n');console.log(l);}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  fs.writeFileSync(LOG,'');
  const browser=await chromium.launch({headless:true});
  const ctx=await browser.newContext({viewport:{width:480,height:920},permissions:['clipboard-read','clipboard-write']});
  const page=await ctx.newPage();
  const R={};
  const visible=async(t,to=3000,e=true)=>{try{await page.getByText(t,{exact:e}).last().waitFor({state:'visible',timeout:to});return true;}catch{return false;}};
  const clickT=async(t,o={})=>{const l=page.getByText(t,{exact:o.exact!==false}).last();await l.waitFor({state:'visible',timeout:o.timeout||15000});await l.click();log('clicked:',t);};
  const closePopups=async()=>{for(const t of ['✕','닫기','나중에']){try{if(await visible(t,700)){await page.getByText(t,{exact:true}).last().click();await sleep(500);}}catch{}}};

  await page.goto('http://localhost:8081',{timeout:120000});
  await page.getByText('차트',{exact:true}).first().waitFor({timeout:180000});
  await sleep(3000);await closePopups();await closePopups();

  // ── L1: 커버 풀블리드 + 하단 토글 보존 (920) ──
  await page.getByText('더 나오려는 것을 막는 것일뿐',{exact:false}).last().click();await sleep(4000);
  const coverW=await page.evaluate(()=>{const im=[...document.querySelectorAll('img')].filter(i=>i.src.includes('cover-preview')&&i.clientWidth>200);return im.length?Math.max(...im.map(i=>i.clientWidth)):0;});
  const toggleBB=await page.getByText('가사 · 프롬프트 · 착장',{exact:false}).last().boundingBox();
  const toggleVisible=!!toggleBB&&toggleBB.y+toggleBB.height<=920;
  R.L1=coverW>=470&&toggleVisible;
  await page.screenshot({path:SCRATCH+'/v3160e_full.png'});
  log('L1 풀블리드+토글(920):',R.L1,{coverW,toggleY:toggleBB&&Math.round(toggleBB.y)});

  // ── L4: 동영상 탭 풀블리드 ──
  await clickT('동영상');await sleep(3000);
  const lyricW=await page.evaluate(()=>{const els=[...document.querySelectorAll('div')].filter(d=>{const s=getComputedStyle(d);return s.overflow==='hidden'&&d.clientWidth>300&&d.clientHeight>=150&&d.clientHeight<=500;});return els.length?Math.max(...els.map(e=>e.clientWidth)):0;});
  R.L4=lyricW>=470;
  await page.screenshot({path:SCRATCH+'/v3160e_video.png'});
  log('L4 동영상 풀블리드:',R.L4,{lyricW});
  await clickT('노래');await sleep(1000);

  // ── L3: 가사 공유 → 클립보드 폴백 알럿 ──
  await clickT('가사 · 프롬프트 · 착장',{exact:false});await sleep(1500);
  const shareBtn=await visible('가사 공유',3000,true);
  let shareAlert=false;
  if(shareBtn){
    await clickT('가사 공유');await sleep(1500);
    shareAlert=await visible('가사 복사 완료',4000,false)||await visible('공유하지 못했어요',2000,false);
    await page.screenshot({path:SCRATCH+'/v3160e_share.png'});
    if(await visible('확인',1500,true)){await page.getByText('확인',{exact:true}).last().click();await sleep(800);}
  }
  R.L3=shareBtn&&shareAlert;
  log('L3 가사 공유:',R.L3,{shareBtn,shareAlert});
  await page.mouse.click(240,292);await sleep(900); // 시트 닫기

  // ── L2: 헤더 아래 화살표 → 미니플레이어 ──
  const downBtn=page.getByLabel('미니플레이어로 내려가기').last();
  const hasDown=await downBtn.isVisible().catch(()=>false);
  if(hasDown){await downBtn.click();await sleep(2000);}
  const chartBack=await visible('차트',3000,true);
  const miniTitle=await visible('더 나오려는 것을 막는 것일뿐',3000,false); // 미니플레이어에 곡 표시
  R.L2=hasDown&&chartBack&&miniTitle;
  await page.screenshot({path:SCRATCH+'/v3160e_mini.png'});
  log('L2 아래화살표→미니플레이어:',R.L2,{hasDown,chartBack,miniTitle});

  // ── L5: 채널 아티스트 탭 — 실적 표기·시트 아님(커버)·곡 펼침 ──
  await page.getByText('더 나오려는 것을 막는 것일뿐',{exact:false}).last().click();await sleep(3500);
  await page.getByText('lovvepearl',{exact:false}).last().click();await sleep(3000);
  await clickT('아티스트');await sleep(1500);
  const stat=await visible('곡 1 · 앨범 0',3000,false);
  const noVirtualLabel=!(await visible('가상 아티스트',1500,true));
  const imgIsCover=await page.evaluate(()=>{const im=[...document.querySelectorAll('img')].filter(i=>i.clientWidth===56);return im.some(i=>i.src.includes('cover-preview'))&&!im.some(i=>i.src.includes('character/preview'));});
  await page.getByText('펄킴',{exact:true}).last().locator('xpath=ancestor::div[@tabindex="0"][1]').click({force:true}).catch(async()=>{const bb=await page.getByText('펄킴',{exact:true}).last().boundingBox();if(bb)await page.mouse.click(bb.x+10,bb.y+5);});
  await sleep(1500);
  const trackShown=await visible('더 나오려는 것을 막는 것일뿐',3000,false);
  R.L5=stat&&noVirtualLabel&&imgIsCover&&trackShown;
  await page.screenshot({path:SCRATCH+'/v3160e_artists.png'});
  log('L5 아티스트 탭:',R.L5,{stat,noVirtualLabel,imgIsCover,trackShown});

  // ── L1b: 작은 화면(760)에서도 토글 보존 ──
  const page2=await (await browser.newContext({viewport:{width:480,height:760}})).newPage();
  await page2.goto('http://localhost:8081',{timeout:120000});
  await page2.getByText('차트',{exact:true}).first().waitFor({timeout:180000});
  await sleep(3000);
  for(const t of ['✕','닫기','나중에']){try{await page2.getByText(t,{exact:true}).last().click({timeout:700});await sleep(400);}catch{}}
  await page2.getByText('더 나오려는 것을 막는 것일뿐',{exact:false}).last().click();await sleep(4000);
  const tb2=await page2.getByText('가사 · 프롬프트 · 착장',{exact:false}).last().boundingBox();
  R.L1b=!!tb2&&tb2.y+tb2.height<=760;
  await page2.screenshot({path:SCRATCH+'/v3160e_small.png'});
  log('L1b 작은화면 토글 보존:',R.L1b,{y:tb2&&Math.round(tb2.y),h:760});

  log('RESULTS:',Object.fromEntries(Object.entries(R).map(([k,v])=>[k,v?'PASS':'FAIL'])));
  await browser.close();
})().catch(e=>{log('SCRIPT ERROR:',String(e&&e.stack||e).slice(0,500));process.exit(1);});
