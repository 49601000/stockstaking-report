import {createDriveAPI, DRIVE_SCOPE, driveFolderUrl, fileKind, selectable} from './api.js';

export function initDrive({ingest, getImportedNames}) {
  const $ = id => document.getElementById(id);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let token = '', expiresAt = 0, all = [], selected = new Set(), busy = false, loaded = false, gisPromise;
  const msg = text => { $('drive-message').textContent = text; };
  const connected = () => !!token && Date.now() < expiresAt;
  const folderId = () => $('drive-folder-id').value.trim();
  const api = createDriveAPI(() => connected() ? token : '', folderId);
  try { $('drive-folder-id').value = localStorage.getItem('stocktake-google-folder-id') || ''; } catch {}
  try { $('drive-client-id').value = localStorage.getItem('stocktake-google-client-id') || ''; } catch {}
  const remember = () => {
    try {
      localStorage.setItem('stocktake-google-folder-id', folderId());
      localStorage.setItem('stocktake-google-client-id', $('drive-client-id').value.trim());
    } catch {}
  };
  const visible = () => all.filter(f => (!$('drive-kind').value || fileKind(f.name) === $('drive-kind').value) && f.name.toLowerCase().includes($('drive-search').value.toLowerCase()));
  function draw() {
    $('drive-connect').disabled = busy || !window.google?.accounts?.oauth2 || location.protocol === 'file:';
    $('drive-refresh').disabled = busy || !connected();
    $('drive-disconnect').disabled = busy || !token;
    $('drive-folder-id').disabled = busy;
    $('drive-client-id').disabled = busy;
    $('drive-select-visible').disabled = busy || !connected();
    $('drive-clear').disabled = busy || !selected.size;
    $('drive-import').disabled = busy || !selected.size || !connected();
    $('drive-import').textContent = `選択した${selected.size}件を取り込む`;
    $('drive-state').textContent = connected() ? '接続中 · 読み取り専用' : '未接続';
    $('drive-folder-link').href = /^[\w-]+$/.test(folderId()) ? driveFolderUrl(folderId()) : '#';
    const rows = visible(), imported = new Set(getImportedNames());
    $('drive-count').textContent = `${rows.length} / ${all.length} ファイル · 選択 ${selected.size}件`;
    $('drive-list').innerHTML = rows.length ? '<table><thead><tr><th>選択</th><th>ファイル名</th><th>種類</th><th>Drive更新日時</th><th>サイズ</th><th>操作</th></tr></thead><tbody>' + rows.map(f => {
      const allowed = selectable(f);
      return `<tr><td><input type="checkbox" data-select="${esc(f.id)}" aria-label="${esc(f.name)}を選択" ${selected.has(f.id)?'checked':''} ${!allowed||busy||!connected()?'disabled':''}></td><td>${esc(f.name)}<small>${!allowed?'ダウンロード不可・対象形式外・20MB超':imported.has(f.name)?'同名ファイル取込済み':''}</small></td><td>${fileKind(f.name)}</td><td>${esc(f.modifiedTime ? new Date(f.modifiedTime).toLocaleString('ja-JP', {timeZone:'Asia/Tokyo'}) : '—')}</td><td>${f.size ? (Number(f.size)/1024).toFixed(1)+' KB' : '—'}</td><td><button class="secondary" data-download="${esc(f.id)}" ${!allowed||busy||!connected()?'disabled':''}>DL</button> <a href="https://drive.google.com/file/d/${encodeURIComponent(f.id)}/view" target="_blank" rel="noopener noreferrer">Driveで開く</a></td></tr>`;
    }).join('') + '</tbody></table>' : `<div class="empty">${loaded?'該当するJS・JSONファイルはありません':'Googleに接続すると、このフォルダのファイルを選択できます。'}</div>`;
  }
  function report(error) {
    if (error.status === 401) { token = ''; expiresAt = 0; }
    msg(error.message);
  }
  async function run(action) {
    if (busy) return;
    busy = true; draw();
    try { await action(); } catch (e) { report(e); }
    finally { busy = false; draw(); }
  }
  async function refresh() {
    msg('フォルダ内のファイルを取得しています…');
    // Failed refreshes must not leave an old listing looking current.
    all = []; selected.clear(); loaded = false; draw();
    const data = await api.list();
    all = data.files; loaded = true;
    $('drive-folder-name').textContent = data.folder.name;
    msg(`${all.length}件のJS・JSONファイルを取得しました。取り込むファイルにチェックしてください。`);
  }
  function loadGIS() {
    if (window.google?.accounts?.oauth2) return Promise.resolve();
    if (gisPromise) return gisPromise;
    gisPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client'; script.async = true;
      const timer = setTimeout(() => { script.remove(); gisPromise = undefined; reject(Error('Googleログインの読込がタイムアウトしました。接続パネルを開き直してください。')); }, 20000);
      script.onload = () => { clearTimeout(timer); resolve(); };
      script.onerror = () => { clearTimeout(timer); script.remove(); gisPromise = undefined; reject(Error('Googleログインを読み込めません。通信・ブラウザのブロック設定を確認し、接続パネルを開き直してください。')); };
      document.head.append(script);
    });
    return gisPromise;
  }
  $('drive-panel').addEventListener('toggle', async () => {
    if (!$('drive-panel').open) return;
    if (location.protocol === 'file:') {msg('Drive接続はサーバー起動が必要です。npm start の後、http://localhost:4173 を開いてください。');draw();return;}
    try { await loadGIS(); } catch (e) { report(e); } finally { draw(); }
  });
  $('drive-connect').onclick = () => {
    const clientId = $('drive-client-id').value.trim();
    if (!/^[\w-]+$/.test(folderId())) {msg('初回設定にDriveフォルダIDを入力してください。');$('drive-setup').open=true;$('drive-folder-id').focus();return;}
    if (!/^[\w-]+\.apps\.googleusercontent\.com$/.test(clientId)) {msg('初回設定にOAuthクライアントIDを入力してください。末尾は .apps.googleusercontent.com です。');$('drive-setup').open=true;$('drive-client-id').focus();return;}
    if (!window.google?.accounts?.oauth2 || busy) return;
    remember(); busy = true; token = ''; expiresAt = 0; all = []; selected.clear(); loaded = false; draw();
    msg('Googleの画面で、フォルダにアクセスできるアカウントを選んでください。');
    try {
      const client = window.google.accounts.oauth2.initTokenClient({
        client_id:clientId, scope:DRIVE_SCOPE, include_granted_scopes:false,
        callback:response => {
          busy = false;
          if (response.error || !response.access_token || !window.google.accounts.oauth2.hasGrantedAllScopes(response, DRIVE_SCOPE)) {
            msg('Driveの読み取り権限が許可されませんでした。接続をやり直してください。');draw();return;
          }
          token = response.access_token;
          expiresAt = Date.now() + Math.max(0, Number(response.expires_in || 3600) - 30) * 1000;
          run(refresh);
        },
        error_callback:error => {busy=false;msg(error.type==='popup_closed'?'Google接続をキャンセルしました。':'Googleの接続画面を開けません。ポップアップ許可と初回設定を確認してください。');draw();}
      });
      // Must run synchronously in the click event to avoid popup blocking.
      client.requestAccessToken({prompt:'select_account'});
    } catch (e) {busy=false;report(e);draw();}
  };
  $('drive-folder-id').onchange = () => {remember(); token='';expiresAt=0;all=[];selected.clear();loaded=false;draw();};
  $('drive-client-id').onchange = remember;
  $('drive-refresh').onclick = () => run(refresh);
  $('drive-disconnect').onclick = () => {token='';expiresAt=0;all=[];selected.clear();loaded=false;msg('この画面の接続を終了しました。取り込んだデータは照合画面に残ります。');draw();};
  $('drive-search').oninput = draw; $('drive-kind').onchange = draw;
  $('drive-select-visible').onclick = () => {visible().filter(selectable).forEach(f=>selected.add(f.id));draw();};
  $('drive-clear').onclick = () => {selected.clear();draw();};
  $('drive-list').onchange = e => {const id=e.target.dataset.select;if(!id)return;if(e.target.checked)selected.add(id);else selected.delete(id);draw();};
  $('drive-list').onclick = e => {
    const file = all.find(f=>f.id===e.target.dataset.download);
    if (!file) return;
    run(async () => {
      msg(`${file.name} をダウンロードしています…`);
      const data=await api.read(file), url=URL.createObjectURL(data.blob), a=document.createElement('a');
      a.href=url;a.download=data.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);
      msg(`${data.name} の保存を開始しました。`);
    });
  };
  $('drive-import').onclick = () => run(async () => {
    const pending=all.filter(f=>selected.has(f.id)), errors=[];
    let imported=0;
    for (let i=0;i<pending.length;i++) {
      const f=pending[i];msg(`取込中 ${i+1} / ${pending.length}：${f.name}`);
      try {
        if (getImportedNames().includes(f.name)) throw Error('同名ファイルは取込済みです。差し替える場合は「取込ファイル」から削除してください。');
        const data=await api.read(f);
        const outcome=await ingest([data]);
        if (outcome.errors.length) throw Error(outcome.errors.join('\n'));
        imported+=outcome.added;selected.delete(f.id);
      } catch (e) {
        errors.push(`${f.name}：${e.message}`);
        if (e.status===401 || !connected()) {token='';expiresAt=0;errors.push('接続期限切れのため残りの取込を中断しました。再接続して再選択してください。');break;}
      }
    }
    msg(`${imported}件を取り込みました。${errors.length?'\n'+errors.join('\n'): '下の照合一覧に反映しました。'}`);
  });
  // Update expired-state controls while the page remains open; tokens never enter browser storage.
  setInterval(() => {if(token && !connected() && !busy){token='';expiresAt=0;msg('接続期限が切れました。「Googleで接続」で再接続してください。');draw();}},15000);
  draw();
}
