import assert from 'node:assert/strict';
import {samples,readSample} from '../helpers/samples.js';
import {DRIVE_SCOPE} from '../../src/integrations/google-drive/api.js';
const DRIVE_FOLDER = 'test-drive-folder';

export async function testDriveBrowser(browser,baseURL) {
  const page=await browser.newPage({viewport:{width:1440,height:1000}}), errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  const names=samples.map(f=>f.name);
  const files=names.map((name,i)=>({id:'test_'+i,name,mimeType:i?'application/json':'text/javascript',size:'350000',modifiedTime:'2026-09-22T10:58:45Z',parents:[DRIVE_FOLDER],capabilities:{canDownload:true}}));
  let expired=false;
  await page.route('https://accounts.google.com/gsi/client',route=>route.fulfill({contentType:'text/javascript',body:`window.google={accounts:{oauth2:{initTokenClient:c=>({requestAccessToken:()=>setTimeout(()=>c.callback({access_token:'test-only-token',expires_in:3600,scope:'${DRIVE_SCOPE}'}),0)}),hasGrantedAllScopes:()=>true}}};`}));
  await page.route('https://www.googleapis.com/drive/v3/files**',async route=>{
    const url=new URL(route.request().url());
    assert.equal(route.request().headers().authorization,'Bearer test-only-token');
    assert.equal(url.searchParams.has('access_token'),false);
    if(expired)return route.fulfill({status:401,contentType:'application/json',body:'{"error":{}}'});
    const id=url.pathname.split('/').pop();
    let data;
    if(id===DRIVE_FOLDER)data={id:DRIVE_FOLDER,name:'棚卸データ',mimeType:'application/vnd.google-apps.folder'};
    else if(id==='files')data=url.searchParams.has('pageToken')?{files:files.slice(1)}:{nextPageToken:'next',files:[files[0],{...files[1],id:'blocked',name:'blocked.json',capabilities:{canDownload:false}}]};
    else{
      const f=files.find(f=>f.id===id);assert.ok(f);
      if(url.searchParams.get('alt')==='media')return route.fulfill({contentType:f.mimeType,body:readSample(f.name)});
      data=f;
    }
    return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
  });
  await page.goto(baseURL);
  await page.locator('#drive-panel>summary').click();
  await page.locator('#drive-connect').click();
  assert.match(await page.locator('#drive-message').textContent(),/DriveフォルダIDを入力/);
  await page.locator('#drive-folder-id').fill(DRIVE_FOLDER);
  await page.locator('#drive-connect').click();
  assert.match(await page.locator('#drive-message').textContent(),/クライアントIDを入力/);
  await page.locator('#drive-client-id').fill('123-test.apps.googleusercontent.com');
  await page.locator('#drive-connect').click();
  await page.waitForFunction(()=>document.querySelector('#drive-message').textContent.includes('4件の'));
  assert.equal(await page.locator('[data-select="blocked"]').isDisabled(),true);
  await page.locator('#drive-kind').selectOption('棚卸結果');
  assert.equal(await page.locator('#drive-list tbody tr').count(),2);
  await page.locator('#drive-kind').selectOption('');
  await page.locator('#drive-select-visible').click();
  assert.match(await page.locator('#drive-import').textContent(),/3件/);
  await page.locator('#drive-import').click();
  await page.waitForFunction(()=>document.querySelector('#drive-message').textContent.includes('3件を取り込みました'));
  assert.equal(await page.locator('#file-count').textContent(),'3');
  assert.match(await page.locator('#count').textContent(),/1,348/);
  const download=page.waitForEvent('download');await page.locator('[data-download="test_0"]').click();
  assert.equal((await download).suggestedFilename(),names[0]);
  await page.locator('#drive-select-visible').click();await page.locator('#drive-import').click();
  await page.waitForFunction(()=>document.querySelector('#drive-message').textContent.includes('同名ファイルは取込済み'));
  assert.equal(await page.locator('#file-count').textContent(),'3');
  assert.equal(await page.evaluate(()=>JSON.stringify(localStorage).includes('test-only-token')),false);
  assert.equal(await page.evaluate(()=>JSON.stringify(sessionStorage).includes('test-only-token')),false);
  await page.screenshot({path:'output/test-artifacts/Drive選択画面_テスト.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  expired=true;await page.locator('#drive-refresh').click();
  await page.waitForFunction(()=>document.querySelector('#drive-message').textContent.includes('期限が切れ'));
  assert.equal(await page.locator('#drive-import').isDisabled(),true);
  assert.equal(await page.locator('#drive-state').textContent(),'未接続');
  expired=false;await page.locator('#drive-connect').click();
  await page.waitForFunction(()=>document.querySelector('#drive-message').textContent.includes('4件の'));
  await page.locator('#drive-disconnect').click();
  assert.equal(await page.locator('#drive-state').textContent(),'未接続');assert.equal(await page.locator('#file-count').textContent(),'3');
  assert.deepEqual(errors,[]);await page.close();
  console.log('PASS: Drive mocked browser auth, pagination, selection/import, DL, duplicates, expiry, disconnect, mobile');
}
