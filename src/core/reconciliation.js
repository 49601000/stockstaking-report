export const labels = {unchecked:'未確認', checked:'確認済み', pending:'保留', pending_resolved:'保留対応済み'};
export const categories = ['① 棚卸側のみ', '② 両方に在庫', '③ 最新在庫側のみ', '比較対象外'];
const key = r => JSON.stringify([r.store, String(r.id)]);
const str = v => v == null ? '' : String(v);
const time = v => Date.parse(v);
export function parseFile(text, name) {
  text = text.replace(/^\uFEFF/, '').trim();
  if (!text.startsWith('{')) {
    const match = text.match(/^(?:\s*\/\/[^\n]*\n)*\s*(?:var|let|const)\s+STOCKTAKE_DATA\s*=\s*([\s\S]*?)\s*;?\s*$/);
    if (!match) throw Error('対応していないJS形式です');
    text = match[1].replace(/;\s*$/, '');
  }
  const data = JSON.parse(text);
  const type = data.kind === 'stocktake-status' ? 'result' : Array.isArray(data.items) ? 'stock' : null;
  if (!type) throw Error('在庫データまたは棚卸結果ではありません');
  const date = type === 'stock' ? data.exportedAt : data.generatedAt;
  if (!Number.isFinite(time(date))) throw Error('取得日時が不正です');
  if (type === 'result' && (!Array.isArray(data.groups) || !data.scope?.store || !Number.isFinite(time(data.source?.exportedAt)))) throw Error('棚卸結果の店舗・比較元日時・商品情報が不正です');
  const items = type === 'stock' ? data.items : data.groups.flatMap(g => {
    if (!Array.isArray(g.items)) throw Error('商品明細が不正です');
    return g.items.map(i => ({...g, ...i, store:g.store || data.scope.store}));
  });
  if (items.some(i => !i.store || !str(i.id).trim())) throw Error('店舗または商品IDのない明細があります');
  if (type === 'result' && items.some(i => i.store !== data.scope.store)) throw Error('対象店舗と商品明細の店舗が一致しません');
  return {name, data, type, date};
}
export function flatten(file) {
  return file.data.groups.flatMap(g => g.items.map(i => ({
    store:g.store || file.data.scope.store, brand:str(g.brand), model:str(g.model), color:str(g.color),
    id:str(i.id), cost:i.cost, receivedDate:i.receivedDate, status:i.status || g.status || 'unchecked',
    memo:str(i.memo), groupMemo:str(g.memo), updatedAt:i.updatedAt,
    sourceAt:file.data.source.exportedAt, resultAt:file.date, file:file.name
  })));
}
export function reconcile(files, selectedStock) {
  const stocks = files.filter(f => f.type === 'stock').sort((a,b) => time(b.date)-time(a.date) || a.name.localeCompare(b.name));
  const latest = stocks.find(f => f.name === selectedStock) || stocks[0];
  if (!latest) throw Error('在庫データを読み込んでください');
  const warnings = [], chosen = new Map();
  const results = files.filter(f => f.type === 'result').sort((a,b) => time(b.date)-time(a.date) || a.name.localeCompare(b.name));
  for (const f of results) {
    const store = f.data.scope.store;
    if (!chosen.has(store)) chosen.set(store,f);
    else warnings.push(`${store}：${f.name}は過去版として保管。比較には${chosen.get(store).name}を使用。`);
  }
  const current = latest.data.items.map(i => ({...i,id:str(i.id)}));
  const previous = [...chosen.values()].flatMap(flatten);
  const makeMap = list => {const m=new Map(); for(const i of list) {const k=key(i); if(!m.has(k)) m.set(k,[]); m.get(k).push(i);} return m;};
  const cm = makeMap(current), pm = makeMap(previous);
  const brandMemos = results.flatMap(f => (f.data.brandMemos || []).map(m => ({...m,file:f.name,resultAt:f.date,active:chosen.get(f.data.scope.store)===f})));
  for (const [store,f] of chosen) {
    if (time(latest.date)<time(f.data.source.exportedAt)) warnings.push(`${store}：選択在庫が棚卸の比較元在庫より古いため、前後関係を判定できません。`);
    if (time(latest.date)<time(f.date)) warnings.push(`${store}：在庫取得は棚卸結果の出力より前です。「棚卸後」の変動をすべて反映した在庫ではありません。`);
    if (!f.data.scope.allBrands) warnings.push(`${store}：一部ブランドの棚卸です。棚卸結果にない商品は入荷と判定しません。`);
  }
  const rows=[];
  for (const k of new Set([...pm.keys(), ...cm.keys()])) {
    const before=pm.get(k)||[], after=cm.get(k)||[], p=before[0], c=after[0], base=c||p;
    const f=chosen.get(base.store), issues=[];
    const comparable=!!f && f.data.scope.allBrands===true && time(latest.date)>=time(f.data.source.exportedAt);
    const category=p&&c ? categories[1] : p ? categories[0] : comparable ? categories[2] : categories[3];
    if(before.length>1 || after.length>1) issues.push('同一店舗・商品IDが重複（自動確定不可）');
    if(!f) issues.push('店舗の棚卸結果なし');
    if(f && !comparable) issues.push('日時または棚卸範囲の確認が必要');
    if(p && !labels[p.status]) issues.push('不明な確認状態');
    if(p?.status==='pending') issues.push('保留対応が必要');
    if(p?.status==='unchecked') issues.push('棚卸で未確認');
    if(p&&c && ['brand','model','color','cost','receivedDate'].some(x=>str(p[x])!==str(c[x]))) issues.push('商品属性に差異あり');
    const others = (p&&!c ? current : !p&&c ? previous : []).filter(i=>i.id===base.id && i.store!==base.store);
    if(others.length) issues.push(`別店舗に同じIDあり：${[...new Set(others.map(i=>i.store))].join('・')}（移動またはID重複を確認）`);
    const notes=brandMemos.filter(m=>m.active && m.store===base.store && m.brand===base.brand).map(m=>m.memo).filter(Boolean).join('\n');
    if(notes) issues.push('ブランドメモあり');
    if(p?.memo || p?.groupMemo) issues.push('商品・グループメモあり');
    if(p&&!c) issues.push('在庫からの減少理由を確認');
    if(!p&&c&&comparable) issues.push('在庫への追加理由を確認');
    rows.push({key:k, category,store:base.store,id:base.id,brand:base.brand,model:base.model,color:base.color,
      oldBrand:p?.brand||'',oldModel:p?.model||'',oldColor:p?.color||'',oldCost:p?.cost??'',cost:c?.cost??'',oldReceivedDate:p?.receivedDate||'',receivedDate:c?.receivedDate||'',
      oldCount:before.length,currentCount:after.length,status:p ? labels[p.status]||p.status : '棚卸記録なし',
      memo:p?.memo||'',groupMemo:p?.groupMemo||'',brandMemo:notes,issues:issues.join(' / '),
      sourceAt:f?.data.source.exportedAt||'',resultAt:f?.date||'',latestAt:latest.date,resultFile:f?.name||'',latestFile:latest.name,updatedAt:p?.updatedAt||''});
  }
  return {latest,rows, warnings,brandMemos,chosen,history:results.flatMap(flatten)};
}
