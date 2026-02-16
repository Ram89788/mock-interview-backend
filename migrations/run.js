const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

async function runMigrations() {
    const client = await pool.connect();
    try {
        const schemaPath = path.join(__dirname, '001_schema.sql');
        const sql = fs.readFileSync(schemaPath, 'utf8');

        console.log('🔄 Running database migrations...');
        await client.query(sql);
        console.log('✅ Database schema created successfully!');
    } catch (err) {
        console.error('❌ Migration failed:', err.message);
        process.exit(1);
    } finally {
        client.release();
        await pool.end();
    }
}

runMigrations();
