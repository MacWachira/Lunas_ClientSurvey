const fs = require('node:fs/promises');
const path = require('node:path');
const bcrypt = require('bcryptjs');
const { pool } = require('../src/db');
const config = require('../src/config');

async function migrate() {
  const directory = path.join(__dirname, '..', 'db');
  const files = (await fs.readdir(directory)).filter(file => file.endsWith('.sql')).sort();
  for (const filename of files) {
    const sql = await fs.readFile(path.join(directory, filename), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
      const applied = await client.query('SELECT 1 FROM schema_migrations WHERE filename = $1', [filename]);
      if (!applied.rowCount) {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations(filename) VALUES ($1) ON CONFLICT DO NOTHING', [filename]);
        console.log(`Applied migration ${filename}`);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  const passwordHash = await bcrypt.hash(config.adminPassword, 12);
  await pool.query(
    `INSERT INTO admins(email, password_hash) VALUES ($1, $2)
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, updated_at = now()`,
    [config.adminEmail, passwordHash]
  );
  console.log(`Admin account ready for ${config.adminEmail}`);
}

migrate().then(() => pool.end()).catch(error => {
  console.error(error);
  pool.end().finally(() => process.exit(1));
});
