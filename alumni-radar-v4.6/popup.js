// popup.js — Alumni Radar v4.6

let extractedData   = null;
let tableData       = [];
let importedRows    = [];
let importedHeaders = [];
let lastLogCount    = 0;
let colJobCurrent, colCompanyCurrent, colNameCurrent;

// ── Tabs ──────────────────────────────────────────────────────
function switchTab(name) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'panel-' + name));
}
document.querySelectorAll('.tab-btn').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));

function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function extractNameFromUrl(url) {
  const match = (url||'').match(/\/in\/(.+?)(?:\/|$)/);
  if (!match) return null;
  const parts = match[1].split('-');
  const last  = parts[parts.length-1];
  const nameP = /\d/.test(last) ? parts.slice(0,-1) : parts;
  return nameP.map(w=>w.charAt(0).toUpperCase()+w.slice(1).toLowerCase()).join(' ');
}

// ── Extraction DOM (onglet profil manuel) ─────────────────────
function extractLinkedInFromDOM() {
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
    return { name: clean(name), job: clean(job), company: clean(company), url: window.location.href };
  } catch(e) { return { error: e.message }; }
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
    const res = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: extractLinkedInFromDOM });
    const data = res?.[0]?.result;
    if (!data || data.error) throw new Error(data?.error || 'Échec extraction');
    extractedData = data;
    const { job, company } = data;
    const name = data.name || extractNameFromUrl(data.url);
    document.getElementById('profileResult').innerHTML = `
      <div class="info-row"><span class="info-label">👤 Nom</span><span class="info-value">${esc(name||'—')}</span></div>
      <div class="info-row"><span class="info-label">💼 Poste actuel</span><span class="info-value">${esc(job||'—')}</span></div>
      <div class="info-row"><span class="info-label">🏢 Entreprise</span><span class="info-value">${esc(company||'—')}</span></div>
      <button class="add-btn" id="addToTableBtn">➕ Ajouter au tableau</button>`;
    document.getElementById('addToTableBtn').addEventListener('click', () => {
      tableData.push({ name: name||'—', job: job||'—', company: company||'—', url: data.url, error:'' });
      updateTableCount(); renderTablePanel(); switchTab('table');
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
      importedRows    = result.rows;
      importedHeaders = result.headers;
      showColMapper(result.rows, result.headers);
    } catch(err) { alert('Erreur lecture Excel : ' + err.message); }
  };
  reader.readAsArrayBuffer(file);
}
function showColMapper(rows, cols) {
  if (!cols) cols = Object.keys(rows[0]);
  ['colName','colJob','colCompany','colUrl'].forEach(id => {
    document.getElementById(id).innerHTML = cols.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('');
  });
  autoDetect(cols, 'colName',    ['nom','name','prenom','prénom','firstname','lastname']);
  autoDetect(cols, 'colJob',     ['metier','métier','poste','job','title','fonction','emploi']);
  autoDetect(cols, 'colCompany', ['entreprise','company','société','societe','employeur','employer','organization']);
  autoDetect(cols, 'colUrl',     ['url','linkedin','lien','link','profil']);
  renderPreview(rows.slice(0,5), cols);
  document.getElementById('colMapSection').style.display = 'block';
}
function autoDetect(cols, selId, keywords) {
  const sel = document.getElementById(selId);
  const match = cols.find(c => keywords.some(k => c.toLowerCase().includes(k)));
  if (match) sel.value = match;
}
function renderPreview(rows, cols) {
  document.getElementById('previewTable').innerHTML =
    `<thead><tr>${cols.map(c=>`<th>${esc(c)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(r=>`<tr>${cols.map(c=>`<td>${esc(r[c])}</td>`).join('')}</tr>`).join('')}</tbody>`;
}

// ══════════════════════════════════════════════════════════════
// ── SCAN — délégué au background.js ──────────────────────────
// ══════════════════════════════════════════════════════════════
document.getElementById('startScanBtn').addEventListener('click', startScan);
document.getElementById('stopScanBtn').addEventListener('click', () => chrome.runtime.sendMessage({ action: 'stopScan' }));

async function startScan() {
  if (!importedRows.length) return;
  colNameCurrent    = document.getElementById('colName').value;
  colJobCurrent     = document.getElementById('colJob').value;
  const colUrl      = document.getElementById('colUrl').value;
  colCompanyCurrent = document.getElementById('colCompany').value;

  const rows = importedRows.map(r => ({
    name: String(r[colNameCurrent]||''), job: String(r[colJobCurrent]||''),
    company: String(r[colCompanyCurrent]||''), url: String(r[colUrl]||''),
    newJob: null, newCompany: null, newName: null, error: '', _raw: r
  }));

  await chrome.runtime.sendMessage({ action: 'resetScan' });
  lastLogCount = 0;

  document.getElementById('scanWarning').style.display = 'flex';
  document.getElementById('noScanMsg').style.display = 'none';
  document.getElementById('scanActiveSection').style.display = 'flex';
  document.getElementById('scanCount').textContent = rows.length;
  document.getElementById('progressCount').textContent = `0 / ${rows.length}`;
  document.getElementById('progressBar').style.width = '0%';
  document.getElementById('progressCurrent').textContent = 'Démarrage…';
  document.getElementById('scanLog').innerHTML = '';
  document.getElementById('exportDoneBtn').style.display = 'none';
  document.getElementById('startScanBtn').disabled = true;
  switchTab('scan');

  chrome.runtime.sendMessage({ action: 'startScan', payload: { rows, colJob: colJobCurrent, colCompany: colCompanyCurrent, colName: colNameCurrent, importedHeaders } });
  pollScanState();
}

async function pollScanState() {
  try {
    const { state } = await chrome.runtime.sendMessage({ action: 'getScanState' });
    applyStateToUI(state);
    if (state.running) setTimeout(pollScanState, 800);
  } catch(e) { setTimeout(pollScanState, 800); }
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'scanStateUpdate') applyStateToUI(msg.state);
});

function applyStateToUI(state) {
  if (!state) return;
  const total   = state.total || 1;
  const current = state.current || 0;
  const pct     = Math.round((current / total) * 100);

  document.getElementById('progressBar').style.width = pct + '%';
  document.getElementById('progressCount').textContent = `${current} / ${total}`;
  document.getElementById('scanCount').textContent = total;

  const newLogs = state.logs.slice(lastLogCount);
  newLogs.forEach(appendLogItem);
  lastLogCount = state.logs.length;

  if (state.running && state.rows[current]) {
    document.getElementById('progressCurrent').textContent = `⏳ ${state.rows[current].name || state.rows[current].url}`;
  }

  if (state.done || state.stopped) {
    document.getElementById('progressBar').style.width = '100%';
    document.getElementById('progressCount').textContent = `${total} / ${total}`;
    document.getElementById('progressCurrent').textContent = state.stopped ? '⏹ Scan arrêté' : '✅ Scan terminé !';
    document.getElementById('startScanBtn').disabled = false;
    document.getElementById('scanWarning').style.display = 'none';

    tableData = state.rows.map(r => ({
      name: r.newName||r.name, job: r.newJob||r.job,
      company: r.newCompany||(r._raw && r._raw[colCompanyCurrent])||'',
      url: r.url, error: r.error
    }));
    updateTableCount();
    renderTablePanel();
  }
}

function appendLogItem(log) {
  const logEl = document.getElementById('scanLog');
  const div   = document.createElement('div');
  div.className = 'log-item';
  div.innerHTML = `<span class="log-status">${log.icon}</span>
    <div><div class="log-name">${esc(log.name)}</div>
    ${log.newJob ? `<div class="log-job">${esc(log.newJob)}</div>` : ''}
    ${log.error  ? `<div class="log-err">${esc(log.error)}</div>`  : ''}</div>`;
  logEl.appendChild(div);
  logEl.scrollTop = logEl.scrollHeight;
}

// ── Export Excel — lit depuis chrome.storage ──────────────────
document.getElementById('exportDoneBtn').addEventListener('click', downloadExcel);

async function downloadExcel() {
  try {
    const stored = await chrome.storage.local.get(['exportHeaders','exportRows']);
    if (!stored.exportHeaders || !stored.exportRows) { alert('Données non disponibles.'); return; }
    const wb   = XLSXParser.write(stored.exportHeaders, stored.exportRows);
    const blob = new Blob([wb], { type:'application/octet-stream' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = 'alumni-radar-updated.xlsx'; a.click();
    URL.revokeObjectURL(url);
  } catch(e) { alert('Erreur export : ' + e.message); }
}

// ══════════════════════════════════════════════════════════════
// ── TABLEAU ───────────────────────────────────────────────────
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
  box.innerHTML = `<table class="main"><thead><tr>
    <th>#</th><th>Nom</th><th>Poste actuel</th><th>Entreprise</th>${hasErr?'<th>Erreur</th>':''}
    </tr></thead><tbody>
    ${tableData.map((r,i)=>`<tr>
      <td class="td-num">${i+1}</td>
      <td class="td-name"><a class="profile-link" data-url="${esc(r.url)}">${esc(r.name)}</a></td>
      <td class="td-job">${esc(r.job)}</td>
      <td class="td-job">${esc(r.company||'—')}</td>
      ${hasErr?`<td class="td-err">${esc(r.error)}</td>`:''}
    </tr>`).join('')}</tbody></table>`;
  box.querySelectorAll('.profile-link').forEach(a =>
    a.addEventListener('click', () => chrome.tabs.create({ url: a.dataset.url }))
  );
}
function updateTableCount() { document.getElementById('tableCount').textContent = tableData.length; }

document.getElementById('exportCsvBtn').addEventListener('click', () => {
  const hasErr = tableData.some(r=>r.error);
  const headers = ['Nom','Poste actuel','Entreprise','URL'].concat(hasErr?['Erreur']:[]);
  const rows = tableData.map(r=>[r.name,r.job,r.company||'',r.url].concat(hasErr?[r.error]:[]));
  const csv  = [headers,...rows].map(r=>r.map(c=>`"${String(c||'').replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'});
  const url  = URL.createObjectURL(blob); const a = document.createElement('a');
  a.href=url; a.download='alumni-radar.csv'; a.click(); URL.revokeObjectURL(url);
});
document.getElementById('clearTableBtn').addEventListener('click',()=>{ tableData=[]; updateTableCount(); renderTablePanel(); });

