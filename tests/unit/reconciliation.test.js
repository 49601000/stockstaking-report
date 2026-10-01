import test from 'node:test';
import assert from 'node:assert/strict';
import {samples,readSample} from '../helpers/samples.js';
import {parseFile,reconcile,categories} from '../../src/core/reconciliation.js';
const stock=(items,date='2026-09-23T00:00:00Z',name='stock.js')=>parseFile(JSON.stringify({exportedAt:date,items}),name);
const result=(items,extra={})=>parseFile(JSON.stringify({kind:'stocktake-status',generatedAt:'2026-09-22T00:00:00Z',source:{exportedAt:'2026-09-20T00:00:00Z'},scope:{store:'A',allBrands:true},groups:[{store:'A',brand:'Brand',model:'M',color:'C',items}],...extra}),extra.name||'result.json');
const item=id=>({store:'A',id,brand:'Brand',model:'M',color:'C'});
test('3 classifications preserve unchecked and pending rather than inventing physical absence',()=>{
 const r=reconcile([stock([item('2'),item('3')]),result([{id:'1',status:'unchecked'},{id:'2',status:'pending',memo:'hold'}])]);
 assert.deepEqual(r.rows.map(x=>x.category),categories.slice(0,3));assert.equal(r.rows[0].status,'未確認');assert.equal(r.rows[1].memo,'hold');assert.match(r.rows[1].issues,/保留/);
});
test('uncovered stores, partial scope and reverse chronology are excluded from additions',()=>{
 assert.equal(reconcile([stock([item('1')])]).rows[0].category,categories[3]);
 assert.equal(reconcile([stock([item('1')]),result([],{scope:{store:'A',allBrands:false}})]).rows[0].category,categories[3]);
 const r=reconcile([stock([item('1')],'2026-09-19T00:00:00Z'),result([])]);assert.equal(r.rows[0].category,categories[3]);assert.ok(r.warnings.length);
});
test('duplicate IDs are flagged and counts retained; cross-store IDs are not merged',()=>{
 let r=reconcile([stock([item('1'),item('1')]),result([{id:'1'}])]);assert.equal(r.rows[0].currentCount,2);assert.match(r.rows[0].issues,/重複/);
 r=reconcile([stock([{...item('1'),store:'B'}]),result([{id:'1'}])]);assert.equal(r.rows.length,2);assert.match(r.rows[0].issues,/別店舗/);
});
test('latest result is selected as a whole, old notes remain in history',()=>{
 const old=result([{id:'1',memo:'old'}],{name:'old.json'}), newer=result([{id:'1',memo:'new'}],{name:'new.json',generatedAt:'2026-09-23T00:00:00Z'});
 const r=reconcile([stock([item('1')]),old,newer]);assert.equal(r.rows[0].memo,'new');assert.equal(r.history.length,2);
});
test('brand notes survive without matching products and resolved status is preserved',()=>{
 const r=reconcile([stock([item('1')]),result([{id:'1',status:'pending_resolved'}],{brandMemos:[{store:'A',brand:'Missing',memo:'keep'}]})]);assert.equal(r.brandMemos[0].memo,'keep');assert.equal(r.rows[0].status,'保留対応済み');
});
test('JS is parsed without executing scripts; malformed dates are rejected',()=>{
 assert.equal(parseFile('// comment\nvar STOCKTAKE_DATA = {"exportedAt":"2026-09-23","items":[]};','x.js').type,'stock');
 assert.throws(()=>parseFile('var STOCKTAKE_DATA = {}; globalThis.bad=true;','x.js'));
 assert.throws(()=>stock([],'invalid'));
});
test('provided data reconciles without losing baseline or current records',()=>{
 const files=samples.map(f=>parseFile(readSample(f.name).toString('utf8'),f.name));
 const r=reconcile(files);assert.equal(r.rows.reduce((n,x)=>n+x.currentCount,0),1345);assert.equal(r.rows.reduce((n,x)=>n+x.oldCount,0),1331);assert.equal(r.rows.filter(x=>x.status==='保留').length,5);assert.equal(r.brandMemos.length,1);
 console.log('実データ集計',Object.fromEntries(categories.map(c=>[c,r.rows.filter(x=>x.category===c).length])));
});
