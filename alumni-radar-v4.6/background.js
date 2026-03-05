// background.js — Alumni Radar v4.6
// Scan dans le service worker. À la fin : sauvegarde dans chrome.storage + réouverture du popup.

let scanState = {
  running: false, stopped: false, rows: [], current: 0, total: 0,
  logs: [], done: false, exportHeaders: [], exportRows: []
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'startScan') {
    if (!scanState.running) startScan(msg.payload);
    sendResponse({ ok: true });
    return true;
  }
  if (msg.action === 'stopScan') {
    scanState.stopped = true;
    sendResponse({ ok: true });
    return true;
  }
  if (msg.action === 'getScanState') {
    sendResponse({ state: scanState });
    return true;
  }
  if (msg.action === 'resetScan') {
    scanState = { running:false, stopped:false, rows:[], current:0, total:0, logs:[], done:false, exportHeaders:[], exportRows:[] };
    chrome.storage.local.remove(['exportReady','exportHeaders','exportRows']);
    sendResponse({ ok: true });
    return true;
  }
});

async function startScan({ rows, colJob, colCompany, colName, importedHeaders }) {
  scanState = { running:true, stopped:false, done:false, logs:[], current:0, total:rows.length, rows, exportHeaders:[], exportRows:[] };
  broadcastState();

  for (let i = 0; i < rows.length; i++) {
    if (scanState.stopped) break;
    const row = rows[i];
    scanState.current = i;
    broadcastState();

    if (!row.url || !row.url.startsWith('http')) {
      row.error = 'URL manquante ou invalide';
      pushLog(row, '⚠️');
      continue;
    }
    try {
      const result = await scanProfile(row.url);
      row.newJob     = result.job     || null;
      row.newCompany = result.company || null;
      row.newName    = (!row.name || row.name.trim() === '') ? (result.name || null) : null;
      if (!row.newJob) row.error = 'Poste non trouvé';
      pushLog(row, row.newJob ? '✅' : '⚠️');
    } catch(e) {
      row.error = e.message;
      pushLog(row, '❌');
    }
    broadcastState();
    if (i < rows.length - 1 && !scanState.stopped) await sleep(1500 + Math.random() * 3000);
  }

  // Préparer les données d'export
  const exportHeaders = [...importedHeaders];
  if (!exportHeaders.includes('Erreur')) exportHeaders.push('Erreur');
  const exportRows = rows.map(row => {
    const r = { ...row._raw };
    if (row.newName    && (!r[colName]    || r[colName].trim() === '')) r[colName] = row.newName;
    if (row.newJob)     r[colJob]     = row.newJob;
    if (row.newCompany) r[colCompany] = row.newCompany;
    r['Erreur'] = row.error || '';
    return r;
  });
  scanState.exportHeaders = exportHeaders;
  scanState.exportRows    = exportRows;

  // ── Persister dans chrome.storage pour survivre à la fermeture du popup ──
  await chrome.storage.local.set({ exportReady: true, exportHeaders, exportRows });

  scanState.running = false;
  scanState.done    = true;
  scanState.current = rows.length;
  broadcastState();

  // ── Rouvrir le popup automatiquement ─────────────────────────────────────
  try { await chrome.action.openPopup(); } catch(e) {}
}

function pushLog(row, icon) {
  scanState.logs.push({ name: row.name || row.url, newJob: row.newJob, error: row.error, icon });
  if (scanState.logs.length > 200) scanState.logs.shift();
}

function broadcastState() {
  chrome.runtime.sendMessage({ action: 'scanStateUpdate', state: scanState }).catch(() => {});
}

async function scanProfile(url) {
  let tabId = null, originalTabId = null;
  try {
    const [originalTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    originalTabId = originalTab?.id;
    const tab = await chrome.tabs.create({ url, active: true });
    tabId = tab.id;
    await waitForTabLoad(tabId);
    await sleep(3500);
    const results = await chrome.scripting.executeScript({ target: { tabId }, func: extractLinkedInData });
    const r = results?.[0]?.result;
    if (!r) throw new Error('Script non exécuté');
    if (r.error) throw new Error(r.error);
    return { job: r.job, company: r.company, name: r.name };
  } finally {
    if (tabId) { try { await chrome.tabs.remove(tabId); } catch(e) {} }
    if (originalTabId) { try { await chrome.tabs.update(originalTabId, { active: true }); } catch(e) {} }
  }
}

function extractLinkedInData() {
  try {
    const allH2 = Array.from(document.querySelectorAll('h2'));
    const sectionNames = ['expérience','formation','compétences','activité','bénévolat','centres','essentiel','notification','publicité','personnes','profils','aimerez','connaître'];
    const nameH2 = allH2.find(h => {
      const t = h.innerText.trim().toLowerCase();
      return t.length > 1 && !sectionNames.some(s => t.includes(s));
    });
    const name = nameH2 ? nameH2.innerText.trim() : null;
    const expH2 = allH2.find(h => h.innerText.trim() === 'Expérience');
    let job = null, company = null;
    if (expH2) {
      const container = expH2.closest('section') || expH2.parentElement?.parentElement;
      if (container) {
        const texts = Array.from(container.querySelectorAll('span, p, div'))
          .filter(el => el.children.length === 0)
          .map(el => el.innerText.trim())
          .filter(t => t.length > 2 && t.length < 150);
        job     = texts[0] || null;
        company = texts[1] ? texts[1].split('·')[0].trim() || null : null;
      }
    }
    const clean = s => s ? s.replace(/\n+/g,' ').replace(/\s{2,}/g,' ').trim()||null : null;
    return { name: clean(name), job: clean(job), company: clean(company) };
  } catch(e) { return { error: e.message }; }
}

function waitForTabLoad(tabId) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timeout chargement')), 25000);
    function listener(id, info) {
      if (id === tabId && info.status === 'complete') {
        clearTimeout(timeout); chrome.tabs.onUpdated.removeListener(listener); resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
