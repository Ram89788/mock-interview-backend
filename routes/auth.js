const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// Helper: Get assigned college IDs for an interviewer
async function getAssignedCollegeIds(userId) {
    const result = await pool.query(
        'SELECT college_id FROM interviewer_colleges WHERE user_id = $1',
        [userId]
    );
    return result.rows.map(r => r.college_id);
}

// Helper: Get assigned colleges with names for an interviewer
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

// Helper: Get assigned batch IDs for an interviewer
async function getAssignedBatchIds(userId) {
    const result = await pool.query(
        'SELECT batch_id FROM interviewer_batches WHERE user_id = $1',
        [userId]
    );
    return result.rows.map(r => r.batch_id);
}

// Helper: Get assigned batches with details for an interviewer
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

// POST /api/auth/login
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required.' });
        }

        const result = await pool.query(
            'SELECT * FROM users WHERE email = $1',
            [email]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Invalid email or password.' });
        }

        const user = result.rows[0];
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            return res.status(401).json({ error: 'Invalid email or password.' });
        }

        // Get assigned colleges and batches for interviewers
        let assignedCollegeIds = [];
        let assignedColleges = [];
        let assignedBatchIds = [];
        let assignedBatches = [];
        let collegeId = null;
        let collegeName = null;

        if (user.role === 'interviewer') {
            assignedCollegeIds = await getAssignedCollegeIds(user.id);
            assignedColleges = await getAssignedColleges(user.id);
            assignedBatchIds = await getAssignedBatchIds(user.id);
            assignedBatches = await getAssignedBatches(user.id);
        } else if (user.role === 'college') {
            collegeId = user.assigned_college_id;
            if (collegeId) {
                const collegeResult = await pool.query('SELECT name FROM colleges WHERE id = $1', [collegeId]);
                collegeName = collegeResult.rows[0]?.name || null;
            }
        }

        const token = jwt.sign(
            {
                id: user.id,
                email: user.email,
                role: user.role,
                name: user.name,
                assignedCollegeIds: assignedCollegeIds,
                assignedBatchIds: assignedBatchIds,
                collegeId: collegeId,
            },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );

        res.json({
            token,
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                role: user.role,
                assignedCollegeIds: assignedCollegeIds,
                assignedColleges: assignedColleges,
                assignedBatchIds: assignedBatchIds,
                assignedBatches: assignedBatches,
                collegeId: collegeId,
                collegeName: collegeName,
            },
        });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Server error during login.' });
    }
});

// GET /api/auth/me - Get current user info
router.get('/me', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, name, email, role, assigned_college_id FROM users WHERE id = $1',
            [req.user.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found.' });
        }

        const user = result.rows[0];

        // Get assigned colleges and batches for interviewers
        let assignedCollegeIds = [];
        let assignedColleges = [];
        let assignedBatchIds = [];
        let assignedBatches = [];
        let collegeId = null;
        let collegeName = null;

        if (user.role === 'interviewer') {
            assignedCollegeIds = await getAssignedCollegeIds(user.id);
            assignedColleges = await getAssignedColleges(user.id);
            assignedBatchIds = await getAssignedBatchIds(user.id);
            assignedBatches = await getAssignedBatches(user.id);
        } else if (user.role === 'college') {
            collegeId = user.assigned_college_id;
            if (collegeId) {
                const collegeResult = await pool.query('SELECT name FROM colleges WHERE id = $1', [collegeId]);
                collegeName = collegeResult.rows[0]?.name || null;
            }
        }

        res.json({
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            assignedCollegeIds: assignedCollegeIds,
            assignedColleges: assignedColleges,
            assignedBatchIds: assignedBatchIds,
            assignedBatches: assignedBatches,
            collegeId: collegeId,
            collegeName: collegeName,
        });
    } catch (err) {
        console.error('Get user error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
});

module.exports = router;
