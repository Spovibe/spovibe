/* ============================================================
   Spovibe — Système de certificats
   Génère des SVG paramétrés (1200×630, format social card) pour
   les évaluations réussies et les retraits, avec un numéro
   de série déterministe et 3 modes d'export : SVG, PNG, PDF.
   ============================================================ */
(function (global) {
  "use strict";

  // ---------- Numéro de série déterministe ----------
  function certSerial(payload) {
    let h = 5381;
    const s = String(payload || "");
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    const hex = (h >>> 0).toString(16).toUpperCase().padStart(8, "0");
    return "SPV-" + hex.slice(0, 4) + "-" + hex.slice(4, 8);
  }

  function fmtDateLong(ts) {
    return new Date(ts).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
  }

  function escapeXml(s) {
    return String(s || "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // Logo Spovibe inline SVG (speedlines + S + povibe)
  function logoSvg(x, y) {
    return `<g transform="translate(${x}, ${y})">
      <g fill="#7C6BF6">
        <rect x="14" y="0" width="22" height="6" rx="3" opacity=".55"/>
        <rect x="0" y="10" width="36" height="6" rx="3"/>
        <rect x="18" y="20" width="20" height="6" rx="3" opacity=".45"/>
      </g>
      <text x="48" y="22" font-family="Quicksand, 'Trebuchet MS', sans-serif" font-weight="700" font-size="30" fill="#0F0E1A" letter-spacing="-0.5">
        <tspan fill="#7C6BF6">S</tspan>povibe
      </text>
    </g>`;
  }

  // Bloc de stats 4 colonnes (clé + valeur)
  function statsBlock(x, y, stats) {
    const w = 280, h = 90, gap = 18, total = stats.length, totalW = total * w + (total - 1) * gap;
    let html = "";
    stats.forEach((s, i) => {
      const cx = x + i * (w + gap);
      html += `<g transform="translate(${cx}, ${y})">
        <rect width="${w}" height="${h}" rx="14" fill="#FBFAFE" stroke="rgba(15,14,26,0.08)" stroke-width="1"/>
        <text x="20" y="34" font-family="Archivo, sans-serif" font-weight="700" font-size="11" letter-spacing="1.6" fill="#6B6A82" text-transform="uppercase">${escapeXml(s.label.toUpperCase())}</text>
        <text x="20" y="68" font-family="Archivo, sans-serif" font-weight="800" font-size="26" fill="${s.color || '#0F0E1A'}" letter-spacing="-0.5">${escapeXml(s.value)}</text>
      </g>`;
    });
    return { html, totalWidth: totalW };
  }

  // ---------- Template : Certificat de réussite ----------
  function renderAchievementSVG(user, account, opts) {
    opts = opts || {};
    const tier = account.tier || {};
    const s = global.SF && SF.stats ? SF.stats(account) : null;
    const vert = (account.vertical || tier.vertical || "sports") === "predictions" ? "Prédictions" : "Sports";
    const name = user.name || user.email || "Spovibe Trader";
    const date = opts.date || account.fundedAt || account.startedAt || Date.now();
    const serial = certSerial(user.email + ":" + tier.id + ":achievement");
    const profitPct = s ? Math.max(s.profitPct, tier.target) : tier.target;
    const ddUsed = s ? Math.max(0, Math.min(tier.maxDD, Math.round(s.ddUsedPct * tier.maxDD / 100))) : 0;
    const betsCount = s ? Math.max(s.bets, tier.minBets) : tier.minBets;
    const daysCount = s ? Math.max(s.activeDays, tier.minActiveDays) : tier.minActiveDays;
    const unit = tier.unitLabel === "positions" ? "positions" : "paris";

    const stats = statsBlock(60, 380, [
      { label: "Profit",   value: "+" + profitPct + " %",       color: "#1FB573" },
      { label: "Drawdown", value: ddUsed + " % / " + tier.maxDD + " %", color: "#0F0E1A" },
      { label: unit === "positions" ? "Positions" : "Paris",
        value: betsCount + " / " + tier.minBets, color: "#0F0E1A" },
      { label: "Jours actifs", value: daysCount + " / " + tier.minActiveDays, color: "#0F0E1A" },
    ]);

    return `<svg viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg" font-family="Archivo, sans-serif">
      <defs>
        <linearGradient id="gP" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#7C6BF6"/>
          <stop offset="1" stop-color="#9D8FF7"/>
        </linearGradient>
        <linearGradient id="gW" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stop-color="rgba(124,107,246,0.10)"/>
          <stop offset="1" stop-color="rgba(124,107,246,0)"/>
        </linearGradient>
      </defs>
      <rect width="1200" height="630" fill="#F5F3FB"/>
      <rect x="0" y="0" width="1200" height="8" fill="url(#gP)"/>
      <path d="M1200 0 L1200 240 L920 0 Z" fill="url(#gP)" opacity="0.18"/>
      <circle cx="120" cy="640" r="180" fill="url(#gP)" opacity="0.10"/>
      <rect x="0" y="540" width="1200" height="90" fill="url(#gW)"/>

      ${logoSvg(60, 56)}

      <text x="60" y="170" font-weight="700" font-size="14" letter-spacing="4.8" fill="#7C6BF6">CERTIFICAT DE RÉUSSITE · ÉVALUATION ${vert.toUpperCase()}</text>

      <text x="60" y="244" font-family="Georgia, 'Times New Roman', serif" font-weight="700" font-size="58" fill="#0F0E1A">${escapeXml(name)}</text>

      <text x="60" y="300" font-size="20" fill="#6B6A82">a validé l'évaluation Spovibe ${vert} et pilote désormais</text>
      <text x="60" y="346" font-weight="800" font-size="44" fill="#0F0E1A" letter-spacing="-0.5">un capital de <tspan fill="#7C6BF6">${escapeXml(tier.capital ? (tier.capital.toLocaleString("fr-FR") + " €") : "—")}</tspan></text>

      ${stats.html}

      <text x="60" y="568" font-size="14" fill="#6B6A82">Validé le ${escapeXml(fmtDateLong(date))} · Palier <tspan font-weight="700" fill="#0F0E1A">${escapeXml(tier.name || "")}</tspan> · Partage des profits <tspan font-weight="700" fill="#0F0E1A">${tier.split || 85} %</tspan></text>
      <text x="60" y="592" font-size="13" fill="#9D9BAE">Spovibe · La prop firm multi-marché — sports &amp; marchés prédictifs</text>

      <text x="1140" y="568" font-size="14" font-weight="700" fill="#0F0E1A" text-anchor="end" letter-spacing="2">N° ${escapeXml(serial)}</text>
      <text x="1140" y="592" font-size="12" fill="#9D9BAE" text-anchor="end">Vérifiable sur spovibe.com/c/${escapeXml(serial.toLowerCase())}</text>
    </svg>`;
  }

  // ---------- Template : Certificat de payout ----------
  function renderPayoutSVG(user, payment, ctx) {
    ctx = ctx || {};
    const name = user.name || user.email || "Spovibe Trader";
    const date = payment.at || Date.now();
    const amount = payment.amount || 0;
    const totalPaid = ctx.totalPaid || amount;
    const tierName = ctx.tierName || "";
    const tierCapital = ctx.tierCapital || 0;
    const vert = ctx.vertical === "predictions" ? "Prédictions" : "Sports";
    const method = ctx.method || "USDC";
    const serial = certSerial(user.email + ":" + payment.at + ":payout");

    const stats = statsBlock(60, 410, [
      { label: "Compte financé",      value: tierName ? (tierName + " · " + tierCapital.toLocaleString("fr-FR") + " €") : "—", color: "#0F0E1A" },
      { label: "Méthode",             value: method, color: "#0F0E1A" },
      { label: "Total cumulé retiré", value: totalPaid.toLocaleString("fr-FR") + " €", color: "#1FB573" },
    ]);

    return `<svg viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg" font-family="Archivo, sans-serif">
      <defs>
        <linearGradient id="pG" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#1FB573"/>
          <stop offset="1" stop-color="#3DD68F"/>
        </linearGradient>
      </defs>
      <rect width="1200" height="630" fill="#F5F3FB"/>
      <rect x="0" y="0" width="1200" height="8" fill="url(#pG)"/>
      <path d="M1200 0 L1200 220 L940 0 Z" fill="url(#pG)" opacity="0.16"/>
      <circle cx="140" cy="660" r="200" fill="url(#pG)" opacity="0.08"/>

      ${logoSvg(60, 56)}

      <text x="60" y="170" font-weight="700" font-size="14" letter-spacing="4.8" fill="#1FB573">PREUVE DE PAIEMENT · COMPTE FINANCÉ ${vert.toUpperCase()}</text>

      <text x="60" y="244" font-family="Georgia, 'Times New Roman', serif" font-weight="700" font-size="58" fill="#0F0E1A">${escapeXml(name)}</text>

      <text x="60" y="300" font-size="20" fill="#6B6A82">a reçu un paiement de</text>
      <text x="60" y="372" font-weight="800" font-size="72" fill="#1FB573" letter-spacing="-1">${amount.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €</text>

      ${stats.html}

      <text x="60" y="568" font-size="14" fill="#6B6A82">Payé le ${escapeXml(fmtDateLong(date))} · Traité sous 24 h</text>
      <text x="60" y="592" font-size="13" fill="#9D9BAE">Spovibe · 85 % des gains revient au talent · retraits sans plafond</text>

      <text x="1140" y="568" font-size="14" font-weight="700" fill="#0F0E1A" text-anchor="end" letter-spacing="2">N° ${escapeXml(serial)}</text>
      <text x="1140" y="592" font-size="12" fill="#9D9BAE" text-anchor="end">Vérifiable sur spovibe.com/p/${escapeXml(serial.toLowerCase())}</text>
    </svg>`;
  }

  // ---------- Exports ----------
  let _currentSvg = null, _currentBaseName = null;

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function svgToImage(svgStr) {
    return new Promise((resolve, reject) => {
      const blob = new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
      img.src = url;
    });
  }

  async function exportSVG() {
    if (!_currentSvg) return;
    downloadBlob(new Blob([_currentSvg], { type: "image/svg+xml" }), _currentBaseName + ".svg");
  }

  async function exportPNG() {
    if (!_currentSvg) return;
    // Attendre que les fonts soient chargées dans le document parent
    try { await document.fonts.ready; } catch (e) {}
    const img = await svgToImage(_currentSvg);
    const canvas = document.createElement("canvas");
    const scale = 2; // 2400×1260 pour Retina
    canvas.width = 1200 * scale; canvas.height = 630 * scale;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#F5F3FB"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(b => downloadBlob(b, _currentBaseName + ".png"), "image/png");
  }

  async function exportPDF() {
    if (!_currentSvg) return;
    if (!global.jspdf || !global.jspdf.jsPDF) {
      alert("La librairie PDF charge encore. Réessayez dans une seconde.");
      return;
    }
    try { await document.fonts.ready; } catch (e) {}
    const img = await svgToImage(_currentSvg);
    const canvas = document.createElement("canvas");
    canvas.width = 2400; canvas.height = 1260;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#F5F3FB"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/png");
    const { jsPDF } = global.jspdf;
    const pdf = new jsPDF({ orientation: "landscape", unit: "pt", format: [1200, 630] });
    pdf.addImage(dataUrl, "PNG", 0, 0, 1200, 630);
    pdf.save(_currentBaseName + ".pdf");
  }

  // ---------- Modal ----------
  function openModal(svg, title, baseFilename) {
    _currentSvg = svg;
    _currentBaseName = baseFilename;
    let modal = document.getElementById("certModal");
    if (modal) modal.remove();
    modal = document.createElement("div");
    modal.id = "certModal";
    modal.className = "cert-modal";
    modal.onclick = (e) => { if (e.target === modal) closeModal(); };
    modal.innerHTML = `
      <div class="cert-modal-inner">
        <div class="cert-head">
          <h3>${escapeXml(title)}</h3>
          <button class="cert-close" onclick="SpovibeCert.close()">Fermer ✕</button>
        </div>
        <div class="cert-preview">${svg}</div>
        <div class="cert-actions">
          <button class="cert-btn primary" onclick="SpovibeCert.exportPNG()">Télécharger PNG</button>
          <button class="cert-btn" onclick="SpovibeCert.exportPDF()">Télécharger PDF</button>
          <button class="cert-btn" onclick="SpovibeCert.exportSVG()">Télécharger SVG</button>
          <span style="flex:1;"></span>
          <span class="cert-link-row" style="cursor:default;">N° ${escapeXml(certSerial(baseFilename))}</span>
        </div>
      </div>`;
    document.body.appendChild(modal);
  }
  function closeModal() {
    const m = document.getElementById("certModal");
    if (m) m.remove();
    _currentSvg = null;
  }

  // ---------- Helpers publics ----------
  function showAchievement(user, account) {
    const svg = renderAchievementSVG(user, account);
    const name = (user.name || "trader").toLowerCase().replace(/[^a-z0-9]+/g, "-");
    openModal(svg, "Certificat de réussite · " + (account.tier && account.tier.name || ""), `spovibe-certificat-${name}-${account.tier && account.tier.id || ""}`);
  }
  function showPayout(user, payment, ctx) {
    const svg = renderPayoutSVG(user, payment, ctx);
    const name = (user.name || "trader").toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const ts = new Date(payment.at).toISOString().slice(0, 10);
    openModal(svg, "Preuve de paiement · " + payment.amount.toLocaleString("fr-FR") + " €", `spovibe-payout-${name}-${ts}`);
  }

  global.SpovibeCert = {
    serial: certSerial,
    renderAchievementSVG, renderPayoutSVG,
    showAchievement, showPayout,
    exportSVG, exportPNG, exportPDF,
    close: closeModal,
  };
})(window);
