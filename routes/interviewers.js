const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const { authMiddleware, adminOnly } = require('../middleware/auth');

const router = express.Router();

// Helper: Get assigned colleges for an interviewer
async function getAssignedColleges(userId) {
    const result = await pool.query(
        `SELECT c.id, c.name 
         FROM interviewer_colleges ic 
         JOIN colleges c ON ic.college_id = c.id 
         WHERE ic.user_id = $1 
         ORDER BY c.name`,
        [userId]
    );
    return result.rows;
}

// Helper: Get assigned batches for an interviewer
async function getAssignedBatches(userId) {
    const result = await pool.query(
        `SELECT b.id, b.batch_name, b.college_id, c.name as college_name
         FROM interviewer_batches ib 
         JOIN batches b ON ib.batch_id = b.id 
         JOIN colleges c ON b.college_id = c.id
         WHERE ib.user_id = $1 
         ORDER BY c.name, b.batch_name`,
        [userId]
    );
    return result.rows;
}

// GET /api/interviewers - List all interviewers
router.get('/', authMiddleware, adminOnly, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT u.id, u.name, u.email, u.role, u.created_at
             FROM users u 
             WHERE u.role = 'interviewer'
             ORDER BY u.name`
        );

        // Fetch assigned colleges and batches for each interviewer
        const interviewers = [];
        for (const interviewer of result.rows) {
            const colleges = await getAssignedColleges(interviewer.id);
            const batches = await getAssignedBatches(interviewer.id);
            interviewers.push({
                ...interviewer,
                assigned_colleges: colleges,
                assigned_college_ids: colleges.map(c => c.id),
                assigned_college: colleges.map(c => c.name).join(', ') || 'Not Assigned',
                assigned_batches: batches,
                assigned_batch_ids: batches.map(b => b.id),
            });
        }

        res.json(interviewers);
    } catch (err) {
        console.error('Get interviewers error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
});

// GET /api/interviewers/:id
router.get('/:id', authMiddleware, adminOnly, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT u.id, u.name, u.email, u.role
             FROM users u 
             WHERE u.id = $1 AND u.role = 'interviewer'`,
            [req.params.id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Interviewer not found.' });
        }

        const interviewer = result.rows[0];
        const colleges = await getAssignedColleges(interviewer.id);
        const batches = await getAssignedBatches(interviewer.id);

        res.json({
            ...interviewer,
            assigned_colleges: colleges,
            assigned_college_ids: colleges.map(c => c.id),
            assigned_college: colleges.map(c => c.name).join(', ') || 'Not Assigned',
            assigned_batches: batches,
            assigned_batch_ids: batches.map(b => b.id),
        });
    } catch (err) {
        console.error('Get interviewer error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
});

// POST /api/interviewers - Create interviewer (Admin only)
router.post('/', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { name, email, password, assigned_college_ids, assigned_batch_ids } = req.body;
        if (!name || !email || !password) {
            return res.status(400).json({ error: 'Name, email, and password are required.' });
        }
        if (!assigned_college_ids || !Array.isArray(assigned_college_ids) || assigned_college_ids.length === 0) {
            return res.status(400).json({ error: 'At least one college must be assigned.' });
        }

        // Check if email already exists
        const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
        if (existing.rows.length > 0) {
            return res.status(400).json({ error: 'Email already registered.' });
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const hashedPassword = await bcrypt.hash(password, 10);
            const userResult = await client.query(
                `INSERT INTO users (name, email, password, role) 
                 VALUES ($1, $2, $3, 'interviewer') RETURNING id, name, email, role`,
                [name, email, hashedPassword]
            );
            const userId = userResult.rows[0].id;

            // Insert college assignments
            const uniqueCollegeIds = [...new Set(assigned_college_ids)];
            for (const collegeId of uniqueCollegeIds) {
                await client.query(
                    'INSERT INTO interviewer_colleges (user_id, college_id) VALUES ($1, $2)',
                    [userId, parseInt(collegeId)]
                );
            }

            // Insert batch assignments
            if (assigned_batch_ids && Array.isArray(assigned_batch_ids)) {
                const uniqueBatchIds = [...new Set(assigned_batch_ids)];
                for (const batchId of uniqueBatchIds) {
                    await client.query(
                        'INSERT INTO interviewer_batches (user_id, batch_id) VALUES ($1, $2)',
                        [userId, parseInt(batchId)]
                    );
                }
            }

            await client.query('COMMIT');

            // Fetch full data
            const colleges = await getAssignedColleges(userId);
            const batches = await getAssignedBatches(userId);
            res.status(201).json({
                ...userResult.rows[0],
                assigned_colleges: colleges,
                assigned_college_ids: colleges.map(c => c.id),
                assigned_college: colleges.map(c => c.name).join(', ') || 'Not Assigned',
                assigned_batches: batches,
                assigned_batch_ids: batches.map(b => b.id),
            });
        } catch (innerErr) {
            await client.query('ROLLBACK');
            throw innerErr;
        } finally {
            client.release();
        }
    } catch (err) {
        console.error('Create interviewer error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
});

