// xlsxparser.js — Lecteur XLSX minimal (pas de dépendance externe)
// Un fichier .xlsx est un ZIP contenant des XML. On décompresse avec DecompressionStream.

window.XLSXParser = (function() {

  // ── Décompresser un flux DEFLATE raw ──────────────────────
  async function inflate(data) {
    const ds = new DecompressionStream('deflate-raw');
    const writer = ds.writable.getWriter();
    writer.write(data);
    writer.close();
    const chunks = [];
    const reader = ds.readable.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    const total = chunks.reduce((s, c) => s + c.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) { out.set(c, offset); offset += c.length; }
    return out;
  }

  // ── Lire un ZIP et retourner { filename -> Uint8Array } ──
  async function readZip(buffer) {
    const view = new DataView(buffer);
    const files = {};
    let offset = 0;
    const u8 = new Uint8Array(buffer);
    const dec = new TextDecoder('utf-8');

    while (offset < buffer.byteLength - 4) {
      const sig = view.getUint32(offset, true);
      if (sig !== 0x04034b50) break; // Local file header

      const flags      = view.getUint16(offset + 6, true);
      const compression= view.getUint16(offset + 8, true);
      const compSize   = view.getUint32(offset + 18, true);
      const fnLen      = view.getUint16(offset + 26, true);
      const extraLen   = view.getUint16(offset + 28, true);
      const fnBytes    = u8.slice(offset + 30, offset + 30 + fnLen);
      const filename   = dec.decode(fnBytes);
      const dataOffset = offset + 30 + fnLen + extraLen;
      const compData   = u8.slice(dataOffset, dataOffset + compSize);

      if (compression === 0) {
        files[filename] = compData;
      } else if (compression === 8) {
        files[filename] = await inflate(compData);
      }
      offset = dataOffset + compSize;
    }
    return files;
  }

  // ── Parser XML minimaliste ────────────────────────────────
  function parseXML(str) {
    return new DOMParser().parseFromString(str, 'application/xml');
  }

  // ── Décoder une valeur de cellule Excel ──────────────────
  function decodeCell(cell, sharedStrings) {
    const t = cell.getAttribute('t');
    const v = cell.querySelector('v');
    if (!v) return '';
    if (t === 's') return sharedStrings[parseInt(v.textContent)] || '';
    if (t === 'b') return v.textContent === '1' ? 'TRUE' : 'FALSE';
    return v.textContent;
  }

  // ── Convertir une référence cellule (ex: AB12) en {col, row} ─
  function cellRef(ref) {
    const m = ref.match(/^([A-Z]+)(\d+)$/);
    if (!m) return null;
    let col = 0;
    for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
    return { col: col - 1, row: parseInt(m[2]) - 1 };
  }

  // ── Lire un fichier XLSX (ArrayBuffer) ───────────────────
  async function read(arrayBuffer) {
    const files = await readZip(arrayBuffer);
    const dec   = new TextDecoder('utf-8');

    // Shared strings
    let sharedStrings = [];
    if (files['xl/sharedStrings.xml']) {
      const xml = parseXML(dec.decode(files['xl/sharedStrings.xml']));
      sharedStrings = Array.from(xml.querySelectorAll('si')).map(si => {
        // Concaténer tous les <t> (textes riches)
        return Array.from(si.querySelectorAll('t')).map(t => t.textContent).join('');
      });
    }

    // Workbook — liste des feuilles
    const wbXml    = parseXML(dec.decode(files['xl/workbook.xml']));
    const sheetEls = Array.from(wbXml.querySelectorAll('sheet'));
    const sheetNames = sheetEls.map(s => s.getAttribute('name'));

    // Première feuille
    const sheetFile = files['xl/worksheets/sheet1.xml'];
    if (!sheetFile) throw new Error('Feuille introuvable dans le ZIP');
    const wsXml = parseXML(dec.decode(sheetFile));

    // Lire les lignes
    const rowEls = Array.from(wsXml.querySelectorAll('row'));
    const matrix = [];
    for (const rowEl of rowEls) {
      const rIdx = parseInt(rowEl.getAttribute('r')) - 1;
      const cells = Array.from(rowEl.querySelectorAll('c'));
      for (const cell of cells) {
        const ref = cell.getAttribute('r');
        const pos = cellRef(ref);
        if (!pos) continue;
        while (matrix.length <= pos.row) matrix.push([]);
        while (matrix[pos.row].length <= pos.col) matrix[pos.row].push('');
        matrix[pos.row][pos.col] = decodeCell(cell, sharedStrings);
      }
    }

    if (matrix.length < 2) return { sheetNames, rows: [] };

    // Première ligne = headers
    const headers = matrix[0].map(h => String(h).trim()).filter(Boolean);
    const maxCol  = headers.length;
    const rows = matrix.slice(1).map(row => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = row[i] !== undefined ? row[i] : ''; });
      return obj;
    }).filter(r => Object.values(r).some(v => v !== ''));

    return { sheetNames, headers, rows };
  }

  // ── Générer un XLSX simple ────────────────────────────────
  // Ecrit un tableau d'objets en XLSX (format simple sans formatage)
  function write(headers, rows) {
    // On génère le XML manuellement
    const esc = s => String(s||'')
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&apos;');

    const sharedStrs = [];
    const strIndex = {};
    function si(v) {
      const s = String(v||'');
      if (strIndex[s] === undefined) { strIndex[s] = sharedStrs.length; sharedStrs.push(s); }
      return strIndex[s];
    }

    // Pré-indexer toutes les strings
    headers.forEach(si);
    rows.forEach(r => headers.forEach(h => si(r[h])));

    // Générer les cellules
    function colLetter(n) {
      let s = ''; n++;
      while (n > 0) { s = String.fromCharCode(64 + (n % 26 || 26)) + s; n = Math.floor((n - 1) / 26); }
      return s;
    }

    let wsRows = '';
    const allRows = [headers.reduce((o,h)=>{o[h]=h;return o;},{}), ...rows];
    allRows.forEach((row, ri) => {
      let cells = '';
      headers.forEach((h, ci) => {
        const ref = colLetter(ci) + (ri+1);
        cells += `<c r="${ref}" t="s"><v>${si(row[h])}</v></c>`;
      });
      wsRows += `<row r="${ri+1}">${cells}</row>`;
    });

    const lastCol = colLetter(headers.length - 1);
    const lastRow = allRows.length;

    const wsXml = `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetData>${wsRows}</sheetData></worksheet>`;

    const ssXml = `<?xml version="1.0" encoding="UTF-8"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${sharedStrs.length}" uniqueCount="${sharedStrs.length}">
${sharedStrs.map(s=>`<si><t xml:space="preserve">${esc(s)}</t></si>`).join('')}
</sst>`;

    const wbXml = `<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="Alumni Radar" sheetId="1" r:id="rId1"/></sheets></workbook>`;

    const wbRels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
</Relationships>`;

    const rels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

    const ct = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
</Types>`;

    // Assembler le ZIP
    return buildZip([
      { name:'[Content_Types].xml',            data: ct },
      { name:'_rels/.rels',                    data: rels },
      { name:'xl/workbook.xml',                data: wbXml },
      { name:'xl/_rels/workbook.xml.rels',     data: wbRels },
      { name:'xl/worksheets/sheet1.xml',       data: wsXml },
      { name:'xl/sharedStrings.xml',           data: ssXml },
    ]);
  }

  // ── Construire un ZIP (store, pas de compression) ─────────
  function buildZip(entries) {
    const enc = new TextEncoder();
    const centralDir = [];
    const parts = [];
    let offset = 0;

    function crc32(data) {
      let crc = 0xFFFFFFFF;
      for (const b of data) {
        crc ^= b;
        for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
      }
      return (crc ^ 0xFFFFFFFF) >>> 0;
    }

    function u16(n) { const b=new Uint8Array(2); new DataView(b.buffer).setUint16(0,n,true); return b; }
    function u32(n) { const b=new Uint8Array(4); new DataView(b.buffer).setUint32(0,n,true); return b; }
    function concat(...arrays) {
      const total = arrays.reduce((s,a)=>s+a.length,0);
      const out = new Uint8Array(total); let off=0;
      for (const a of arrays) { out.set(a,off); off+=a.length; }
      return out;
    }

    for (const { name, data } of entries) {
      const fnBytes  = enc.encode(name);
      const content  = enc.encode(data);
      const crc      = crc32(content);
      const size     = content.length;

      const local = concat(
        new Uint8Array([0x50,0x4B,0x03,0x04]),
        u16(20), u16(0), u16(0), u16(0), u16(0),
        u32(crc), u32(size), u32(size),
        u16(fnBytes.length), u16(0),
        fnBytes, content
      );
      parts.push(local);

      centralDir.push(concat(
        new Uint8Array([0x50,0x4B,0x01,0x02]),
        u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
        u32(crc), u32(size), u32(size),
        u16(fnBytes.length), u16(0), u16(0), u16(0), u16(0), u32(0),
        u32(offset), fnBytes
      ));
      offset += local.length;
    }

    const cdData   = concat(...centralDir);
    const cdSize   = cdData.length;
    const cdOffset = offset;
    const eocd = concat(
      new Uint8Array([0x50,0x4B,0x05,0x06]),
      u16(0), u16(0),
      u16(centralDir.length), u16(centralDir.length),
      u32(cdSize), u32(cdOffset), u16(0)
    );
    return concat(...parts, cdData, eocd);
  }

  return { read, write };
})();
