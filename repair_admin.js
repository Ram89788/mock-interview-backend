const bcrypt = require('bcryptjs');
const pool = require('./config/db');

async function repairAdmin() {
    try {
        const adminPassword = await bcrypt.hash('admin123', 10);
        const result = await pool.query(
            "INSERT INTO users (name, email, password, role) VALUES ($1, $2, $3, 'admin') ON CONFLICT (email) DO UPDATE SET password = $3, role = 'admin', name = $1 RETURNING *",
            ['Admin User', 'admin@crt.com', adminPassword]
        );
        console.log('✅ Admin user repaired/ensured (admin@crt.com / admin123)');
        process.exit(0);
    } catch (err) {
        console.error('❌ Repair failed:', err.message);
        process.exit(1);
    }
}

repairAdmin();
