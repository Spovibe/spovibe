// ============================================================
// Spovibe — Wrapper Supabase
// Auth réelle via Supabase Auth, cache localStorage pour reads sync
// Dépendances : sb-config.js + @supabase/supabase-js (chargé via CDN)
// ============================================================
(function (global) {
  "use strict";

  const USER_CACHE_KEY = "sf_supabase_user";

  let _client = null;
  function client() {
    if (_client) return _client;
    if (!global.supabase) throw new Error("Supabase JS non chargé");
    if (!global.SPOVIBE_SUPABASE) throw new Error("sb-config.js non chargé");
    _client = global.supabase.createClient(
      global.SPOVIBE_SUPABASE.url,
      global.SPOVIBE_SUPABASE.anonKey
    );
    return _client;
  }

  // -- Cache local du user pour reads synchrones (SF.currentUser) --
  function setCachedUser(u) {
    if (u) localStorage.setItem(USER_CACHE_KEY, JSON.stringify(u));
    else localStorage.removeItem(USER_CACHE_KEY);
  }
  function getCachedUser() {
    try { return JSON.parse(localStorage.getItem(USER_CACHE_KEY)) || null; }
    catch (e) { return null; }
  }

  // Lit le profil enrichi (name) depuis la table profiles
  async function refreshFromDb() {
    try {
      const { data: { user } } = await client().auth.getUser();
      if (!user) { setCachedUser(null); return null; }
      const { data: profile } = await client()
        .from("profiles")
        .select("name,created_at")
        .eq("id", user.id)
        .maybeSingle();
      // Détecte si l'utilisateur est admin (via RPC is_admin sécurisé côté Postgres)
      let isAdmin = false;
      try {
        const { data: adminFlag } = await client().rpc("is_admin");
        isAdmin = !!adminFlag;
      } catch (e) { /* RPC absente ou non autorisée → user normal */ }
      const userObj = {
        id: user.id,
        email: user.email,
        name: (profile && profile.name) || (user.user_metadata && user.user_metadata.name) || (user.email || "").split("@")[0],
        created: profile && profile.created_at ? new Date(profile.created_at).getTime() : Date.now(),
        isAdmin,
      };
      setCachedUser(userObj);
      return userObj;
    } catch (e) {
      console.warn("Supabase refreshFromDb error:", e);
      return null;
    }
  }

  // Au chargement de page : hydrate le cache depuis la session existante
  async function init() {
    try {
      const { data: { session } } = await client().auth.getSession();
      if (session && session.user) {
        await refreshFromDb();
        // Lance l'hydratation des données utilisateur (non bloquante ici,
        // les pages qui en ont besoin l'awaiteront via ensureHydrated)
        ensureHydrated();
      } else {
        setCachedUser(null);
      }
    } catch (e) {
      console.warn("Supabase init error:", e);
    }
  }

  // -- Wrappers d'auth --
  async function signUp(name, email, password) {
    try {
      const { data, error } = await client().auth.signUp({
        email,
        password,
        options: { data: { name } },
      });
      if (error) return { error: traduireErreur(error.message) };
      // Le trigger SQL côté Supabase crée la ligne dans profiles automatiquement
      if (data.session) {
        await refreshFromDb();
        return { ok: true, user: getCachedUser() };
      }
      // Pas de session = confirmation par e-mail requise
      return { ok: true, needsConfirmation: true };
    } catch (e) {
      return { error: e.message || "Erreur d'inscription." };
    }
  }

  async function signIn(email, password) {
    try {
      const { data, error } = await client().auth.signInWithPassword({ email, password });
      if (error) return { error: traduireErreur(error.message) };
      await refreshFromDb();
      return { ok: true, user: getCachedUser() };
    } catch (e) {
      return { error: e.message || "Erreur de connexion." };
    }
  }

  async function signOut() {
    try { await client().auth.signOut(); } catch (e) {}
    setCachedUser(null);
    // On nettoie aussi la session legacy si jamais
    try { localStorage.removeItem("sf_session"); } catch (e) {}
  }

  function currentUser() {
    return getCachedUser();
  }

  // -- Helpers DB (utilisés par SF) --
  async function insertContact({ name, email, subject, message }) {
    try {
      const { error } = await client().from("contacts").insert({ name, email, subject: subject || null, message });
      if (error) return { error: error.message };
      return { ok: true };
    } catch (e) { return { error: e.message }; }
  }

  // -- Data layer Phase 2b : accounts + payments persistés --

  // Convertit une ligne accounts (Supabase) → format objet localStorage SF
  function rowToAccount(r) {
    return {
      tierId: r.tier_id,
      tier: r.tier,
      vertical: r.vertical,
      phase: r.phase,
      status: r.status,
      capital: Number(r.capital),
      balance: Number(r.balance),
      peak: Number(r.peak),
      startedAt: r.started_at ? new Date(r.started_at).getTime() : Date.now(),
      fundedAt: r.funded_at ? new Date(r.funded_at).getTime() : null,
      bets: Array.isArray(r.bets) ? r.bets : (r.bets || []),
      pending: Array.isArray(r.pending) ? r.pending : (r.pending || []),
      dayStart: r.day_start || {},
      failReason: r.fail_reason || null,
      withdrawn: Number(r.withdrawn || 0),
    };
  }

  // Fetch toutes les données du user connecté
  async function pullUserData() {
    try {
      const cached = getCachedUser();
      if (!cached) return null;
      const c = client();
      const [accountsRes, paymentsRes] = await Promise.all([
        c.from("accounts").select("*").eq("user_id", cached.id),
        c.from("payments").select("*").eq("user_id", cached.id).order("at", { ascending: false }),
      ]);
      const slot = { sports: null, predictions: null };
      for (const r of (accountsRes.data || [])) {
        if (r.vertical === "sports" || r.vertical === "predictions") {
          slot[r.vertical] = rowToAccount(r);
        }
      }
      const payments = (paymentsRes.data || []).map(p => ({
        type: p.type,
        label: p.label,
        amount: Number(p.amount),
        dir: p.direction,
        at: p.at ? new Date(p.at).getTime() : Date.now(),
      }));
      return { slot, payments };
    } catch (e) {
      console.warn("pullUserData error:", e);
      return null;
    }
  }

  // Hydrate le cache localStorage avec les données fraîches DB.
  // On attend que tous les pushes en cours soient terminés avant de pull,
  // sinon on risque d'écraser un état local plus récent (race condition
  // entre une écriture client juste avant et un fetch DB juste après).
  async function hydrateLocalStorage() {
    const cached = getCachedUser();
    if (!cached) return false;
    // Attente des pushes en cours (max 3s)
    let waited = 0;
    while (_pendingPushes > 0 && waited < 3000) {
      await new Promise(r => setTimeout(r, 50)); waited += 50;
    }
    const data = await pullUserData();
    if (!data) return false;
    try {
      const all = JSON.parse(localStorage.getItem("sf_accounts") || "{}");
      all[cached.email] = data.slot;
      localStorage.setItem("sf_accounts", JSON.stringify(all));
      localStorage.setItem("sf_payments_" + cached.email, JSON.stringify(data.payments));
      return true;
    } catch (e) { console.warn("hydrate write error:", e); return false; }
  }

  // Compteur de pushes en vol (incrémenté par pushAccount / pushPayment)
  let _pendingPushes = 0;

  // Upsert un account (sports OU predictions) en base
  async function pushAccount(vertical, acc) {
    _pendingPushes++;
    try {
      const cached = getCachedUser();
      if (!cached) return { error: "not connected" };
      if (!acc) {
        // null → on supprime cette ligne en base
        await client().from("accounts").delete().eq("user_id", cached.id).eq("vertical", vertical);
        return { ok: true };
      }
      const row = {
        user_id: cached.id,
        vertical,
        tier_id: acc.tierId,
        tier: acc.tier,
        phase: acc.phase || "evaluation",
        status: acc.status || "active",
        capital: acc.capital,
        balance: acc.balance,
        peak: acc.peak,
        started_at: acc.startedAt ? new Date(acc.startedAt).toISOString() : new Date().toISOString(),
        funded_at: acc.fundedAt ? new Date(acc.fundedAt).toISOString() : null,
        bets: acc.bets || [],
        pending: acc.pending || [],
        day_start: acc.dayStart || {},
        fail_reason: acc.failReason || null,
        withdrawn: acc.withdrawn || 0,
      };
      const { error } = await client().from("accounts").upsert(row, { onConflict: "user_id,vertical" });
      if (error) { console.warn("pushAccount error:", error); return { error: error.message }; }
      return { ok: true };
    } catch (e) { return { error: e.message }; }
    finally { _pendingPushes--; }
  }

  // Insert un payment
  async function pushPayment(p) {
    _pendingPushes++;
    try {
      const cached = getCachedUser();
      if (!cached || !p) return { error: "not connected" };
      const { error } = await client().from("payments").insert({
        user_id: cached.id,
        type: p.type,
        label: p.label,
        amount: p.amount,
        direction: p.dir || (p.amount < 0 ? "out" : "in"),
        at: p.at ? new Date(p.at).toISOString() : new Date().toISOString(),
      });
      if (error) { console.warn("pushPayment error:", error); return { error: error.message }; }
      return { ok: true };
    } catch (e) { return { error: e.message }; }
    finally { _pendingPushes--; }
  }

  // Supprime tous les comptes (utilisé par admin reset / leave)
  async function deleteAllAccounts() {
    _pendingPushes++;
    try {
      const cached = getCachedUser();
      if (!cached) return { ok: true };
      await client().from("accounts").delete().eq("user_id", cached.id);
      return { ok: true };
    } catch (e) { return { error: e.message }; }
    finally { _pendingPushes--; }
  }

  // -- Admin : liste tous les users (RLS doit autoriser admin) --
  async function adminListUsers() {
    try {
      const c = client();
      const { data: profiles, error: pe } = await c.from("profiles").select("id, email, name, created_at").order("created_at", { ascending: false });
      if (pe) return { error: pe.message };
      const { data: accounts } = await c.from("accounts").select("user_id, vertical, status, phase, balance, capital, peak");
      const { data: payments } = await c.from("payments").select("user_id, type, amount, direction, at");
      // Agrège par user
      const byUser = {};
      for (const p of (profiles || [])) byUser[p.id] = { profile: p, sports: null, predictions: null, payments: [] };
      for (const a of (accounts || [])) {
        if (!byUser[a.user_id]) continue;
        if (a.vertical === "sports" || a.vertical === "predictions") byUser[a.user_id][a.vertical] = a;
      }
      for (const pay of (payments || [])) {
        if (!byUser[pay.user_id]) continue;
        byUser[pay.user_id].payments.push(pay);
      }
      return { ok: true, users: Object.values(byUser) };
    } catch (e) { return { error: e.message }; }
  }

  // -- Promise d'hydratation : utilisée par les pages pour await avant render --
  let _hydratePromise = null;
  function ensureHydrated() {
    if (!_hydratePromise) {
      _hydratePromise = hydrateLocalStorage().catch(e => { console.warn(e); return false; });
    }
    return _hydratePromise;
  }
  function resetHydrate() { _hydratePromise = null; }

  // -- Traduction des messages Supabase en français --
  function traduireErreur(msg) {
    const m = (msg || "").toLowerCase();
    if (m.includes("invalid login credentials")) return "E-mail ou mot de passe incorrect.";
    if (m.includes("user already registered")) return "Un compte existe déjà avec cet e-mail.";
    if (m.includes("password should be at least")) return "Le mot de passe doit faire au moins 6 caractères.";
    if (m.includes("invalid email")) return "Adresse e-mail invalide.";
    if (m.includes("email rate limit")) return "Trop de tentatives, réessaie dans quelques minutes.";
    return msg;
  }

  // === Export ===
  global.SpovibeAuth = {
    client, init, refreshFromDb,
    signUp, signIn, signOut, currentUser,
    insertContact,
    // Phase 2b — data layer
    pullUserData, hydrateLocalStorage, pushAccount, pushPayment,
    deleteAllAccounts, ensureHydrated, resetHydrate,
    adminListUsers,
  };

  // Auto-init au chargement
  init();

  // Sync entre onglets : si l'utilisateur se déconnecte ailleurs, on suit
  setTimeout(() => {
    try {
      client().auth.onAuthStateChange(async (event) => {
        if (event === "SIGNED_OUT") {
          setCachedUser(null);
          resetHydrate();
          // Nettoie le cache local des données utilisateur précédent
          try {
            const all = JSON.parse(localStorage.getItem("sf_accounts") || "{}");
            localStorage.setItem("sf_accounts", JSON.stringify(all));
          } catch (e) {}
        }
        if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "USER_UPDATED") {
          await refreshFromDb();
          resetHydrate();
          await ensureHydrated();
        }
      });
    } catch (e) {}
  }, 200);
})(window);
