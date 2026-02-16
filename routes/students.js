const express = require('express');
const pool = require('../config/db');
const { authMiddleware, adminOnly } = require('../middleware/auth');

const router = express.Router();

// GET /api/students - List students (filtered by college for interviewers)
router.get('/', authMiddleware, async (req, res) => {
    try {
        const { college_id } = req.query;
        let query = `
            SELECT s.*, c.name as college_name 
            FROM students s 
            JOIN colleges c ON s.college_id = c.id
        `;
        const params = [];

        if (req.user.role === 'interviewer') {
            // Interviewers can only see students from their assigned college
            query += ' WHERE s.college_id = $1';
            params.push(req.user.assignedCollegeId);
        } else if (college_id) {
            query += ' WHERE s.college_id = $1';
            params.push(college_id);
        }

        query += ' ORDER BY s.name';
        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (err) {
        console.error('Get students error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
});

// GET /api/students/:id
router.get('/:id', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT s.*, c.name as college_name 
             FROM students s 
             JOIN colleges c ON s.college_id = c.id 
             WHERE s.id = $1`,
            [req.params.id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Student not found.' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Get student error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
});

// POST /api/students - Create student (Admin only)
router.post('/', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { name, email, phone, college_id, branch, year } = req.body;
        if (!name || !email || !college_id) {
            return res.status(400).json({ error: 'Name, email, and college are required.' });
        }
        const result = await pool.query(
            `INSERT INTO students (name, email, phone, college_id, branch, year) 
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
            [name, email, phone || null, college_id, branch || null, year || null]
        );

        // Fetch with college name
        const student = await pool.query(
            `SELECT s.*, c.name as college_name 
             FROM students s JOIN colleges c ON s.college_id = c.id 
             WHERE s.id = $1`,
            [result.rows[0].id]
        );
        res.status(201).json(student.rows[0]);
    } catch (err) {
        console.error('Create student error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
});

// POST /api/students/bulk - Bulk upload students (CSV) (Admin only)
router.post('/bulk', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { students } = req.body;
        if (!students || !Array.isArray(students) || students.length === 0) {
            return res.status(400).json({ error: 'Students array is required.' });
        }

        const inserted = [];
        for (const s of students) {
            const result = await pool.query(
                `INSERT INTO students (name, email, phone, college_id, branch, year) 
                 VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
                [s.name, s.email, s.phone || null, s.college_id, s.branch || null, s.year || null]
            );
            inserted.push(result.rows[0]);
        }

        res.status(201).json({ message: `${inserted.length} students added.`, students: inserted });
    } catch (err) {
        console.error('Bulk upload error:', err);
        res.status(500).json({ error: 'Server error during bulk upload.' });
    }
});

// PUT /api/students/:id - Update student (Admin only)
router.put('/:id', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { name, email, phone, college_id, branch, year } = req.body;
        const result = await pool.query(
            `UPDATE students SET 
                name = COALESCE($1, name), 
                email = COALESCE($2, email), 
                phone = COALESCE($3, phone), 
                college_id = COALESCE($4, college_id), 
                branch = COALESCE($5, branch), 
                year = COALESCE($6, year),
                updated_at = CURRENT_TIMESTAMP
             WHERE id = $7 RETURNING *`,
            [name, email, phone, college_id, branch, year, req.params.id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Student not found.' });
        }

        const student = await pool.query(
            `SELECT s.*, c.name as college_name 
             FROM students s JOIN colleges c ON s.college_id = c.id 
             WHERE s.id = $1`,
            [req.params.id]
        );
        res.json(student.rows[0]);
    } catch (err) {
        console.error('Update student error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
});

// DELETE /api/students/:id - Delete student (Admin only)
router.delete('/:id', authMiddleware, adminOnly, async (req, res) => {
    try {
        const result = await pool.query('DELETE FROM students WHERE id = $1 RETURNING *', [req.params.id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Student not found.' });
        }
        res.json({ message: 'Student deleted successfully.' });
    } catch (err) {
        console.error('Delete student error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
});

module.exports = router;