// PUT /api/interviewers/:id - Update interviewer (Admin only)
router.put('/:id', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { name, email, password, assigned_college_ids, assigned_batch_ids } = req.body;
        const userId = req.params.id;

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // Update user info
            if (password) {
                const hashedPassword = await bcrypt.hash(password, 10);
                const result = await client.query(
                    `UPDATE users SET 
                        name = COALESCE($1, name), 
                        email = COALESCE($2, email), 
                        password = $3,
                        updated_at = CURRENT_TIMESTAMP
                     WHERE id = $4 AND role = 'interviewer' RETURNING id`,
                    [name, email, hashedPassword, userId]
                );
                if (result.rows.length === 0) {
                    await client.query('ROLLBACK');
                    return res.status(404).json({ error: 'Interviewer not found.' });
                }
            } else {
                const result = await client.query(
                    `UPDATE users SET 
                        name = COALESCE($1, name), 
                        email = COALESCE($2, email),
                        updated_at = CURRENT_TIMESTAMP
                     WHERE id = $3 AND role = 'interviewer' RETURNING id`,
                    [name, email, userId]
                );
                if (result.rows.length === 0) {
                    await client.query('ROLLBACK');
                    return res.status(404).json({ error: 'Interviewer not found.' });
                }
            }

            // Update college assignments if provided
            if (assigned_college_ids && Array.isArray(assigned_college_ids)) {
                // Remove existing assignments
                await client.query('DELETE FROM interviewer_colleges WHERE user_id = $1', [userId]);
                // Insert new ones
                const uniqueCollegeIds = [...new Set(assigned_college_ids)];
                for (const collegeId of uniqueCollegeIds) {
                    await client.query(
                        'INSERT INTO interviewer_colleges (user_id, college_id) VALUES ($1, $2)',
                        [userId, parseInt(collegeId)]
                    );
                }
            }

            // Update batch assignments if provided
            if (assigned_batch_ids && Array.isArray(assigned_batch_ids)) {
                // Remove existing batch assignments
                await client.query('DELETE FROM interviewer_batches WHERE user_id = $1', [userId]);
                // Insert new ones
                const uniqueBatchIds = [...new Set(assigned_batch_ids)];
                for (const batchId of uniqueBatchIds) {
                    await client.query(
                        'INSERT INTO interviewer_batches (user_id, batch_id) VALUES ($1, $2)',
                        [userId, parseInt(batchId)]
                    );
                }
            }

            await client.query('COMMIT');

            // Fetch updated data
            const userResult = await pool.query(
                'SELECT id, name, email, role FROM users WHERE id = $1',
                [userId]
            );
            const colleges = await getAssignedColleges(userId);
            const batches = await getAssignedBatches(userId);

            res.json({
                ...userResult.rows[0],
                assigned_colleges: colleges,
                assigned_college_ids: colleges.map(c => c.id),
                assigned_college: colleges.map(c => c.name).join(', ') || 'Not Assigned',
                assigned_batches: batches,
                assigned_batch_ids: batches.map(b => b.id),
            });
        } catch (innerErr) {
            await client.query('ROLLBACK');
            throw innerErr;
        } finally {
            client.release();
        }
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
        // Junction table entries will be cascade deleted
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
