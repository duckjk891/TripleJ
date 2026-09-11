// v3.156 E2E — ① 차트/플레이어 아티스트·기획사 표기(펄킴/lovvepearl) ② 가사 싱크 배경 고정폭
// ③ 프롬프트 탭 중복 제거·통계 칩 제거 ④ 가사 [] 마커 숨김 ⑤ 착장 탭 ⑥ Cody ← 커버 대화 복귀
const { chromium } = require('/Users/pearl/TripleJ/2_housing/node_modules/playwright');
const fs = require('fs');
const SCRATCH = '/Users/pearl/TripleJ/2_housing/scratchpad';
const LOG = SCRATCH + '/v3156e.log';
function log(...a){const l=`[${new Date().toISOString()}] `+a.map(x=>typeof x==='string'?x:JSON.stringify(x)).join(' ');fs.appendFileSync(LOG,l+'\n');console.log(l);}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  fs.writeFileSync(LOG,'');
  const browser=await chromium.launch({headless:true,args:['--autoplay-policy=no-user-gesture-required']});
  const page=await (await browser.newContext({viewport:{width:480,height:920}})).newPage();
  const R={};
  const visible=async(t,to=3000,e=true)=>{try{await page.getByText(t,{exact:e}).last().waitFor({state:'visible',timeout:to});return true;}catch{return false;}};
  const clickT=async(t,o={})=>{const l=page.getByText(t,{exact:o.exact!==false}).last();await l.waitFor({state:'visible',timeout:o.timeout||15000});await l.click();log('clicked:',t);};
  const closePopups=async()=>{for(const t of ['✕','닫기','나중에']){try{if(await visible(t,700)){await page.getByText(t,{exact:true}).last().click();await sleep(500);}}catch{}}};
  const lyricBoxWidth=async()=>page.evaluate(()=>{
    const els=[...document.querySelectorAll('div')].filter(d=>{const s=getComputedStyle(d);return s.borderRadius==='16px'&&s.overflow==='hidden'&&d.clientWidth>200&&d.clientHeight>=150&&d.clientHeight<=260;});
    return els.length?Math.max(...els.map(e=>e.clientWidth)):0;
  });

  await page.goto('http://localhost:8081',{timeout:120000});
  await page.getByText('차트',{exact:true}).first().waitFor({timeout:180000});
  await sleep(3000);await closePopups();await closePopups();
  // 로그인 (작업실 경유)
  await clickT('작업실');await sleep(2000);
  if(!(await visible('로그인하고 시작하기',2000))){await page.mouse.click(240,460);await sleep(1200);}
  await clickT('로그인하고 시작하기');await sleep(1800);
  await page.getByPlaceholder('이메일을 입력하세요').fill('teamdev_v228bg_qepfra@test.local');
  await page.getByPlaceholder('비밀번호를 입력하세요').fill('Teamdev1234!');
  await page.getByText('로그인',{exact:true}).last().click();await sleep(4000);
  await closePopups();

  // ── L1: 차트에 펄킴 표기 ──
  await clickT('차트');await sleep(2500);await closePopups();
  const chartTitle=await visible('더 나오려는 것을 막는 것일뿐',8000,false);
  const chartArtist=await visible('펄킴',4000,true);
  R.L1=chartTitle&&chartArtist;
  await page.screenshot({path:SCRATCH+'/v3156e_chart.png'});
  log('L1 차트 펄킴:',R.L1,{chartTitle,chartArtist});

  // ── L2: NowPlaying 3단(제목/가수/기획사) ──
  await page.getByText('더 나오려는 것을 막는 것일뿐',{exact:false}).last().click();await sleep(4000);
  const npTitle=await visible('더 나오려는 것을 막는 것일뿐',6000,false);
  const npArtist=await visible('펄킴',3000,true);
  const npAgency=await visible('lovvepearl',3000,false);
  R.L2=npTitle&&npArtist&&npAgency;
  await page.screenshot({path:SCRATCH+'/v3156e_np.png'});
  log('L2 NowPlaying 3단:',R.L2,{npTitle,npArtist,npAgency});

  // ── L3: 동영상 탭 — 가사 싱크 배경 고정폭 ──
  await clickT('동영상');await sleep(3000);
  const w1=await lyricBoxWidth();
  await sleep(5000);
  const w2=await lyricBoxWidth();
  R.L3=w1>=400&&w1===w2;
  await page.screenshot({path:SCRATCH+'/v3156e_video.png'});
  log('L3 가사싱크 고정폭:',R.L3,{w1,w2});
  await clickT('노래');await sleep(1200);

  // ── L4: 프롬프트 탭 — 중복 제거·통계 칩 제거 ──
  await clickT('가사 · 프롬프트 · 착장',{exact:false});await sleep(1500);
  await clickT('프롬프트');await sleep(1200);
  const chipsShown=await visible('핵심 파라미터',4000,true);
  const dupLine=await visible('장르: 하우스',1500,false);   // 중복 줄 — 안 보여야
  const statChip=await visible('재생 수',1500,true);        // 통계 칩 — 안 보여야
  R.L4=chipsShown&&!dupLine&&!statChip;
  await page.screenshot({path:SCRATCH+'/v3156e_prompt.png'});
  log('L4 프롬프트 정리:',R.L4,{chipsShown,dupLine,statChip});

  // ── L5: 착장 탭 ──
  await clickT('착장');await sleep(1500);
  const outfitHdr=await visible('이 곡 아티스트의 착장',4000,false);
  R.L5=outfitHdr;
  await page.screenshot({path:SCRATCH+'/v3156e_outfit.png'});
  log('L5 착장 표시:',R.L5);
  await page.mouse.click(240,292);await sleep(1000); // 상세시트 핸들(70% 시트 상단) — 시트 닫기
  await page.getByText('✕',{exact:true}).last().click();await sleep(1500); // 플레이어 닫기

  // ── L6: 픽스처(마이뮤직) — [] 숨김 + 비중복 프롬프트 유지 + 2단 표기 ──
  await page.screenshot({path:SCRATCH+'/v3156e_afterclose.png'});
  await clickT('차트');await sleep(1500);await closePopups();
  try{ await page.getByLabel('마이페이지').last().click({timeout:5000}); }
  catch{ const bb=await page.getByLabel('마이페이지').last().boundingBox(); log('마이페이지 좌표 폴백', bb); if(bb) await page.mouse.click(bb.x+bb.width/2, bb.y+bb.height/2); }
  await sleep(2500);
  const fxRow=await visible('v3156 아티스트표기검증',8000,false);
  if(fxRow){
    await page.getByText('v3156 아티스트표기검증',{exact:false}).last().click();await sleep(3500);
    const fxArtist=await visible('리얼검증',4000,true);
    const fxAgency=await visible('팀데브bg_qepfra',3000,false);
    await clickT('가사 · 프롬프트 · 착장',{exact:false});await sleep(1500);
    const lyricsBody=await visible('첫 소절 가사입니다',4000,false);
    const marker=await visible('[Verse',1500,false);          // 안 보여야
    await clickT('프롬프트');await sleep(1200);
    const keepLine=await visible('서브 보컬 스타일: 허스키한 저음',3000,false); // 비중복 — 보여야
    const freeLine=await visible('빗소리로 시작해서',2000,false);              // 자유 서술 — 보여야
    const dupLine2=await visible('장르: 발라드',1500,false);                    // 중복 — 안 보여야
    R.L6=fxArtist&&fxAgency&&lyricsBody&&!marker&&keepLine&&freeLine&&!dupLine2;
    await page.screenshot({path:SCRATCH+'/v3156e_fixture.png'});
    log('L6 픽스처:',R.L6,{fxArtist,fxAgency,lyricsBody,marker,keepLine,freeLine,dupLine2});
    await page.mouse.click(240,292);await sleep(1000); // 상세시트 닫기
    await page.getByText('✕',{exact:true}).last().click();await sleep(1200);
  } else { R.L6=false; log('L6 FAIL — 마이뮤직에서 픽스처 미발견'); await page.screenshot({path:SCRATCH+'/v3156e_mymusic.png'}); }

  // ── L7: 이미지 디렉터 → 꾸미기 → ← → 커버 대화 복귀 ──
  await clickT('차트');await sleep(1500);await clickT('작업실');await sleep(2500);await closePopups();
  await clickT('이미지 디렉터');await sleep(2500);
  await page.screenshot({path:SCRATCH+'/v3156e_coverlist.png'});
  const coverPickTitle=(await visible('커버검증곡',4000,false))?'커버검증곡':'v3156 아티스트표기검증';
  // 리스트 카드는 화면 하단 — 여러 매치 중 y가 가장 큰(=리스트) 요소를 고른다(미니플레이어 오탐 회피)
  const cnt=await page.getByText(coverPickTitle,{exact:false}).count();
  let rowBB=null;
  for(let i=0;i<cnt;i++){const b=await page.getByText(coverPickTitle,{exact:false}).nth(i).boundingBox();if(b&&(!rowBB||b.y>rowBB.y))rowBB=b;}
  await page.mouse.click(rowBB.x+rowBB.width/2, rowBB.y+rowBB.height/2);
  log('clicked(row-xy):',coverPickTitle,rowBB,'matches='+cnt);
  await sleep(3000);
  await page.screenshot({path:SCRATCH+'/v3156e_afterpick.png'});
  await clickT('네, 아티스트 포함');await sleep(2500);
  const wardrobeQ=await visible('지금 아티스트가 입고 있는 의상이에요',5000,false);
  await clickT('👗 의상 바꾸러 가기 (아티스트 꾸미기)',{exact:false});await sleep(3000);
  const codyShown=await visible('코디',4000,false)||await visible('아이템',3000,false)||await visible('옷 입히기',3000,false);
  await page.screenshot({path:SCRATCH+'/v3156e_cody.png'});
  await page.getByText('‹',{exact:true}).last().click();await sleep(2500); // 헤더 ← (v3.156 goBack)
  const backToCover=await visible('지금 아티스트가 입고 있는 의상이에요',5000,false)||await visible('의상 바꾸러 가기',3000,false);
  const notMap=!(await visible('아티스트 디렉터',1500,true));
  R.L7=wardrobeQ&&codyShown&&backToCover&&notMap;
  await page.screenshot({path:SCRATCH+'/v3156e_back.png'});
  log('L7 Cody 복귀:',R.L7,{wardrobeQ,codyShown,backToCover,notMap});

  log('RESULTS:',Object.fromEntries(Object.entries(R).map(([k,v])=>[k,v?'PASS':'FAIL'])));
  await browser.close();
  log('DONE-v3156e');
})().catch(e=>{log('SCRIPT ERROR:',String(e&&e.stack||e).slice(0,900));process.exit(1);});
