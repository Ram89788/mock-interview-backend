const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const { authMiddleware, adminOnly } = require('../middleware/auth');

const router = express.Router();

// GET /api/colleges - List all colleges
router.get('/', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT c.*, 
                    (SELECT COUNT(*) FROM students s WHERE s.college_id = c.id) as student_count
             FROM colleges c 
             ORDER BY c.name`
        );
        res.json(result.rows);
    } catch (err) {
        console.error('Get colleges error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
});

// GET /api/colleges/:id - Get single college
router.get('/:id', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT c.*, 
                    (SELECT COUNT(*) FROM students s WHERE s.college_id = c.id) as student_count
             FROM colleges c WHERE c.id = $1`,
            [req.params.id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'College not found.' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Get college error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
});

// POST /api/colleges - Create college (Admin only)
router.post('/', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { name, location } = req.body;
        if (!name || !location) {
            return res.status(400).json({ error: 'Name and location are required.' });
        }
        const result = await pool.query(
            'INSERT INTO colleges (name, location) VALUES ($1, $2) RETURNING *',
            [name, location]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Create college error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
});

// PUT /api/colleges/:id - Update college (Admin only)
router.put('/:id', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { name, location } = req.body;
        const result = await pool.query(
            'UPDATE colleges SET name = COALESCE($1, name), location = COALESCE($2, location), updated_at = CURRENT_TIMESTAMP WHERE id = $3 RETURNING *',
            [name, location, req.params.id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'College not found.' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Update college error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
});

// DELETE /api/colleges/:id - Delete college (Admin only)
router.delete('/:id', authMiddleware, adminOnly, async (req, res) => {
    try {
        const result = await pool.query(
            'DELETE FROM colleges WHERE id = $1 RETURNING *',
            [req.params.id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'College not found.' });
        }
        res.json({ message: 'College deleted successfully.' });
    } catch (err) {
        console.error('Delete college error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
});

// ============================================
// College Login Account Management (Admin only)
// ============================================

// GET /api/colleges/:id/login-info - Check if college has a login account
router.get('/:id/login-info', authMiddleware, adminOnly, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, name, email, created_at FROM users WHERE role = 'college' AND assigned_college_id = $1`,
            [req.params.id]
        );
        if (result.rows.length === 0) {
            return res.json({ hasLogin: false });
        }
        res.json({
            hasLogin: true,
            user: result.rows[0]
        });
    } catch (err) {
        console.error('Get college login info error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
});

// POST /api/colleges/:id/create-login - Create login account for a college
router.post('/:id/create-login', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { email, password, name } = req.body;
        const collegeId = req.params.id;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required.' });
        }

        // Check if college exists
        const collegeResult = await pool.query('SELECT * FROM colleges WHERE id = $1', [collegeId]);
        if (collegeResult.rows.length === 0) {
            return res.status(404).json({ error: 'College not found.' });
        }

        // Check if college already has a login
        const existingLogin = await pool.query(
            `SELECT id FROM users WHERE role = 'college' AND assigned_college_id = $1`,
            [collegeId]
        );
        if (existingLogin.rows.length > 0) {
            return res.status(400).json({ error: 'This college already has a login account.' });
        }

        // Check if email is already taken
        const existingEmail = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
        if (existingEmail.rows.length > 0) {
            return res.status(400).json({ error: 'Email is already registered.' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const loginName = name || collegeResult.rows[0].name;

        const result = await pool.query(
            `INSERT INTO users (name, email, password, role, assigned_college_id)
             VALUES ($1, $2, $3, 'college', $4)
             RETURNING id, name, email, role, assigned_college_id, created_at`,
            [loginName, email, hashedPassword, collegeId]
        );

        res.status(201).json({
            message: 'College login created successfully.',
            user: result.rows[0],
            collegeName: collegeResult.rows[0].name
        });
    } catch (err) {
        console.error('Create college login error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
});

// PUT /api/colleges/:id/update-login - Update college login credentials
router.put('/:id/update-login', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { email, password, name } = req.body;
        const collegeId = req.params.id;

        const existingLogin = await pool.query(
            `SELECT id FROM users WHERE role = 'college' AND assigned_college_id = $1`,
            [collegeId]
        );
        if (existingLogin.rows.length === 0) {
            return res.status(404).json({ error: 'No login account found for this college.' });
        }

        const userId = existingLogin.rows[0].id;

        if (password) {
            const hashedPassword = await bcrypt.hash(password, 10);
            await pool.query(
                `UPDATE users SET name = COALESCE($1, name), email = COALESCE($2, email), password = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4`,
                [name, email, hashedPassword, userId]
            );
        } else {
            await pool.query(
                `UPDATE users SET name = COALESCE($1, name), email = COALESCE($2, email), updated_at = CURRENT_TIMESTAMP WHERE id = $3`,
                [name, email, userId]
            );
        }

        const updated = await pool.query(
            'SELECT id, name, email, role, created_at FROM users WHERE id = $1',
            [userId]
        );

        res.json({ message: 'Login updated.', user: updated.rows[0] });
    } catch (err) {
        console.error('Update college login error:', err);
        if (err.code === '23505') {
            return res.status(400).json({ error: 'Email already in use.' });
        }
        res.status(500).json({ error: 'Server error.' });
    }
});

// DELETE /api/colleges/:id/login - Remove college login account
router.delete('/:id/login', authMiddleware, adminOnly, async (req, res) => {
    try {
        const result = await pool.query(
            `DELETE FROM users WHERE role = 'college' AND assigned_college_id = $1 RETURNING *`,
            [req.params.id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'No login account found for this college.' });
        }
        res.json({ message: 'College login removed successfully.' });
    } catch (err) {
        console.error('Delete college login error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
});

module.exports = router;
