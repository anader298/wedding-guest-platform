// tests/_env.ts: imported FIRST by every test file. Points the app at an in-memory database and in-memory
// file storage, and sets a known owner password, before any app module loads.
// Do not import app modules here.
//notes: each test file runs in its own Node process, so each gets a fresh empty database.
process.env.DB_DRIVER = "pglite";
process.env.PGLITE_DIR = "memory://";
process.env.BLOBS_DRIVER = "memory";
process.env.OWNER_PASSWORD = "owner-secret";
process.env.SESSION_SECRET = "test-session-secret";
delete process.env.PUBLIC_BASE_URL;
delete process.env.NETLIFY_DB_URL;
delete process.env.NETLIFY_DATABASE_URL;
