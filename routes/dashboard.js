const express = require('express');
const pool = require('../config/db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// GET /api/dashboard/stats - Dashboard statistics
router.get('/stats', authMiddleware, async (req, res) => {
    try {
        if (req.user.role === 'admin') {
            const [collegesRes, studentsRes, interviewersRes, evaluationsRes, recentRes] = await Promise.all([
                pool.query('SELECT COUNT(*) as count FROM colleges'),
                pool.query('SELECT COUNT(*) as count FROM students'),
                pool.query("SELECT COUNT(*) as count FROM users WHERE role = 'interviewer'"),
                pool.query('SELECT COUNT(*) as count FROM evaluations'),
                pool.query(`
                    SELECT e.id, e.total_score, e.recommendation, e.created_at,
                           s.name as student_name, c.name as college_name, u.name as interviewer_name
                    FROM evaluations e
                    JOIN students s ON e.student_id = s.id
                    JOIN colleges c ON s.college_id = c.id
                    LEFT JOIN users u ON e.interviewer_id = u.id
                    ORDER BY e.created_at DESC LIMIT 10
                `),
            ]);

            res.json({
                totalColleges: parseInt(collegesRes.rows[0].count),
                totalStudents: parseInt(studentsRes.rows[0].count),
                totalInterviewers: parseInt(interviewersRes.rows[0].count),
                totalEvaluations: parseInt(evaluationsRes.rows[0].count),
                recentActivity: recentRes.rows,
            });
        } else {
            // Interviewer dashboard — multiple colleges
            const collegeIdsResult = await pool.query(
                'SELECT college_id FROM interviewer_colleges WHERE user_id = $1',
                [req.user.id]
            );
            const assignedIds = collegeIdsResult.rows.map(r => r.college_id);

            if (assignedIds.length === 0) {
                return res.json({
                    assignedColleges: [],
                    totalStudents: 0,
                    completedInterviews: 0,
                    students: [],
                });
            }

            // Build placeholders for IN clause
            const placeholders = assignedIds.map((_, i) => `$${i + 1}`).join(', ');

            const [collegesRes, studentsRes, evaluationsRes, myStudentsRes] = await Promise.all([
                pool.query(
                    `SELECT id, name FROM colleges WHERE id IN (${placeholders})`,
                    assignedIds
                ),
                pool.query(
                    `SELECT COUNT(*) as count FROM students WHERE college_id IN (${placeholders})`,
                    assignedIds
                ),
                pool.query(
                    'SELECT COUNT(*) as count FROM evaluations WHERE interviewer_id = $1',
                    [req.user.id]
                ),
                pool.query(
                    `SELECT s.id, s.name, s.email, s.branch, s.year, c.name as college_name,
                            CASE WHEN e.id IS NOT NULL THEN 'Completed' ELSE 'Pending' END as status
                     FROM students s
                     JOIN colleges c ON s.college_id = c.id
                     LEFT JOIN evaluations e ON e.student_id = s.id AND e.interviewer_id = $1
                     WHERE s.college_id IN (${assignedIds.map((_, i) => `$${i + 2}`).join(', ')})
                     ORDER BY c.name, s.name`,
                    [req.user.id, ...assignedIds]
                ),
            ]);

            res.json({
                assignedColleges: collegesRes.rows,
                assignedCollege: collegesRes.rows.map(c => c.name).join(', '),
                totalStudents: parseInt(studentsRes.rows[0].count),
                completedInterviews: parseInt(evaluationsRes.rows[0].count),
                students: myStudentsRes.rows,
            });
        }
    } catch (err) {
        console.error('Dashboard stats error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
});

module.exports = router;
