const express = require('express');
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

module.exports = router;
