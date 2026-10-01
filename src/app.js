import * as XLSX from 'xlsx';
import {parseFile,reconcile,categories,labels} from './core/reconciliation.js';
import {initDrive} from './integrations/google-drive/ui.js';
const $=id=>document.getElementById(id), esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let files=[], result, page=0, tab='items', editing, records={};
try { records=JSON.parse(localStorage.getItem('stocktake-reviews-v1')||'{}'); } catch { $('notice').textContent='ブラウザの保存記録を読み込めませんでした。対応記録のJSONをご利用ください。'; }
const date=s=>s ? new Date(s).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'}) : '—';
const recordKey=r=>JSON.stringify([r.key,r.latestFile,r.latestAt,r.resultFile,r.resultAt]);
const review=r=>records[recordKey(r)]||{};
function persist(){try{localStorage.setItem('stocktake-reviews-v1',JSON.stringify(records));}catch{$('notice').textContent='ブラウザに保存できません。対応記録をJSON保存してください。';}}
async function ingest(list){const errors=[];let added=0;for(const file of list){try{const f=parseFile(await file.text(),file.name);if(files.some(x=>x.name===f.name))throw Error('同名ファイルは取込済みです。差し替える場合は先に削除してください');files.push(f);added++;}catch(e){errors.push(`${file.name}：${e.message}`);}}$('notice').textContent=errors.join('\n'); refresh();return {added,errors};}
$('files').onchange=async e=>{await ingest([...e.target.files]);e.target.value='';};
$('drop').ondragover=e=>{e.preventDefault();$('drop').classList.add('drag');};$('drop').ondragleave=()=>$('drop').classList.remove('drag');$('drop').ondrop=e=>{e.preventDefault();$('drop').classList.remove('drag');ingest([...e.dataTransfer.files]);};
async function loadSamples() {
  for (const path of ['/config/samples.local.json', '/config/samples.json']) {
    const response = await fetch(path);
    if (response.ok) return response.json();
  }
  return [];
}
$('sample').onclick=async()=>{try{const samples=await loadSamples();if(!samples.length)throw Error('ローカルデータ設定がありません');await ingest(await Promise.all(samples.map(async ({name,path})=>{const r=await fetch('/'+path.split('/').map(encodeURIComponent).join('/'));if(!r.ok)throw Error(name+'を読めません');const content=await r.text();return {name,text:async()=>content};})));}catch(e){$('notice').textContent=e.message+'。ファイル選択から取り込んでください。';}};
function options(id,values){const v=$(id).value;$(id).innerHTML='<option value="">'+({store:'すべての店舗',category:'すべての分類',status:'すべての確認状態'}[id])+'</option>'+values.map(x=>`<option>${esc(x)}</option>`).join('');$(id).value=values.includes(v)?v:'';}
function refresh(keep=false){
  const selected=keep?$('baseline').value:'';
  const stocks=files.filter(f=>f.type==='stock').sort((a,b)=>Date.parse(b.date)-Date.parse(a.date)||a.name.localeCompare(b.name));
  $('baseline').innerHTML=stocks.map(f=>`<option value="${esc(f.name)}">${esc(f.name)} · ${date(f.date)}</option>`).join('')||'<option>未読込</option>';
  if(stocks.some(f=>f.name===selected))$('baseline').value=selected;
  $('file-count').textContent=files.length;
  $('file-list').innerHTML=files.map((f,i)=>`<div><span>${f.type==='stock'?'在庫':'棚卸結果'} · ${esc(f.name)} · ${date(f.date)}</span><button class="text-button" data-remove="${i}">削除</button></div>`).join('');
  result=stocks.length?reconcile(files,$('baseline').value):null;
  $('export').disabled=$('export-csv').disabled=!result;page=0;
  const rows=result?.rows||[];
  options('store',[...new Set(rows.map(r=>r.store))].sort());options('category',categories);options('status',[...Object.values(labels),'棚卸記録なし']);
  $('cards').innerHTML=[...categories.slice(0,3).map((c,i)=>[c,rows.filter(r=>r.category===c).length,['減少理由の確認対象','在庫は継続・確認状態は別判定','追加理由の確認対象'][i]]),['要確認',rows.filter(r=>r.issues).length,`比較対象外 ${rows.filter(r=>r.category===categories[3]).length}件`]].map(([label,n,sub])=>`<div class="card">${label}<strong>${n.toLocaleString()}<small style="display:inline;font-size:12px;margin-left:8px">商品</small></strong><small>${sub}</small></div>`).join('');
  $('warnings').innerHTML=(result?.warnings||[]).map(w=>`<div class="warning">${esc(w)}</div>`).join('');
  $('dates').textContent=result?[...result.chosen].map(([s,f])=>`${s}：比較元 ${date(f.data.source.exportedAt)} ／ 棚卸出力 ${date(f.date)}`).join(' ｜ '):'ファイルを取り込むと照合が始まります';
  render();
}
$('file-list').onclick=e=>{if(e.target.dataset.remove!=null){files.splice(Number(e.target.dataset.remove),1);refresh(true);}};
$('baseline').onchange=()=>refresh(true);
for(const id of ['search','store','category','status','attention','unresolved'])$(id).oninput=()=>{page=0;render();};
document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>{tab=b.dataset.tab;page=0;document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active',t===b));render();});
function filtered(){const q=$('search').value.toLowerCase();return (result?.rows||[]).filter(r=>(!$('store').value||r.store===$('store').value)&&(!$('category').value||r.category===$('category').value)&&(!$('status').value||r.status===$('status').value)&&(!$('attention').checked||r.issues)&&(!$('unresolved').checked||!review(r).reviewed)&&(!q||Object.values(r).some(v=>String(v).toLowerCase().includes(q))||JSON.stringify(review(r)).toLowerCase().includes(q)));}
function render(){
  document.querySelectorAll('.filters select:not(#store),.filters label').forEach(e=>e.style.display=tab==='items'?'':'none');
  if(tab==='memos'){
    const q=$('search').value.toLowerCase();const ms=(result?.brandMemos||[]).filter(m=>(!$('store').value||m.store===$('store').value)&&JSON.stringify(m).toLowerCase().includes(q));
    $('count').textContent=ms.length+'件（過去版を含む）';$('table').innerHTML=ms.length?'<table><thead><tr><th>店舗</th><th>ブランド</th><th>メモ</th><th>更新日時</th><th>採用</th><th>取込元</th></tr></thead><tbody>'+ms.map(m=>`<tr><td>${esc(m.store)}</td><td>${esc(m.brand)}</td><td class="wrap">${esc(m.memo)}</td><td>${date(m.updatedAt)}</td><td>${m.active?'採用版':'過去版'}</td><td>${esc(m.file)}</td></tr>`).join('')+'</tbody></table>':'<div class="empty">該当するブランドメモはありません</div>';
    $('page').textContent='';$('prev').disabled=$('next').disabled=true;return;
  }
  const rows=filtered(), slice=rows.slice(page*100,(page+1)*100);
  $('count').textContent=`${rows.length.toLocaleString()} / ${(result?.rows.length||0).toLocaleString()} 商品`;
  $('table').innerHTML=slice.length?'<table><thead><tr><th>分類</th><th>店舗 / ID</th><th>商品</th><th>棚卸状態</th><th>確認事項・メモ</th><th>照合対応</th><th></th></tr></thead><tbody>'+slice.map(r=>`<tr><td>${esc(r.category)}</td><td>${esc(r.store)}<br><span class="muted">${esc(r.id)}</span></td><td>${esc(r.brand)}<br><b>${esc(r.model)}</b> / ${esc(r.color)}</td><td><span class="badge ${r.status==='保留'?'warn':''}">${esc(r.status)}</span></td><td class="wrap">${esc(r.memo||r.groupMemo||r.brandMemo||r.issues||'—')}<small>${esc(r.issues)}</small></td><td>${review(r).reviewed?'✓ 完了':'未完了'}<small>${esc(review(r).reason||'')}</small></td><td><button class="secondary" data-key="${esc(r.key)}">詳細・対応</button></td></tr>`).join('')+'</tbody></table>':'<div class="empty">'+(result?'条件に合う商品はありません':'在庫データと棚卸結果を取り込んでください')+'</div>';
  $('page').textContent=rows.length?`${page+1} / ${Math.ceil(rows.length/100)} ページ`:'';$('prev').disabled=page===0;$('next').disabled=(page+1)*100>=rows.length;
}
$('prev').onclick=()=>{page--;render();};$('next').onclick=()=>{page++;render();};
$('table').onclick=e=>{const k=e.target.dataset.key;if(!k)return;editing=result.rows.find(r=>r.key===k);const r=editing,v=review(r);$('detail-title').textContent=`${r.store} · ${r.brand} ${r.model} / ${r.color}（${r.id}）`;$('detail-info').textContent=`${r.category} ／ ${r.status}\n棚卸元 ${date(r.sourceAt)} → 選択在庫 ${date(r.latestAt)}\n元在庫：${r.oldCount}件 ／ 選択在庫：${r.currentCount}件\n棚卸側の商品：${r.oldBrand} / ${r.oldModel} / ${r.oldColor}\n下代：${r.oldCost} → ${r.cost} ／ 納品日：${r.oldReceivedDate} → ${r.receivedDate}\n確認事項：${r.issues||'なし'}\n商品メモ：${r.memo||'なし'}\nグループメモ：${r.groupMemo||'なし'}\nブランドメモ：${r.brandMemo||'なし'}\n棚卸結果：${r.resultFile}`;$('reason').value=v.reason||'';$('note').value=v.note||'';$('reviewed').checked=!!v.reviewed;$('detail').showModal();};
$('edit').onsubmit=e=>{e.preventDefault();records[recordKey(editing)]={reason:$('reason').value,note:$('note').value,reviewed:$('reviewed').checked,updatedAt:new Date().toISOString()};persist();$('detail').close();render();};
function download(content,name,type){const url=URL.createObjectURL(new Blob([content],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);}
$('backup').onclick=()=>download(JSON.stringify({kind:'stocktake-reviews',version:1,records},null,2),'棚卸対応記録.json','application/json');
$('restore').onchange=async e=>{try{const data=JSON.parse(await e.target.files[0].text());if(data.kind!=='stocktake-reviews'||data.version!==1||!data.records||typeof data.records!=='object'||Array.isArray(data.records))throw Error('対応記録ファイルではありません');for(const [k,v] of Object.entries(data.records)){if(!Array.isArray(JSON.parse(k))||!v||typeof v!=='object'||typeof v.reviewed!=='boolean'||typeof v.note!=='string'||typeof v.reason!=='string'||!Number.isFinite(Date.parse(v.updatedAt)))throw Error('対応記録の形式が不正です');}for(const [k,v] of Object.entries(data.records)){if(!records[k]||Date.parse(v.updatedAt)>Date.parse(records[k].updatedAt))records[k]=v;}persist();render();$('notice').textContent='対応記録を復元しました。同じ比較元・在庫の組み合わせに適用します。';}catch(err){$('notice').textContent=err.message;}e.target.value='';};
const columns={category:'分類',store:'店舗',id:'商品ID',brand:'ブランド（現在優先）',model:'モデル（現在優先）',color:'カラー（現在優先）',oldBrand:'棚卸ブランド',oldModel:'棚卸モデル',oldColor:'棚卸カラー',oldCount:'棚卸元在庫件数',currentCount:'選択在庫件数',oldCost:'棚卸下代',cost:'最新下代',oldReceivedDate:'棚卸納品日',receivedDate:'最新納品日',status:'棚卸確認状態',memo:'商品メモ',groupMemo:'グループメモ',brandMemo:'ブランドメモ',issues:'確認事項',sourceAt:'棚卸比較元取得日時',resultAt:'棚卸結果出力日時',latestAt:'選択在庫取得日時',updatedAt:'棚卸項目更新日時',resultFile:'棚卸結果ファイル',latestFile:'在庫ファイル'};
const converted=r=>({...Object.fromEntries(Object.entries(columns).map(([k,v])=>[v,k.endsWith('At')?(r[k]?date(r[k]):''):r[k]])),照合完了:review(r).reviewed?'完了':'未完了',確認理由:review(r).reason||'',対応メモ:review(r).note||'',対応更新日時:review(r).updatedAt?date(review(r).updatedAt):''});
const headers=[...Object.values(columns),'照合完了','確認理由','対応メモ','対応更新日時'];
$('export-csv').onclick=()=>{
  if(!result)return;
  try{
    const sheet=XLSX.utils.json_to_sheet(result.rows.map(converted),{header:headers});
    const csv=XLSX.utils.sheet_to_csv(sheet,{RS:'\r\n',forceQuotes:true});
    download('\uFEFF'+csv,`棚卸照合_全店舗_${new Date().toISOString().slice(0,10)}.csv`,'text/csv;charset=utf-8');
  }catch(e){$('notice').textContent='CSV出力に失敗しました：'+e.message;}
};
$('export').onclick=()=>{
  try{
    const wb=XLSX.utils.book_new();
    const add=(name,rows,headers)=>{const ws=XLSX.utils.json_to_sheet(rows,{header:headers});ws['!cols']=(headers||Object.keys(rows[0]||{})).map(k=>({wch:/メモ|確認事項/.test(k)?45:/日時|ファイル/.test(k)?29:20}));if(ws['!ref'])ws['!autofilter']={ref:ws['!ref']};XLSX.utils.book_append_sheet(wb,ws,name);};
    add('集計',[...new Set(result.rows.map(r=>r.store))].map(store=>({店舗:store,...Object.fromEntries(categories.map(c=>[c,result.rows.filter(r=>r.store===store&&r.category===c).length])),保留:result.rows.filter(r=>r.store===store&&r.status==='保留').length,未確認:result.rows.filter(r=>r.store===store&&r.status==='未確認').length,要確認:result.rows.filter(r=>r.store===store&&r.issues).length,照合完了:result.rows.filter(r=>r.store===store&&review(r).reviewed).length})));
    add('商品照合',result.rows.map(converted),headers);add('要確認',result.rows.filter(r=>r.issues).map(converted),headers);
    add('ブランドメモ',result.brandMemos.map(m=>({店舗:m.store,ブランド:m.brand,メモ:m.memo,更新日時:m.updatedAt?date(m.updatedAt):'',棚卸結果:m.file,採用:m.active?'採用版':'過去版'})),['店舗','ブランド','メモ','更新日時','棚卸結果','採用']);
    add('棚卸明細履歴',result.history.map(r=>({ファイル:r.file,店舗:r.store,商品ID:r.id,ブランド:r.brand,モデル:r.model,カラー:r.color,下代:r.cost,納品日:r.receivedDate,状態:labels[r.status]||r.status,商品メモ:r.memo,グループメモ:r.groupMemo,更新日時:r.updatedAt?date(r.updatedAt):'',元在庫取得日時:date(r.sourceAt),結果出力日時:date(r.resultAt)})),['ファイル','店舗','商品ID','ブランド','モデル','カラー','下代','納品日','状態','商品メモ','グループメモ','更新日時','元在庫取得日時','結果出力日時']);
    add('在庫明細履歴',files.filter(f=>f.type==='stock').flatMap(f=>f.data.items.map(i=>({ファイル:f.name,採用:f===result.latest?'採用':'未採用',取得日時:date(f.date),店舗:i.store,商品ID:String(i.id),ブランド:i.brand,モデル:i.model,カラー:i.color,下代:i.cost,納品日:i.receivedDate}))));
    add('取込元',files.map(f=>({ファイル:f.name,種別:f.type==='stock'?'在庫':'棚卸結果',取得または出力日時:date(f.date),店舗:f.data.scope?.store||'全店舗',棚卸元在庫:f.data.source?.fileName||'',採用:f===result.latest||result.chosen.get(f.data.scope?.store)===f?'採用':'未採用'})));
    add('判定ルール',[...['照合キーは店舗＋商品ID。商品名だけの推測照合はしません。','①は棚卸元の在庫だけに存在。販売・移動・修正等の理由は別途確認。','②は両方のデータに存在。現物確認済みを意味しません。','③は棚卸元に記録がなく選択在庫に存在。入荷・移動・修正等の理由は別途確認。','棚卸未実施の店舗・一部範囲の棚卸・比較元より古い在庫は追加を比較対象外とします。','店舗ごとに出力日時が最新の棚卸結果を採用。過去版との自動補完はしません。','重複IDは件数を表示し、代表の属性は先頭明細。全明細は履歴シートに保持。','日時は日本時間（JST）。画面の絞り込みに関係なく全商品を出力。','照合対応は元データを書き換えず別に保存。異なる比較時点へ自動転用しません。',...result.warnings].map(説明=>({説明}))]);
    XLSX.writeFile(wb,`棚卸照合_${new Date().toISOString().slice(0,10)}.xlsx`);
  }catch(e){$('notice').textContent='Excel出力に失敗しました：'+e.message;}
};
refresh();
initDrive({ingest,getImportedNames:()=>files.map(f=>f.name)});
