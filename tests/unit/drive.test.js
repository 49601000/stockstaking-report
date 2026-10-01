import test from 'node:test';
import assert from 'node:assert/strict';
import {createDriveAPI,fileKind,selectable} from '../../src/integrations/google-drive/api.js';
const json = (data,status=200) => new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
const DRIVE_FOLDER = 'test-drive-folder';
const item = {id:'example_123',name:'matoi-result.json',mimeType:'application/json',size:'12',parents:[DRIVE_FOLDER],capabilities:{canDownload:true}};
test('Drive list follows every page, excludes unrelated formats, and sends auth only as header',async()=>{
  const calls=[];
  const api=createDriveAPI(()=> 'test-token',()=> DRIVE_FOLDER,async(url,options)=>{
    calls.push([url,options]);const u=new URL(url);
    assert.equal(options.headers.Authorization,'Bearer test-token');assert.equal(u.searchParams.has('access_token'),false);
    if(u.pathname.endsWith(DRIVE_FOLDER))return json({id:DRIVE_FOLDER,name:'棚卸データ',mimeType:'application/vnd.google-apps.folder'});
    assert.equal(u.searchParams.get('q'),`'${DRIVE_FOLDER}' in parents and trashed = false`);
    return u.searchParams.has('pageToken')?json({files:[{...item,id:'second'}]}):json({nextPageToken:'page2',files:[item,{id:'pdf',name:'memo.pdf'}]});
  });
  const r=await api.list();assert.equal(r.files.length,2);assert.equal(calls.length,3);
});
test('Drive download validates current metadata, folder membership and capability',async()=>{
  const calls=[];
  const api=createDriveAPI(()=> 't',()=> DRIVE_FOLDER,async(url,options)=>{
    calls.push(url);assert.equal(options.headers['X-Goog-Drive-Resource-Keys'],'example_123/resource-key');
    return new URL(url).searchParams.get('alt')==='media'?new Response('{"ok":true}'):json(item);
  });
  const result=await api.read({...item,resourceKey:'resource-key'});assert.equal(await result.text(),'{"ok":true}');assert.equal(result.name,item.name);assert.equal(calls.length,2);
  for(const meta of [{...item,parents:['other']},{...item,trashed:true},{...item,capabilities:{canDownload:false}},{...item,size:String(21*1024*1024)}]){
    let calls=0;await assert.rejects(createDriveAPI(()=> 't',()=> DRIVE_FOLDER,async()=>{calls++;return json(meta);}).read(item));assert.equal(calls,1);
  }
});
test('expired token, forbidden, missing files, and incomplete lists report meaningful failures',async()=>{
  await assert.rejects(createDriveAPI(()=>'',()=> DRIVE_FOLDER,()=>{throw Error('must not fetch');}).list(),/接続が切れ/);
  for(const [status,pattern] of [[401,/期限が切れ/],[403,/許可されていません/],[404,/見つかりません/]]){
    await assert.rejects(createDriveAPI(()=> 't',()=> DRIVE_FOLDER,async()=>json({error:{}},status)).list(),pattern);
  }
  let calls=0;
  await assert.rejects(createDriveAPI(()=> 't',()=> DRIVE_FOLDER,async()=>++calls===1?json({mimeType:'application/vnd.google-apps.folder'}):json({incompleteSearch:true})).list(),/完全な一覧/);
});
test('Drive type detection and downloadable filtering',()=>{
  assert.equal(fileKind('棚卸データ_20260921.js'),'在庫');assert.equal(fileKind('nicome-result20260919.json'),'棚卸結果');
  assert.equal(selectable(item),true);assert.equal(selectable({...item,mimeType:'application/vnd.google-apps.shortcut'}),false);
  assert.equal(selectable({...item,capabilities:{}}),false);assert.equal(selectable({...item,name:'notes.html'}),false);
});
