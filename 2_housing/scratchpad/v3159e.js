// v3.159 E2E — ①플레이어 제목 마퀴(실이동) ②채널 아티스트 탭(펄킴) ③채널 UI 마이페이지 통일(칩/작성버튼)
// ④이모지 제거 ⑤내 채널 새 피드/공지 작성 버튼 → FeedCompose 진입(발행 안 함)
const { chromium } = require('/Users/pearl/TripleJ/2_housing/node_modules/playwright');
const fs = require('fs');
const SCRATCH='/Users/pearl/TripleJ/2_housing/scratchpad';
const LOG=SCRATCH+'/v3159e.log';
function log(...a){const l=`[${new Date().toISOString()}] `+a.map(x=>typeof x==='string'?x:JSON.stringify(x)).join(' ');fs.appendFileSync(LOG,l+'\n');console.log(l);}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  fs.writeFileSync(LOG,'');
  const browser=await chromium.launch({headless:true});
  const page=await (await browser.newContext({viewport:{width:480,height:920}})).newPage();
  const R={};
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

  // ── L1: 긴 제목 마퀴 — 픽스처 열고 제목 x좌표가 시간에 따라 이동 ──
  await clickT('차트');await sleep(1500);
  await page.getByLabel('마이페이지').last().click().catch(async()=>{const bb=await page.getByLabel('마이페이지').last().boundingBox();if(bb)await page.mouse.click(bb.x+bb.width/2,bb.y+bb.height/2);});
  await sleep(2500);
  {
    // 행 제목이 마퀴(이동 중)라 텍스트 직접 클릭 불가 — 행(ancestor tabindex) 좌표 클릭
    const row=page.getByText('아주아주 길고 긴 제목',{exact:false}).last().locator('xpath=ancestor::div[@tabindex="0"][1]');
    const bb=await row.boundingBox();
    await page.mouse.click(bb.x+bb.width/2, bb.y+bb.height/2);
    log('clicked(row): 긴제목 픽스처');
  }
  await sleep(4000);
  const titleX=async()=>page.evaluate(()=>{
    const els=[...document.querySelectorAll('div')].filter(d=>d.children.length===0&&(d.textContent||'').includes('마퀴 검증을 위한'));
    return els.length?Math.min(...els.map(e=>e.getBoundingClientRect().x)):null;
  });
  const x1=await titleX();
  await sleep(2500);
  const x2=await titleX();
  R.L1=x1!=null&&x2!=null&&Math.abs(x1-x2)>5; // 마퀴가 흐르는 중이면 x가 변함
  await page.screenshot({path:SCRATCH+'/v3159e_marquee.png'});
  log('L1 제목 마퀴 이동:',R.L1,{x1,x2});

  // ── L3/L5: 내 채널 — 탭 UI·작성 버튼 ──
  await page.getByText('팀데브bg_qepfra',{exact:false}).last().click();await sleep(3000);
  const chipTracks=await visible('곡',3000,true);
  const chipAlbums=await visible('앨범',2000,true);
  const artistTab=await visible('아티스트',2000,true);
  await page.screenshot({path:SCRATCH+'/v3159e_channel.png'});
  R.L3=chipTracks&&chipAlbums&&artistTab;
  log('L3 채널 탭 UI:',R.L3,{chipTracks,chipAlbums,artistTab});
  await clickT('피드');await sleep(1500);
  const composeFeed=await visible('새 피드 작성',3000,true);
  const noEmoji=!(await visible('✏️',1000,false))&&!(await visible('📝',1000,false))&&!(await visible('📢',1000,false));
  let composeLanded=false;
  if(composeFeed){
    await clickT('새 피드 작성');await sleep(2500);
    composeLanded=await visible('작성',4000,false)||await visible('등록',3000,false)||await visible('발행',3000,false);
    await page.screenshot({path:SCRATCH+'/v3159e_compose.png'});
    await page.goBack();await sleep(1500);
  }
  await clickT('커뮤니티');await sleep(1200);
  const composeNotice=await visible('새 공지 작성',3000,true);
  R.L5=composeFeed&&composeLanded&&composeNotice;
  R.L4=noEmoji;
  log('L4 이모지 제거:',R.L4,'| L5 작성 버튼:',R.L5,{composeFeed,composeLanded,composeNotice});
  await page.goBack();await sleep(1200);await page.getByText('✕',{exact:true}).last().click().catch(()=>{});await sleep(1000);

  // ── L2: 대표 채널 — 아티스트 탭에 펄킴 ──
  await clickT('차트');await sleep(2000);await closePopups();
  await page.getByText('더 나오려는 것을 막는 것일뿐',{exact:false}).last().click();await sleep(4000);
  await page.getByText('lovvepearl',{exact:false}).last().click();await sleep(3000);
  await clickT('아티스트');await sleep(1500);
  const pearlkim=await visible('펄킴',3000,true);
  const virtualLabel=await visible('가상 아티스트',2000,true);
  R.L2=pearlkim&&virtualLabel;
  await page.screenshot({path:SCRATCH+'/v3159e_artists.png'});
  log('L2 아티스트 탭 펄킴:',R.L2,{pearlkim,virtualLabel});

  log('RESULTS:',Object.fromEntries(Object.entries(R).map(([k,v])=>[k,v?'PASS':'FAIL'])));
  await browser.close();
})().catch(e=>{log('SCRIPT ERROR:',String(e&&e.stack||e).slice(0,500));process.exit(1);});
