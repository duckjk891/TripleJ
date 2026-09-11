// v3.166 E2E — 프롬프트 탭: '작곡 프롬프트'→'이야기' + 이야기 내용 표시 + 핵심 파라미터 유지
const { chromium } = require('/Users/pearl/TripleJ/2_housing/node_modules/playwright');
const fs=require('fs');
const SCRATCH='/Users/pearl/TripleJ/2_housing/scratchpad';
const log=(...a)=>{const l=a.map(x=>typeof x==='string'?x:JSON.stringify(x)).join(' ');fs.appendFileSync(SCRATCH+'/v3166e.log',l+'\n');console.log(l);};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  fs.writeFileSync(SCRATCH+'/v3166e.log','');
  const browser=await chromium.launch({headless:true});
  const page=await (await browser.newContext({viewport:{width:480,height:920}})).newPage();
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
  // 마이페이지 → 픽스처 재생 → 프롬프트 탭
  try{await page.getByLabel('마이페이지').last().click({timeout:5000});}catch{const bb=await page.getByLabel('마이페이지').last().boundingBox();if(bb)await page.mouse.click(bb.x+bb.width/2,bb.y+bb.height/2);}
  await sleep(2500);
  await page.getByText('v3166 이야기검증',{exact:false}).last().click();await sleep(3500);
  await clickT('가사 · 프롬프트 · 착장',{exact:false});await sleep(1500);
  await clickT('프롬프트');await sleep(1500);
  const storyTitle=await visible('이야기',3000,true);
  const oldTitle=await visible('작곡 프롬프트',1500,false);   // 없어야
  const storyBody=await visible('주제: 우리집 고양이',3000,false);
  const keyword=await visible('꼭 들어갈 말: 잘지냈냥',3000,false);
  const chips=await visible('핵심 파라미터',3000,true);
  await page.screenshot({path:SCRATCH+'/v3166e_story.png'});
  const pass=storyTitle&&!oldTitle&&storyBody&&keyword&&chips;
  log('RESULTS:',{pass:pass?'PASS':'FAIL',storyTitle,oldTitle,storyBody,keyword,chips});
  await browser.close();
})().catch(e=>{log('ERR',String(e).slice(0,400));process.exit(1);});
