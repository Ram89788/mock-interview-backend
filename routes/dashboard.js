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
            // Interviewer dashboard
            const collegeId = req.user.assignedCollegeId;
            const [collegeRes, studentsRes, evaluationsRes, myStudentsRes] = await Promise.all([
                pool.query('SELECT name FROM colleges WHERE id = $1', [collegeId]),
                pool.query('SELECT COUNT(*) as count FROM students WHERE college_id = $1', [collegeId]),
                pool.query('SELECT COUNT(*) as count FROM evaluations WHERE interviewer_id = $1', [req.user.id]),
                pool.query(`
                    SELECT s.id, s.name, s.email, s.branch, s.year,
                           CASE WHEN e.id IS NOT NULL THEN 'Completed' ELSE 'Pending' END as status
                    FROM students s
                    LEFT JOIN evaluations e ON e.student_id = s.id AND e.interviewer_id = $1
                    WHERE s.college_id = $2
                    ORDER BY s.name
                `, [req.user.id, collegeId]),
            ]);

            res.json({
                assignedCollege: collegeRes.rows[0]?.name || 'Not Assigned',
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
