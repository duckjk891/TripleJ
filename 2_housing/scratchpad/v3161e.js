// v3.161 E2E — 커버: 잘림 없는 정사각, 기존 210보다 크게(coverH), 하단 토글 보존(920/760)
const { chromium } = require('/Users/pearl/TripleJ/2_housing/node_modules/playwright');
const fs=require('fs');
const SCRATCH='/Users/pearl/TripleJ/2_housing/scratchpad';
const log=(...a)=>{const l=a.map(x=>typeof x==='string'?x:JSON.stringify(x)).join(' ');fs.appendFileSync(SCRATCH+'/v3161e.log',l+'\n');console.log(l);};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function checkAt(browser,H){
  const page=await (await browser.newContext({viewport:{width:480,height:H}})).newPage();
  await page.goto('http://localhost:8081',{timeout:120000});
  await page.getByText('차트',{exact:true}).first().waitFor({timeout:180000});
  await sleep(3000);
  for(const t of ['✕','닫기','나중에']){try{await page.getByText(t,{exact:true}).last().click({timeout:700});await sleep(400);}catch{}}
  await page.getByText('더 나오려는 것을 막는 것일뿐',{exact:false}).last().click();await sleep(4000);
  const img=await page.evaluate(()=>{const im=[...document.querySelectorAll('img')].filter(i=>i.src.includes('cover-preview')&&i.clientWidth>100);return im.length?{w:im[0].clientWidth,h:im[0].clientHeight}:null;});
  const toggle=await page.getByText('가사 · 프롬프트 · 착장',{exact:false}).last().boundingBox();
  await page.screenshot({path:SCRATCH+`/v3161e_${H}.png`});
  const square=img&&Math.abs(img.w-img.h)<4;
  const bigger=img&&img.w>210;
  const toggleOk=!!toggle&&toggle.y+toggle.height<=H;
  return {H,img,square,bigger,toggleOk,toggleY:toggle&&Math.round(toggle.y)};
}
(async()=>{
  fs.writeFileSync(SCRATCH+'/v3161e.log','');
  const browser=await chromium.launch({headless:true});
  const a=await checkAt(browser,920); log('920:',a);
  const b=await checkAt(browser,760); log('760:',b);
  const pass=a.square&&a.bigger&&a.toggleOk&&b.square&&b.toggleOk;
  log('RESULTS:',{pass:pass?'PASS':'FAIL'});
  await browser.close();
})().catch(e=>{log('ERR',String(e).slice(0,300));process.exit(1);});
