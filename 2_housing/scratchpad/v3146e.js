// v3.146 E2E — 작곡 디렉터 장르/분위기 직접 입력 UI (G1) + 버튼 선택 회귀 (G2)
const { chromium } = require('/Users/pearl/TripleJ/2_housing/node_modules/playwright');
const fs = require('fs');
const SCRATCH = '/Users/pearl/TripleJ/2_housing/scratchpad';
const LOG = SCRATCH + '/v3146e.log';
function log(...a){const l=`[${new Date().toISOString()}] `+a.map(x=>typeof x==='string'?x:JSON.stringify(x)).join(' ');fs.appendFileSync(LOG,l+'\n');console.log(l);}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const results={};
(async()=>{
  fs.writeFileSync(LOG,'');
  const browser=await chromium.launch({headless:true});
  const page=await (await browser.newContext({viewport:{width:480,height:920}})).newPage();
  page.on('console',m=>{const t=m.text();if(/MusicGeneration\]/.test(t))log('[console]',t.slice(0,140));});
  const visible=async(t,to=3000,e=true)=>{try{await page.getByText(t,{exact:e}).last().waitFor({state:'visible',timeout:to});return true;}catch{return false;}};
  const clickT=async(t,o={})=>{const l=page.getByText(t,{exact:o.exact!==false}).last();await l.waitFor({state:'visible',timeout:o.timeout||15000});await l.click();log('clicked:',t);};
  const closePopups=async()=>{for(const t of ['✕','닫기','나중에']){try{if(await visible(t,700)){await page.getByText(t,{exact:true}).last().click();await sleep(500);}}catch{}}};
  const clearDraft=async()=>{await page.evaluate(()=>localStorage.removeItem('aidol-lyrics-draft'));};
  const enterToRepick=async()=>{
    await page.goto('http://localhost:8081',{timeout:60000});
    await page.getByText('차트',{exact:true}).first().waitFor({timeout:120000});
    await sleep(2500);await closePopups();await closePopups();
    await clickT('작업실');await sleep(2500);await closePopups();
    await clickT('작곡 디렉터');await sleep(2500);
    for(let i=0;i<6;i++){ if(await visible('가사 보기',1500,true))break; await page.mouse.click(240,600); await sleep(1200);}
    await page.getByText('여름 바다로',{exact:false}).last().click();await sleep(3000);
    if(await visible('제목 확인',8000,true)){await clickT('제목 확인');await sleep(1500);}
    if(await visible('가사 확인 완료',8000,true)){await clickT('가사 확인 완료');await sleep(2500);}
    await clickT('아니요, 다른 장르·분위기로 만들래요');await sleep(1800);
  };

  // 로그인
  await page.goto('http://localhost:8081',{timeout:120000});
  await page.getByText('차트',{exact:true}).first().waitFor({timeout:180000});
  await sleep(3000);await closePopups();await closePopups();
  await clickT('작업실');await sleep(2000);
  if(!(await visible('로그인하고 시작하기',2000))){await page.mouse.click(240,460);await sleep(1200);}
  await clickT('로그인하고 시작하기');await sleep(1800);
  await page.getByPlaceholder('이메일을 입력하세요').fill('teamdev_v228bg_qepfra@test.local');
  await page.getByPlaceholder('비밀번호를 입력하세요').fill('Teamdev1234!');
  await page.getByText('로그인',{exact:true}).last().click();await sleep(4000);
  await closePopups();await clearDraft();

  // ── G1: 직접 입력 경로 ──
  await enterToRepick();
  const genreInput=page.getByPlaceholder('직접 입력... (예: 신스팝)');
  const g1row=await genreInput.isVisible().catch(()=>false);
  await page.screenshot({path:SCRATCH+'/v3146e_genre.png'});
  await genreInput.fill('신스팝');await clickT('확인');await sleep(1800);
  const moodInput=page.getByPlaceholder('직접 입력... (예: 쓸쓸한 새벽 감성)');
  const g1moodRow=await moodInput.isVisible().catch(()=>false);
  await page.screenshot({path:SCRATCH+'/v3146e_mood.png'});
  await moodInput.fill('쓸쓸한 새벽 감성');await clickT('확인');await sleep(2500);
  const g1body=await page.evaluate(()=>document.body.innerText);
  const g1ok=g1body.includes('신스팝')&&/분위기: 쓸쓸한 새벽 감성/.test(g1body)&&/함께할 아티스트|보컬/.test(g1body);
  results.G1=g1row&&g1moodRow&&g1ok?'PASS':'FAIL';
  log('G1 장르입력행:',g1row,'분위기입력행:',g1moodRow,'진행:',g1ok);
  await page.screenshot({path:SCRATCH+'/v3146e_g1done.png'});

  // ── G2: 버튼 선택 회귀 ──
  await clearDraft();
  await enterToRepick();
  await clickT('발라드');await sleep(1800);
  await clickT('잔잔하고 편안한');await sleep(2500);
  const g2body=await page.evaluate(()=>document.body.innerText);
  const g2ok=/분위기: 잔잔하고 편안한/.test(g2body)&&/함께할 아티스트|보컬/.test(g2body);
  results.G2=g2ok?'PASS':'FAIL';
  log('G2 버튼 선택 회귀:',g2ok);

  log('RESULTS:',results);
  await browser.close();
  log('DONE-v3146e');
})().catch(e=>{log('SCRIPT ERROR:',String(e&&e.stack||e).slice(0,900));process.exit(1);});
