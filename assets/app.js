/* ============================================================
   Spovibe — Moteur d'application (démo client-side)
   Auth + comptes + logique de challenge, persistés en localStorage.
   NB : ceci est une démo front-end. Aucun argent réel, aucun
   serveur. La "sécurité" est symbolique (hash local simple).
   ============================================================ */
(function (global) {
  "use strict";

  const KEYS = {
    users: "sf_users",
    session: "sf_session",
    accounts: "sf_accounts", // { [email]: account }
  };

  /* ----------------------------------------------------------
     Paliers de challenge — DEUX VERTICALES (sports + prédictions)
     ---------------------------------------------------------- */
  const RULES_SPORTS = {
    vertical: "sports",
    unitLabel: "paris",          // "30 paris min", "premier pari"…
    target: 35,                  // objectif de profit (%)
    timeLimitDays: 30,           // délai (jours)
    split: 85,                   // partage des gains compte financé (%)
    minStakePct: 2,              // mise min par pari (% du capital) — force une vraie prise de risque
    maxStakePct: 5,              // mise max par pari (% du capital)
    maxExposurePct: 5,           // exposition max par match (% du capital)
    maxDailyLoss: 5,             // drawdown journalier max (%)
    maxDD: 10,                   // drawdown total max (%)
    minActiveDays: 15,           // jours actifs minimum
    minBets: 30,                 // paris valides minimum
    positiveWeeks: 3,            // semaines positives requises
    totalWeeks: 4,               // sur N semaines
  };
  // Prédictions : positions plus longues, exposition par marché plus généreuse,
  // moins de positions requises (chacune dure plus longtemps).
  const RULES_PREDICTIONS = {
    vertical: "predictions",
    unitLabel: "positions",
    target: 35,
    timeLimitDays: 30,
    split: 85,
    maxStakePct: 5,              // exposition max par marché (% du capital)
    maxExposurePct: 5,
    maxDailyLoss: 5,
    maxDD: 10,
    minActiveDays: 15,
    minBets: 20,                 // 20 positions au lieu de 30 paris
    positiveWeeks: 2,            // tolérance plus élevée sur les semaines (positions plus longues)
    totalWeeks: 4,
  };
  const TIERS_SPORTS = [
    { id: "s-rookie", name: "Rookie", capital: 5000,   fee: 97,   ...RULES_SPORTS },
    { id: "s-pro",    name: "Pro",    capital: 10000,  fee: 197,  ...RULES_SPORTS },
    { id: "s-elite",  name: "Elite",  capital: 25000,  fee: 397,  ...RULES_SPORTS, featured: true },
    { id: "s-master", name: "Master", capital: 50000,  fee: 847,  ...RULES_SPORTS },
    { id: "s-legend", name: "Legend", capital: 100000, fee: 1697, ...RULES_SPORTS },
  ];
  const TIERS_PREDICTIONS = [
    { id: "p-rookie", name: "Rookie", capital: 5000,   fee: 97,   ...RULES_PREDICTIONS },
    { id: "p-pro",    name: "Pro",    capital: 10000,  fee: 197,  ...RULES_PREDICTIONS },
    { id: "p-elite",  name: "Elite",  capital: 25000,  fee: 397,  ...RULES_PREDICTIONS, featured: true },
    { id: "p-master", name: "Master", capital: 50000,  fee: 847,  ...RULES_PREDICTIONS },
    { id: "p-legend", name: "Legend", capital: 100000, fee: 1697, ...RULES_PREDICTIONS },
  ];
  // Rétro-compatibilité : SF.TIERS = TIERS_SPORTS (alias pour les anciens consommateurs)
  const TIERS = TIERS_SPORTS;
  const ALL_TIERS = TIERS_SPORTS.concat(TIERS_PREDICTIONS);
  function tierById(id) { return ALL_TIERS.find(t => t.id === id) || null; }

  /* ----------------------------------------------------------
     Stockage utilitaire
     ---------------------------------------------------------- */
  function read(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
    catch (e) { return fallback; }
  }
  function write(key, val) { localStorage.setItem(key, JSON.stringify(val)); }

  // Hash symbolique (démo uniquement — pas de vraie sécurité)
  function hash(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return "h" + (h >>> 0).toString(16);
  }

  /* ----------------------------------------------------------
     Auth
     ---------------------------------------------------------- */
  function getUsers() { return read(KEYS.users, {}); }

  // Auth via Supabase (avec fallback localStorage si Supabase pas chargé,
  // utile pour les anciens utilisateurs de la démo localStorage)
  async function signup(name, email, password, opts) {
    email = (email || "").trim().toLowerCase();
    name = (name || "").trim();
    if (!name) return { error: "Veuillez indiquer votre nom." };
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "Adresse e-mail invalide." };
    // Domaine @spovibe.com réservé aux comptes admin créés via Supabase Dashboard
    if (/@spovibe\.com$/.test(email)) return { error: "Ce domaine d'e-mail est réservé. Utilise une adresse personnelle." };
    if ((password || "").length < 6) return { error: "Le mot de passe doit faire au moins 6 caractères." };
    if (global.SpovibeAuth) {
      return await global.SpovibeAuth.signUp(name, email, password, opts);
    }
    // Fallback localStorage (démo hors-ligne)
    const users = getUsers();
    if (users[email]) return { error: "Un compte existe déjà avec cet e-mail." };
    users[email] = { name, email, pass: hash(password), created: Date.now() };
    write(KEYS.users, users);
    write(KEYS.session, email);
    return { ok: true, user: users[email] };
  }

  async function login(email, password) {
    email = (email || "").trim().toLowerCase();
    if (global.SpovibeAuth) {
      return await global.SpovibeAuth.signIn(email, password);
    }
    const users = getUsers();
    const u = users[email];
    if (!u || u.pass !== hash(password)) return { error: "E-mail ou mot de passe incorrect." };
    write(KEYS.session, email);
    return { ok: true, user: u };
  }

  async function logout() {
    if (global.SpovibeAuth) {
      await global.SpovibeAuth.signOut();
      global.SpovibeAuth.resetHydrate && global.SpovibeAuth.resetHydrate();
    }
    localStorage.removeItem(KEYS.session);
    // On vide aussi le cache local pour ne pas leaker des données
    // d'un user vers un autre sur le même navigateur.
    try {
      Object.keys(localStorage).forEach(k => {
        if (k.startsWith("sf_payments_") || k.startsWith("sf_arena_tourn_") ||
            k.startsWith("sf_prefs_") || k === KEYS.accounts) {
          localStorage.removeItem(k);
        }
      });
    } catch (e) {}
  }

  function currentUser() {
    if (global.SpovibeAuth) {
      const u = global.SpovibeAuth.currentUser();
      if (u) return u;
    }
    const email = read(KEYS.session, null);
    if (!email) return null;
    return getUsers()[email] || null;
  }

  // Vrai si l'utilisateur connecté est dans la table public.admins (Supabase)
  function isAdmin() {
    const u = currentUser();
    return !!(u && u.isAdmin);
  }

  /* ----------------------------------------------------------
     Comptes / Challenges — structure multi-vertical
     accounts[email] = { sports: account|null, predictions: account|null }
     (Migration auto : un compte v1 mono = wrappé en slot "sports")
     ---------------------------------------------------------- */
  function getAccounts() {
    const raw = read(KEYS.accounts, {});
    let migrated = false;
    Object.keys(raw).forEach(email => {
      const v = raw[email];
      if (v && (v.sports !== undefined || v.predictions !== undefined)) return; // déjà v2
      // v1 : compte unique → on le glisse dans le slot "sports"
      const single = v || null;
      if (single) {
        single.vertical = single.vertical || (single.tier && single.tier.vertical) || "sports";
      }
      raw[email] = { sports: single, predictions: null };
      migrated = true;
    });
    if (migrated) write(KEYS.accounts, raw);
    return raw;
  }

  // getAccount(vertical?) : si vertical fourni → ce slot précis ;
  // sinon → sports en priorité, puis predictions (rétro-compat).
  function getAccount(vertical) {
    const user = currentUser(); if (!user) return null;
    const slot = getAccounts()[user.email];
    if (!slot) return null;
    if (vertical) return slot[vertical] || null;
    return slot.sports || slot.predictions || null;
  }
  function sportsAccount() { return getAccount("sports"); }
  function predictionsAccount() { return getAccount("predictions"); }
  function activeAccounts() {
    const user = currentUser(); if (!user) return [];
    const slot = getAccounts()[user.email] || {};
    return [slot.sports, slot.predictions].filter(Boolean);
  }

  function todayKey() { return new Date().toISOString().slice(0, 10); }

  // Async : retourne une promise qui résout après confirmation Supabase
  // (l'UI affiche un mini-loader pendant ce temps, ~200ms typiques).
  async function startChallenge(tierId) {
    const user = currentUser();
    if (!user) return { error: "Vous devez être connecté." };
    const tier = tierById(tierId);
    if (!tier) return { error: "Palier introuvable." };
    const accounts = getAccounts();
    if (!accounts[user.email]) accounts[user.email] = { sports: null, predictions: null };
    const newAcc = {
      tierId: tier.id,
      tier,
      vertical: tier.vertical,
      phase: "evaluation",
      status: "active",
      capital: tier.capital,
      balance: tier.capital,
      peak: tier.capital,
      startedAt: Date.now(),
      bets: [],
      pending: [],
      dayStart: { [todayKey()]: tier.capital },
      failReason: null,
      withdrawn: 0,
    };
    accounts[user.email][tier.vertical] = newAcc;
    write(KEYS.accounts, accounts);
    const vertLabel = tier.vertical === "sports" ? "Sports" : "Prédictions";
    const payment = { at: Date.now(), type: "Challenge", label: `Challenge ${tier.name} · ${fmt(tier.capital)} (${vertLabel})`, amount: tier.fee, dir: "out" };
    const l = payments(); l.unshift(payment); write("sf_payments_" + user.email, l);

    // Persiste en base et attend la confirmation avant de retourner
    if (global.SpovibeAuth) {
      try {
        const [accRes, payRes] = await Promise.all([
          global.SpovibeAuth.pushAccount(tier.vertical, newAcc),
          global.SpovibeAuth.pushPayment(payment),
        ]);
        if (accRes && accRes.error) {
          // Rollback local en cas d'échec serveur
          accounts[user.email][tier.vertical] = null;
          write(KEYS.accounts, accounts);
          return { error: "Erreur d'enregistrement : " + accRes.error };
        }
      } catch (e) {
        return { error: "Connexion serveur perdue. Réessaie." };
      }
    }
    // E-mail de confirmation d'achat (fire-and-forget, échec silencieux)
    if (global.SpovibeEmail) {
      try {
        global.SpovibeEmail.send("challenge_purchased", user.email, {
          tierName: tier.name,
          vertical: vertLabel,
          capital: fmt(tier.capital),
          fee: fmt(tier.fee),
          timeLimitDays: tier.timeLimitDays,
          target: tier.target,
        });
      } catch (e) {}
    }
    return { ok: true, account: newAcc };
  }

  function saveAccount(acc) {
    const user = currentUser(); if (!user || !acc) return;
    const accounts = getAccounts();
    if (!accounts[user.email]) accounts[user.email] = { sports: null, predictions: null };
    const vert = acc.vertical || (acc.tier && acc.tier.vertical) || "sports";
    accounts[user.email][vert] = acc;
    write(KEYS.accounts, accounts);
    // Persist Supabase (fire & forget — l'UI a déjà l'état frais via localStorage)
    if (global.SpovibeAuth) { global.SpovibeAuth.pushAccount(vert, acc); }
  }

  // resetAccount(vertical?) : si vertical → reset ce slot ; sinon → reset les deux.
  function resetAccount(vertical) {
    const user = currentUser(); if (!user) return;
    const accounts = getAccounts();
    if (!accounts[user.email]) return;
    if (vertical) accounts[user.email][vertical] = null;
    else accounts[user.email] = { sports: null, predictions: null };
    write(KEYS.accounts, accounts);
    // Persist Supabase
    if (global.SpovibeAuth) {
      if (vertical) global.SpovibeAuth.pushAccount(vertical, null);
      else global.SpovibeAuth.deleteAllAccounts();
    }
  }

  // Stats agrégées cross-vertical (pour Arena, badges, hub d'accueil)
  function combinedStats() {
    const all = activeAccounts();
    if (!all.length) return null;
    const list = all.map(a => stats(a));
    const totalProfit = list.reduce((s, x) => s + x.profit, 0);
    const totalStaked = list.reduce((s, x) => s + x.staked, 0);
    const totalBets = list.reduce((s, x) => s + x.bets, 0);
    const totalCapital = all.reduce((s, a) => s + a.capital, 0);
    const positiveWeeks = Math.max(...list.map(x => x.positiveWeeks));
    return {
      profit: round2(totalProfit),
      staked: round2(totalStaked),
      bets: totalBets,
      roi: totalStaked ? round2((totalProfit / totalStaked) * 100) : 0,
      profitPct: totalCapital ? round2((totalProfit / totalCapital) * 100) : 0,
      capital: totalCapital,
      positiveWeeks,
      verticals: all.map(a => a.vertical),
    };
  }

  /* ----------------------------------------------------------
     Logique de pari + règles
     ---------------------------------------------------------- */
  function placeBet(acc, { event, stake, odds, result }) {
    if (acc.status !== "active" && acc.status !== "funded") {
      return { error: "Ce compte n'accepte plus de paris." };
    }
    stake = Number(stake); odds = Number(odds);
    if (!event || !event.trim()) return { error: "Indiquez l'événement / le match." };
    if (!(stake > 0)) return { error: "Mise invalide." };
    if (!(odds >= 1.01)) return { error: "La cote doit être ≥ 1.01." };
    const maxStake = acc.capital * acc.tier.maxStakePct / 100;
    if (stake > maxStake + 0.001) {
      return { error: `Mise maximale dépassée (${fmt(maxStake)} = ${acc.tier.maxStakePct}% du capital).` };
    }
    if (acc.tier.minStakePct) {
      const minStake = acc.capital * acc.tier.minStakePct / 100;
      if (stake < minStake - 0.001) {
        return { error: `Mise minimale requise : ${fmt(minStake)} (${acc.tier.minStakePct}% du capital).` };
      }
    }
    if (stake > acc.balance + 0.001) return { error: "Mise supérieure au solde disponible." };

    const day = todayKey();
    if (acc.dayStart[day] === undefined) acc.dayStart[day] = acc.balance;

    let pnl;
    if (result === "win") pnl = stake * (odds - 1);
    else pnl = -stake;

    acc.balance = round2(acc.balance + pnl);
    acc.peak = Math.max(acc.peak, acc.balance);

    const bet = {
      id: Date.now() + "-" + Math.floor(Math.random() * 1000),
      date: Date.now(),
      day,
      event: event.trim(),
      stake: round2(stake),
      odds,
      result,
      pnl: round2(pnl),
      balanceAfter: acc.balance,
    };
    acc.bets.unshift(bet);

    evaluateRules(acc, day);
    saveAccount(acc);
    return { ok: true, bet, account: acc };
  }

  function daysElapsed(acc) { return Math.floor((Date.now() - acc.startedAt) / 86400000); }

  // Vérifie drawdown / délai / objectif (et critères de validité)
  function evaluateRules(acc, day) {
    // Guard : si déjà passed/failed, ne rien faire (évite emails dupliqués)
    if (acc.status !== "active" && acc.status !== "funded") return;
    const prevStatus = acc.status;
    const t = acc.tier;
    const ddFloor = acc.capital * (1 - t.maxDD / 100);              // plancher de drawdown total
    const dailyFloor = (acc.dayStart[day] ?? acc.capital) - acc.capital * (t.maxDailyLoss / 100);

    // Règles de risque (actives en évaluation ET en compte financé)
    if (acc.balance < ddFloor - 0.001) {
      acc.status = "failed";
      acc.failReason = `Drawdown total dépassé (plancher ${fmt(ddFloor)}, soit -${t.maxDD}%).`;
    } else if (acc.balance < dailyFloor - 0.001) {
      acc.status = "failed";
      acc.failReason = `Drawdown journalier dépassé (plancher du jour ${fmt(dailyFloor)}, soit -${t.maxDailyLoss}%).`;
    } else if (acc.phase === "evaluation" && acc.status === "active") {
      const targetBal = acc.capital * (1 + t.target / 100);
      const reached = acc.balance >= targetBal - 0.001;
      if (reached && acc.bets.length >= t.minBets) {
        acc.status = "passed";
      } else if (daysElapsed(acc) > t.timeLimitDays) {
        acc.status = "failed";
        acc.failReason = `Délai de ${t.timeLimitDays} jours dépassé avant la validation de l'objectif.`;
      }
    }
    // E-mail à la transition de statut (fire-and-forget)
    if (prevStatus !== acc.status && global.SpovibeEmail) {
      const u = currentUser();
      if (u && u.email) {
        try {
          if (acc.status === "passed") {
            const profitPct = Math.round(((acc.balance - acc.capital) / acc.capital) * 100);
            global.SpovibeEmail.send("challenge_passed", u.email, {
              name: u.name, tierName: t.name, profitPct, split: t.split || 85,
            });
          } else if (acc.status === "failed") {
            global.SpovibeEmail.send("challenge_failed", u.email, {
              tierName: t.name, reason: acc.failReason,
            });
          }
        } catch (e) {}
      }
    }
  }

  function claimFunded(acc) {
    if (acc.status !== "passed") return { error: "Le challenge n'est pas encore validé." };
    acc.phase = "funded";
    acc.status = "funded";
    acc.balance = acc.capital;     // le compte financé démarre au capital
    acc.peak = acc.capital;
    acc.fundedAt = Date.now();
    acc.dayStart = { [todayKey()]: acc.capital };
    saveAccount(acc);
    return { ok: true, account: acc };
  }

  function withdraw(acc) {
    if (acc.phase !== "funded") return { error: "Retrait disponible uniquement sur compte financé." };
    const profit = acc.balance - acc.capital;
    if (profit <= 0) return { error: "Aucun profit à retirer." };
    const payout = round2(profit * acc.tier.split / 100);
    acc.withdrawn = round2((acc.withdrawn || 0) + payout);
    acc.balance = acc.capital;     // on remet le compte au capital après retrait
    acc.peak = acc.capital;
    acc.dayStart = { [todayKey()]: acc.capital };
    saveAccount(acc);
    addPayment({ type: "Retrait", label: "Retrait compte financé", amount: payout, dir: "in" });
    return { ok: true, payout, account: acc };
  }

  /* ----------------------------------------------------------
     Statistiques
     ---------------------------------------------------------- */
  function countDays(acc) {
    const d = {};
    acc.bets.forEach(b => { d[b.day] = (d[b.day] || 0) + 1; });
    return d;
  }

  function weekKey(ts) {
    const d = new Date(ts);
    const jan1 = new Date(d.getFullYear(), 0, 1);
    const week = Math.ceil((((d - jan1) / 86400000) + jan1.getDay() + 1) / 7);
    return d.getFullYear() + "-W" + week;
  }

  function stats(acc) {
    const bets = acc.bets;
    const n = bets.length;
    const wins = bets.filter(b => b.result === "win").length;
    const staked = bets.reduce((s, b) => s + b.stake, 0);
    const profit = round2(acc.balance - acc.capital);
    const t = acc.tier;
    // P&L par semaine -> semaines positives
    const weeks = {};
    bets.forEach(b => { const k = weekKey(b.date); weeks[k] = (weeks[k] || 0) + b.pnl; });
    const positiveWeeks = Object.values(weeks).filter(v => v > 0.001).length;
    const elapsed = daysElapsed(acc);
    return {
      bets: n,
      wins,
      losses: n - wins,
      winRate: n ? Math.round((wins / n) * 100) : 0,
      staked: round2(staked),
      profit,
      profitPct: round2((profit / acc.capital) * 100),
      roi: staked ? round2((profit / staked) * 100) : 0,
      daysTraded: Object.keys(countDays(acc)).length,
      activeDays: Object.keys(countDays(acc)).length,
      weeksTraded: Object.keys(weeks).length,
      positiveWeeks,
      daysElapsed: elapsed,
      daysRemaining: Math.max(0, t.timeLimitDays - elapsed),
      targetBal: round2(acc.capital * (1 + t.target / 100)),
      targetProfit: round2(acc.capital * t.target / 100),
      ddFloor: round2(acc.capital * (1 - t.maxDD / 100)),
      ddUsedPct: round2(((acc.peak - acc.balance) / (acc.capital * t.maxDD / 100)) * 100),
      withdrawable: acc.phase === "funded" ? round2(Math.max(0, profit) * t.split / 100) : 0,
    };
  }

  /* ----------------------------------------------------------
     Helpers de formatage
     ---------------------------------------------------------- */
  function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }
  function fmt(n) {
    return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);
  }
  function fmt2(n) {
    return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
  }
  function fmtDate(ts) {
    return new Date(ts).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  /* ----------------------------------------------------------
     Contact (enregistrement des messages — démo)
     ---------------------------------------------------------- */
  function saveContact({ name, email, subject, message }) {
    name = (name || "").trim();
    email = (email || "").trim().toLowerCase();
    message = (message || "").trim();
    if (!name) return { error: "Veuillez indiquer votre nom." };
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "Adresse e-mail invalide." };
    if (message.length < 10) return { error: "Votre message doit faire au moins 10 caractères." };
    const list = read("sf_contacts", []);
    list.unshift({ name, email, subject: subject || "Général", message, at: Date.now() });
    write("sf_contacts", list);
    return { ok: true };
  }

  /* ----------------------------------------------------------
     Espace membre — Arena, récompenses, communauté, profil, paiements
     ---------------------------------------------------------- */
  const DIVS = [
    { id: "bronze", name: "Bronze" }, { id: "argent", name: "Argent" },
    { id: "or", name: "Or" }, { id: "champion", name: "Champion" }, { id: "elite", name: "Élite" },
  ];

  // Univers thématiques par mois — donne une identité à chaque saison Arena
  const SEASONS_THEMES = [
    { theme: "Winter Cycle", subtitle: "Reset annuel · début de cycle compétitif", tag: "Nouveau cycle" },
    { theme: "Mid-Season Showdown", subtitle: "Tournois quotidiens · bonus Premier League × 1,5", tag: "Football" },
    { theme: "March Madness", subtitle: "Basket NCAA et NBA en feu · brackets surprises", tag: "Basket" },
    { theme: "Spring Run", subtitle: "Champions League quarts + Roland-Garros qualifications", tag: "Multi-sport" },
    { theme: "Roland-Garros Series", subtitle: "Tennis chaque soir · bonus ROI doublé sur Grand Chelem", tag: "Tennis" },
    { theme: "Summer Kickoff", subtitle: "Euro / Copa America · fenêtres de matchs serrées", tag: "Football" },
    { theme: "Tour de France Edition", subtitle: "Étapes hippiques + Tour · marchés prédictifs sport", tag: "Endurance" },
    { theme: "Summer Tour", subtitle: "Tennis ATP Masters · transferts foot · fenêtre estivale", tag: "Multi-sport" },
    { theme: "Back to School", subtitle: "Reprise Ligue 1, Premier League, Liga · rentrée chargée", tag: "Football" },
    { theme: "Champions Series", subtitle: "Champions League en mode tournoi quotidien", tag: "Football" },
    { theme: "Black Friday Tournament", subtitle: "Cup événementiel · récompenses doublées toute la semaine", tag: "Événement" },
    { theme: "Year-End Showdown", subtitle: "Bilan annuel · le ranking de l'année se joue ici", tag: "Finale" },
  ];

  function currentSeason() {
    const now = new Date();
    const m = now.getMonth();
    const t = SEASONS_THEMES[m];
    const start = new Date(now.getFullYear(), m, 1);
    const end = new Date(now.getFullYear(), m + 1, 0); // dernier jour du mois
    const promoWeekStart = new Date(now.getFullYear(), m + 1, 0);
    promoWeekStart.setDate(promoWeekStart.getDate() - 6); // 7 derniers jours
    const daysToEnd = Math.max(0, Math.ceil((end - now) / 86400000));
    const inPromoWeek = now >= promoWeekStart;
    const monthLabel = now.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
    const monthLabelShort = now.toLocaleDateString("fr-FR", { month: "long" });
    return {
      theme: t.theme,
      subtitle: t.subtitle,
      tag: t.tag,
      monthLabel: monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1),
      monthLabelShort: monthLabelShort.charAt(0).toUpperCase() + monthLabelShort.slice(1),
      start,
      end,
      promoWeekStart,
      daysToEnd,
      inPromoWeek,
      seasonNumber: m + 1, // saison du mois
      season: now.getFullYear() + "-" + String(m + 1).padStart(2, "0"),
    };
  }

  function arena() {
    const u = currentUser(); if (!u) return null;
    const key = "sf_arena_" + u.email;
    let a = read(key, null);
    if (!a) { a = { division: "bronze", poule: 1, joinedAt: Date.now() }; write(key, a); }
    return a;
  }
  function saveArena(a) { const u = currentUser(); if (u) write("sf_arena_" + u.email, a); }

  // RNG déterministe (mêmes adversaires d'une visite à l'autre, sur la même saison)
  function seeded(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return function () {
      h += 0x6D2B79F5; let t = Math.imul(h ^ (h >>> 15), 1 | h);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const BOT_NAMES = ["NeymarDuQuartier","La_Cote_Sûre","MissPronos","TontonBankroll","ZoneMixte","KopOuRien","TennisGod","LaRemontada","RookieMais","PariSafe92","ValueHunter","ExpectedGoals","CashOutKing","LeProno","BetItAll","SafeStake","UnderdogFR","CornerMaster","xG_Wizard","FlairBet","DoubleChance","HandicapPro","LiveBettor","OddsMachine","GoalLine","TipsterFR","BankrollBoss","ColdStreak","HotHand","PenaltyKing","CleanSheet","ParlayPaul","RoiDuFoot","CapitaineCote","BetBuilder","LaPepite","ZoneEuro","MrCote","StatsGeek","LeTacticien"];
  function pseudo(rng) {
    const n = BOT_NAMES[Math.floor(rng() * BOT_NAMES.length)];
    return rng() < 0.35 ? n + (Math.floor(rng() * 89) + 10) : n;
  }
  // Génère la poule (~100 joueurs) avec le membre inséré, classée au ROI agrégé (sports + prédictions)
  function poule() {
    const u = currentUser(); const a = arena(); if (!u) return null;
    const season = new Date().toISOString().slice(0, 7);
    const rng = seeded(u.email + "|" + season + "|" + a.division);
    const rows = [];
    for (let i = 0; i < 99; i++) {
      rows.push({ name: pseudo(rng), roi: round2(rng() * 34 - 9), bets: Math.floor(rng() * 80) + 12, you: false });
    }
    let myRoi, myBets;
    const combo = combinedStats();
    if (combo && combo.bets > 0) { myRoi = combo.roi; myBets = combo.bets; }
    else { myRoi = round2(rng() * 20 - 4); myBets = Math.floor(rng() * 25) + 5; }
    rows.push({ name: u.name, roi: myRoi, bets: myBets, you: true });
    rows.sort((x, y) => y.roi - x.roi);
    rows.forEach((r, i) => r.rank = i + 1);
    const total = rows.length;
    return { rows, total, me: rows.find(r => r.you), promoMax: Math.ceil(total * 0.15), relegMin: total - Math.floor(total * 0.15) + 1, division: a.division, divName: (DIVS.find(d => d.id === a.division) || {}).name };
  }

  /* ---- Récompenses & codes ---- */
  function referralCode() { const u = currentUser(); return u ? "VIBE-" + hash(u.email).slice(1, 6).toUpperCase() : ""; }
  function getRewards() {
    const u = currentUser(); if (!u) return { credits: 0, codes: [] };
    const key = "sf_rewards_" + u.email;
    let r = read(key, null);
    if (!r) { r = { credits: 20, codes: [{ code: "BIENVENUE10", label: "-10 % sur ton premier challenge", expiry: "30 jours" }] }; write(key, r); }
    return r;
  }
  function saveRewards(r) { const u = currentUser(); if (u) write("sf_rewards_" + u.email, r); }

  /* ---- Communauté (réservée créateurs + leur communauté) ---- */
  function communities() { return read("sf_communities", {}); }
  function saveCommunities(c) { write("sf_communities", c); }
  function myCommunity() {
    const u = currentUser(); if (!u) return null;
    return Object.values(communities()).find(c => c.creator === u.email || (c.members || []).includes(u.email)) || null;
  }
  function isCreator() { const u = currentUser(); const c = myCommunity(); return !!(u && c && c.creator === u.email); }
  function createCommunity(name) {
    const u = currentUser(); if (!u) return { error: "Connexion requise." };
    if (myCommunity()) return { error: "Vous faites déjà partie d'une communauté." };
    name = (name || "").trim(); if (!name) return { error: "Nom de communauté requis." };
    const cs = communities();
    const code = "C-" + hash(u.email + name).slice(1, 6).toUpperCase();
    cs[code] = { code, name, creator: u.email, members: [], messages: [{ author: name, text: "Bienvenue dans la communauté ! Place tes pronos et grimpe le classement.", at: Date.now() }] };
    saveCommunities(cs);
    return { ok: true, code };
  }
  function joinCommunity(code) {
    const u = currentUser(); if (!u) return { error: "Connexion requise." };
    if (myCommunity()) return { error: "Vous faites déjà partie d'une communauté." };
    code = (code || "").trim().toUpperCase();
    const cs = communities(); const c = cs[code];
    if (!c) return { error: "Code de communauté invalide." };
    c.members.push(u.email); saveCommunities(cs);
    return { ok: true, community: c };
  }
  function leaveCommunity() {
    const u = currentUser(); const c = myCommunity(); if (!u || !c) return;
    const cs = communities();
    if (c.creator === u.email) delete cs[c.code];
    else cs[c.code].members = cs[c.code].members.filter(e => e !== u.email);
    saveCommunities(cs);
  }
  function postMessage(text) {
    const u = currentUser(); const c = myCommunity();
    if (!u || !c) return { error: "Réservé aux communautés de créateurs." };
    text = (text || "").trim(); if (!text) return { error: "Message vide." };
    const cs = communities();
    cs[c.code].messages.push({ author: u.name, text, at: Date.now() });
    saveCommunities(cs);
    return { ok: true };
  }

  /* ---- Profil, paiements, préférences ---- */
  function updateProfile(name) {
    const u = currentUser(); if (!u) return { error: "Connexion requise." };
    name = (name || "").trim(); if (!name) return { error: "Nom requis." };
    const users = getUsers(); users[u.email].name = name; write(KEYS.users, users);
    return { ok: true };
  }
  function changePassword(oldP, newP) {
    const u = currentUser(); if (!u) return { error: "Connexion requise." };
    const users = getUsers();
    if (users[u.email].pass !== hash(oldP)) return { error: "Mot de passe actuel incorrect." };
    if ((newP || "").length < 6) return { error: "Le nouveau mot de passe doit faire 6 caractères minimum." };
    users[u.email].pass = hash(newP); write(KEYS.users, users);
    return { ok: true };
  }
  function payments() { const u = currentUser(); return u ? read("sf_payments_" + u.email, []) : []; }
  function addPayment(p) {
    const u = currentUser(); if (!u) return;
    const stamped = Object.assign({ at: Date.now() }, p);
    const l = payments(); l.unshift(stamped); write("sf_payments_" + u.email, l);
    if (global.SpovibeAuth) { global.SpovibeAuth.pushPayment(stamped); }
  }
  function prefs() { const u = currentUser(); return u ? read("sf_prefs_" + u.email, { notifs: true, newsletter: true }) : {}; }
  function savePrefs(p) { const u = currentUser(); if (u) write("sf_prefs_" + u.email, p); }

  /* ----------------------------------------------------------
     Univers Arena — tournois, Survivor, duels, badges
     ---------------------------------------------------------- */
  function arenaTourn() {
    const u = currentUser(); if (!u) return null;
    const key = "sf_arena_tourn_" + u.email;
    let t = read(key, null);
    if (!t) { t = { soireeRegistered: false, survivor: { entered: false, round: 0, eliminated: false } }; write(key, t); }
    return t;
  }
  function saveArenaTourn(t) {
    const u = currentUser(); if (!u) return;
    write("sf_arena_tourn_" + u.email, t);
    // Marque l'engagement Arena côté Supabase (idempotent : marqué une seule fois)
    if (global.SpovibeAuth && global.SpovibeAuth.markArenaEngaged) {
      global.SpovibeAuth.markArenaEngaged();
    }
  }
  function toggleSoiree() { const t = arenaTourn(); t.soireeRegistered = !t.soireeRegistered; saveArenaTourn(t); return t; }
  function survivorEnter() { const t = arenaTourn(); if (!t.survivor.entered) { t.survivor = { entered: true, round: 1, eliminated: false }; saveArenaTourn(t); } return t; }
  function survivorPick() {
    const t = arenaTourn();
    if (!t.survivor.entered || t.survivor.eliminated) return { error: "Tu n'es pas en lice." };
    const survives = Math.random() < 0.62;          // probabilité de survie
    if (survives) { t.survivor.round++; saveArenaTourn(t); return { ok: true, survived: true, round: t.survivor.round }; }
    t.survivor.eliminated = true; saveArenaTourn(t);
    return { ok: true, survived: false, round: t.survivor.round };
  }
  function survivorRestart() { const t = arenaTourn(); t.survivor = { entered: false, round: 0, eliminated: false }; saveArenaTourn(t); return t; }

  // Duels (vs bot pour la démo)
  function getDuels() { const u = currentUser(); return u ? read("sf_duels_" + u.email, []) : []; }
  function saveDuels(l) {
    const u = currentUser(); if (!u) return;
    write("sf_duels_" + u.email, l);
    if (global.SpovibeAuth && global.SpovibeAuth.markArenaEngaged) {
      global.SpovibeAuth.markArenaEngaged();
    }
  }
  function createDuel(opponent, days) {
    const u = currentUser(); if (!u) return { error: "Connexion requise." };
    opponent = (opponent || "").trim(); if (!opponent) return { error: "Indique un pseudo." };
    days = days || 7;
    const combo = combinedStats();
    const myRoi = combo && combo.bets > 0 ? combo.roi : 0;
    const opponentRoi = round2((Math.random() * 22) - 4);
    const l = getDuels();
    l.unshift({ id: Date.now() + "-" + Math.floor(Math.random() * 1000), opponent, days, createdAt: Date.now(), myRoi, opponentRoi, settled: false, myWin: null });
    saveDuels(l);
    return { ok: true };
  }
  function settleDuel(id) {
    const l = getDuels(); const d = l.find(x => x.id === id); if (!d) return { error: "Duel introuvable." };
    if (d.settled) return { error: "Déjà réglé." };
    const combo = combinedStats();
    d.myRoi = combo && combo.bets > 0 ? combo.roi : d.myRoi;
    d.settled = true; d.myWin = d.myRoi > d.opponentRoi;
    saveDuels(l);
    return { ok: true, win: d.myWin };
  }
  function deleteDuel(id) { const l = getDuels().filter(x => x.id !== id); saveDuels(l); }

  // Badges (calculés à la volée — agrégés sur sports + prédictions)
  function badges() {
    const u = currentUser(); if (!u) return [];
    const all = activeAccounts();
    const combo = combinedStats();
    const minDdPct = all.length ? Math.min(...all.map(a => stats(a).ddUsedPct)) : null;
    const anyFunded = all.some(a => a.phase === "funded");
    const a = arena();
    const t = arenaTourn(); const c = myCommunity(); const ds = getDuels();
    const wonDuels = ds.filter(d => d.settled && d.myWin).length;
    const multiVert = all.length >= 2;
    return [
      { id: "newcomer", name: "Bienvenue", desc: "Inscription sur Spovibe", unlocked: true },
      { id: "first_bet", name: "Premier pari", desc: "Place ton 1ᵉʳ pari", unlocked: !!(combo && combo.bets >= 1) },
      { id: "ten_bets", name: "10 paris", desc: "Cumule 10 paris valides", unlocked: !!(combo && combo.bets >= 10) },
      { id: "discipline", name: "Discipline", desc: "Atteins 30 paris valides", unlocked: !!(combo && combo.bets >= 30) },
      { id: "positive", name: "ROI positif", desc: "Maintiens un ROI positif", unlocked: !!(combo && combo.roi > 0) },
      { id: "week_pos", name: "Semaine positive", desc: "Termine une semaine en profit", unlocked: !!(combo && combo.positiveWeeks >= 1) },
      { id: "regularity", name: "Régularité", desc: "3 semaines positives", unlocked: !!(combo && combo.positiveWeeks >= 3) },
      { id: "no_dd", name: "Sang-froid", desc: "Évite tout drawdown majeur", unlocked: !!(minDdPct !== null && minDdPct <= 50 && combo && combo.bets >= 10) },
      { id: "multi_edge", name: "Multi-edge", desc: "Active un challenge sports ET prédictions", unlocked: multiVert },
      { id: "duel_win", name: "Duelliste", desc: "Remporte ton premier duel", unlocked: wonDuels >= 1 },
      { id: "survivor", name: "Survivant", desc: "Atteins le round 3 en Survivor", unlocked: !!(t && t.survivor.round >= 3) },
      { id: "elite", name: "Élite", desc: "Atteins la division Élite", unlocked: !!(a && a.division === "elite") },
      { id: "funded", name: "Compte financé", desc: "Décroche un compte financé", unlocked: anyFunded },
      { id: "community", name: "Communauté", desc: "Rejoins une communauté de créateur", unlocked: !!c },
    ];
  }

  /* ----------------------------------------------------------
     Paris sportifs — matchs, paris en attente, règlement
     ---------------------------------------------------------- */
  const FIXTURES = [
    { id: "f1", sport: "Football", league: "Ligue 1", home: "PSG", away: "Marseille", time: "Sam. 21:00", market: "Résultat", sels: [{ k: "1", n: "PSG", o: 1.65 }, { k: "X", n: "Match nul", o: 4.20 }, { k: "2", n: "Marseille", o: 5.10 }] },
    { id: "f2", sport: "Football", league: "Premier League", home: "Man City", away: "Liverpool", time: "Dim. 17:30", market: "Résultat", sels: [{ k: "1", n: "Man City", o: 2.10 }, { k: "X", n: "Match nul", o: 3.60 }, { k: "2", n: "Liverpool", o: 3.30 }] },
    { id: "f3", sport: "Football", league: "Ligue des Champions", home: "Real Madrid", away: "Bayern", time: "Mar. 21:00", market: "Résultat", sels: [{ k: "1", n: "Real Madrid", o: 2.45 }, { k: "X", n: "Match nul", o: 3.70 }, { k: "2", n: "Bayern", o: 2.70 }] },
    { id: "f4", sport: "Football", league: "Serie A", home: "Inter", away: "Juventus", time: "Dim. 20:45", market: "Résultat", sels: [{ k: "1", n: "Inter", o: 2.00 }, { k: "X", n: "Match nul", o: 3.40 }, { k: "2", n: "Juventus", o: 3.90 }] },
    { id: "f5", sport: "Football", league: "Liga", home: "Barcelone", away: "Atlético", time: "Sam. 18:30", market: "Résultat", sels: [{ k: "1", n: "Barcelone", o: 1.75 }, { k: "X", n: "Match nul", o: 3.90 }, { k: "2", n: "Atlético", o: 4.60 }] },
    { id: "f6", sport: "Football", league: "Bundesliga", home: "Bayern", away: "Dortmund", time: "Sam. 18:30", market: "Résultat", sels: [{ k: "1", n: "Bayern", o: 1.55 }, { k: "X", n: "Match nul", o: 4.50 }, { k: "2", n: "Dortmund", o: 5.80 }] },
    { id: "t1", sport: "Tennis", league: "ATP Masters", home: "Alcaraz", away: "Sinner", time: "Sam. 15:00", market: "Vainqueur", sels: [{ k: "1", n: "Alcaraz", o: 1.90 }, { k: "2", n: "Sinner", o: 1.90 }] },
    { id: "t2", sport: "Tennis", league: "WTA 1000", home: "Swiatek", away: "Sabalenka", time: "Sam. 13:00", market: "Vainqueur", sels: [{ k: "1", n: "Swiatek", o: 1.55 }, { k: "2", n: "Sabalenka", o: 2.45 }] },
    { id: "t3", sport: "Tennis", league: "ATP 500", home: "Djokovic", away: "Medvedev", time: "Dim. 14:00", market: "Vainqueur", sels: [{ k: "1", n: "Djokovic", o: 1.70 }, { k: "2", n: "Medvedev", o: 2.20 }] },
    { id: "b1", sport: "Basket", league: "NBA", home: "Celtics", away: "Lakers", time: "Lun. 02:00", market: "Vainqueur", sels: [{ k: "1", n: "Celtics", o: 1.45 }, { k: "2", n: "Lakers", o: 2.75 }] },
    { id: "b2", sport: "Basket", league: "Euroligue", home: "Monaco", away: "Madrid", time: "Ven. 20:00", market: "Vainqueur", sels: [{ k: "1", n: "Monaco", o: 2.05 }, { k: "2", n: "Madrid", o: 1.80 }] },
    { id: "b3", sport: "Basket", league: "NBA", home: "Warriors", away: "Nuggets", time: "Mar. 03:00", market: "Vainqueur", sels: [{ k: "1", n: "Warriors", o: 2.30 }, { k: "2", n: "Nuggets", o: 1.65 }] },
    { id: "e1", sport: "E-sport", league: "LEC", home: "G2 Esports", away: "Fnatic", time: "Sam. 18:00", market: "Vainqueur", sels: [{ k: "1", n: "G2", o: 1.40 }, { k: "2", n: "Fnatic", o: 2.90 }] },
    { id: "e2", sport: "E-sport", league: "Counter-Strike Major", home: "Vitality", away: "FaZe", time: "Sam. 20:00", market: "Vainqueur", sels: [{ k: "1", n: "Vitality", o: 1.85 }, { k: "2", n: "FaZe", o: 1.95 }] },
    { id: "r1", sport: "Rugby", league: "Top 14", home: "Toulouse", away: "La Rochelle", time: "Sam. 21:05", market: "Résultat", sels: [{ k: "1", n: "Toulouse", o: 1.50 }, { k: "X", n: "Match nul", o: 22.0 }, { k: "2", n: "La Rochelle", o: 2.60 }] },
    { id: "r2", sport: "Rugby", league: "Six Nations", home: "France", away: "Angleterre", time: "Sam. 17:45", market: "Résultat", sels: [{ k: "1", n: "France", o: 1.65 }, { k: "X", n: "Match nul", o: 25.0 }, { k: "2", n: "Angleterre", o: 2.30 }] },
    { id: "h1", sport: "Hippique", league: "Prix de Diane", home: "Vinci d'Or", away: "Field", time: "Dim. 16:45", market: "Vainqueur", sels: [{ k: "1", n: "Vinci d'Or", o: 4.50 }, { k: "2", n: "Le reste", o: 1.20 }] },
    { id: "h2", sport: "Hippique", league: "Vincennes", home: "Idéal Royal", away: "Field", time: "Mar. 20:15", market: "Vainqueur", sels: [{ k: "1", n: "Idéal Royal", o: 5.20 }, { k: "2", n: "Le reste", o: 1.18 }] },
  ];

  // Catalogue des disciplines affichées dans la grille des paris sportifs
  const SPORT_CATEGORIES = [
    { id: "Football",  desc: "Ligue 1 · Premier League · Liga · Bundesliga · LdC" },
    { id: "Tennis",    desc: "ATP · WTA · Grand Chelem" },
    { id: "Basket",    desc: "NBA · Euroligue" },
    { id: "E-sport",   desc: "LoL · CS2 · Valorant · Dota 2" },
    { id: "Rugby",     desc: "Top 14 · Six Nations · Champions Cup" },
    { id: "Hippique",  desc: "PMU · Quinté+ · Trot et galop" },
    { id: "MMA",       desc: "UFC · Bellator · ONE Championship", soon: true },
    { id: "Hockey",    desc: "NHL · KHL · Champions League", soon: true },
    { id: "Volley",    desc: "Ligue A · CEV · FIVB", soon: true },
  ];

  function availableBalance(acc) {
    const pend = (acc.pending || []).reduce((s, p) => s + p.stake, 0);
    return round2(acc.balance - pend);
  }
  function placeWager(acc, { fixtureId, pick, stake }) {
    if (acc.status !== "active" && acc.status !== "funded") return { error: "Ce compte n'accepte plus de paris." };
    stake = Number(stake);
    const f = FIXTURES.find(x => x.id === fixtureId); if (!f) return { error: "Match introuvable." };
    const sel = f.sels.find(s => s.k === pick); if (!sel) return { error: "Sélection invalide." };
    if (!(stake > 0)) return { error: "Mise invalide." };
    const maxStake = acc.capital * acc.tier.maxStakePct / 100;
    if (stake > maxStake + 0.001) return { error: `Mise maximale ${fmt(maxStake)} (${acc.tier.maxStakePct}% du capital).` };
    if (acc.tier.minStakePct) {
      const minStake = acc.capital * acc.tier.minStakePct / 100;
      if (stake < minStake - 0.001) return { error: `Mise minimale ${fmt(minStake)} (${acc.tier.minStakePct}% du capital).` };
    }
    if (stake > availableBalance(acc) + 0.001) return { error: "Solde disponible insuffisant (paris en cours déduits)." };
    acc.pending = acc.pending || [];
    acc.pending.push({ id: Date.now() + "-" + Math.floor(Math.random() * 1000), event: f.home + " – " + f.away, sport: f.sport, pickName: sel.n, odds: sel.o, stake: round2(stake), placedAt: Date.now() });
    saveAccount(acc);
    return { ok: true };
  }
  // Règle tous les paris en cours (résultat aléatoire pondéré par la cote, marge maison ~8 %)
  function settleAll(acc) {
    if (!acc.pending || !acc.pending.length) return { error: "Aucun pari en cours à régler." };
    const results = [];
    acc.pending.slice().forEach(p => {
      const winProb = (1 / p.odds) * 0.92;
      const win = Math.random() < winProb;
      const day = todayKey();
      if (acc.dayStart[day] === undefined) acc.dayStart[day] = acc.balance;
      const pnl = win ? p.stake * (p.odds - 1) : -p.stake;
      acc.balance = round2(acc.balance + pnl);
      acc.peak = Math.max(acc.peak, acc.balance);
      acc.bets.unshift({ id: p.id, date: Date.now(), day, event: p.event + " · " + p.pickName, stake: p.stake, odds: p.odds, result: win ? "win" : "lose", pnl: round2(pnl), balanceAfter: acc.balance });
      results.push({ event: p.event, win: win, pnl: round2(pnl) });
      evaluateRules(acc, day);
    });
    acc.pending = [];
    saveAccount(acc);
    return { ok: true, results };
  }

  // Position sur marché de prédiction (Polymarket-style)
  function placePrediction(acc, { marketId, marketTitle, side, price, stake }) {
    if (acc.status !== "active" && acc.status !== "funded") return { error: "Ce compte n'accepte plus de paris." };
    stake = Number(stake); price = Number(price);
    if (!(stake > 0)) return { error: "Mise invalide." };
    if (!(price > 0.01 && price < 0.99)) return { error: "Prix de marché invalide." };
    const maxStake = acc.capital * acc.tier.maxStakePct / 100;
    if (stake > maxStake + 0.001) return { error: `Mise maximale ${fmt(maxStake)} (${acc.tier.maxStakePct}% du capital).` };
    if (stake > availableBalance(acc) + 0.001) return { error: "Solde disponible insuffisant." };
    const odds = round2(1 / price);
    acc.pending = acc.pending || [];
    acc.pending.push({
      id: Date.now() + "-" + Math.floor(Math.random() * 1000),
      event: marketTitle.length > 90 ? marketTitle.slice(0, 87) + "…" : marketTitle,
      sport: "Marché prédictif",
      pickName: side,
      odds,
      stake: round2(stake),
      placedAt: Date.now(),
      kind: "prediction",
      marketId,
      price,
    });
    saveAccount(acc);
    return { ok: true };
  }

  /* ----------------------------------------------------------
     Admin — agrégateurs cross-users (lit tout le localStorage)
     ---------------------------------------------------------- */
  function adminUsers() { return Object.values(read(KEYS.users, {})); }
  function adminAccounts() {
    const raw = read(KEYS.accounts, {});
    const out = [];
    Object.entries(raw).forEach(([email, slot]) => {
      if (slot && slot.sports) out.push(Object.assign({ _email: email }, slot.sports));
      if (slot && slot.predictions) out.push(Object.assign({ _email: email }, slot.predictions));
    });
    return out;
  }
  function adminPayments() {
    const out = [];
    adminUsers().forEach(u => {
      const pays = read("sf_payments_" + u.email, []);
      pays.forEach(p => out.push(Object.assign({ _email: u.email, _name: u.name }, p)));
    });
    return out.sort((a, b) => b.at - a.at);
  }
  function adminContacts() { return read("sf_contacts", []); }
  function adminCommunitiesList() { return Object.values(read("sf_communities", {})); }

  function adminKpis() {
    const users = adminUsers();
    const accs = adminAccounts();
    const pays = adminPayments();
    const now = Date.now();
    const monthAgo = now - 30 * 86400000;
    const revenue = pays.filter(p => p.dir === "out" && p.type === "Challenge").reduce((s, p) => s + p.amount, 0);
    const revenueMonth = pays.filter(p => p.dir === "out" && p.type === "Challenge" && p.at >= monthAgo).reduce((s, p) => s + p.amount, 0);
    const payouts = pays.filter(p => p.dir === "in" && p.type === "Retrait");
    const payoutsTotal = payouts.reduce((s, p) => s + p.amount, 0);
    const payoutsMonth = payouts.filter(p => p.at >= monthAgo).reduce((s, p) => s + p.amount, 0);
    return {
      usersTotal: users.length,
      usersMonth: users.filter(u => (u.created || 0) >= monthAgo).length,
      challengesActive: accs.filter(a => a.status === "active" && a.phase === "evaluation").length,
      challengesPassed: accs.filter(a => a.status === "passed").length,
      challengesFailed: accs.filter(a => a.status === "failed").length,
      fundedActive: accs.filter(a => a.phase === "funded").length,
      revenue, revenueMonth,
      payoutsTotal, payoutsMonth,
      messagesOpen: adminContacts().length,
    };
  }

  /* ----------------------------------------------------------
     Navbar (état connecté / déconnecté)
     ---------------------------------------------------------- */
  function renderNav(active) {
    const u = currentUser();
    const admin = isAdmin();
    // Pour les admins, on garde uniquement les liens vitrine + bouton vers admin console.
    // L'admin n'est pas un parieur : pas de challenges, pas d'arena, pas d'espace membre.
    const links = admin
      ? [
          { href: "index.html", label: "Accueil" },
          { href: "contact.html", label: "Contact" },
        ]
      : [
          { href: "index.html", label: "Accueil" },
          { href: "arena.html", label: "Arena" },
          { href: "index.html#challenges", label: "Challenges" },
          { href: "index.html#about", label: "À propos" },
          { href: "index.html#faq", label: "FAQ" },
          { href: "contact.html", label: "Contact" },
        ];
    const navLinks = links.map(l => `<a href="${l.href}">${l.label}</a>`).join("");
    let actions;
    if (admin) {
      actions = `<a class="btn btn-ghost btn-sm" href="admin.html">Admin console</a>
         <button class="btn btn-primary btn-sm" onclick="(async()=>{await SF.logout();location.href='index.html';})();">Déconnexion</button>`;
    } else if (u) {
      actions = `<a class="btn btn-ghost btn-sm" href="espace.html">Espace membre</a>
         <button class="btn btn-primary btn-sm" onclick="(async()=>{await SF.logout();location.href='index.html';})();">Déconnexion</button>`;
    } else {
      actions = `<a class="btn btn-ghost btn-sm" href="login.html">Connexion</a>
         <a class="btn btn-primary btn-sm" href="challenges.html">Commencer</a>`;
    }
    // Auth visible aussi dans le burger mobile (caché en desktop)
    let mobileAuth;
    if (admin) {
      mobileAuth = `<div class="nav-mobile-auth">
           <a class="btn btn-ghost btn-block" href="admin.html">Admin console</a>
           <button class="btn btn-primary btn-block" onclick="(async()=>{await SF.logout();location.href='index.html';})();">Déconnexion</button>
         </div>`;
    } else if (u) {
      mobileAuth = `<div class="nav-mobile-auth">
           <a class="btn btn-ghost btn-block" href="espace.html">Espace membre</a>
           <button class="btn btn-primary btn-block" onclick="(async()=>{await SF.logout();location.href='index.html';})();">Déconnexion</button>
         </div>`;
    } else {
      mobileAuth = `<div class="nav-mobile-auth">
           <a class="btn btn-ghost btn-block" href="login.html">Connexion</a>
           <a class="btn btn-primary btn-block" href="challenges.html">Commencer</a>
         </div>`;
    }
    return `
    <nav class="nav">
      <div class="container nav-inner">
        <a class="brand" href="index.html"><svg class="brand-lines" viewBox="0 0 26 22" aria-hidden="true"><rect x="8" y="4" width="14" height="4" rx="2" fill="#7C6BF6" opacity=".6"/><rect x="2" y="9" width="20" height="4" rx="2" fill="#7C6BF6"/><rect x="10" y="14" width="12" height="4" rx="2" fill="#7C6BF6" opacity=".45"/></svg><span class="brand-logo"><span class="s">S</span>povibe</span></a>
        <div class="nav-links" id="navLinks">${navLinks}${mobileAuth}</div>
        <div class="nav-actions">${actions}</div>
        <button class="nav-toggle" aria-label="Menu" onclick="document.getElementById('navLinks').classList.toggle('open')">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M3 12h18M3 18h18"/></svg>
        </button>
      </div>
    </nav>`;
  }

  function requireAuth() {
    if (!currentUser()) { location.href = "login.html"; return false; }
    return true;
  }

  /* ----------------------------------------------------------
     Export
     ---------------------------------------------------------- */
  // dataReady : promise qui résout quand l'hydratation Supabase est terminée.
  // Les pages back-office l'awaitent avant de render.
  function dataReady() {
    if (global.SpovibeAuth && global.SpovibeAuth.ensureHydrated) {
      return global.SpovibeAuth.ensureHydrated();
    }
    return Promise.resolve(true);
  }

  global.SF = {
    TIERS, TIERS_SPORTS, TIERS_PREDICTIONS, ALL_TIERS, tierById, DIVS,
    signup, login, logout, currentUser, isAdmin, dataReady,
    getAccount, sportsAccount, predictionsAccount, activeAccounts,
    startChallenge, saveAccount, resetAccount,
    placeBet, claimFunded, withdraw, stats, combinedStats, countDays,
    saveContact,
    arena, saveArena, poule, currentSeason,
    arenaTourn, toggleSoiree, survivorEnter, survivorPick, survivorRestart,
    getDuels, createDuel, settleDuel, deleteDuel,
    badges,
    FIXTURES, SPORT_CATEGORIES, availableBalance, placeWager, settleAll, placePrediction,
    getRewards, saveRewards, referralCode,
    myCommunity, isCreator, createCommunity, joinCommunity, leaveCommunity, postMessage,
    updateProfile, changePassword, payments, prefs, savePrefs,
    fmt, fmt2, fmtDate, round2, escapeHtml,
    renderNav, requireAuth,
    adminUsers, adminAccounts, adminPayments, adminContacts, adminCommunitiesList, adminKpis,
  };
})(window);
