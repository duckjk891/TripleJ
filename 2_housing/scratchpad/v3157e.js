// v3.157 E2E — NowPlaying: 출처줄(목소리/가사) 제거·비트 토글 제거·3단 표기(제목/가수/기획사) 유지 회귀
const { chromium } = require('/Users/pearl/TripleJ/2_housing/node_modules/playwright');
const fs = require('fs');
const SCRATCH='/Users/pearl/TripleJ/2_housing/scratchpad';
const LOG=SCRATCH+'/v3157e.log';
function log(...a){const l=`[${new Date().toISOString()}] `+a.map(x=>typeof x==='string'?x:JSON.stringify(x)).join(' ');fs.appendFileSync(LOG,l+'\n');console.log(l);}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  fs.writeFileSync(LOG,'');
  const browser=await chromium.launch({headless:true});
  const page=await (await browser.newContext({viewport:{width:480,height:920}})).newPage();
  const visible=async(t,to=3000,e=true)=>{try{await page.getByText(t,{exact:e}).last().waitFor({state:'visible',timeout:to});return true;}catch{return false;}};
  await page.goto('http://localhost:8081',{timeout:120000});
  await page.getByText('차트',{exact:true}).first().waitFor({timeout:180000});
  await sleep(3000);
  for(const t of ['✕','닫기','나중에']){try{if(await visible(t,700)){await page.getByText(t,{exact:true}).last().click();await sleep(500);}}catch{}}
  await page.getByText('더 나오려는 것을 막는 것일뿐',{exact:false}).last().waitFor({timeout:10000});
  await page.getByText('더 나오려는 것을 막는 것일뿐',{exact:false}).last().click();await sleep(4000);
  const title=await visible('더 나오려는 것을 막는 것일뿐',6000,false);
  const artist=await visible('펄킴',3000,true);
  const agency=await visible('lovvepearl',3000,false);
  const beatGone=!(await visible('비트',1500,true));
  const voiceGone=!(await visible('목소리 테스트진주',1500,false));
  const lyricsMetaGone=!(await visible('(내 가사)',1500,false));
  await page.screenshot({path:SCRATCH+'/v3157e_np.png'});
  const pass=title&&artist&&agency&&beatGone&&voiceGone&&lyricsMetaGone;
  log('RESULTS:',{pass:pass?'PASS':'FAIL',title,artist,agency,beatGone,voiceGone,lyricsMetaGone});
  await browser.close();
})().catch(e=>{log('SCRIPT ERROR:',String(e).slice(0,400));process.exit(1);});
