// ============================================================================
// expedition-pricing.js
// Responsabilité : interroger rpc_estimer_tarif (inchangée) pour un couple
// de zones donné, et exposer un total pour un ensemble de trajets.
// ============================================================================

export async function estimerTarif(supabase, codeEntreprise, zoneDepart, zoneArrivee) {
  if (!zoneDepart || !zoneArrivee) return null;
  const { data, error } = await supabase.rpc("rpc_estimer_tarif", {
    p_code_entreprise: codeEntreprise,
    p_zone_depart: zoneDepart,
    p_zone_arrivee: zoneArrivee
  });
  if (error || data == null) return null;
  return Number(data);
}
