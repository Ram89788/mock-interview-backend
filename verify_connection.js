const pool = require('./config/db');

async function testConnection() {
    try {
        console.log('🔍 Testing database connection and schema...');

        // 1. Check connection
        const now = await pool.query('SELECT NOW()');
        console.log('✅ Database connected:', now.rows[0].now);

        // 2. Check tables exist
        const tables = ['users', 'colleges', 'students', 'evaluations', 'batches'];
        for (const table of tables) {
            try {
                await pool.query(`SELECT 1 FROM ${table} LIMIT 1`);
                console.log(`✅ Table "${table}" exists`);
            } catch (e) {
                console.error(`❌ Table "${table}" missing or error:`, e.message);
            }
        }

        // 3. Check admin user
        const adminRes = await pool.query("SELECT id, name, email, role FROM users WHERE role = 'admin'");
        if (adminRes.rows.length > 0) {
            console.log('✅ Admin user(s) found:');
            adminRes.rows.forEach(u => console.log(`   - ${u.name} (${u.email})`));
        } else {
            console.error('❌ NO ADMIN USER FOUND! Run "node repair_admin.js"');
        }

        // 4. Check college users
        const collegeRes = await pool.query("SELECT id, name, email FROM users WHERE role = 'college'");
        console.log(`ℹ️  Found ${collegeRes.rows.length} college login(s)`);

        process.exit(0);
    } catch (err) {
        console.error('❌ Test failed:', err.message);
        process.exit(1);
    }
}

testConnection();
