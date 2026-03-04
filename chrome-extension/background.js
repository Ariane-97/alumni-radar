// background.js — Service worker Alumni Radar
// Gère le scan automatique des profils LinkedIn en arrière-plan

const TARGET_CLASS = "_0b0793cb _31e492f1 bf5ce2f1 d3e4cf96 _16d086f0 _9bceb233 e41563ff ffd1c173 _62e1dd3a";

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'scanProfile') {
    scanProfile(msg.url).then(sendResponse).catch(err => sendResponse({ error: err.message }));
    return true; // async
  }
});

async function scanProfile(url) {
  let tabId = null;
  try {
    // Ouvrir le profil dans un onglet en arrière-plan
    const tab = await chrome.tabs.create({ url, active: false });
    tabId = tab.id;

    // Attendre que la page soit chargée
    await waitForTabLoad(tabId);

    // Petite pause pour le rendu JS de LinkedIn
    await sleep(2500);

    // Fetch le HTML depuis le contexte de la page
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (pageUrl) => {
        try {
          const res = await fetch(pageUrl, { credentials: 'include', headers: { 'Accept': 'text/html' } });
          return { html: await res.text(), ok: res.ok };
        } catch(e) { return { error: e.message }; }
      },
      args: [url]
    });

    const r = results?.[0]?.result;
    if (!r || r.error) throw new Error(r?.error || 'Fetch échoué');
    if (!r.ok) throw new Error('HTTP non-OK');

    // Extraire le poste
    const job = extractJob(r.html, TARGET_CLASS);
    return { job };

  } finally {
    // Toujours fermer l'onglet
    if (tabId) {
      try { await chrome.tabs.remove(tabId); } catch(e) {}
    }
  }
}

function extractJob(html, className) {
  const escaped = className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(
    `<[^>]+class=["\'][^"\']*${escaped}[^"\']*["\'][^>]*>([\\s\\S]*?)<\\/p>`,
    'i'
  );
  const match = pattern.exec(html);
  if (!match) return null;
  return match[1]
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#\d+;/g, '').replace(/&[a-z]+;/g, '')
    .trim() || null;
}

function waitForTabLoad(tabId) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timeout chargement')), 20000);
    function listener(id, info) {
      if (id === tabId && info.status === 'complete') {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
