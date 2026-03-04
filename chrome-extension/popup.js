// popup.js — Alumni Radar v4.0

const TARGET_CLASS = "_0b0793cb _31e492f1 bf5ce2f1 d3e4cf96 _16d086f0 _9bceb233 e41563ff ffd1c173 _62e1dd3a";

let extractedData = null;
let tableData     = [];
let importedRows  = [];  // lignes du fichier Excel importé
let importedHeaders = []; // headers du fichier importé
let scanStopped   = false;

// ── Tabs ──────────────────────────────────────────────────────
function switchTab(name) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'panel-' + name));
}
document.querySelectorAll('.tab-btn').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));

// ── Helpers ───────────────────────────────────────────────────
function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function formatBytes(n) {
  return n>1048576?(n/1048576).toFixed(1)+' MB':n>1024?(n/1024).toFixed(1)+' KB':n+' B';
}
function formatNum(n) { return n>=1000?(n/1000).toFixed(1)+'k':String(n); }

function extractNameFromUrl(url) {
  const match = (url||'').match(/\/in\/(.+?)(?:\/|$)/);
  if (!match) return null;
  const parts = match[1].split('-');
  const last  = parts[parts.length-1];
  const nameP = /\d/.test(last) ? parts.slice(0,-1) : parts;
  return nameP.map(w=>w.charAt(0).toUpperCase()+w.slice(1).toLowerCase()).join(' ');
}

function extractJobFromHtml(html) {
  const escaped = TARGET_CLASS.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const pat = new RegExp(`<[^>]+class=["\'][^"\']*${escaped}[^"\']*["\'][^>]*>([\\s\\S]*?)<\\/p>`,'i');
  const m = pat.exec(html);
  if (!m) return null;
  return m[1]
    .replace(/<[^>]+>/g,'')
    .replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
    .replace(/&#\d+;/g,'').replace(/&[a-z]+;/g,'').trim() || null;
}

// ══════════════════════════════════════════════════════════════
// ── ONGLET PROFIL ─────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════
document.getElementById('extractBtn').addEventListener('click', async () => {
  const btn = document.getElementById('extractBtn');
  btn.disabled = true;
  document.getElementById('profileResult').innerHTML = '<div class="idle-note">⏳ Analyse en cours…</div>';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('Aucun onglet actif.');
    if (!tab.url?.startsWith('http')) { alert('Ouvrez une page web (http/https).'); return; }

    const res = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: async (url) => {
        try {
          const r = await fetch(url, { credentials:'include', headers:{'Accept':'text/html'} });
          return { html: await r.text(), url, title: document.title, size: 0, status: r.status, ok: r.ok };
        } catch(e) { return { error: e.message }; }
      },
      args: [tab.url]
    });

    const data = res?.[0]?.result;
    if (!data || data.error) throw new Error(data?.error||'Échec');
    extractedData = data;

    const job  = extractJobFromHtml(data.html);
    const name = extractNameFromUrl(data.url);

    const box = document.getElementById('profileResult');
    box.innerHTML = `
      <div class="info-row"><span class="info-label">👤 Nom</span><span class="info-value">${esc(name||'—')}</span></div>
      <div class="info-row"><span class="info-label">💼 Poste actuel</span><span class="info-value">${esc(job||'—')}</span></div>
      <button class="add-btn" id="addToTableBtn">➕ Ajouter au tableau</button>`;

    document.getElementById('addToTableBtn').addEventListener('click', () => {
      tableData.push({ name: name||'—', job: job||'—', url: data.url, error:'' });
      updateTableCount();
      renderTablePanel();
      switchTab('table');
    });

  } catch(e) { alert('Erreur : '+e.message); }
  finally { btn.disabled = false; }
});

// ══════════════════════════════════════════════════════════════
// ── ONGLET IMPORT EXCEL ───────────────────────────────────────
// ══════════════════════════════════════════════════════════════
const dropZone  = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');

dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', e => { e.preventDefault(); dropZone.classList.remove('dragover'); handleFile(e.dataTransfer.files[0]); });
fileInput.addEventListener('change', () => handleFile(fileInput.files[0]));

function handleFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async e => {
    try {
      const result = await XLSXParser.read(e.target.result);
      if (!result.rows.length) { alert('Le fichier semble vide.'); return; }
      importedRows   = result.rows;
      importedHeaders = result.headers;
      showColMapper(result.rows, result.headers);
    } catch(err) { alert('Erreur lecture Excel : ' + err.message); }
  };
  reader.readAsArrayBuffer(file);
}

