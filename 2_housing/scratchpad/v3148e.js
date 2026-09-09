// v3.148 E2E — 작곡 대화 답변 말풍선 탭 → 되감기 (I3/I4/I5)
const { chromium } = require('/Users/pearl/TripleJ/2_housing/node_modules/playwright');
const fs = require('fs');
const SCRATCH = '/Users/pearl/TripleJ/2_housing/scratchpad';
const LOG = SCRATCH + '/v3148e.log';
function log(...a){const l=`[${new Date().toISOString()}] `+a.map(x=>typeof x==='string'?x:JSON.stringify(x)).join(' ');fs.appendFileSync(LOG,l+'\n');console.log(l);}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const results={};
(async()=>{
  fs.writeFileSync(LOG,'');
  const browser=await chromium.launch({headless:true});
  const page=await (await browser.newContext({viewport:{width:480,height:920}})).newPage();
  page.on('console',m=>{const t=m.text();if(/MusicGeneration\]/.test(t))log('[console]',t.slice(0,130));});
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
  await page.evaluate(()=>localStorage.removeItem('aidol-lyrics-draft'));

  // 작곡 진입 → 302 네 → 아티스트 건너뛰기 → 성별 여성 → 목소리 간편 → 스타일 소프트
  await page.goto('http://localhost:8081');await page.getByText('차트',{exact:true}).first().waitFor({timeout:120000});
  await sleep(2500);await closePopups();
  await clickT('작업실');await sleep(2500);await closePopups();
  await clickT('작곡 디렉터');await sleep(2500);
  for(let i=0;i<6;i++){ if(await visible('가사 보기',1500,true))break; await page.mouse.click(240,600); await sleep(1200);}
  await page.getByText('여름 바다로',{exact:false}).last().click();await sleep(3000);
  await clickT('제목 확인');await sleep(1500);
  await clickT('가사 확인 완료');await sleep(2500);
  await clickT('네, 이대로 갈게요');await sleep(2500);
  await clickT('아티스트 없이 진행 (건너뛰기)');await sleep(1800);
  await clickT('여성');await sleep(1800);
  await clickT('간편 목소리 (보컬 스타일 선택)');await sleep(1800);
  const styleShown=await visible('소프트',4000,true);
  log('I5 회귀 — 302→간편→스타일 도달:',styleShown);
  results.I5=styleShown?'PASS':'FAIL';

  // I4: '여성' 말풍선 탭 → 팝업 → 취소 → 상태 불변(스타일 칩 유지)
  await page.getByText('여성',{exact:true}).last().click();await sleep(1000);
  const confirmShown=await visible('이 답변부터 다시 할까요?',3000,false);
  await page.screenshot({path:SCRATCH+'/v3148e_confirm.png'});
  await clickT('취소');await sleep(1000);
  const stillStyle=await visible('소프트',3000,true);
  results.I4=confirmShown&&stillStyle?'PASS':'FAIL';
  log('I4 취소 — 팝업:',confirmShown,'상태 유지:',stillStyle);

  // I3: 다시 탭 → '다시 선택' → 성별 질문 재출력 → 남성 → 목소리 질문 이어짐
  await page.getByText('여성',{exact:true}).last().click();await sleep(1000);
  await clickT('다시 선택');await sleep(1500);
  const genderQ=await visible('보컬을 선택해주세요!',4000,false);
  const genderBtns=(await visible('남성',2000,true))&&(await visible('여성',2000,true));
  await page.screenshot({path:SCRATCH+'/v3148e_rewind.png'});
  await clickT('남성');await sleep(1800);
  const voiceQ=await visible('간편 목소리 (보컬 스타일 선택)',4000,true);
  const body=await page.evaluate(()=>document.body.innerText);
  const maleInChat=body.includes('남성');
  results.I3=genderQ&&genderBtns&&voiceQ&&maleInChat?'PASS':'FAIL';
  log('I3 되감기 — 질문 재출력:',genderQ,'선택지:',genderBtns,'재선택 후 목소리 질문:',voiceQ);
  // 이어서 간편→스타일까지 재진행(후속 흐름 무결 확인)
  await clickT('간편 목소리 (보컬 스타일 선택)');await sleep(1500);
  const styleAgain=await visible('파워풀',3000,true);
  log('되감기 후 흐름 계속:',styleAgain);
  if(!styleAgain) results.I3='FAIL(후속흐름)';
  await page.screenshot({path:SCRATCH+'/v3148e_done.png'});

  log('RESULTS:',results);
  await browser.close();
  log('DONE-v3148e');
})().catch(e=>{log('SCRIPT ERROR:',String(e&&e.stack||e).slice(0,900));process.exit(1);});
