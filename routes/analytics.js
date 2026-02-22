const express = require('express');
const pool = require('../config/db');
const { authMiddleware, adminOnly, adminOrCollege } = require('../middleware/auth');

const router = express.Router();

// ============================================
// GET /api/analytics/admin - Admin analytics overview
// ============================================
router.get('/admin', authMiddleware, adminOnly, async (req, res) => {
    try {
        const [
            totalsRes,
            recommendationRes,
            collegePerformanceRes,
            monthlyRes,
            topStudentsRes
        ] = await Promise.all([
            // Totals
            pool.query(`
                SELECT 
                    (SELECT COUNT(*) FROM students) as total_students,
                    (SELECT COUNT(*) FROM colleges) as total_colleges,
                    (SELECT COUNT(*) FROM evaluations) as total_evaluations,
                    (SELECT COUNT(*) FROM users WHERE role = 'interviewer') as total_interviewers,
                    (SELECT COUNT(*) FROM batches) as total_batches,
                    (SELECT COALESCE(AVG(total_score), 0) FROM evaluations) as avg_score
            `),
            // Recommendation distribution
            pool.query(`
                SELECT recommendation_type, COUNT(*) as count
                FROM (
                    SELECT 
                        CASE 
                            WHEN total_score >= 85 THEN 'Highly Recommended'
                            WHEN total_score >= 70 THEN 'Recommended'
                            ELSE 'Not Recommended'
                        END as recommendation_type
                    FROM evaluations
                ) sub
                GROUP BY recommendation_type
                ORDER BY count DESC
            `),
            // Performance per college
            pool.query(`
                SELECT c.name as college_name, c.id as college_id,
                       COUNT(e.id) as evaluation_count,
                       COALESCE(AVG(e.total_score), 0) as avg_score,
                       COUNT(DISTINCT s.id) as student_count,
                       SUM(CASE WHEN e.total_score >= 85 THEN 1 ELSE 0 END) as highly_recommended,
                       SUM(CASE WHEN e.total_score >= 70 AND e.total_score < 85 THEN 1 ELSE 0 END) as recommended,
                       SUM(CASE WHEN e.total_score < 70 THEN 1 ELSE 0 END) as not_recommended
                FROM colleges c
                LEFT JOIN students s ON s.college_id = c.id
                LEFT JOIN evaluations e ON e.student_id = s.id
                GROUP BY c.id, c.name
                ORDER BY avg_score DESC
            `),
            // Monthly evaluation trend (last 6 months)
            pool.query(`
                SELECT 
                    TO_CHAR(created_at, 'YYYY-MM') as month,
                    COUNT(*) as count,
                    AVG(total_score) as avg_score
                FROM evaluations
                WHERE created_at >= NOW() - INTERVAL '6 months'
                GROUP BY month
                ORDER BY month
            `),
            // Top performing students
            pool.query(`
                SELECT s.name as student_name, c.name as college_name,
                       e.total_score, e.recommendation,
                       CASE 
                           WHEN e.total_score >= 85 THEN 'Highly Recommended'
                           WHEN e.total_score >= 70 THEN 'Recommended'
                           ELSE 'Not Recommended'
                       END as recommendation_type
                FROM evaluations e
                JOIN students s ON e.student_id = s.id
                JOIN colleges c ON s.college_id = c.id
                ORDER BY e.total_score DESC
                LIMIT 10
            `)
        ]);

        const totals = totalsRes.rows[0];

        res.json({
            totalStudents: parseInt(totals.total_students),
            totalColleges: parseInt(totals.total_colleges),
            totalEvaluations: parseInt(totals.total_evaluations),
            totalInterviewers: parseInt(totals.total_interviewers),
            totalBatches: parseInt(totals.total_batches),
            avgScore: parseFloat(parseFloat(totals.avg_score).toFixed(1)),
            recommendationDistribution: recommendationRes.rows.map(r => ({
                name: r.recommendation_type,
                value: parseInt(r.count)
            })),
            collegePerformance: collegePerformanceRes.rows.map(r => ({
                name: r.college_name,
                collegeId: r.college_id,
                avgScore: parseFloat(parseFloat(r.avg_score).toFixed(1)),
                evaluations: parseInt(r.evaluation_count),
                students: parseInt(r.student_count),
                highlyRecommended: parseInt(r.highly_recommended),
                recommended: parseInt(r.recommended),
                notRecommended: parseInt(r.not_recommended)
            })),
            monthlyTrend: monthlyRes.rows.map(r => ({
                month: r.month,
                count: parseInt(r.count),
                avgScore: parseFloat(parseFloat(r.avg_score).toFixed(1))
            })),
            topStudents: topStudentsRes.rows
        });
    } catch (err) {
        console.error('Admin analytics error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
});

// ============================================
// GET /api/analytics/college/:id - College-specific analytics
// ============================================
router.get('/college/:id', authMiddleware, async (req, res) => {
    try {
        const collegeId = req.params.id;

        // College role can only see their own data
        if (req.user.role === 'college' && String(req.user.collegeId) !== String(collegeId)) {
            return res.status(403).json({ error: 'Access denied.' });
        }

        const [
            collegeRes,
            totalsRes,
            recommendationRes,
            batchPerformanceRes,
            studentsRes,
            scoreDistRes
        ] = await Promise.all([
            pool.query('SELECT * FROM colleges WHERE id = $1', [collegeId]),
            pool.query(`
                SELECT 
                    (SELECT COUNT(*) FROM students WHERE college_id = $1) as total_students,
                    (SELECT COUNT(*) FROM batches WHERE college_id = $1) as total_batches,
                    (SELECT COUNT(*) FROM evaluations e JOIN students s ON e.student_id = s.id WHERE s.college_id = $1) as total_evaluations,
                    (SELECT COALESCE(AVG(e.total_score), 0) FROM evaluations e JOIN students s ON e.student_id = s.id WHERE s.college_id = $1) as avg_score
            `, [collegeId]),
            // Recommendation distribution for this college
            pool.query(`
                SELECT recommendation_type, COUNT(*) as count
                FROM (
                    SELECT 
                        CASE 
                            WHEN e.total_score >= 85 THEN 'Highly Recommended'
                            WHEN e.total_score >= 70 THEN 'Recommended'
                            ELSE 'Not Recommended'
                        END as recommendation_type
                    FROM evaluations e
                    JOIN students s ON e.student_id = s.id
                    WHERE s.college_id = $1
                ) sub
                GROUP BY recommendation_type
                ORDER BY count DESC
            `, [collegeId]),
            // Batch-wise performance
            pool.query(`
                SELECT b.id as batch_id, b.batch_name,
                       COUNT(DISTINCT s.id) as student_count,
                       COUNT(e.id) as evaluation_count,
                       COALESCE(AVG(e.total_score), 0) as avg_score,
                       SUM(CASE WHEN e.total_score >= 85 THEN 1 ELSE 0 END) as highly_recommended,
                       SUM(CASE WHEN e.total_score >= 70 AND e.total_score < 85 THEN 1 ELSE 0 END) as recommended,
                       SUM(CASE WHEN e.total_score < 70 THEN 1 ELSE 0 END) as not_recommended
                FROM batches b
                LEFT JOIN students s ON s.batch_id = b.id
                LEFT JOIN evaluations e ON e.student_id = s.id
                WHERE b.college_id = $1
                GROUP BY b.id, b.batch_name
                ORDER BY b.batch_name
            `, [collegeId]),
            // Student-level performance
            pool.query(`
                SELECT s.id, s.name as student_name, s.email, s.branch, s.year,
                       b.batch_name,
                       e.total_score, e.recommendation, e.created_at as eval_date,
                       e.score_self_intro, e.score_communication, e.score_confidence,
                       e.score_programming, e.score_oops, e.score_dsa, e.score_core_subject,
                       e.score_logical, e.score_approach,
                       e.score_hr_handling, e.score_strengths, e.score_attitude, e.score_career,
                       CASE 
                           WHEN e.total_score >= 85 THEN 'Highly Recommended'
                           WHEN e.total_score >= 70 THEN 'Recommended'
                           ELSE 'Not Recommended'
                       END as recommendation_type
                FROM students s
                LEFT JOIN evaluations e ON e.student_id = s.id
                LEFT JOIN batches b ON s.batch_id = b.id
                WHERE s.college_id = $1
                ORDER BY e.total_score DESC NULLS LAST
            `, [collegeId]),
            // Score distribution brackets
            pool.query(`
                SELECT score_range, COUNT(*) as count
                FROM (
                    SELECT 
                        CASE 
                            WHEN e.total_score >= 90 THEN '90-100'
                            WHEN e.total_score >= 80 THEN '80-89'
                            WHEN e.total_score >= 70 THEN '70-79'
                            WHEN e.total_score >= 60 THEN '60-69'
                            WHEN e.total_score >= 50 THEN '50-59'
                            ELSE 'Below 50'
                        END as score_range
                    FROM evaluations e
                    JOIN students s ON e.student_id = s.id
                    WHERE s.college_id = $1
                ) sub
                GROUP BY score_range
                ORDER BY score_range
            `, [collegeId])
        ]);

        if (collegeRes.rows.length === 0) {
            return res.status(404).json({ error: 'College not found.' });
        }

        const totals = totalsRes.rows[0];

        res.json({
            college: collegeRes.rows[0],
            totalStudents: parseInt(totals.total_students),
            totalBatches: parseInt(totals.total_batches),
            totalEvaluations: parseInt(totals.total_evaluations),
            avgScore: parseFloat(parseFloat(totals.avg_score).toFixed(1)),
            recommendationDistribution: recommendationRes.rows.map(r => ({
                name: r.recommendation_type,
                value: parseInt(r.count)
            })),
            batchPerformance: batchPerformanceRes.rows.map(r => ({
                name: r.batch_name,
                batchId: r.batch_id,
                avgScore: parseFloat(parseFloat(r.avg_score).toFixed(1)),
                evaluations: parseInt(r.evaluation_count),
                students: parseInt(r.student_count),
                highlyRecommended: parseInt(r.highly_recommended || 0),
                recommended: parseInt(r.recommended || 0),
                notRecommended: parseInt(r.not_recommended || 0)
            })),
            students: studentsRes.rows,
            scoreDistribution: scoreDistRes.rows.map(r => ({
                name: r.score_range,
                value: parseInt(r.count)
            }))
        });
    } catch (err) {
        console.error('College analytics error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
});

// ============================================
// GET /api/analytics/student/:id - Student-specific analytics
// ============================================
router.get('/student/:id', authMiddleware, async (req, res) => {
    try {
        const studentId = req.params.id;

        const [studentRes, evalRes] = await Promise.all([
            pool.query(`
                SELECT s.*, c.name as college_name, b.batch_name
                FROM students s
                JOIN colleges c ON s.college_id = c.id
                LEFT JOIN batches b ON s.batch_id = b.id
                WHERE s.id = $1
            `, [studentId]),
            pool.query(`
                SELECT e.*, u.name as interviewer_name
                FROM evaluations e
                LEFT JOIN users u ON e.interviewer_id = u.id
                WHERE e.student_id = $1
                ORDER BY e.created_at DESC
            `, [studentId])
        ]);

        if (studentRes.rows.length === 0) {
            return res.status(404).json({ error: 'Student not found.' });
        }

        // College role can only see their own students
        if (req.user.role === 'college' && String(studentRes.rows[0].college_id) !== String(req.user.collegeId)) {
            return res.status(403).json({ error: 'Access denied.' });
        }

        const student = studentRes.rows[0];
        const evaluations = evalRes.rows;

        // Build radar chart data from latest evaluation
        let radarData = [];
        if (evaluations.length > 0) {
            const latest = evaluations[0];
            radarData = [
                { subject: 'Self Intro', score: (latest.score_self_intro / 5) * 100, fullMark: 100 },
                { subject: 'Communication', score: (latest.score_communication / 5) * 100, fullMark: 100 },
                { subject: 'Confidence', score: (latest.score_confidence / 5) * 100, fullMark: 100 },
                { subject: 'Programming', score: (latest.score_programming / 10) * 100, fullMark: 100 },
                { subject: 'OOP', score: (latest.score_oops / 10) * 100, fullMark: 100 },
                { subject: 'DSA', score: (latest.score_dsa / 10) * 100, fullMark: 100 },
                { subject: 'Core Subject', score: (latest.score_core_subject / 10) * 100, fullMark: 100 },
                { subject: 'Logical', score: (latest.score_logical / 10) * 100, fullMark: 100 },
                { subject: 'Problem Solving', score: (latest.score_approach / 10) * 100, fullMark: 100 },
                { subject: 'HR Skills', score: (latest.score_hr_handling / 10) * 100, fullMark: 100 },
                { subject: 'Strengths', score: (latest.score_strengths / 5) * 100, fullMark: 100 },
                { subject: 'Attitude', score: (latest.score_attitude / 5) * 100, fullMark: 100 },
                { subject: 'Career Clarity', score: (latest.score_career / 5) * 100, fullMark: 100 },
            ];
        }

        res.json({
            student,
            evaluations,
            radarData,
            latestScore: evaluations.length > 0 ? evaluations[0].total_score : null,
            recommendationType: evaluations.length > 0 ? (
                evaluations[0].total_score >= 85 ? 'Highly Recommended' :
                    evaluations[0].total_score >= 70 ? 'Recommended' : 'Not Recommended'
            ) : null
        });
    } catch (err) {
        console.error('Student analytics error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
});

module.exports = router;
