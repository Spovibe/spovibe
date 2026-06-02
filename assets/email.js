// ============================================================
// Spovibe — Module Email client
// Wrapper léger pour appeler l'Edge Function send-email sur Supabase.
// Usage : SpovibeEmail.send("welcome", "user@example.com", { name: "Alex" })
// ============================================================
(function (global) {
  "use strict";

  function projectRef() {
    // Extrait "ongmdyybucbzykoehspn" depuis "https://ongmdyybucbzykoehspn.supabase.co"
    if (!global.SPOVIBE_SUPABASE) return null;
    const url = global.SPOVIBE_SUPABASE.url || "";
    const m = url.match(/^https?:\/\/([^.]+)\.supabase\.co/);
    return m ? m[1] : null;
  }

  function functionUrl(fnName) {
    const ref = projectRef();
    if (!ref) throw new Error("Supabase URL non configurée");
    return `https://${ref}.functions.supabase.co/${fnName}`;
  }

  // Envoie un e-mail via l'Edge Function. Fire-and-forget par défaut (await
  // optionnel si l'appelant veut vérifier le résultat).
  async function send(template, to, data) {
    try {
      if (!global.SpovibeAuth) throw new Error("Auth Supabase non chargée");
      const c = global.SpovibeAuth.client();
      const { data: { session } } = await c.auth.getSession();
      if (!session) throw new Error("Pas de session active");
      const res = await fetch(functionUrl("send-email"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session.access_token}`,
          "apikey": global.SPOVIBE_SUPABASE.anonKey,
        },
        body: JSON.stringify({ template, to, data: data || {} }),
      });
      const result = await res.json();
      if (!res.ok) {
        console.warn("send-email error:", result);
        return { error: result.error || "Erreur envoi e-mail" };
      }
      return { ok: true, id: result.id };
    } catch (e) {
      console.warn("SpovibeEmail.send exception:", e);
      return { error: e.message };
    }
  }

  global.SpovibeEmail = { send };
})(window);
