// content.js — Injecté dans chaque page, écoute les messages du popup

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "extractContent") {
    try {
      const content = extractPageContent();
      sendResponse({ success: true, data: content });
    } catch (e) {
      sendResponse({ success: false, error: e.message });
    }
  }
  return true; // Garder le canal ouvert pour réponse asynchrone
});

function extractPageContent() {
  // Titre
  const title = document.title || "Sans titre";

  // URL
  const url = window.location.href;

  // Meta description
  const metaDesc = document.querySelector('meta[name="description"]');
  const description = metaDesc ? metaDesc.getAttribute("content") : "";

  // Cloner le body pour manipuler sans modifier la page
  const clone = document.body.cloneNode(true);

  // Supprimer les éléments inutiles
  const toRemove = clone.querySelectorAll(
    "script, style, noscript, iframe, nav, footer, header, " +
    ".nav, .footer, .header, .sidebar, .advertisement, .ads, .cookie, " +
    "[aria-hidden='true'], .sr-only, .visually-hidden"
  );
  toRemove.forEach(el => el.remove());

  // Extraire le texte principal
  const rawText = clone.innerText || clone.textContent || "";

  // Nettoyer le texte : supprimer les lignes vides multiples
  const cleanText = rawText
    .split("\n")
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .join("\n");

  // Extraire tous les liens
  const links = [];
  document.querySelectorAll("a[href]").forEach(a => {
    const href = a.href;
    const text = a.innerText.trim();
    if (href && text && !href.startsWith("javascript:") && text.length > 1) {
      links.push({ text, href });
    }
  });

  // Extraire les titres (h1-h4)
  const headings = [];
  document.querySelectorAll("h1, h2, h3, h4").forEach(h => {
    const text = h.innerText.trim();
    if (text) headings.push({ level: h.tagName, text });
  });

  // Compter les mots
  const wordCount = cleanText.split(/\s+/).filter(w => w.length > 0).length;

  // Temps de lecture estimé (250 mots/min)
  const readTime = Math.max(1, Math.round(wordCount / 250));

  return {
    title,
    url,
    description,
    text: cleanText,
    headings,
    links: links.slice(0, 50), // Limiter à 50 liens
    wordCount,
    readTime,
    extractedAt: new Date().toISOString()
  };
}
