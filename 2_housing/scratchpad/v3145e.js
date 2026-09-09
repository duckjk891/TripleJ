// v3.145 E2E — F1: 고아 작업본 자동 자산화 + 장르/분위기 질문 경로
//              F2: 장르/분위기 확인 질문(step 302) '네' → 그대로 진행
//              F3: '아니요' → 장르·분위기 재선택(작곡 선택 우선)
const { chromium } = require('/Users/pearl/TripleJ/2_housing/node_modules/playwright');
const fs = require('fs');
const SCRATCH = '/Users/pearl/TripleJ/2_housing/scratchpad';
const LOG = SCRATCH + '/v3145e.log';
const API = 'http://100.127.225.55:9004/api';
function log(...a){const l=`[${new Date().toISOString()}] `+a.map(x=>typeof x==='string'?x:JSON.stringify(x)).join(' ');fs.appendFileSync(LOG,l+'\n');console.log(l);}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const results={};
(async()=>{
  fs.writeFileSync(LOG,'');
  const browser=await chromium.launch({headless:true});
  const page=await (await browser.newContext({viewport:{width:480,height:920}})).newPage();
  const consoleLines=[];
  page.on('console',m=>{const t=m.text();consoleLines.push(t);if(/ComposeLyricsPick|MusicGeneration\]/.test(t))log('[console]',t.slice(0,150));});
  const visible=async(t,to=3000,e=true)=>{try{await page.getByText(t,{exact:e}).last().waitFor({state:'visible',timeout:to});return true;}catch{return false;}};
  const clickT=async(t,o={})=>{const l=page.getByText(t,{exact:o.exact!==false}).last();await l.waitFor({state:'visible',timeout:o.timeout||15000});await l.click();log('clicked:',t);};
  const closePopups=async()=>{for(const t of ['✕','닫기','나중에']){try{if(await visible(t,700)){await page.getByText(t,{exact:true}).last().click();await sleep(500);}}catch{}}};
  const setDraft=async(obj)=>{await page.evaluate((o)=>{
    const base={genre:'',mood:'',content:'',perspective:'',language:'한국어 100%',structure:'',keywords:'',duration:120,hasRap:false,isDuet:false,reference:'',tempo:'보통',generatedTitle:'',generatedLyrics:'',sourceAssetId:''};
    localStorage.setItem('aidol-lyrics-draft',JSON.stringify({state:{...base,...o},version:0}));
  },obj);};
  const enterCompose=async()=>{
    await page.goto('http://localhost:8081',{timeout:60000});
    await page.getByText('차트',{exact:true}).first().waitFor({timeout:120000});
    await sleep(2500);await closePopups();await closePopups();
    await clickT('작업실');await sleep(2500);await closePopups();
    await clickT('작곡 디렉터');await sleep(2500);
    for(let i=0;i<6;i++){ if(await visible('가사 보기',1500,true))break; await page.mouse.click(240,600); await sleep(1200);}
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
  await closePopups();

  // ── F1: 고아 작업본(제목·내용 모두 DB에 없음, 장르/분위기 없음) ──
  await setDraft({generatedTitle:'고아검증v3145',generatedLyrics:'[Verse]\n고아 작업본 자산화 검증\n[Outro]\n유일무이 라인 v3145'});
  await enterCompose();
  await sleep(1500);
  const orphanSaved=consoleLines.some(t=>t.includes('고아 작업본 자산화')&&!t.includes('실패'));
  await clickT('방금 작사');await sleep(3000);
  if(await visible('제목 확인',8000,true)){await clickT('제목 확인');await sleep(1500);}
  if(await visible('가사 확인 완료',8000,true)){await clickT('가사 확인 완료');await sleep(2500);}
  const f1body=await page.evaluate(()=>document.body.innerText);
  const askedGenre=f1body.includes('장르 정보가 없네요');
  if(askedGenre&&await visible('댄스',3000,true)){await clickT('댄스');await sleep(1800);}
  if(await visible('분위기는 어떻게 할까요',3000,false)){await clickT('흥겹고 신나는');await sleep(2000);}
  const f1after=await page.evaluate(()=>document.body.innerText);
  const f1artist=/함께할 아티스트|보컬/.test(f1after);
  results.F1=orphanSaved&&askedGenre&&f1artist?'PASS':'FAIL';
  log('F1 자산화:',orphanSaved,'장르질문:',askedGenre,'아티스트/보컬 진행:',f1artist);
  await page.screenshot({path:SCRATCH+'/v3145e_f1.png'});

  // ── F2: 장르/분위기 있는 자산 선택 → 302 확인 질문 → '네' ──
  await setDraft({});
  await enterCompose();
  await clickT('여름 바다로',{exact:false});await sleep(3000);
  if(await visible('제목 확인',8000,true)){await clickT('제목 확인');await sleep(1500);}
  if(await visible('가사 확인 완료',8000,true)){await clickT('가사 확인 완료');await sleep(2500);}
  const f2q=await visible('이 느낌 그대로 작곡할까요',5000,false);
  await page.screenshot({path:SCRATCH+'/v3145e_f2q.png'});
  await clickT('네, 이대로 갈게요');await sleep(3500);
  const f2body=await page.evaluate(()=>document.body.innerText);
  const f2ok=/확인! \(댄스, 밝고 경쾌한/.test(f2body)&&/함께할 아티스트|보컬/.test(f2body);
  results.F2=f2q&&f2ok?'PASS':'FAIL';
  log('F2 확인질문:',f2q,'유지 진행:',f2ok);
  if(!f2ok) log('F2 body tail:',f2body.slice(-600).replace(/\n/g,'|'));
  await page.screenshot({path:SCRATCH+'/v3145e_f2after.png'});

  // ── F3: '아니요' → 장르·분위기 재선택 우선 ──
  await setDraft({});
  await enterCompose();
  await clickT('여름 바다로',{exact:false});await sleep(3000);
  if(await visible('제목 확인',8000,true)){await clickT('제목 확인');await sleep(1500);}
  if(await visible('가사 확인 완료',8000,true)){await clickT('가사 확인 완료');await sleep(2500);}
  await clickT('아니요, 다른 장르·분위기로 만들래요');await sleep(1800);
  const f3genreQ=await visible('어떤 장르로 만들까요',4000,false);
  await clickT('발라드');await sleep(1800);
  const f3moodQ=await visible('분위기는 어떻게 할까요',4000,false);
  await clickT('잔잔하고 편안한');await sleep(2200);
  const f3body=await page.evaluate(()=>document.body.innerText);
  const f3ok=/분위기: 잔잔하고 편안한/.test(f3body)&&/함께할 아티스트|보컬/.test(f3body);
  results.F3=f3genreQ&&f3moodQ&&f3ok?'PASS':'FAIL';
  log('F3 장르질문:',f3genreQ,'분위기질문:',f3moodQ,'재선택 진행:',f3ok);
  await page.screenshot({path:SCRATCH+'/v3145e_f3.png'});

  // 정리: F1 고아 자산 삭제 (테스트 계정 오염 방지)
  try{
    const lr=await fetch(`${API}/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'teamdev_v228bg_qepfra@test.local',password:'Teamdev1234!'})});
    const tok=(await lr.json()).token;
    const list=await (await fetch(`${API}/lyrics`,{headers:{Authorization:'Bearer '+tok}})).json();
    for(const it of (list.items||[]).filter(i=>i.title==='고아검증v3145')){
      await fetch(`${API}/lyrics/${it.lyrics_id}`,{method:'DELETE',headers:{Authorization:'Bearer '+tok}});
      log('정리: 고아검증v3145 자산 삭제', it.lyrics_id);
    }
  }catch(e){log('정리 실패(수동 확인 필요):',String(e).slice(0,120));}

  log('RESULTS:',results);
  await browser.close();
  log('DONE-v3145e');
})().catch(e=>{log('SCRIPT ERROR:',String(e&&e.stack||e).slice(0,900));process.exit(1);});
