export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const API = 'https://www.googleapis.com/drive/v3/files';
const MAX_BYTES = 20 * 1024 * 1024;

export function fileKind(name) {
  if (/^棚卸データ_.*\.(js|json)$/i.test(name)) return '在庫';
  if (/result.*\.json$/i.test(name)) return '棚卸結果';
  return 'その他';
}

export function selectable(file) {
  return /\.(js|json)$/i.test(file.name) &&
    !file.mimeType?.startsWith('application/vnd.google-apps.') &&
    file.capabilities?.canDownload === true && Number(file.size || 0) <= MAX_BYTES;
}

export function driveFolderUrl(folderId) {
  return `https://drive.google.com/drive/folders/${encodeURIComponent(folderId)}`;
}

export function createDriveAPI(getToken, getFolderId, fetcher = fetch) {
  const folderId = () => {
    const id = getFolderId();
    if (!/^[\w-]+$/.test(id)) throw Error('DriveフォルダIDを入力してください。');
    return id;
  };
  async function request(path, params, resourceKeys = '') {
    const token = getToken();
    if (!token) throw Error('Googleとの接続が切れています。「Googleで接続」を押してください。');
    const url = new URL(API + path);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    const headers = {Authorization:`Bearer ${token}`};
    if (resourceKeys) headers['X-Goog-Drive-Resource-Keys'] = resourceKeys;
    let response;
    try { response = await fetcher(url.toString(), {headers, signal:AbortSignal.timeout(60000)}); }
    catch { throw Error('Google Driveへの通信に失敗しました。接続を確認して再試行してください。'); }
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      const reason = body.error?.errors?.[0]?.reason;
      const messages = {
        401:'Googleとの接続期限が切れました。「Googleで接続」で再接続してください。',
        403:reason === 'accessNotConfigured' ? 'Google CloudでGoogle Drive APIを有効にしてください。' : 'アクセスまたはダウンロードが許可されていません。共有先のアカウント・読取権限・API設定を確認してください。',
        404:'フォルダまたはファイルが見つかりません。共有先のアカウントと、ファイルが削除・移動されていないか確認してください。',
        429:'Google Driveの利用制限に達しました。しばらく待って再試行してください。'
      };
      const error = Error(messages[response.status] || `Google Driveの取得に失敗しました（HTTP ${response.status}）。`);
      error.status = response.status;
      throw error;
    }
    return response;
  }
  return {
    async list() {
      const driveFolder = folderId();
      const folder = await (await request('/' + driveFolder, {fields:'id,name,mimeType',supportsAllDrives:'true'})).json();
      if (folder.mimeType !== 'application/vnd.google-apps.folder') throw Error('指定先がフォルダではありません。');
      const files = [], seen = new Set();
      let pageToken = '';
      do {
        const params = {
          q:`'${driveFolder}' in parents and trashed = false`,
          fields:'nextPageToken,incompleteSearch,files(id,name,mimeType,size,modifiedTime,resourceKey,capabilities(canDownload))',
          pageSize:'1000',orderBy:'modifiedTime desc,name',supportsAllDrives:'true',includeItemsFromAllDrives:'true'
        };
        if (pageToken) params.pageToken = pageToken;
        const data = await (await request('', params)).json();
        if (data.incompleteSearch) throw Error('Google Driveが完全な一覧を返しませんでした。再取得してください。');
        files.push(...(data.files || []));
        pageToken = data.nextPageToken || '';
        if (pageToken && seen.has(pageToken)) throw Error('ファイル一覧の取得が繰り返されたため中断しました。');
        seen.add(pageToken);
      } while (pageToken);
      return {folder, files:files.filter(f => /\.(js|json)$/i.test(f.name))};
    },
    async read(file) {
      const driveFolder = folderId();
      if (!/^[\w-]+$/.test(file.id)) throw Error('ファイルIDが不正です。');
      const keys = file.resourceKey ? `${file.id}/${file.resourceKey}` : '';
      const meta = await (await request('/' + file.id, {
        fields:'id,name,mimeType,size,parents,trashed,capabilities(canDownload)',supportsAllDrives:'true'
      }, keys)).json();
      if (meta.trashed || !meta.parents?.includes(driveFolder)) throw Error('ファイルが削除または別フォルダへ移動されています。一覧を更新してください。');
      if (!selectable(meta)) throw Error('ダウンロード可能な20MB以下のJS・JSONファイルではありません。');
      const response = await request('/' + file.id, {alt:'media',supportsAllDrives:'true'}, keys);
      if (Number(response.headers.get('Content-Length')) > MAX_BYTES) throw Error('ファイルが20MBを超えています。');
      // Bound the stream as well: Content-Length may be missing or stale.
      const reader = response.body.getReader(), chunks = [];
      let size = 0;
      for (;;) {
        const {done, value} = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BYTES) { await reader.cancel(); throw Error('ファイルが20MBを超えています。'); }
        chunks.push(value);
      }
      const blob = new Blob(chunks, {type:meta.mimeType || 'application/octet-stream'});
      return {name:meta.name, blob, text:() => blob.text(), driveId:meta.id};
    }
  };
}
