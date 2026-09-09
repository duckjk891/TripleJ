// v3.143 E2E — 아티스트 목소리 필수·간편 프리셋 자동반영 + 무아티스트 성별→목소리 2질문
// E2: 미연결 아티스트 선택 차단 / E3: 간편 프리셋 자동 반영 / E1: 성별→목소리(간편/내목소리) /
// E5: 내 목소리 목록에서 돌아가기 → 목소리 질문 복귀 / step12 자동 통과 멘트 확인.
// 실제 작곡 POST 는 route abort 로 차단.
const { chromium } = require('/Users/pearl/TripleJ/2_housing/node_modules/playwright');
const fs = require('fs');
const SCRATCH = '/Users/pearl/TripleJ/2_housing/scratchpad';
const LOG = SCRATCH + '/v3143e.log';
const API = 'http://100.127.225.55:9004/api';
const CID = '9c3a65b471dc433bbec07c02d6d54b28';
function log(...a){const l=`[${new Date().toISOString()}] `+a.map(x=>typeof x==='string'?x:JSON.stringify(x)).join(' ');fs.appendFileSync(LOG,l+'\n');console.log(l);}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const results={};

async function apiLogin(){
  const r=await fetch(`${API}/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'teamdev_v228bg_qepfra@test.local',password:'Teamdev1234!'})});
  return (await r.json()).token;
}
async function patchVoicePreset(tok,val){
  const r=await fetch(`${API}/character/${CID}`,{method:'PATCH',headers:{'Content-Type':'application/json',Authorization:'Bearer '+tok},body:JSON.stringify({voice_preset:val})});
  log('[api] PATCH voice_preset=',JSON.stringify(val),'status',r.status);
  return r.status;
}

(async()=>{
  fs.writeFileSync(LOG,'');
  const tok=await apiLogin();
  const browser=await chromium.launch({headless:true});
  const page=await (await browser.newContext({viewport:{width:480,height:920}})).newPage();
  await page.route('**/api/generate/**',(route)=>{
    const req=route.request();
    if(req.method()==='POST' && !/translate-tags|lyrics/.test(req.url())){log('[route] 작곡 POST 차단');return route.abort();}
    route.continue();
  });
  page.on('console',m=>{const t=m.text();if(/MusicGeneration|ArtistResult/.test(t))log('[console]',t.slice(0,140));});
  const visible=async(t,to=3000,e=true)=>{try{await page.getByText(t,{exact:e}).last().waitFor({state:'visible',timeout:to});return true;}catch{return false;}};
  const clickT=async(t,o={})=>{const l=page.getByText(t,{exact:o.exact!==false}).last();await l.waitFor({state:'visible',timeout:o.timeout||15000});await l.click();log('clicked:',t);};
  const closePopups=async()=>{for(const t of ['✕','닫기','나중에']){try{if(await visible(t,700)){await page.getByText(t,{exact:true}).last().click();await sleep(500);}}catch{}}};

  // 로그인 1회
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

  // 작곡 디렉터 진입 → step 200 도달 공통 루틴
  const enterComposeToArtistStep=async(tag)=>{
    await page.goto('http://localhost:8081',{timeout:60000});
    await page.getByText('차트',{exact:true}).first().waitFor({timeout:120000});
    await sleep(2500);await closePopups();
    await clickT('작업실');await sleep(2500);await closePopups();
    await clickT('작곡 디렉터');await sleep(2000);
    for(let i=0;i<6;i++){ if(await visible('가사 보기',1500,true))break; await page.mouse.click(240,600); await sleep(1200);}
    await page.getByText('여름 바다로',{exact:false}).last().click();await sleep(3500);
    if(await visible('제목 확인',8000,true)){await clickT('제목 확인');await sleep(1500);}
    if(await visible('가사 확인 완료',8000,true)){await clickT('가사 확인 완료');await sleep(2500);}
    // 장르/분위기 질문 폴백
    for(const g of ['팝','록']){try{if(await visible('어떤 장르로 작곡할까요',1200,false)){await clickT(g);await sleep(1500);break;}}catch{}}
    try{if(await visible('분위기는 어떻게 할까요',1500,false)){const b=page.getByText('신나는',{exact:false}).last();if(await b.isVisible({timeout:800}).catch(()=>false)){await b.click();}else{await page.locator('div,button').filter({hasText:/^1/}).last().click();}await sleep(1500);}}catch{}
    await sleep(2000);
    const ok=await visible('함께할 아티스트를 선택해주세요',9000,false);
    log(tag,'step200 도달:',ok);
    return ok;
  };

  // ── E2: 목소리 미연결 아티스트 선택 차단 ──
  await patchVoicePreset(tok,'');
  if(await enterComposeToArtistStep('E2')){
    const tagShown=await visible('목소리 미연결',4000,false);
    await clickT('리얼검증',{exact:false});await sleep(1500);
    const blocked=await visible('목소리 연결이 필요해요',4000,false);
    results.E2=tagShown&&blocked?'PASS':'FAIL';
    log('E2 미연결태그:',tagShown,'차단다이얼로그:',blocked);
    await page.screenshot({path:SCRATCH+'/v3143e_e2.png'});
    for(const t of ['확인','닫기']){try{if(await visible(t,1000)){await page.getByText(t,{exact:true}).last().click();break;}}catch{}}
  } else { results.E2='FAIL(진입불가)'; }

  // ── E3: 간편 프리셋 연결 아티스트 → 자동 반영 ──
  await patchVoicePreset(tok,'female:소프트');
  if(await enterComposeToArtistStep('E3')){
    const tagShown=await visible('간편 목소리 · 여성 소프트',4000,false);
    await clickT('리얼검증',{exact:false});await sleep(2000);
    const applied=await visible('간편 목소리(여성 · 소프트)를 자동으로 반영할게요',5000,false);
    results.E3=tagShown&&applied?'PASS':'FAIL';
    log('E3 카드태그:',tagShown,'자동반영멘트:',applied);
    await page.screenshot({path:SCRATCH+'/v3143e_e3.png'});
  } else { results.E3='FAIL(진입불가)'; }

  // ── E1+E5: 무아티스트 — 성별→목소리 질문, 내 목소리 목록↔돌아가기, 간편 진행 ──
  if(await enterComposeToArtistStep('E1')){
    await clickT('아티스트 없이 진행 (건너뛰기)');await sleep(1800);
    const genderQ=await visible('보컬', 4000, false);
    const noMyVoiceInGender=!(await visible('🎤 내 목소리로 만들기',1500,true));
    log('E1 성별질문:',genderQ,'성별지문에 내목소리 없음:',noMyVoiceInGender);
    await clickT('여성');await sleep(1800);
    const voiceQ=await visible('간편 목소리 (보컬 스타일 선택)',5000,true);
    await page.screenshot({path:SCRATCH+'/v3143e_e1_voiceq.png'});
    // E5: 내 목소리 → 목록(목클론) → 돌아가기 → 질문 복귀
    await clickT('🎤 내 목소리 (클로닝한 목소리)');await sleep(2500);
    const cloneListed=await visible('목클론v3143',6000,false);
    await clickT('돌아가기 (목소리 다시 선택)');await sleep(1800);
    const backToQ=await visible('간편 목소리 (보컬 스타일 선택)',5000,true);
    results.E5=cloneListed&&backToQ?'PASS':'FAIL';
    log('E5 클론목록:',cloneListed,'질문복귀:',backToQ);
    // 간편 → 스타일 → 이후 자동 진행하며 step12 스킵 멘트 확인
    await clickT('간편 목소리 (보컬 스타일 선택)');await sleep(1800);
    const styleQ=await visible('소프트',5000,true);
    if(styleQ){await clickT('소프트');await sleep(1500);}
    results.E1=genderQ&&noMyVoiceInGender&&voiceQ&&styleQ?'PASS':'FAIL';
    log('E1 목소리질문:',voiceQ,'스타일칩:',styleQ);
    // 자동 진행 루프 (v3134e 패턴)
    const FULL=['음악 생성 시작','건너뛰기','자동으로 맡길게요','이대로 갈게요','자동 템포','자동 키','확인'];
    let CANDS=[...FULL],lastC='',streak=0,lastProgress='';
    let skipMsgSeen=false;
    for(let r=0;r<40;r++){
      const body=await page.evaluate(()=>document.body.innerText);
      if(body.includes('목소리는 이미 정해져 있어서')) skipMsgSeen=true;
      if(/모든 설정이 완료됐어요|음악을 만들어볼까요/.test(body)){log('최종 도달 round',r);break;}
      const m=body.match(/(\d+) \/ 13/);const prog=m?m[1]:'';
      if(prog!==lastProgress){lastProgress=prog;CANDS=[...FULL];lastC='';streak=0;}
      let clicked=false;
      for(const c of CANDS){
        try{
          const loc=page.getByText(c,{exact:true}).last();
          if(await loc.isVisible({timeout:400}).catch(()=>false)){
            await loc.click();log('round',r,'clicked:',c);clicked=true;
            if(c===lastC){streak++;}else{lastC=c;streak=1;}
            if(streak>=3){CANDS=CANDS.filter(x=>x!==c);}
            break;
          }
        }catch{}
      }
      if(!clicked){log('round',r,'no candidate — tail:',body.slice(-300).replace(/\n/g,'|'));await page.screenshot({path:SCRATCH+`/v3143e_stuck_${r}.png`});break;}
      await sleep(1300);
    }
    const finalBody=await page.evaluate(()=>document.body.innerText);
    if(finalBody.includes('목소리는 이미 정해져 있어서')) skipMsgSeen=true;
    results.STEP12_SKIP=skipMsgSeen?'PASS':'FAIL';
    log('step12 스킵 멘트:',skipMsgSeen);
    await page.screenshot({path:SCRATCH+'/v3143e_e1_final.png'});
  } else { results.E1='FAIL(진입불가)'; results.E5='FAIL(진입불가)'; }

  log('RESULTS:',results);
  await browser.close();
  log('DONE-v3143e');
})().catch(e=>{log('SCRIPT ERROR:',String(e&&e.stack||e).slice(0,900));process.exit(1);});
