// ============================================================
// Spovibe — Edge Function: send-email
// Reçoit { template, to, data } depuis le frontend authentifié,
// rend le template HTML, et envoie via Resend API.
//
// Variable d'env requise : RESEND_API_KEY (configurée dans Supabase Dashboard
// → Project Settings → Edge Functions → Secrets).
//
// Templates disponibles :
//   - welcome              : après confirmation e-mail du nouveau user
//   - challenge_purchased  : après achat d'un challenge
//   - challenge_passed     : évaluation réussie
//   - challenge_failed     : évaluation échouée
//   - withdrawal_requested : retrait demandé (notif user)
//   - withdrawal_paid      : retrait payé (notif user)
// ============================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ============================================================
// Design tokens — pour cohérence visuelle e-mails / site
// ============================================================
const COLORS = {
  lavande: "#7C6BF6",
  lavandeDark: "#5848E0",
  orange: "#FB8500",
  ink: "#0F0E1A",
  inkSoft: "#4B4A5C",
  muted: "#6B6B7B",
  bg: "#F5F4FB",
  surface: "#FFFFFF",
  border: "#E8E6F4",
  green: "#16a34a",
  red: "#dc2626",
};

function shell({ preheader, title, body, ctaLabel, ctaUrl, footnote }: {
  preheader?: string; title: string; body: string;
  ctaLabel?: string; ctaUrl?: string; footnote?: string;
}) {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:${COLORS.bg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${COLORS.ink};">
  ${preheader ? `<div style="display:none;font-size:1px;color:${COLORS.bg};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${preheader}</div>` : ""}
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:${COLORS.bg};padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width:560px;background:${COLORS.surface};border-radius:16px;box-shadow:0 1px 3px rgba(15,14,26,0.06);overflow:hidden;">
        <!-- Header -->
        <tr><td style="padding:28px 32px 12px;border-bottom:1px solid ${COLORS.border};">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0">
            <tr>
              <td>
                <span style="display:inline-block;font-family:'Archivo Black',Impact,sans-serif;font-weight:900;font-size:1.4rem;letter-spacing:-0.02em;color:${COLORS.ink};">
                  <span style="color:${COLORS.lavande};">S</span>povibe
                </span>
              </td>
            </tr>
          </table>
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:32px;">
          <h1 style="margin:0 0 16px;font-size:1.5rem;font-weight:800;letter-spacing:-0.02em;line-height:1.25;color:${COLORS.ink};">${title}</h1>
          <div style="font-size:1rem;line-height:1.6;color:${COLORS.inkSoft};">${body}</div>
          ${ctaLabel && ctaUrl ? `<div style="margin-top:28px;">
            <a href="${ctaUrl}" style="display:inline-block;background:${COLORS.lavande};color:#fff;text-decoration:none;font-weight:700;padding:14px 28px;border-radius:99px;font-size:0.96rem;">${ctaLabel}</a>
          </div>` : ""}
        </td></tr>
        <!-- Footer -->
        <tr><td style="padding:20px 32px 28px;background:${COLORS.bg};border-top:1px solid ${COLORS.border};font-size:0.78rem;color:${COLORS.muted};line-height:1.55;">
          ${footnote || ""}
          <p style="margin:8px 0 0;">© ${new Date().getFullYear()} Spovibe. Tous droits réservés.</p>
          <p style="margin:6px 0 0;">Tu reçois cet e-mail car tu as un compte sur <a href="https://spovibe.com" style="color:${COLORS.lavande};text-decoration:none;font-weight:600;">spovibe.com</a>.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ============================================================
// Templates — chaque template prend `data` et retourne { subject, html }
// ============================================================
type TemplateResult = { subject: string; html: string };

const templates: Record<string, (data: any) => TemplateResult> = {
  welcome: (d) => ({
    subject: "Bienvenue sur Spovibe 🎯",
    html: shell({
      preheader: "Ton compte Spovibe est activé. Lance ton premier challenge.",
      title: `Bienvenue ${d.name || "à toi"} !`,
      body: `<p>Ton compte Spovibe est officiellement <b>activé</b>. La prop firm dédiée aux parieurs sportifs et marchés prédictifs t'ouvre ses portes.</p>
      <p>Trois prochaines étapes pour commencer :</p>
      <ol style="margin:14px 0;padding-left:22px;line-height:1.8;">
        <li><b>Choisis un palier</b> de challenge (Sports ou Prédictions) entre 5 000 € et 100 000 € de bankroll.</li>
        <li><b>Démontre ta régularité</b> sur 30 jours — objectif +35 %, drawdown contrôlé.</li>
        <li><b>Active ton compte financé</b> et garde jusqu'à 85 % de tes gains.</li>
      </ol>`,
      ctaLabel: "Démarrer mon évaluation",
      ctaUrl: "https://spovibe.com/challenges.html",
      footnote: "Questions ? Réponds à cet e-mail ou écris-nous à <a href=\"mailto:support@spovibe.com\" style=\"color:" + COLORS.lavande + ";\">support@spovibe.com</a>.",
    }),
  }),

  challenge_purchased: (d) => ({
    subject: `Challenge ${d.tierName} activé · ${d.capital}`,
    html: shell({
      preheader: `Bankroll de ${d.capital} active. Démarrage de l'évaluation maintenant.`,
      title: `Challenge ${d.tierName} activé`,
      body: `<p>Confirmation de l'achat de ton challenge :</p>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:16px 0;background:${COLORS.bg};border-radius:10px;">
        <tr><td style="padding:14px 18px;border-bottom:1px solid ${COLORS.border};color:${COLORS.muted};font-size:0.86rem;">Palier</td><td style="padding:14px 18px;border-bottom:1px solid ${COLORS.border};text-align:right;font-weight:700;">${d.tierName}</td></tr>
        <tr><td style="padding:14px 18px;border-bottom:1px solid ${COLORS.border};color:${COLORS.muted};font-size:0.86rem;">Vertical</td><td style="padding:14px 18px;border-bottom:1px solid ${COLORS.border};text-align:right;font-weight:700;">${d.vertical || "Sports"}</td></tr>
        <tr><td style="padding:14px 18px;border-bottom:1px solid ${COLORS.border};color:${COLORS.muted};font-size:0.86rem;">Capital confié</td><td style="padding:14px 18px;border-bottom:1px solid ${COLORS.border};text-align:right;font-weight:800;color:${COLORS.lavande};">${d.capital}</td></tr>
        <tr><td style="padding:14px 18px;color:${COLORS.muted};font-size:0.86rem;">Frais d'évaluation</td><td style="padding:14px 18px;text-align:right;font-weight:700;">${d.fee} HT</td></tr>
      </table>
      <p>L'horloge tourne : tu as <b>${d.timeLimitDays || 30} jours</b> pour atteindre <b>+${d.target || 35} %</b> en respectant les règles de drawdown.</p>`,
      ctaLabel: "Accéder à mon espace",
      ctaUrl: "https://spovibe.com/espace.html",
      footnote: "Garde une copie de cet e-mail comme preuve d'achat. La facture détaillée est dispo dans ton espace membre.",
    }),
  }),

  challenge_passed: (d) => ({
    subject: `🎉 Évaluation ${d.tierName} réussie ! Active ton compte financé`,
    html: shell({
      preheader: `Profit +${d.profitPct}%. Ton compte financé t'attend.`,
      title: `Évaluation réussie 🎉`,
      body: `<p>Bravo ${d.name || ""}, tu as <b>validé ton challenge ${d.tierName}</b> avec un profit de <b style="color:${COLORS.green};">+${d.profitPct}%</b> sur ton capital initial.</p>
      <p>Prochaine étape : <b>active ton compte financé</b> pour basculer sur la vraie bankroll Spovibe. À partir de cet instant, tu gardes <b style="color:${COLORS.orange};">${d.split || 85} %</b> de tous tes gains, payés sous 24 h sur ton compte bancaire ou en USDC.</p>`,
      ctaLabel: "Activer mon compte financé",
      ctaUrl: "https://spovibe.com/espace.html#challenges",
      footnote: "Tu as 14 jours pour activer ton compte financé. Au-delà, il faudra repasser une évaluation.",
    }),
  }),

  challenge_failed: (d) => ({
    subject: `Évaluation ${d.tierName} terminée`,
    html: shell({
      preheader: "Voici les détails et tes options pour la suite.",
      title: `Évaluation terminée`,
      body: `<p>Ton évaluation ${d.tierName} s'est arrêtée sur la règle suivante :</p>
      <div style="background:${COLORS.bg};border-left:4px solid ${COLORS.red};padding:12px 16px;border-radius:8px;margin:14px 0;font-weight:600;">${d.reason || "Drawdown dépassé."}</div>
      <p>C'est rude, mais c'est aussi ce qui rend ce statut "Spovibe Funded" valuable — peu de gens y arrivent du premier coup. Les meilleurs traders prop firm passent 3 à 5 challenges avant d'être financés.</p>
      <p>Ce que tu peux faire maintenant :</p>
      <ul style="margin:14px 0;padding-left:22px;line-height:1.8;">
        <li><b>Analyse ton journal de paris</b> dans ton espace membre — où le drawdown a été pris ?</li>
        <li><b>Recommence sur le même palier</b> ou descend d'un niveau pour limiter la mise.</li>
      </ul>`,
      ctaLabel: "Choisir un nouveau challenge",
      ctaUrl: "https://spovibe.com/challenges.html",
    }),
  }),

  withdrawal_requested: (d) => ({
    subject: `Retrait de ${d.amount} en cours de traitement`,
    html: shell({
      preheader: "Réception de ta demande, traitement sous 24 h.",
      title: `Demande de retrait reçue`,
      body: `<p>On a bien reçu ta demande de retrait de <b style="color:${COLORS.orange};">${d.amount}</b>.</p>
      <p>Méthode : <b>${d.method || "Virement bancaire"}</b><br>
      Référence interne : <code style="background:${COLORS.bg};padding:2px 8px;border-radius:6px;font-size:0.88rem;">${d.id || "—"}</code></p>
      <p>Délai de traitement : <b>sous 24 h ouvrées</b>. Tu recevras un nouvel e-mail quand le virement sera émis avec la référence de transaction.</p>`,
      ctaLabel: "Voir mes retraits",
      ctaUrl: "https://spovibe.com/espace.html#profile",
    }),
  }),

  withdrawal_paid: (d) => ({
    subject: `✓ Retrait de ${d.amount} envoyé`,
    html: shell({
      preheader: `Référence de transaction : ${d.txRef || "—"}`,
      title: `Retrait envoyé ✓`,
      body: `<p>Bonne nouvelle : ton retrait de <b style="color:${COLORS.green};">${d.amount}</b> vient d'être envoyé.</p>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:16px 0;background:${COLORS.bg};border-radius:10px;">
        <tr><td style="padding:14px 18px;border-bottom:1px solid ${COLORS.border};color:${COLORS.muted};font-size:0.86rem;">Montant</td><td style="padding:14px 18px;border-bottom:1px solid ${COLORS.border};text-align:right;font-weight:800;color:${COLORS.green};">${d.amount}</td></tr>
        <tr><td style="padding:14px 18px;border-bottom:1px solid ${COLORS.border};color:${COLORS.muted};font-size:0.86rem;">Méthode</td><td style="padding:14px 18px;border-bottom:1px solid ${COLORS.border};text-align:right;font-weight:700;">${d.method || "Virement"}</td></tr>
        <tr><td style="padding:14px 18px;color:${COLORS.muted};font-size:0.86rem;">Référence tx</td><td style="padding:14px 18px;text-align:right;font-family:monospace;font-size:0.84rem;">${d.txRef || "—"}</td></tr>
      </table>
      <p>${d.method && d.method.toLowerCase().includes("usdc") ? "Le transfert USDC apparaît dans ton wallet dans les minutes qui suivent." : "Selon ta banque, le virement arrive sous 1-3 jours ouvrés."}</p>`,
      ctaLabel: "Voir mes retraits",
      ctaUrl: "https://spovibe.com/espace.html#profile",
    }),
  }),
};

// ============================================================
// Handler principal
// ============================================================
serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get("RESEND_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "RESEND_API_KEY missing" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { template, to, data } = await req.json();
    if (!template || !to) {
      return new Response(JSON.stringify({ error: "template & to required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const fn = templates[template];
    if (!fn) {
      return new Response(JSON.stringify({ error: `Unknown template: ${template}` }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { subject, html } = fn(data || {});

    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from: "Spovibe <noreply@spovibe.com>",
        to: Array.isArray(to) ? to : [to],
        subject,
        html,
      }),
    });

    const result = await resendRes.json();
    if (!resendRes.ok) {
      return new Response(JSON.stringify({ error: result.message || "Resend error", details: result }), {
        status: resendRes.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ ok: true, id: result.id }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
