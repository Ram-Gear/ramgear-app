/* Shop configuration – the ONE file another shop edits to use its own cloud (see docs/SETUP-FOR-OTHER-SHOPS.md).
   Only public values belong here. The publishable key is meant to be public: Row Level Security in the database
   decides what a signed-in user can see. NEVER put a secret / service_role key or an access token in this file. */
self.RG_CONFIG = {
  cloud: {
    url: 'https://dbveedcksommanxshpzx.supabase.co',     // Supabase project URL (Project Settings › API)
    publishableKey: 'sb_publishable_GE8oGj58dn6AaFVKGPCM3Q_plAf4TST',   // sb_publishable_… (Project Settings › API Keys)
    bucket: 'ramgear-files',                              // private storage bucket created by supabase/migrations/001_init.sql
    adminFunction: 'rg-admin',                            // Edge Function in supabase/functions/rg-admin
  },
};
