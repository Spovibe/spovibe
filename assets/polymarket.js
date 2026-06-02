// ============================================================
// Spovibe — Module Polymarket (Phase A)
// Fetch live des marchés depuis l'API gamma-api.polymarket.com
// Cache localStorage avec TTL de 10 min.
// Helpers : getMarkets({category, search, sort}), getMarketById(id),
// categoriesList(), placePosition(...)
// ============================================================
(function (global) {
  "use strict";

  const API_BASE = "https://gamma-api.polymarket.com";
  const CACHE_KEY = "sf_polymarket_cache_v2";  // bump v2 (nouvelle source events)
  const CACHE_TTL_MS = 10 * 60 * 1000;  // 10 minutes

  // Catégories Spovibe = mapping étendu vers les tags Polymarket réels.
  // Source vérifiée : endpoint /events renvoie un array tags par event.
  // L'ordre détermine la priorité de matching (1er hit gagne) + ordre UI.
  const SPOVIBE_CATEGORIES = [
    { slug: "sports", label: "Sports", tagSlugs: [
      "sports", "soccer", "football", "nfl", "nba", "mlb", "nhl",
      "tennis", "atp", "wta", "ufc", "mma", "boxing",
      "f1", "formula-1", "nascar", "racing", "motogp",
      "golf", "pga", "cricket", "ipl", "rugby",
      "esports", "lol", "csgo", "valorant", "dota",
      "world-cup", "fifa-world-cup", "uefa", "champions-league",
      "premier-league", "epl", "la-liga", "serie-a", "bundesliga", "ligue-1",
      "euro-2024", "euro-2026", "copa-america", "concacaf", "afcon",
      "olympic", "olympics", "summer-olympics", "winter-olympics",
      "super-bowl", "ncaa", "march-madness", "stanley-cup", "world-series",
    ]},
    { slug: "politics", label: "Politique", tagSlugs: [
      "politics", "us-elections", "elections", "trump", "biden", "harris",
      "house-races", "federal-government", "congress", "supreme-court",
      "republican", "democrat", "senate", "presidential", "governor",
      "midterms", "election-2024", "election-2026", "election-2028",
      "presidential-election", "primary",
    ]},
    { slug: "crypto", label: "Crypto", tagSlugs: [
      "crypto", "bitcoin", "btc", "ethereum", "eth", "memecoins",
      "microstrategy", "solana", "sol", "blockchain", "defi", "nft",
      "stablecoins", "doge", "shiba", "etf", "crypto-etf",
    ]},
    { slug: "tech", label: "Tech", tagSlugs: [
      "tech", "ai", "artificial-intelligence", "apple", "google", "meta",
      "nvidia", "microsoft", "amazon", "openai", "tesla", "spacex",
      "twitter", "x", "facebook", "instagram", "tiktok", "youtube",
      "anthropic", "chatgpt", "claude", "gemini",
    ]},
    { slug: "economy", label: "Économie", tagSlugs: [
      "economy", "business", "stocks", "fed", "earnings", "macro",
      "inflation", "recession", "gdp", "unemployment", "rates", "markets",
      "finance", "jobs-report", "cpi", "fed-rates", "interest-rates",
    ]},
    { slug: "culture", label: "Culture & Pop", tagSlugs: [
      "pop-culture", "entertainment", "music", "movies", "celebrity",
      "oscars", "grammys", "eurovision", "emmys", "golden-globes",
      "albums", "concerts", "netflix", "marvel", "disney", "tv",
      "gaming", "video-games", "gta-vi", "minecraft",
    ]},
    { slug: "world", label: "Monde", tagSlugs: [
      "world", "international", "europe", "asia", "middle-east", "africa",
      "ukraine", "israel", "iran", "geopolitics", "china", "russia",
      "war", "peace", "us-x-iran", "us-x-russia", "us-x-china",
      "israel-iran", "israel-palestine", "north-korea", "taiwan",
      "venezuela", "syria", "lebanon", "yemen",
    ]},
  ];

  function getCache() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (!obj || !obj.t || (Date.now() - obj.t) > CACHE_TTL_MS) return null;
      return obj;
    } catch (e) { return null; }
  }
  function setCache(markets) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ t: Date.now(), markets })); } catch (e) {}
  }
  function clearCache() { try { localStorage.removeItem(CACHE_KEY); } catch (e) {} }

  // Parse un champ JSON-stringifié à la Polymarket
  function parseField(v, fallback) {
    if (Array.isArray(v) || typeof v === "object") return v;
    if (typeof v !== "string") return fallback;
    try { return JSON.parse(v); } catch (e) { return fallback; }
  }

  // Mappe un marché Gamma (depuis /events) vers le format interne Spovibe.
  // Le 2e arg event apporte tags + image fallback.
  function normalize(m, event) {
    event = event || {};
    const outcomes = parseField(m.outcomes, ["Yes", "No"]);
    const prices = parseField(m.outcomePrices, ["0.5", "0.5"]).map(p => Number(p));
    const tags = event.tags || m.tags || [];
    const tagSlugs = tags.map(t => (t.slug || "").toLowerCase());
    // Détermine la catégorie Spovibe : 1re catégorie qui matche un tag
    let category = "other";
    let categoryLabel = "Autres";
    for (const cat of SPOVIBE_CATEGORIES) {
      if (cat.tagSlugs.some(s => tagSlugs.includes(s))) {
        category = cat.slug; categoryLabel = cat.label; break;
      }
    }
    return {
      id: m.id,
      conditionId: m.conditionId,
      slug: m.slug,
      question: m.question,
      description: m.description || event.description || "",
      image: m.image || event.image,
      outcomes,
      prices,
      yesPrice: prices[0] || 0,
      noPrice: prices[1] || 0,
      volume: Number(m.volume || 0),
      volume24hr: Number(m.volume24hr || 0),
      volume1wk: Number(m.volume1wk || 0),
      liquidity: Number(m.liquidity || 0),
      endDate: m.endDate || m.endDateIso || event.endDate,
      endDateMs: (m.endDate || event.endDate) ? new Date(m.endDate || event.endDate).getTime() : null,
      closed: !!m.closed,
      active: !!m.active,
      acceptingOrders: m.acceptingOrders !== false,
      eventId: event.id,
      eventTitle: event.title,
      eventSlug: event.slug,
      category, categoryLabel,
      tags: tags.map(t => ({ id: t.id, label: t.label, slug: t.slug })),
    };
  }

  // Fetch les events actifs (qui incluent les tags + leur sous-markets).
  // Limit réduite à 100 par page pour éviter les timeouts (le payload event est
  // lourd : chaque event embarque sa liste de markets + tags + metadata).
  async function fetchEventsRaw(maxPages) {
    maxPages = maxPages || 3;  // 3 × 100 = 300 events ≈ 1000+ markets, suffisant
    const all = [];
    for (let p = 0; p < maxPages; p++) {
      const url = `${API_BASE}/events?active=true&closed=false&limit=100&offset=${p * 100}&order=volume24hr&ascending=false`;
      // Retry une fois en cas de Load failed
      let res = null, lastErr = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          res = await fetch(url, { headers: { "Accept": "application/json" } });
          if (res.ok) break;
          lastErr = "HTTP " + res.status;
        } catch (e) {
          lastErr = e.message || "réseau";
          await new Promise(r => setTimeout(r, 400));  // attente avant retry
        }
      }
      if (!res || !res.ok) throw new Error("Polymarket API: " + (lastErr || "inaccessible"));
      const batch = await res.json();
      if (!Array.isArray(batch) || batch.length === 0) break;
      all.push(...batch);
      if (batch.length < 100) break;  // dernière page
    }
    return all;
  }

  // Récupère les marchés (depuis cache si frais, sinon API /events qu'on flatten)
  async function getMarkets(filter) {
    filter = filter || {};
    let markets;
    const cache = filter.bypassCache ? null : getCache();
    if (cache) {
      markets = cache.markets;
    } else {
      const events = await fetchEventsRaw();
      markets = [];
      for (const event of events) {
        if (!event.markets || event.markets.length === 0) continue;
        for (const market of event.markets) {
          if (market.closed || market.acceptingOrders === false) continue;
          markets.push(normalize(market, event));
        }
      }
      // Dédoublonnage par id au cas où
      const seen = new Set();
      markets = markets.filter(m => { if (seen.has(m.id)) return false; seen.add(m.id); return true; });
      setCache(markets);
    }
    // Filtrage
    let list = markets;
    if (filter.category && filter.category !== "all") {
      list = list.filter(m => m.category === filter.category);
    }
    if (filter.search) {
      const q = filter.search.toLowerCase().trim();
      list = list.filter(m =>
        (m.question || "").toLowerCase().includes(q) ||
        (m.eventTitle || "").toLowerCase().includes(q)
      );
    }
    // Tri
    const sort = filter.sort || "volume24hr";
    if (sort === "volume24hr") list = list.slice().sort((a, b) => b.volume24hr - a.volume24hr);
    else if (sort === "volume") list = list.slice().sort((a, b) => b.volume - a.volume);
    else if (sort === "endDate") list = list.slice().sort((a, b) => (a.endDateMs || Infinity) - (b.endDateMs || Infinity));
    else if (sort === "liquidity") list = list.slice().sort((a, b) => b.liquidity - a.liquidity);
    return list;
  }

  // Récupère un marché précis par son ID (fetch direct si nécessaire)
  async function getMarketById(id) {
    if (!id) return null;
    // 1. Cache local
    const cache = getCache();
    if (cache) {
      const found = cache.markets.find(m => m.id === id);
      if (found) return found;
    }
    // 2. Fetch direct depuis l'API
    try {
      const res = await fetch(`${API_BASE}/markets/${encodeURIComponent(id)}`);
      if (!res.ok) return null;
      const m = await res.json();
      return normalize(m);
    } catch (e) { return null; }
  }

  // Vérifie côté Polymarket si un marché est résolu (utilisé pour le settlement)
  async function checkResolution(id) {
    try {
      const res = await fetch(`${API_BASE}/markets/${encodeURIComponent(id)}`);
      if (!res.ok) return { resolved: false };
      const m = await res.json();
      if (!m.closed) return { resolved: false };
      // Le marché est fermé : déterminer le winning outcome via outcomePrices
      const prices = parseField(m.outcomePrices, []).map(p => Number(p));
      const outcomes = parseField(m.outcomes, ["Yes", "No"]);
      // Convention Polymarket : un outcome resolved a un prix de 1, l'autre de 0
      let winner = null;
      if (prices[0] >= 0.99) winner = outcomes[0];
      else if (prices[1] >= 0.99) winner = outcomes[1];
      else if (prices[0] > 0.4 && prices[0] < 0.6) winner = "50-50";
      return { resolved: true, winner, market: normalize(m) };
    } catch (e) { return { resolved: false, error: e.message }; }
  }

  // Statistiques sur la catégorisation : pour debug + admin
  function categoryStats(markets) {
    const counts = {};
    for (const m of markets) counts[m.category] = (counts[m.category] || 0) + 1;
    return SPOVIBE_CATEGORIES.map(c => ({ slug: c.slug, label: c.label, count: counts[c.slug] || 0 }))
      .concat([{ slug: "other", label: "Autres", count: counts.other || 0 }]);
  }

  function categoriesList() {
    return SPOVIBE_CATEGORIES.slice().concat([{ slug: "other", label: "Autres", tagSlugs: [] }]);
  }

  // ============= POSITIONS (lecture/écriture via Supabase) =============

  async function listOpenPositions() {
    const u = global.SF && global.SF.currentUser();
    if (!u || !global.SpovibeAuth) return [];
    const c = global.SpovibeAuth.client();
    const { data } = await c.from("predictions_positions").select("*").eq("user_id", u.id).eq("status", "open").order("opened_at", { ascending: false });
    return data || [];
  }

  async function listAllPositions() {
    const u = global.SF && global.SF.currentUser();
    if (!u || !global.SpovibeAuth) return [];
    const c = global.SpovibeAuth.client();
    const { data } = await c.from("predictions_positions").select("*").eq("user_id", u.id).order("opened_at", { ascending: false });
    return data || [];
  }

  async function placePosition({ marketId, side, stake }) {
    if (!global.SpovibeAuth) return { error: "Supabase non initialisé." };
    const u = global.SF && global.SF.currentUser();
    if (!u) return { error: "Connexion requise." };
    if (!marketId || (side !== "Yes" && side !== "No") || !stake || stake <= 0) {
      return { error: "Paramètres invalides." };
    }
    const market = await getMarketById(marketId);
    if (!market) return { error: "Marché introuvable." };
    if (market.closed || !market.acceptingOrders) return { error: "Marché clôturé ou en pause." };
    const price = side === "Yes" ? market.yesPrice : market.noPrice;
    if (!price || price <= 0 || price >= 1) return { error: "Prix indisponible ou hors marché." };
    // Récupère le compte predictions de l'utilisateur
    const acc = global.SF.predictionsAccount();
    if (!acc) return { error: "Aucun compte Prédictions actif. Achète un challenge Prédictions d'abord." };
    if (acc.status !== "active" && acc.status !== "funded") {
      return { error: "Compte Prédictions inactif." };
    }
    if (stake > acc.balance) return { error: "Solde insuffisant." };
    // Vérifie l'exposition max si définie sur le palier
    if (acc.tier && acc.tier.maxStakePct) {
      const maxStake = acc.capital * acc.tier.maxStakePct / 100;
      if (stake > maxStake) return { error: `Mise > exposition max (${acc.tier.maxStakePct}% = ${Math.round(maxStake)} €).` };
    }
    const shares = stake / price;
    const c = global.SpovibeAuth.client();
    const { data, error } = await c.from("predictions_positions").insert({
      user_id: u.id,
      market_id: market.id,
      condition_id: market.conditionId,
      market_question: market.question,
      market_slug: market.slug,
      market_image: market.image,
      event_id: market.eventId,
      event_title: market.eventTitle,
      category: market.category,
      end_date: market.endDate ? new Date(market.endDate).toISOString() : null,
      side,
      price_at_entry: price,
      stake,
      shares,
      status: "open",
    }).select().single();
    if (error) return { error: error.message };
    // Débite immédiatement le compte (la mise est verrouillée)
    acc.balance = Math.round((acc.balance - stake) * 100) / 100;
    acc.pending = acc.pending || [];
    acc.pending.push({ kind: "polymarket", positionId: data.id, marketId: market.id, question: market.question, side, stake, price, at: Date.now() });
    global.SF.saveAccount(acc);
    return { ok: true, position: data };
  }

  // ============= RÉSOLUTION (utilisée par admin pour settle les positions) =============

  // Pour chaque position 'open' du user (ou globalement si admin), check si le market
  // est résolu. Si oui, calcule le payout et update.
  async function settleMyOpenPositions() {
    const u = global.SF && global.SF.currentUser();
    if (!u || !global.SpovibeAuth) return { settled: 0, errors: 0 };
    const c = global.SpovibeAuth.client();
    const { data: openPositions } = await c.from("predictions_positions").select("*").eq("user_id", u.id).eq("status", "open");
    let settled = 0, errors = 0;
    for (const pos of (openPositions || [])) {
      try {
        const res = await checkResolution(pos.market_id);
        if (!res.resolved) continue;
        let status = "lost", payout = 0;
        if (res.winner === "50-50") { status = "cancelled"; payout = pos.stake; }
        else if (res.winner === pos.side) { status = "won"; payout = pos.shares; }
        else { status = "lost"; payout = 0; }
        await c.from("predictions_positions").update({
          status, resolved_outcome: res.winner, payout, settled_at: new Date().toISOString(),
        }).eq("id", pos.id);
        // Crédite le compte
        const acc = global.SF.predictionsAccount();
        if (acc && payout > 0) {
          acc.balance = Math.round((acc.balance + payout) * 100) / 100;
          acc.peak = Math.max(acc.peak || acc.capital, acc.balance);
          acc.pending = (acc.pending || []).filter(p => p.positionId !== pos.id);
          global.SF.saveAccount(acc);
        }
        settled++;
      } catch (e) { errors++; console.warn("settle error:", e); }
    }
    return { settled, errors };
  }

  // Version admin : règle TOUTES les positions open (de tous les users)
  async function adminSettleAllPositions() {
    if (!global.SpovibeAuth) return { settled: 0, errors: 0 };
    const c = global.SpovibeAuth.client();
    const { data: openPositions, error } = await c.from("predictions_positions").select("*").eq("status", "open");
    if (error) return { error: error.message };
    let settled = 0, errors = 0;
    const updatedAccountsBalance = {};  // user_id → delta de balance prédictions
    for (const pos of (openPositions || [])) {
      try {
        const res = await checkResolution(pos.market_id);
        if (!res.resolved) continue;
        let status = "lost", payout = 0;
        if (res.winner === "50-50") { status = "cancelled"; payout = pos.stake; }
        else if (res.winner === pos.side) { status = "won"; payout = pos.shares; }
        await c.from("predictions_positions").update({
          status, resolved_outcome: res.winner, payout, settled_at: new Date().toISOString(),
        }).eq("id", pos.id);
        if (payout > 0) {
          updatedAccountsBalance[pos.user_id] = (updatedAccountsBalance[pos.user_id] || 0) + payout;
        }
        settled++;
      } catch (e) { errors++; console.warn("admin settle error:", e); }
    }
    // Note : l'admin ne peut pas mettre à jour les comptes des autres users via RLS
    // (les policies accounts ne le permettent pas — il faudrait passer par une Edge
    // Function service_role). Pour v1, on log juste les deltas, l'admin valide
    // ensuite manuellement le report ou on fait une Edge Function plus tard.
    return { settled, errors, balanceUpdates: updatedAccountsBalance };
  }

  // ============= EXPORT =============
  global.SpovibePolymarket = {
    getMarkets, getMarketById, checkResolution,
    categoriesList, categoryStats,
    listOpenPositions, listAllPositions,
    placePosition,
    settleMyOpenPositions, adminSettleAllPositions,
    clearCache,
  };
})(window);
