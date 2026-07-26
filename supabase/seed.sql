-- Donnees locales IKMS exclusivement destinees au developpement et aux tests.
--
-- Comptes (mot de passe commun : IkmsTest2026!)
--   admin@ikms.test
--   agent.yopougon@ikms.test
--   agent.cocody@ikms.test
--   ramassage@ikms.test
--   livraison@ikms.test
--
-- Ce fichier est execute apres toutes les migrations par `supabase db reset`.

begin;

insert into public.entreprises (
  id_entreprise,
  code_entreprise,
  nom,
  actif,
  essai_expire_le
) values (
  '10000000-0000-4000-8000-000000000001',
  'DEMO',
  'IKMS Démonstration',
  true,
  now() + interval '365 days'
);

insert into public.hubs (
  id_hub,
  id_entreprise,
  nom,
  adresse
) values
  (
    '20000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    'Hub Yopougon',
    'Niangon Nord, Yopougon, Abidjan'
  ),
  (
    '20000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    'Hub Cocody',
    'Danga, Cocody, Abidjan'
  );

insert into public.vehicules (
  id_vehicule,
  id_entreprise,
  type,
  immatriculation,
  charges_jour
) values
  (
    '40000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    'MOTO',
    'DEMO-RAM-01',
    2500
  ),
  (
    '40000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    'MOTO',
    'DEMO-LIV-01',
    2500
  );

insert into public.groupes_tarifaires (
  id_groupe,
  id_entreprise,
  code,
  nom
) values
  (
    '30000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    'YOPOUGON_OUEST',
    'Yopougon Ouest'
  ),
  (
    '30000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    'COCODY_CENTRE',
    'Cocody Centre'
  ),
  (
    '30000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000001',
    'ABOBO_NORD',
    'Abobo Nord'
  ),
  (
    '30000000-0000-4000-8000-000000000004',
    '10000000-0000-4000-8000-000000000001',
    'BINGERVILLE_EST',
    'Bingerville Est'
  );

insert into public.zones_tarification (
  id_entreprise,
  code_zone,
  secteur,
  id_hub,
  nom_commune,
  mots_cles,
  id_groupe_tarifaire,
  tarif_intra_zone
) values
  (
    '10000000-0000-4000-8000-000000000001',
    'YOPOUGON_NIANGON_NORD',
    'Niangon Nord',
    '20000000-0000-4000-8000-000000000001',
    'Yopougon',
    array['Niangon Nord', 'Niangon', 'Cité verte'],
    '30000000-0000-4000-8000-000000000001',
    800
  ),
  (
    '10000000-0000-4000-8000-000000000001',
    'YOPOUGON_NIANGON_SUD',
    'Niangon Sud',
    '20000000-0000-4000-8000-000000000001',
    'Yopougon',
    array['Niangon Sud', 'Niangon', 'Lubafrique'],
    '30000000-0000-4000-8000-000000000001',
    800
  ),
  (
    '10000000-0000-4000-8000-000000000001',
    'COCODY_DANGA',
    'Danga',
    '20000000-0000-4000-8000-000000000002',
    'Cocody',
    array['Danga', 'Cocody Danga'],
    '30000000-0000-4000-8000-000000000002',
    1000
  ),
  (
    '10000000-0000-4000-8000-000000000001',
    'COCODY_RIVIERA',
    'Riviera',
    '20000000-0000-4000-8000-000000000002',
    'Cocody',
    array['Riviera', 'Riviera 2', 'Riviera 3'],
    '30000000-0000-4000-8000-000000000002',
    1000
  ),
  (
    '10000000-0000-4000-8000-000000000001',
    'ABOBO_PK18',
    'PK18',
    '20000000-0000-4000-8000-000000000002',
    'Abobo',
    array['PK18', 'Abobo PK18'],
    '30000000-0000-4000-8000-000000000003',
    900
  ),
  (
    '10000000-0000-4000-8000-000000000001',
    'BINGERVILLE_PK18',
    'PK18',
    '20000000-0000-4000-8000-000000000002',
    'Bingerville',
    array['PK18', 'Bingerville PK18'],
    '30000000-0000-4000-8000-000000000004',
    900
  );

