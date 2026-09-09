// v3.151 E2E — 커버 질문 재편(가사 우선)·되감기·자유입력 예시
const { chromium } = require('/Users/pearl/TripleJ/2_housing/node_modules/playwright');
const fs = require('fs');
const SCRATCH = '/Users/pearl/TripleJ/2_housing/scratchpad';
const LOG = SCRATCH + '/v3152e.log';
function log(...a){const l=`[${new Date().toISOString()}] `+a.map(x=>typeof x==='string'?x:JSON.stringify(x)).join(' ');fs.appendFileSync(LOG,l+'\n');console.log(l);}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const results={};
(async()=>{
  fs.writeFileSync(LOG,'');
  const browser=await chromium.launch({headless:true});
  const page=await (await browser.newContext({viewport:{width:480,height:920}})).newPage();
  let coverPayload=null;
  await page.route('**/api/upload/generate-cover',(route)=>{coverPayload=route.request().postData();log('[route] generate-cover 차단·캡처');return route.abort();});
  page.on('console',m=>{const t=m.text();if(/\[Cover\]/.test(t))log('[console]',t.slice(0,130));});
  const visible=async(t,to=3000,e=true)=>{try{await page.getByText(t,{exact:e}).last().waitFor({state:'visible',timeout:to});return true;}catch{return false;}};
  const clickT=async(t,o={})=>{const l=page.getByText(t,{exact:o.exact!==false}).last();await l.waitFor({state:'visible',timeout:o.timeout||15000});await l.click();log('clicked:',t);};
  const closePopups=async()=>{for(const t of ['✕','닫기','나중에']){try{if(await visible(t,700)){await page.getByText(t,{exact:true}).last().click();await sleep(500);}}catch{}}};
  const enterDirector=async()=>{
    await page.goto('http://localhost:8081');await page.getByText('차트',{exact:true}).first().waitFor({timeout:120000});
    await sleep(2500);await closePopups();
    await clickT('작업실');await sleep(2500);await closePopups();
    await clickT('이미지 디렉터');await sleep(2500);
    await clickT('커버검증곡',{exact:false});await sleep(2000);
    await clickT('네, 아티스트 포함');await sleep(2000);
    await clickT('이 의상 그대로 갈게요');await sleep(1800);
  };

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

  // ── K1: 가사 미포함 경로 + 되감기 ──
  await enterDirector();
  const lyrQfirst=await visible('가사 내용을 반영해서 만들까요',4000,false);
  await clickT('아니요, 직접 정할게요 (구도·배경·색감)');await sleep(1800);
  const shotQ=await visible('어떤 구도로 담을까요',4000,false);
  await clickT('반신');await sleep(1800);
  // 되감기: '반신' 답변 탭 → 취소(K3) → 다시 탭 → 다시 선택 → '전신'
  await page.getByText('반신',{exact:true}).last().click();await sleep(900);
  const confirm1=await visible('이 답변부터 다시 할까요?',3000,false);
  await clickT('취소');await sleep(900);
  const stillBg=await visible('배경이나 장소 생각이 있나요',3000,false);
  results.K3=confirm1&&stillBg?'PASS':'FAIL';
  log('K3 취소:',confirm1,stillBg);
  await page.getByText('반신',{exact:true}).last().click();await sleep(900);
  await clickT('다시 선택');await sleep(1500);
  const reQ=await visible('어떤 구도로 담을까요',4000,false);
  await clickT('전신');await sleep(1800);
  await page.getByPlaceholder('말로 설명... (예: 노을 지는 한강 다리 위)').fill('보라색 스튜디오');
  await clickT('확인');await sleep(1800);
  await clickT('다크 무디');await sleep(1800);
  const exampleHint=await page.evaluate(()=>document.body.innerText).then(b=>b.includes('보라색 배경에 아티스트가 점프하는 모습'));
  await page.screenshot({path:SCRATCH+'/v3151e_final.png'});
  await clickT('이대로 만들기 (건너뛰기)');await sleep(4000);
  let k1Payload=false;
  if(coverPayload){const p=JSON.parse(coverPayload);k1Payload=p.shot==='전신'&&p.palette==='다크 무디'&&p.background_prompt==='보라색 스튜디오'&&!p.lyrics_excerpt&&p.character_kind==='real';log('K1 payload:',JSON.stringify(p).slice(0,260));}
  results.K1=lyrQfirst&&shotQ&&reQ&&exampleHint&&k1Payload?'PASS':'FAIL';
  log('K1 가사질문 선행:',lyrQfirst,'구도Q:',shotQ,'되감기 재질문:',reQ,'예시 노출:',exampleHint,'페이로드(전신):',k1Payload);

  // ── K2: 가사 반영 경로 — 디테일 질문 생략 ──
  coverPayload=null;
  await enterDirector();
  await clickT('🎵 가사 내용 반영하기');await sleep(3500);
  const bodyK2=await page.evaluate(()=>document.body.innerText);
  const noDetailQ=!bodyK2.includes('어떤 구도로 담을까요');
  const finalQ=bodyK2.includes('자유롭게 적어주세요');
  await page.screenshot({path:SCRATCH+'/v3151e_k2.png'});
  await clickT('이대로 만들기 (건너뛰기)');await sleep(4000);
  let k2Payload=false;
  if(coverPayload){const p=JSON.parse(coverPayload);k2Payload=!!p.lyrics_excerpt&&!p.shot&&!p.palette&&p.character_kind==='real'&&!p.character_art_style;log('K2 payload lyrics len:',(p.lyrics_excerpt||'').length,'kind:',p.character_kind,'style:',p.character_art_style||null);}
  results.K2=noDetailQ&&finalQ&&k2Payload?'PASS':'FAIL';
  log('K2 디테일 생략:',noDetailQ,'최종 직행:',finalQ,'페이로드(가사):',k2Payload);

  log('RESULTS:',results);
  await browser.close();
  log('DONE-v3152e');
})().catch(e=>{log('SCRIPT ERROR:',String(e&&e.stack||e).slice(0,900));process.exit(1);});
