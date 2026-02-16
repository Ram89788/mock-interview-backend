const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

async function runMigrations() {
    const client = await pool.connect();
    try {
        // Get all .sql files sorted by name
        const migrationDir = __dirname;
        const files = fs.readdirSync(migrationDir)
            .filter(f => f.endsWith('.sql'))
            .sort();

        console.log('🔄 Running database migrations...');
        for (const file of files) {
            const filePath = path.join(migrationDir, file);
            const sql = fs.readFileSync(filePath, 'utf8');
            console.log(`  ▶ Running ${file}...`);
            await client.query(sql);
            console.log(`  ✅ ${file} completed`);
        }
        console.log('✅ All migrations completed successfully!');
    } catch (err) {
        console.error('❌ Migration failed:', err.message);
        process.exit(1);
    } finally {
        client.release();
        await pool.end();
    }
}

runMigrations();