insert into public.tarifs_groupes (
  id_entreprise,
  groupe_a,
  groupe_b,
  montant
) values
  ('10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 1000),
  ('10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002', 2000),
  ('10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000003', 1800),
  ('10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000004', 2200),
  ('10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000002', 1200),
  ('10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000003', 1800),
  ('10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000004', 1600),
  ('10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000003', 1000),
  ('10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000004', 1500),
  ('10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000004', '30000000-0000-4000-8000-000000000004', 1000);

insert into public.zones_tarifs_paires (
  id_entreprise,
  zone_a,
  zone_b,
  montant
) values (
  '10000000-0000-4000-8000-000000000001',
  'ABOBO_PK18',
  'BINGERVILLE_PK18',
  1800
);

insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
) values
  (
    '00000000-0000-0000-0000-000000000000',
    '50000000-0000-4000-8000-000000000001',
    'authenticated',
    'authenticated',
    'admin@ikms.test',
    extensions.crypt('IkmsTest2026!', extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"],"role":"admin","id_entreprise":"10000000-0000-4000-8000-000000000001"}',
    '{"nom":"Aminata Admin"}',
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '50000000-0000-4000-8000-000000000002',
    'authenticated',
    'authenticated',
    'agent.yopougon@ikms.test',
    extensions.crypt('IkmsTest2026!', extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"],"role":"agent","id_entreprise":"10000000-0000-4000-8000-000000000001"}',
    '{"nom":"Mariam Agent Yopougon"}',
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '50000000-0000-4000-8000-000000000003',
    'authenticated',
    'authenticated',
    'agent.cocody@ikms.test',
    extensions.crypt('IkmsTest2026!', extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"],"role":"agent","id_entreprise":"10000000-0000-4000-8000-000000000001"}',
    '{"nom":"Serge Agent Cocody"}',
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '50000000-0000-4000-8000-000000000004',
    'authenticated',
    'authenticated',
    'ramassage@ikms.test',
    extensions.crypt('IkmsTest2026!', extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"],"role":"livreur","id_entreprise":"10000000-0000-4000-8000-000000000001"}',
    '{"nom":"Yao Ramassage"}',
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '50000000-0000-4000-8000-000000000005',
    'authenticated',
    'authenticated',
    'livraison@ikms.test',
    extensions.crypt('IkmsTest2026!', extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"],"role":"livreur","id_entreprise":"10000000-0000-4000-8000-000000000001"}',
    '{"nom":"Issa Livraison"}',
    now(),
    now()
  );

insert into auth.identities (
  id,
  provider_id,
  user_id,
  identity_data,
  provider,
  last_sign_in_at,
  created_at,
  updated_at
)
select
  ('a0000000-0000-4000-8000-' || right(u.id::text, 12))::uuid,
  u.id::text,
  u.id,
  jsonb_build_object(
    'sub', u.id::text,
    'email', u.email,
    'email_verified', true,
    'phone_verified', false
  ),
  'email',
  now(),
  now(),
  now()
from auth.users u
where u.id in (
  '50000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000002',
  '50000000-0000-4000-8000-000000000003',
  '50000000-0000-4000-8000-000000000004',
  '50000000-0000-4000-8000-000000000005'
);

insert into public.utilisateurs (
  id_utilisateur,
  id_entreprise,
  nom,
  telephone,
  email,
  role,
  salaire_jour,
  charges_jour,
  id_vehicule,
  id_hub_affecte
) values
  (
    '50000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    'Aminata Admin',
    '+2250100000001',
    'admin@ikms.test',
    'admin',
    0,
    0,
    null,
    null
  ),
  (
    '50000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    'Mariam Agent Yopougon',
    '+2250100000002',
    'agent.yopougon@ikms.test',
    'agent',
    8000,
    1000,
    null,
    '20000000-0000-4000-8000-000000000001'
  ),
  (
    '50000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000001',
    'Serge Agent Cocody',
    '+2250100000003',
    'agent.cocody@ikms.test',
    'agent',
    8000,
    1000,
    null,
    '20000000-0000-4000-8000-000000000002'
  ),
  (
    '50000000-0000-4000-8000-000000000004',
    '10000000-0000-4000-8000-000000000001',
    'Yao Ramassage',
    '+2250100000004',
    'ramassage@ikms.test',
    'livreur',
    7000,
    500,
    '40000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001'
  ),
  (
    '50000000-0000-4000-8000-000000000005',
    '10000000-0000-4000-8000-000000000001',
    'Issa Livraison',
    '+2250100000005',
    'livraison@ikms.test',
    'livreur',
    7000,
    500,
    '40000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000002'
  );

insert into public.clients_pro (
  id_client,
  id_entreprise,
  nom,
  telephone,
  email,
  adresse,
  solde_portefeuille,
  facturation_activee
) values (
  '60000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  'Boutique Démo',
  '+2250100000010',
  'boutique@ikms.test',
  'Niangon Nord, Yopougon',
  25000,
  false
);

insert into public.mouvements_portefeuille (
  id_entreprise,
  id_client,
  type,
  montant,
  note,
  cree_par
) values (
  '10000000-0000-4000-8000-000000000001',
  '60000000-0000-4000-8000-000000000001',
  'CREDIT',
  25000,
  'Crédit initial de démonstration',
  '50000000-0000-4000-8000-000000000001'
);

do $seed$
declare
  v_jour date := (clock_timestamp() at time zone 'Africa/Abidjan')::date;
  v_date text := to_char(v_jour, 'YYMMDD');
  v_cmd text[];
  v_rm text[];
  v_col text[];
  v_liv text[];
begin
  v_cmd := array[
    'CMD-' || v_date || '-001',
    'CMD-' || v_date || '-002',
    'CMD-' || v_date || '-003',
    'CMD-' || v_date || '-004',
    'CMD-' || v_date || '-005',
    'CMD-' || v_date || '-006',
    'CMD-' || v_date || '-007',
    'CMD-' || v_date || '-008'
  ];
  v_rm := array[
    'RM-' || v_date || '-001',
    'RM-' || v_date || '-002',
    'RM-' || v_date || '-003',
    'RM-' || v_date || '-004',
    'RM-' || v_date || '-005',
    'RM-' || v_date || '-006',
    'RM-' || v_date || '-007',
    'RM-' || v_date || '-008'
  ];
  v_col := array[
    'COL-' || v_date || '-001',
    'COL-' || v_date || '-002',
    'COL-' || v_date || '-003',
    'COL-' || v_date || '-004',
    'COL-' || v_date || '-005',
    'COL-' || v_date || '-006',
    'COL-' || v_date || '-007',
    'COL-' || v_date || '-008'
  ];
  v_liv := array[
    'LIV-' || v_date || '-001',
    'LIV-' || v_date || '-002',
    'LIV-' || v_date || '-003'
  ];

  insert into public.commandes (
    id_commande,
    id_entreprise,
    canal_creation,
    cree_par,
    expediteur_nom,
    expediteur_tel,
    expediteur_adresse,
    gps_expediteur,
    code_ramassage,
    mode_paiement,
    id_livreur_ramassage,
    cree_le,
    id_client_pro,
    id_hub_prevu,
    alerte_zone_expediteur,
    id_ramassage
  ) values
    (
      v_cmd[1], '10000000-0000-4000-8000-000000000001', 'DIRECT', null,
      'Aïcha Koffi', '+2250100000101', 'Niangon Nord, Yopougon',
      '{"lat":5.3351,"lng":-4.1053}', 'RAM001', 'A_LA_LIVRAISON',
      '50000000-0000-4000-8000-000000000004', now() - interval '45 minutes',
      null, '20000000-0000-4000-8000-000000000001', null, v_rm[1]
    ),
    (
      v_cmd[2], '10000000-0000-4000-8000-000000000001', 'INTERNE',
      '50000000-0000-4000-8000-000000000002',
      'Kouadio SARL', '+2250100000102', 'Niangon Sud, Yopougon',
      '{"lat":5.3224,"lng":-4.1127}', 'RAM002', 'SANS_PAIEMENT',
      '50000000-0000-4000-8000-000000000004', now() - interval '3 hours',
      null, '20000000-0000-4000-8000-000000000001', null, v_rm[2]
    ),
    (
      v_cmd[3], '10000000-0000-4000-8000-000000000001', 'INTERNE',
      '50000000-0000-4000-8000-000000000002',
      'Fatim Diarra', '+2250100000103', 'Niangon Nord, Yopougon',
      '{"lat":5.3370,"lng":-4.1020}', 'RAM003', 'A_LA_LIVRAISON',
      '50000000-0000-4000-8000-000000000004', now() - interval '5 hours',
      null, '20000000-0000-4000-8000-000000000001', null, v_rm[3]
    ),
    (
      v_cmd[4], '10000000-0000-4000-8000-000000000001', 'DIRECT', null,
      'Boutique Nour', '+2250100000104', 'Niangon Sud, Yopougon',
      '{"lat":5.3210,"lng":-4.1090}', 'RAM004', 'A_LA_LIVRAISON',
      '50000000-0000-4000-8000-000000000004', now() - interval '7 hours',
      null, '20000000-0000-4000-8000-000000000001', null, v_rm[4]
    ),
    (
      v_cmd[5], '10000000-0000-4000-8000-000000000001', 'INTERNE',
      '50000000-0000-4000-8000-000000000003',
      'Maison Kady', '+2250100000105', 'Danga, Cocody',
      '{"lat":5.3448,"lng":-3.9954}', 'RAM005', 'A_LA_LIVRAISON',
      '50000000-0000-4000-8000-000000000004', now() - interval '9 hours',
      null, '20000000-0000-4000-8000-000000000002', null, v_rm[5]
    ),
    (
      v_cmd[6], '10000000-0000-4000-8000-000000000001', 'INTERNE',
      '50000000-0000-4000-8000-000000000003',
      'Soum Cosmétique', '+2250100000106', 'Riviera 2, Cocody',
      '{"lat":5.3610,"lng":-3.9730}', 'RAM006', 'A_LA_LIVRAISON',
      '50000000-0000-4000-8000-000000000004', now() - interval '1 day',
      null, '20000000-0000-4000-8000-000000000002', null, v_rm[6]
    ),
    (
      v_cmd[7], '10000000-0000-4000-8000-000000000001', 'DIRECT', null,
      'Nadia Koné', '+2250100000107', 'PK18, Bingerville',
      '{"lat":5.4070,"lng":-3.8440}', 'RAM007', 'A_LA_LIVRAISON',
      '50000000-0000-4000-8000-000000000004', now() - interval '1 day 2 hours',
      null, '20000000-0000-4000-8000-000000000002', null, v_rm[7]
    ),
    (
      v_cmd[8], '10000000-0000-4000-8000-000000000001', 'CLIENT_PRO',
      '50000000-0000-4000-8000-000000000001',
      'Boutique Démo', '+2250100000010', 'Niangon Nord, Yopougon',
      '{"lat":5.3351,"lng":-4.1053}', 'RAM008', 'PAR_EXPEDITEUR',
      null, now() - interval '15 minutes',
      '60000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001', null, v_rm[8]
    );

  insert into public.lots_livraison (
    id_lot,
    id_entreprise,
    id_livreur,
    cree_par,
    note,
    cree_le,
    id_hub
  ) values
    (
      v_liv[1], '10000000-0000-4000-8000-000000000001',
      '50000000-0000-4000-8000-000000000005',
      '50000000-0000-4000-8000-000000000002',
      'Lot prêt au départ', now() - interval '4 hours',
      '20000000-0000-4000-8000-000000000001'
    ),
    (
      v_liv[2], '10000000-0000-4000-8000-000000000001',
      '50000000-0000-4000-8000-000000000005',
      '50000000-0000-4000-8000-000000000002',
      'Récupération demandée', now() - interval '6 hours',
      '20000000-0000-4000-8000-000000000001'
    ),
    (
      v_liv[3], '10000000-0000-4000-8000-000000000001',
      '50000000-0000-4000-8000-000000000005',
      '50000000-0000-4000-8000-000000000003',
      'Tournée Cocody et périphérie', now() - interval '10 hours',
      '20000000-0000-4000-8000-000000000002'
    );

  insert into public.colis (
    id_colis,
    id_entreprise,
    id_commande,
    id_lot,
    destinataire_nom,
    destinataire_tel,
    destinataire_adresse,
    gps_destinataire,
    code_livraison,
    code_zone,
    montant_livraison,
    statut,
    motif_retour,
    cree_le,
    maj_le,
    code_retour,
    id_livreur_retour,
    id_hub_reel,
    motif_hub_different,
    alerte_zone,
    motif_choix_hub_retour,
    hub_retour_confirme_le,
    hub_retour_confirme_par
  ) values
    (
      v_col[1], '10000000-0000-4000-8000-000000000001', v_cmd[1], null,
      'Adjoua NGuessan', '+2250100000201', 'Riviera 2, Cocody',
      '{"lat":5.3610,"lng":-3.9730}', 'LIV001', 'COCODY_RIVIERA', 2000,
      'A_RAMASSER', null, now() - interval '45 minutes', now() - interval '40 minutes',
      null, null, null, null, null, null, null, null
    ),
    (
      v_col[2], '10000000-0000-4000-8000-000000000001', v_cmd[2], null,
      'Yannick Bamba', '+2250100000202', 'Niangon Nord, Yopougon',
      '{"lat":5.3358,"lng":-4.1038}', 'LIV002', 'YOPOUGON_NIANGON_NORD', 1000,
      'AU_HUB', null, now() - interval '3 hours', now() - interval '2 hours',
      null, null, '20000000-0000-4000-8000-000000000001', null, null, null, null, null
    ),
    (
      v_col[3], '10000000-0000-4000-8000-000000000001', v_cmd[3], v_liv[1],
      'Clarisse Yao', '+2250100000203', 'Danga, Cocody',
      '{"lat":5.3448,"lng":-3.9954}', 'LIV003', 'COCODY_DANGA', 2000,
      'EN_LOT', null, now() - interval '5 hours', now() - interval '3 hours 30 minutes',
      null, null, '20000000-0000-4000-8000-000000000001', null, null, null, null, null
    ),
    (
      v_col[4], '10000000-0000-4000-8000-000000000001', v_cmd[4], v_liv[2],
      'Moussa Traoré', '+2250100000204', 'PK18, Abobo',
      '{"lat":5.4410,"lng":-4.0630}', 'LIV004', 'ABOBO_PK18', 1800,
      'RECUP_DEMANDEE', null, now() - interval '7 hours', now() - interval '1 hour',
      null, null, '20000000-0000-4000-8000-000000000001', null, null, null, null, null
    ),
    (
      v_col[5], '10000000-0000-4000-8000-000000000001', v_cmd[5], v_liv[3],
      'Grâce Assi', '+2250100000205', 'Niangon Sud, Yopougon',
      '{"lat":5.3224,"lng":-4.1127}', 'LIV005', 'YOPOUGON_NIANGON_SUD', 2000,
      'EN_TOURNEE', null, now() - interval '9 hours', now() - interval '30 minutes',
      null, null, '20000000-0000-4000-8000-000000000002', null, null, null, null, null
    ),
    (
      v_col[6], '10000000-0000-4000-8000-000000000001', v_cmd[6], v_liv[3],
      'Aya Konan', '+2250100000206', 'Danga, Cocody',
      '{"lat":5.3448,"lng":-3.9954}', 'LIV006', 'COCODY_DANGA', 1200,
      'LIVRE', null, now() - interval '1 day', now() - interval '20 hours',
      null, null, '20000000-0000-4000-8000-000000000002', null, null, null, null, null
    ),
    (
      v_col[7], '10000000-0000-4000-8000-000000000001', v_cmd[7], v_liv[3],
      'Ibrahim Coulibaly', '+2250100000207', 'PK18, Abobo',
      '{"lat":5.4410,"lng":-4.0630}', 'LIV007', 'ABOBO_PK18', 1800,
      'RETOUR_DEMANDE', 'DESTINATAIRE_ABSENT',
      now() - interval '1 day 2 hours', now() - interval '2 hours',
      null, null, '20000000-0000-4000-8000-000000000001',
      'Dépôt demandé dans un hub différent du hub prévu',
      null, 'Le hub Yopougon était le plus proche de la tournée du livreur.',
      null, null
    ),
    (
      v_col[8], '10000000-0000-4000-8000-000000000001', v_cmd[8], null,
      'Client Test', '+2250100000208', 'PK18, Bingerville',
      '{"lat":5.4070,"lng":-3.8440}', 'LIV008', 'BINGERVILLE_PK18', 2200,
      'CREE', null, now() - interval '15 minutes', now() - interval '15 minutes',
      null, null, null, null, null, null, null, null
    );

  insert into public.paiements (
    id,
    id_entreprise,
    id_colis,
    payeur,
    methode,
    montant,
    statut,
    reference_externe,
    id_event_externe,
    encaisse_par,
    cree_le
  ) values (
    '70000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    v_col[6],
    'DESTINATAIRE',
    'ESPECES',
    1200,
    'PAYE',
    'DEMO-ESPECES-001',
    'DEMO-EVENT-001',
    '50000000-0000-4000-8000-000000000005',
    now() - interval '20 hours'
  );

  insert into public.versements_livreur (
    id,
    id_entreprise,
    id_livreur,
    montant,
    valide_par,
    cree_le,
    id_hub
  ) values (
    '71000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000005',
    500,
    '50000000-0000-4000-8000-000000000003',
    now() - interval '18 hours',
    '20000000-0000-4000-8000-000000000002'
  );

  insert into public.liens_partage (
    token,
    id_entreprise,
    type,
    id_commande,
    id_colis,
    expire_le
  ) values
    (
      '80000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000001',
      'POSITION_EXPEDITEUR',
      v_cmd[1],
      null,
      now() + interval '30 days'
    ),
    (
      '81000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000001',
      'POSITION_DESTINATAIRE',
      null,
      v_col[1],
      now() + interval '30 days'
    );

  insert into public.evenements_colis (
    id_entreprise,
    id_colis,
    evenement,
    statut_avant,
    statut_apres,
    acteur,
    role_acteur,
    motif,
    details,
    cree_le
  ) values
    ('10000000-0000-4000-8000-000000000001', v_col[1], 'CREATION', null, 'CREE', null, 'DIRECT', null, '{}', now() - interval '45 minutes'),
    ('10000000-0000-4000-8000-000000000001', v_col[1], 'ASSIGNER_RAMASSAGE', 'CREE', 'A_RAMASSER', '50000000-0000-4000-8000-000000000002', 'agent', null, '{"id_livreur":"50000000-0000-4000-8000-000000000004"}', now() - interval '40 minutes'),
    ('10000000-0000-4000-8000-000000000001', v_col[2], 'VALIDER_RAMASSAGE', 'A_RAMASSER', 'RAMASSE', '50000000-0000-4000-8000-000000000004', 'livreur', null, '{}', now() - interval '2 hours 30 minutes'),
    ('10000000-0000-4000-8000-000000000001', v_col[2], 'VALIDER_DEPOT', 'DEPOT_DEMANDE', 'AU_HUB', '50000000-0000-4000-8000-000000000002', 'agent', null, '{}', now() - interval '2 hours'),
    ('10000000-0000-4000-8000-000000000001', v_col[3], 'METTRE_EN_LOT', 'AU_HUB', 'EN_LOT', '50000000-0000-4000-8000-000000000002', 'agent', null, jsonb_build_object('id_lot', v_liv[1]), now() - interval '3 hours 30 minutes'),
    ('10000000-0000-4000-8000-000000000001', v_col[4], 'DEMANDER_RECUPERATION', 'EN_LOT', 'RECUP_DEMANDEE', '50000000-0000-4000-8000-000000000005', 'livreur', null, jsonb_build_object('id_lot', v_liv[2]), now() - interval '1 hour'),
    ('10000000-0000-4000-8000-000000000001', v_col[5], 'VALIDER_RECUPERATION', 'RECUP_DEMANDEE', 'EN_TOURNEE', '50000000-0000-4000-8000-000000000003', 'agent', null, jsonb_build_object('id_lot', v_liv[3]), now() - interval '30 minutes'),
    ('10000000-0000-4000-8000-000000000001', v_col[6], 'VALIDER_RAMASSAGE', 'A_RAMASSER', 'RAMASSE', '50000000-0000-4000-8000-000000000004', 'livreur', null, '{}', now() - interval '23 hours'),
    ('10000000-0000-4000-8000-000000000001', v_col[6], 'VALIDER_LIVRAISON', 'EN_TOURNEE', 'LIVRE', '50000000-0000-4000-8000-000000000005', 'livreur', null, '{}', now() - interval '20 hours'),
    ('10000000-0000-4000-8000-000000000001', v_col[7], 'SIGNALER_ECHEC', 'EN_TOURNEE', 'RETOUR_EN_COURS', '50000000-0000-4000-8000-000000000005', 'livreur', 'DESTINATAIRE_ABSENT', '{}', now() - interval '3 hours'),
    ('10000000-0000-4000-8000-000000000001', v_col[7], 'DEMANDER_RETOUR_HUB', 'RETOUR_EN_COURS', 'RETOUR_DEMANDE', '50000000-0000-4000-8000-000000000005', 'livreur', null, jsonb_build_object('id_hub_reel', '20000000-0000-4000-8000-000000000001'), now() - interval '2 hours'),
    ('10000000-0000-4000-8000-000000000001', v_col[8], 'CREATION', null, 'CREE', '50000000-0000-4000-8000-000000000001', 'CLIENT_PRO', null, '{}', now() - interval '15 minutes');

  insert into public.notifications_internes (
    id,
    id_entreprise,
    id_utilisateur,
    id_hub,
    type,
    message,
    lien,
    lu,
    cree_le
  ) values
    (
      '90000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000001',
      null,
      '20000000-0000-4000-8000-000000000001',
      'RECEPTION',
      'Un dépôt de ramassage attend la réception au hub.',
      '#operations',
      false,
      now() - interval '10 minutes'
    ),
    (
      '90000000-0000-4000-8000-000000000002',
      '10000000-0000-4000-8000-000000000001',
      '50000000-0000-4000-8000-000000000005',
      null,
      'LOT_ASSIGNE',
      'Un lot de livraison vous a été assigné.',
      '#operations',
      false,
      now() - interval '20 minutes'
    );

  insert into public.compteurs_journaliers (type, jour, valeur) values
    ('ramassage', v_jour, 8),
    ('commande', v_jour, 8),
    ('colis', v_jour, 8),
    ('lot', v_jour, 3)
  on conflict (type, jour) do update
    set valeur = greatest(public.compteurs_journaliers.valeur, excluded.valeur);
end;
$seed$;

commit;