function showColMapper(rows, cols) {
  if (!cols) cols = Object.keys(rows[0]);
  ['colName','colJob','colUrl'].forEach(id => {
    const sel = document.getElementById(id);
    sel.innerHTML = cols.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('');
  });
  // Auto-détecter les colonnes
  autoDetect(cols, 'colName', ['nom','name','prenom','prénom','firstname','lastname']);
  autoDetect(cols, 'colJob',  ['metier','métier','poste','job','title','fonction','emploi']);
  autoDetect(cols, 'colUrl',  ['url','linkedin','lien','link','profil']);

  renderPreview(rows.slice(0,5), cols);
  document.getElementById('colMapSection').style.display = 'block';
}

function autoDetect(cols, selId, keywords) {
  const sel = document.getElementById(selId);
  const match = cols.find(c => keywords.some(k => c.toLowerCase().includes(k)));
  if (match) sel.value = match;
}

function renderPreview(rows, cols) {
  const t = document.getElementById('previewTable');
  t.innerHTML = `<thead><tr>${cols.map(c=>`<th>${esc(c)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(r=>`<tr>${cols.map(c=>`<td>${esc(r[c])}</td>`).join('')}</tr>`).join('')}</tbody>`;
}

// ══════════════════════════════════════════════════════════════
// ── SCAN AUTOMATIQUE ──────────────────────────────────────────
// ══════════════════════════════════════════════════════════════
document.getElementById('startScanBtn').addEventListener('click', startScan);
document.getElementById('stopScanBtn').addEventListener('click',  () => { scanStopped = true; });

async function startScan() {
  if (!importedRows.length) return;

  const colName = document.getElementById('colName').value;
  const colJob  = document.getElementById('colJob').value;
  const colUrl  = document.getElementById('colUrl').value;

  // Préparer les données
  const rows = importedRows.map(r => ({
    name:    String(r[colName]||''),
    job:     String(r[colJob] ||''),
    url:     String(r[colUrl] ||''),
    newJob:  null,
    error:   '',
    _raw:    r
  }));

  scanStopped = false;
  const total = rows.length;
  // Afficher le warning "ne pas fermer"
  document.getElementById('scanWarning').style.display = 'flex';
  // Afficher la section scan active
  document.getElementById('noScanMsg').style.display = 'none';
  document.getElementById('scanActiveSection').style.display = 'flex';
  document.getElementById('scanCount').textContent = total;
  document.getElementById('progressCount').textContent = `0 / ${total}`;
  document.getElementById('progressBar').style.width = '0%';
  document.getElementById('progressCurrent').textContent = 'Démarrage…';
  document.getElementById('scanLog').innerHTML = '';
  document.getElementById('exportDoneBtn').style.display = 'none';
  document.getElementById('startScanBtn').disabled = true;

  switchTab('scan');

  for (let i = 0; i < rows.length; i++) {
    if (scanStopped) break;

    const row = rows[i];
    const pct = Math.round(((i) / total) * 100);
    document.getElementById('progressBar').style.width = pct + '%';
    document.getElementById('progressCount').textContent = `${i} / ${total}`;
    document.getElementById('progressCurrent').textContent = `⏳ ${row.name || row.url}`;

    if (!row.url || !row.url.startsWith('http')) {
      row.error = 'URL manquante ou invalide';
      appendLog(row, '⚠️');
      continue;
    }

    try {
      const result = await chrome.runtime.sendMessage({ action: 'scanProfile', url: row.url });
      if (result.error) throw new Error(result.error);
      row.newJob = result.job || null;
      if (!row.newJob) row.error = 'Poste non trouvé';
      appendLog(row, row.newJob ? '✅' : '⚠️');
    } catch(e) {
      row.error = e.message;
      appendLog(row, '❌');
    }

    // Délai entre chaque profil pour éviter le rate-limit LinkedIn
    if (i < rows.length - 1 && !scanStopped) await sleep(1000 + Math.random() * 4000);
  }

  // Résumé final
  document.getElementById('progressBar').style.width = '100%';
  document.getElementById('progressCount').textContent = `${rows.length} / ${total}`;
  document.getElementById('progressCurrent').textContent = scanStopped ? '⏹ Scan arrêté' : '✅ Scan terminé !';

  // Mettre à jour le tableau interne
  tableData = rows.map(r => ({
    name:  r.name,
    job:   r.newJob || r.job,
    url:   r.url,
    error: r.error
  }));
  updateTableCount();
  renderTablePanel();

  // Préparer l'export Excel mis à jour
  prepareUpdatedWorkbook(rows, colJob);
  document.getElementById('exportDoneBtn').style.display = 'block';
  document.getElementById('startScanBtn').disabled = false;
  document.getElementById('scanWarning').style.display = 'none';
  document.getElementById('progressTitle') && (document.getElementById('progressTitle').textContent = scanStopped ? 'Scan arrêté' : 'Scan terminé !');
}

function appendLog(row, icon) {
  const log  = document.getElementById('scanLog');
  const div  = document.createElement('div');
  div.className = 'log-item';
  div.innerHTML = `
    <span class="log-status">${icon}</span>
    <div>
      <div class="log-name">${esc(row.name||row.url)}</div>
      ${row.newJob ? `<div class="log-job">${esc(row.newJob)}</div>` : ''}
      ${row.error  ? `<div class="log-err">${esc(row.error)}</div>`  : ''}
    </div>`;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}

// ── Export Excel mis à jour ───────────────────────────────────
let updatedWbData = null;

function prepareUpdatedWorkbook(rows, colJob) {
  // Construire les headers : conserver les colonnes d'origine + ajouter Erreur
  const headers = [...importedHeaders];
  if (!headers.includes('Erreur')) headers.push('Erreur');

  // Reconstruire les lignes avec le métier mis à jour
  const updatedRows = rows.map(row => {
    const r = { ...row._raw };
    if (row.newJob) r[colJob] = row.newJob;
    r['Erreur'] = row.error || '';
    return r;
  });

  updatedWbData = XLSXParser.write(headers, updatedRows);
}

document.getElementById('exportDoneBtn').addEventListener('click', () => {
  if (!updatedWbData) return;
  const blob = new Blob([updatedWbData], { type:'application/octet-stream' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = 'alumni-radar-updated.xlsx'; a.click();
  URL.revokeObjectURL(url);
});

// ══════════════════════════════════════════════════════════════
// ── TABLEAU MANUEL ────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════
function renderTablePanel() {
  const box = document.getElementById('tablePanel');
  document.getElementById('tableBadge').textContent = tableData.length + ' profil' + (tableData.length>1?'s':'');

  if (!tableData.length) {
    box.innerHTML = `<div class="no-result"><span class="no-icon">📋</span>
      <p>Aucune entrée.</p><p class="no-hint">Analysez des profils ou lancez un scan Excel.</p></div>`;
    return;
  }

  const hasErr = tableData.some(r => r.error);
  box.innerHTML = `
    <table class="main">
      <thead><tr>
        <th>#</th><th>Nom</th><th>Poste actuel</th>${hasErr?'<th>Erreur</th>':''}
      </tr></thead>
      <tbody>
        ${tableData.map((r,i)=>`<tr>
          <td class="td-num">${i+1}</td>
          <td class="td-name"><a class="profile-link" data-url="${esc(r.url)}">${esc(r.name)}</a></td>
          <td class="td-job">${esc(r.job)}</td>
          ${hasErr?`<td class="td-err">${esc(r.error)}</td>`:''}
        </tr>`).join('')}
      </tbody>
    </table>`;

  box.querySelectorAll('.profile-link').forEach(a =>
    a.addEventListener('click', () => chrome.tabs.create({ url: a.dataset.url }))
  );
}

function updateTableCount() {
  document.getElementById('tableCount').textContent = tableData.length;
}

document.getElementById('exportCsvBtn').addEventListener('click', () => {
  const hasErr = tableData.some(r=>r.error);
  const headers = ['Nom','Poste actuel','URL'].concat(hasErr?['Erreur']:[]);
  const rows = tableData.map(r=>[r.name,r.job,r.url].concat(hasErr?[r.error]:[]));
  const csv  = [headers,...rows].map(r=>r.map(c=>`"${String(c||'').replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'});
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href=url; a.download='alumni-radar.csv'; a.click();
  URL.revokeObjectURL(url);
});

document.getElementById('clearTableBtn').addEventListener('click',()=>{
  tableData=[]; updateTableCount(); renderTablePanel();
});

function sleep(ms) { return new Promise(r=>setTimeout(r,ms)); }

// Init
renderTablePanel();
