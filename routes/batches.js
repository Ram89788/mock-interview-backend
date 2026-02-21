const express = require('express');
const pool = require('../config/db');
const { authMiddleware, adminOnly, adminOrCollege } = require('../middleware/auth');

const router = express.Router();

// Helper: Get the college_id for the current user based on role
function getCollegeScope(req) {
    if (req.user.role === 'college') return req.user.collegeId;
    return null; // admin sees all
}

// GET /api/batches - List batches (scoped by role)
router.get('/', authMiddleware, async (req, res) => {
    try {
        const { college_id } = req.query;
        let query = `
            SELECT b.*, c.name as college_name,
                   (SELECT COUNT(*) FROM students s WHERE s.batch_id = b.id) as student_count
            FROM batches b
            JOIN colleges c ON b.college_id = c.id
        `;
        const params = [];
        const conditions = [];

        // College role can only see their own batches
        if (req.user.role === 'college') {
            conditions.push(`b.college_id = $${params.length + 1}`);
            params.push(req.user.collegeId);
        } else if (college_id) {
            conditions.push(`b.college_id = $${params.length + 1}`);
            params.push(college_id);
        }

        if (conditions.length > 0) {
            query += ' WHERE ' + conditions.join(' AND ');
        }

        query += ' ORDER BY c.name, b.batch_name';
        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (err) {
        console.error('Get batches error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
});

// GET /api/batches/:id - Get single batch
router.get('/:id', authMiddleware, async (req, res) => {
    try {
        let query = `
            SELECT b.*, c.name as college_name,
                   (SELECT COUNT(*) FROM students s WHERE s.batch_id = b.id) as student_count
            FROM batches b
            JOIN colleges c ON b.college_id = c.id
            WHERE b.id = $1
        `;
        const params = [req.params.id];

        // College role: ensure it's their batch
        if (req.user.role === 'college') {
            query += ` AND b.college_id = $2`;
            params.push(req.user.collegeId);
        }

        const result = await pool.query(query, params);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Batch not found.' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Get batch error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
});

// POST /api/batches - Create batch (Admin or College)
router.post('/', authMiddleware, adminOrCollege, async (req, res) => {
    try {
        let { batch_name, college_id, year, description } = req.body;

        // College role: force their own college_id
        if (req.user.role === 'college') {
            college_id = req.user.collegeId;
        }

        if (!batch_name || !college_id) {
            return res.status(400).json({ error: 'Batch name and college are required.' });
        }

        const result = await pool.query(
            `INSERT INTO batches (batch_name, college_id, year, description)
             VALUES ($1, $2, $3, $4) RETURNING *`,
            [batch_name, college_id, year || null, description || null]
        );

        // Return with college name
        const batch = await pool.query(
            `SELECT b.*, c.name as college_name,
                    (SELECT COUNT(*) FROM students s WHERE s.batch_id = b.id) as student_count
             FROM batches b
             JOIN colleges c ON b.college_id = c.id
             WHERE b.id = $1`,
            [result.rows[0].id]
        );
        res.status(201).json(batch.rows[0]);
    } catch (err) {
        console.error('Create batch error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
});

// PUT /api/batches/:id - Update batch (Admin or College owner)
router.put('/:id', authMiddleware, adminOrCollege, async (req, res) => {
    try {
        const { batch_name, year, description } = req.body;
        let query = `UPDATE batches SET 
            batch_name = COALESCE($1, batch_name),
            year = COALESCE($2, year),
            description = COALESCE($3, description)
            WHERE id = $4`;
        const params = [batch_name, year, description, req.params.id];

        // College role: ensure it's their batch
        if (req.user.role === 'college') {
            query += ` AND college_id = $5`;
            params.push(req.user.collegeId);
        }

        query += ' RETURNING *';
        const result = await pool.query(query, params);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Batch not found.' });
        }

        // Return with college name
        const batch = await pool.query(
            `SELECT b.*, c.name as college_name,
                    (SELECT COUNT(*) FROM students s WHERE s.batch_id = b.id) as student_count
             FROM batches b
             JOIN colleges c ON b.college_id = c.id
             WHERE b.id = $1`,
            [req.params.id]
        );
        res.json(batch.rows[0]);
    } catch (err) {
        console.error('Update batch error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
});

// DELETE /api/batches/:id - Delete batch (Admin or College owner)
router.delete('/:id', authMiddleware, adminOrCollege, async (req, res) => {
    try {
        let query = 'DELETE FROM batches WHERE id = $1';
        const params = [req.params.id];

        if (req.user.role === 'college') {
            query += ' AND college_id = $2';
            params.push(req.user.collegeId);
        }

        query += ' RETURNING *';
        const result = await pool.query(query, params);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Batch not found.' });
        }
        res.json({ message: 'Batch deleted successfully.' });
    } catch (err) {
        console.error('Delete batch error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
});

module.exports = router;
