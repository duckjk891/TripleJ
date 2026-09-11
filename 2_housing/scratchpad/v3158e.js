// v3.158 E2E — ①가수·기획사 한 줄 병기(y좌표 동일) ②내 채널 작성 숏컷(본인 표시→마이페이지 이동, 타인 미표시)
const { chromium } = require('/Users/pearl/TripleJ/2_housing/node_modules/playwright');
const fs = require('fs');
const SCRATCH='/Users/pearl/TripleJ/2_housing/scratchpad';
const LOG=SCRATCH+'/v3158e.log';
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
  // 로그인
  await clickT('작업실');await sleep(2000);
  if(!(await visible('로그인하고 시작하기',2000))){await page.mouse.click(240,460);await sleep(1200);}
  await clickT('로그인하고 시작하기');await sleep(1800);
  await page.getByPlaceholder('이메일을 입력하세요').fill('teamdev_v228bg_qepfra@test.local');
  await page.getByPlaceholder('비밀번호를 입력하세요').fill('Teamdev1234!');
  await page.getByText('로그인',{exact:true}).last().click();await sleep(4000);await closePopups();

  // ── L1: CEO 곡 — 펄킴·lovvepearl 한 줄(y좌표 동일) ──
  await clickT('차트');await sleep(2500);await closePopups();
  await page.getByText('더 나오려는 것을 막는 것일뿐',{exact:false}).last().click();await sleep(4000);
  const bbA=await page.getByText('펄킴',{exact:true}).last().boundingBox();
  const bbG=await page.getByText('lovvepearl',{exact:false}).last().boundingBox();
  const sameLine=bbA&&bbG&&Math.abs(bbA.y-bbG.y)<6;
  R.L1=!!sameLine;
  await page.screenshot({path:SCRATCH+'/v3158e_np.png'});
  log('L1 한줄 병기:',R.L1,{aY:bbA&&bbA.y,gY:bbG&&bbG.y});

  // ── L2: 타인 채널(대표 채널) — 숏컷 미표시 ──
  await page.getByText('lovvepearl',{exact:false}).last().click();await sleep(3000);
  await clickT('피드',{exact:false});await sleep(1500);
  const shortcutOnOthers=await visible('작성은 마이페이지에서',2000,false);
  R.L2=!shortcutOnOthers;
  await page.screenshot({path:SCRATCH+'/v3158e_other.png'});
  log('L2 타인 채널 숏컷 미표시:',R.L2);
  await page.goBack();await sleep(1500);
  await page.getByText('✕',{exact:true}).last().click().catch(()=>{});await sleep(1200);

  // ── L3: 내 채널 — 숏컷 표시 + 탭 → 마이페이지 ──
  await page.getByLabel('마이페이지').last().click().catch(async()=>{const bb=await page.getByLabel('마이페이지').last().boundingBox();if(bb)await page.mouse.click(bb.x+bb.width/2,bb.y+bb.height/2);});
  await sleep(2500);
  await page.getByText('v3158 채널숏컷검증',{exact:false}).last().click();await sleep(3500);
  // 픽스처 곡 — 아티스트=리얼검증·기획사=팀데브bg_qepfra 한 줄, 기획사 탭 → 내 채널
  await page.getByText('팀데브bg_qepfra',{exact:false}).last().click();await sleep(3000);
  await clickT('피드',{exact:false});await sleep(1500);
  const shortcutOnMine=await visible('작성은 마이페이지에서',3000,false);
  await page.screenshot({path:SCRATCH+'/v3158e_mine.png'});
  let landed=false;
  if(shortcutOnMine){
    await page.getByText('작성하러 가기',{exact:false}).last().click();await sleep(2500);
    landed=await visible('마이페이지',4000,true)||await visible('새 피드 작성',3000,false);
  }
  R.L3=shortcutOnMine&&landed;
  await page.screenshot({path:SCRATCH+'/v3158e_landed.png'});
  log('L3 내 채널 숏컷·이동:',R.L3,{shortcutOnMine,landed});

  log('RESULTS:',Object.fromEntries(Object.entries(R).map(([k,v])=>[k,v?'PASS':'FAIL'])));
  await browser.close();
})().catch(e=>{log('SCRIPT ERROR:',String(e&&e.stack||e).slice(0,500));process.exit(1);});
