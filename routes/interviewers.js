const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const { authMiddleware, adminOnly } = require('../middleware/auth');

const router = express.Router();

// GET /api/interviewers - List all interviewers
router.get('/', authMiddleware, adminOnly, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT u.id, u.name, u.email, u.role, u.assigned_college_id, 
                    c.name as assigned_college, u.created_at
             FROM users u 
             LEFT JOIN colleges c ON u.assigned_college_id = c.id
             WHERE u.role = 'interviewer'
             ORDER BY u.name`
        );
        res.json(result.rows);
    } catch (err) {
        console.error('Get interviewers error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
});

// GET /api/interviewers/:id
router.get('/:id', authMiddleware, adminOnly, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT u.id, u.name, u.email, u.role, u.assigned_college_id, 
                    c.name as assigned_college
             FROM users u 
             LEFT JOIN colleges c ON u.assigned_college_id = c.id
             WHERE u.id = $1 AND u.role = 'interviewer'`,
            [req.params.id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Interviewer not found.' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Get interviewer error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
});

// POST /api/interviewers - Create interviewer (Admin only)
router.post('/', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { name, email, password, assigned_college_id } = req.body;
        if (!name || !email || !password || !assigned_college_id) {
            return res.status(400).json({ error: 'Name, email, password, and assigned college are required.' });
        }

        // Check if email already exists
        const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
        if (existing.rows.length > 0) {
            return res.status(400).json({ error: 'Email already registered.' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const result = await pool.query(
            `INSERT INTO users (name, email, password, role, assigned_college_id) 
             VALUES ($1, $2, $3, 'interviewer', $4) RETURNING id, name, email, role, assigned_college_id`,
            [name, email, hashedPassword, assigned_college_id]
        );

        // Fetch with college name
        const interviewer = await pool.query(
            `SELECT u.id, u.name, u.email, u.role, u.assigned_college_id, c.name as assigned_college
             FROM users u LEFT JOIN colleges c ON u.assigned_college_id = c.id
             WHERE u.id = $1`,
            [result.rows[0].id]
        );
        res.status(201).json(interviewer.rows[0]);
    } catch (err) {
        console.error('Create interviewer error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
});

// PUT /api/interviewers/:id - Update interviewer (Admin only)
router.put('/:id', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { name, email, password, assigned_college_id } = req.body;

        // If password is provided, hash it
        let updateQuery, params;
        if (password) {
            const hashedPassword = await bcrypt.hash(password, 10);
            updateQuery = `UPDATE users SET 
                name = COALESCE($1, name), 
                email = COALESCE($2, email), 
                password = $3,
                assigned_college_id = COALESCE($4, assigned_college_id),
                updated_at = CURRENT_TIMESTAMP
             WHERE id = $5 AND role = 'interviewer' RETURNING id`;
            params = [name, email, hashedPassword, assigned_college_id, req.params.id];
        } else {
            updateQuery = `UPDATE users SET 
                name = COALESCE($1, name), 
                email = COALESCE($2, email),
                assigned_college_id = COALESCE($3, assigned_college_id),
                updated_at = CURRENT_TIMESTAMP
             WHERE id = $4 AND role = 'interviewer' RETURNING id`;
            params = [name, email, assigned_college_id, req.params.id];
        }

        const result = await pool.query(updateQuery, params);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Interviewer not found.' });
        }

        const interviewer = await pool.query(
            `SELECT u.id, u.name, u.email, u.role, u.assigned_college_id, c.name as assigned_college
             FROM users u LEFT JOIN colleges c ON u.assigned_college_id = c.id
             WHERE u.id = $1`,
            [req.params.id]
        );
        res.json(interviewer.rows[0]);
    } catch (err) {
        console.error('Update interviewer error:', err);
        if (err.code === '23505') {
            return res.status(400).json({ error: 'Email already in use by another user.' });
        }
        res.status(500).json({ error: 'Server error.' });
    }
});

// DELETE /api/interviewers/:id - Delete interviewer (Admin only)
router.delete('/:id', authMiddleware, adminOnly, async (req, res) => {
    try {
        const result = await pool.query(
            `DELETE FROM users WHERE id = $1 AND role = 'interviewer' RETURNING *`,
            [req.params.id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Interviewer not found.' });
        }
        res.json({ message: 'Interviewer deleted successfully.' });
    } catch (err) {
        console.error('Delete interviewer error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
});

module.exports = router;
