// Shared handle to the storage backend for modules that load before server.js finishes booting
// (the Coach). `pg` is the PostgreSQL store when DATABASE_URL is set, else null and every caller
// keeps using DATA_DIR files exactly as before. `secret` is the session secret, set once at boot.
export const rt = { pg: null, secret: null };