// ══════════════════════════════════════════════════════════════
// ── INIT — au chargement du popup ────────────────────────────
// ══════════════════════════════════════════════════════════════
async function init() {
  renderTablePanel();

  // 1. Vérifier si un export est prêt dans le storage (scan terminé, popup rouvert)
  const stored = await chrome.storage.local.get(['exportReady']);
  if (stored.exportReady) {
    // Afficher directement l'onglet scan avec le bouton de téléchargement
    document.getElementById('noScanMsg').style.display = 'none';
    document.getElementById('scanActiveSection').style.display = 'flex';
    document.getElementById('progressCurrent').textContent = '✅ Scan terminé !';
    document.getElementById('progressBar').style.width = '100%';
    document.getElementById('exportDoneBtn').style.display = 'block';
    document.getElementById('startScanBtn').disabled = false;
    switchTab('scan');
  }

  // 2. Vérifier si un scan est en cours
  try {
    const { state } = await chrome.runtime.sendMessage({ action: 'getScanState' });
    if (state && state.running) {
      lastLogCount = 0;
      document.getElementById('noScanMsg').style.display = 'none';
      document.getElementById('scanActiveSection').style.display = 'flex';
      document.getElementById('scanWarning').style.display = 'flex';
      document.getElementById('startScanBtn').disabled = true;
      applyStateToUI(state);
      pollScanState();
      switchTab('scan');
    } else if (state && state.done) {
      applyStateToUI(state);
    }
  } catch(e) {}
}

init();
