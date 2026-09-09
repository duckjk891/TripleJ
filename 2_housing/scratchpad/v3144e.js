// v3.144 E2E — 대표 실사고 재현: 어긋난 작업본(내용 상이·장르 없음·출처 id 없음)이
// 제목 폴백 병합으로 장르/분위기를 승계하고 '장르 없음' 질문이 나지 않는지 검증.
// + 병합된 자산의 이중 표시 제거, sourceAssetId 연결 복구 확인.
const { chromium } = require('/Users/pearl/TripleJ/2_housing/node_modules/playwright');
const fs = require('fs');
const SCRATCH = '/Users/pearl/TripleJ/2_housing/scratchpad';
const LOG = SCRATCH + '/v3144e.log';
function log(...a){const l=`[${new Date().toISOString()}] `+a.map(x=>typeof x==='string'?x:JSON.stringify(x)).join(' ');fs.appendFileSync(LOG,l+'\n');console.log(l);}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  fs.writeFileSync(LOG,'');
  const browser=await chromium.launch({headless:true});
  const page=await (await browser.newContext({viewport:{width:480,height:920}})).newPage();
  const consoleLines=[];
  page.on('console',m=>{const t=m.text();consoleLines.push(t);if(/ComposeLyricsPick|MusicGeneration] 장르/.test(t))log('[console]',t.slice(0,160));});
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

  // ── 대표 케이스 재현: 어긋난 작업본을 localStorage(AsyncStorage 웹 백엔드)에 주입 ──
  // 제목 = 서버 자산 '여름 바다로 (수정판)'과 동일, 내용 = 살짝 수정(드리프트), 장르/분위기/출처 없음
  await page.evaluate(()=>{
    const draft = {
      state: {
        genre:'', mood:'', content:'', perspective:'', language:'한국어 100%', structure:'',
        keywords:'', duration:120, hasRap:false, isDuet:false, reference:'', tempo:'보통',
        generatedTitle:'여름 바다로 (수정판)',
        generatedLyrics:'[Verse]\n파도가 부르는 소리 (드리프트 수정본)\n[Outro]\n어긋난 사본 검증 라인',
        sourceAssetId:'',
      },
      version: 0,
    };
    localStorage.setItem('aidol-lyrics-draft', JSON.stringify(draft));
  });
  log('어긋난 작업본 주입 완료 — 리로드');
  await page.reload();await page.getByText('차트',{exact:true}).first().waitFor({timeout:120000});
  await sleep(3000);await closePopups();await closePopups();
  await clickT('작업실');await sleep(2500);await closePopups();
  await clickT('작곡 디렉터');await sleep(2500);
  for(let i=0;i<6;i++){ if(await visible('가사 보기',1500,true))break; await page.mouse.click(240,600); await sleep(1200);}
  await page.screenshot({path:SCRATCH+'/v3144e_list.png'});

  // D1a: 방금 작사 카드에 장르·분위기 표시(제목 폴백 병합)
  const bodyTxt=await page.evaluate(()=>document.body.innerText);
  const draftShown=bodyTxt.includes('어긋난 사본 검증 라인')||bodyTxt.includes('방금 작사');
  const metaShown=bodyTxt.includes('댄스 · 밝고 경쾌한');
  // D1b: 병합된 자산의 이중 표시 제거 — '여름 바다로 (수정판)' 제목이 1회만
  const titleCount=(bodyTxt.match(/여름 바다로 \(수정판\)/g)||[]).length;
  const mergeLog=consoleLines.find(t=>t.includes('드래프트-자산 병합'));
  log('D1 드래프트 표시:',draftShown,'메타(댄스·밝고 경쾌한):',metaShown,'제목 표시 횟수:',titleCount,'병합 로그:',(mergeLog||'(없음)').slice(0,120));

  // D1c: 드래프트 선택 → 장르 질문 없이 진행(장르/분위기 실값 안내 후 아티스트 단계)
  await page.getByText('방금 작사',{exact:true}).last().click();await sleep(3500);
  if(await visible('제목 확인',8000,true)){await clickT('제목 확인');await sleep(1500);}
  if(await visible('가사 확인 완료',8000,true)){await clickT('가사 확인 완료');await sleep(3000);}
  const after=await page.evaluate(()=>document.body.innerText);
  const askedGenre=after.includes('장르 정보가 없네요');
  const announced=/장르: 댄스/.test(after);
  const genreWarn=consoleLines.some(t=>t.includes('장르 없음 — 선택 질문으로 전환'));
  await page.screenshot({path:SCRATCH+'/v3144e_after.png'});
  log('D1c 장르질문 발생:',askedGenre,'(콘솔 경고:',genreWarn,') 실값 안내:',announced);

  const pass=draftShown&&metaShown&&titleCount===1&&!askedGenre&&!genreWarn&&announced;
  log('RESULT:',pass?'PASS':'FAIL');
  await browser.close();
  log('DONE-v3144e');
})().catch(e=>{log('SCRIPT ERROR:',String(e&&e.stack||e).slice(0,900));process.exit(1);});
