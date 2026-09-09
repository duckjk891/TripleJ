// v3.150 E2E — 이미지 디렉터 대화 개편: J3 전체 흐름+페이로드 / J4 꾸미기 연동
const { chromium } = require('/Users/pearl/TripleJ/2_housing/node_modules/playwright');
const fs = require('fs');
const SCRATCH = '/Users/pearl/TripleJ/2_housing/scratchpad';
const LOG = SCRATCH + '/v3150e.log';
function log(...a){const l=`[${new Date().toISOString()}] `+a.map(x=>typeof x==='string'?x:JSON.stringify(x)).join(' ');fs.appendFileSync(LOG,l+'\n');console.log(l);}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const results={};
(async()=>{
  fs.writeFileSync(LOG,'');
  const browser=await chromium.launch({headless:true});
  const page=await (await browser.newContext({viewport:{width:480,height:920}})).newPage();
  let coverPayload=null;
  await page.route('**/api/upload/generate-cover',(route)=>{
    coverPayload=route.request().postData();
    log('[route] generate-cover 차단, payload 캡처');
    return route.abort();
  });
  page.on('console',m=>{const t=m.text();if(/\[Cover\]/.test(t))log('[console]',t.slice(0,130));});
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

  // 이미지 디렉터 진입
  await page.goto('http://localhost:8081');await page.getByText('차트',{exact:true}).first().waitFor({timeout:120000});
  await sleep(2500);await closePopups();
  await clickT('작업실');await sleep(2500);await closePopups();
  await clickT('이미지 디렉터');await sleep(2500);
  // 곡 선택
  await clickT('커버검증곡',{exact:false});await sleep(2000);
  await clickT('네, 아티스트 포함');await sleep(2000);
  // J4: 의상 확인 — 미리보기 + 꾸미기 연동
  const wardrobeQ=await visible('이 의상 그대로 커버를 만들까요',4000,false);
  await page.screenshot({path:SCRATCH+'/v3150e_wardrobe.png'});
  await clickT('👗 의상 바꾸러 가기 (아티스트 꾸미기)');await sleep(3000);
  const codyEntered=await page.evaluate(()=>document.body.innerText).then(b=>/옷 입히기|카테고리를 골라보세요|이 옷으로 입히기/.test(b));
  await page.screenshot({path:SCRATCH+'/v3150e_cody.png'});
  await page.goBack();await sleep(2500);
  const backAtWardrobe=await visible('이 의상 그대로 갈게요',5000,true);
  results.J4=wardrobeQ&&codyEntered&&backAtWardrobe?'PASS':'FAIL';
  log('J4 의상질문:',wardrobeQ,'꾸미기 진입:',codyEntered,'복귀 유지:',backAtWardrobe);

  // J3: 이어서 전체 흐름
  await clickT('이 의상 그대로 갈게요');await sleep(1800);
  const shotQ=await visible('어떤 구도로 담을까요',4000,false);
  await clickT('반신');await sleep(1800);
  const bgQ=await visible('배경이나 장소 생각이 있나요',4000,false);
  await page.getByPlaceholder('말로 설명... (예: 노을 지는 한강 다리 위)').fill('보라색 스튜디오 배경');
  await clickT('확인');await sleep(1800);
  const palQ=await visible('색감이나 톤은 어떻게 할까요',4000,false);
  await clickT('다크 무디');await sleep(1800);
  const lyrQ=await visible('가사의 장면을 참고해서 만들까요',4000,false);
  await clickT('건너뛰기');await sleep(1800);
  const finalQ=await visible('자유롭게 말해주세요',4000,false);
  await page.screenshot({path:SCRATCH+'/v3150e_final.png'});
  await clickT('이대로 만들기 (건너뛰기)');await sleep(4000);
  let payloadOk=false;
  if(coverPayload){
    const p=JSON.parse(coverPayload);
    payloadOk=p.shot==='반신'&&p.palette==='다크 무디'&&p.background_prompt==='보라색 스튜디오 배경'&&!p.genre&&!p.mood;
    log('payload:',JSON.stringify(p).slice(0,300));
  }
  results.J3=shotQ&&bgQ&&palQ&&lyrQ&&finalQ&&payloadOk?'PASS':'FAIL';
  log('J3 구도Q:',shotQ,'배경Q:',bgQ,'색감Q:',palQ,'가사Q:',lyrQ,'최종Q:',finalQ,'페이로드:',payloadOk);
  await page.screenshot({path:SCRATCH+'/v3150e_done.png'});

  log('RESULTS:',results);
  await browser.close();
  log('DONE-v3150e');
})().catch(e=>{log('SCRIPT ERROR:',String(e&&e.stack||e).slice(0,900));process.exit(1);});
