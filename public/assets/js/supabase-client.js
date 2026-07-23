import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

let client = null;
let sessionCache = null;

export function getSupabaseClient() {
  if (!client) {
    const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.APP_CONFIG || {};
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      // Erreur explicite plutôt qu'un echec confus plus tard (createClient
      // avec des valeurs manquantes echoue de facon peu claire) -- le plus
      // souvent, ca veut dire que assets/js/config.public.js n'existe pas a
      // cet emplacement exact, ou que la balise <script> qui le charge dans
      // le HTML pointe au mauvais endroit / a un nom different.
      const message = "Configuration manquante : assets/js/config.public.js introuvable ou incomplet (SUPABASE_URL / SUPABASE_ANON_KEY). Vérifie le nom exact du fichier et la balise <script> qui le charge dans le HTML.";
      document.body.insertAdjacentHTML("afterbegin",
        `<div style="position:fixed;inset:0;z-index:9999;background:#3A0F09;color:var(--sur-sombre);padding:24px;font:14px/1.5 sans-serif;">${message}</div>`);
      throw new Error(message);
    }
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true }
    });
    client.auth.onAuthStateChange((_event, session) => {
      sessionCache = session;
    });
  }
  return client;
}

export async function getSessionActuelle() {
  if (sessionCache) return sessionCache;
  const { data } = await getSupabaseClient().auth.getSession();
  sessionCache = data?.session || null;
  return sessionCache;
}
