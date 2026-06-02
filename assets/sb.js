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
      const userObj = {
        id: user.id,
        email: user.email,
        name: (profile && profile.name) || (user.user_metadata && user.user_metadata.name) || (user.email || "").split("@")[0],
        created: profile && profile.created_at ? new Date(profile.created_at).getTime() : Date.now(),
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
  };

  // Auto-init au chargement
  init();

  // Sync entre onglets : si l'utilisateur se déconnecte ailleurs, on suit
  setTimeout(() => {
    try {
      client().auth.onAuthStateChange((event) => {
        if (event === "SIGNED_OUT") setCachedUser(null);
        if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "USER_UPDATED") {
          refreshFromDb();
        }
      });
    } catch (e) {}
  }, 200);
})(window);
