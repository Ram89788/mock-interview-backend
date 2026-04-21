const express = require('express');
const pool = require('../config/db');
const { authMiddleware, adminOnly } = require('../middleware/auth');

const router = express.Router();

// ============================================
// POST /api/compare-performance
// Compare student performance across multiple interview dates
// Body: { college_id, batch_id, dates: ["2026-04-01", "2026-04-15", ...] }
// ============================================
router.post('/', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { college_id, batch_id, dates } = req.body;

        // --- Validation ---
        if (!college_id) {
            return res.status(400).json({ error: 'College is required.' });
        }
        if (!batch_id) {
            return res.status(400).json({ error: 'Batch is required.' });
        }
        if (!dates || !Array.isArray(dates) || dates.length < 2) {
            return res.status(400).json({ error: 'At least 2 dates are required for comparison.' });
        }

        // Validate date format (YYYY-MM-DD)
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        for (const d of dates) {
            if (!dateRegex.test(d)) {
                return res.status(400).json({ error: `Invalid date format: ${d}. Use YYYY-MM-DD.` });
            }
        }

        // Sort dates chronologically
        const sortedDates = [...dates].sort();

        // Build date conditions: for each date, match evaluations created on that day
        // We use DATE(e.created_at) to extract the date portion
        const datePlaceholders = sortedDates.map((_, i) => `$${i + 3}`).join(', ');

        const query = `
            SELECT 
                s.email,
                s.name as student_name,
                e.total_score,
                DATE(e.created_at) as eval_date,
                e.id as evaluation_id,
                e.created_at
            FROM evaluations e
            JOIN students s ON e.student_id = s.id
            WHERE s.college_id = $1
              AND s.batch_id = $2
              AND DATE(e.created_at) IN (${datePlaceholders})
            ORDER BY s.email, e.created_at
        `;

        const params = [college_id, batch_id, ...sortedDates];
        const result = await pool.query(query, params);

        // --- Group by student email ---
        // For each student, collect scores per date.
        // If a student has multiple evaluations on the same date, take the latest one.
        const studentMap = new Map();

        for (const row of result.rows) {
            const email = row.email;
            const dateStr = new Date(row.eval_date).toISOString().split('T')[0];

            if (!studentMap.has(email)) {
                studentMap.set(email, {
                    email,
                    name: row.student_name,
                    scores: {},
                    _timestamps: {}, // track created_at to resolve duplicates
                });
            }

            const student = studentMap.get(email);

            // If duplicate date, keep the one with the latest created_at 
            const existingTimestamp = student._timestamps[dateStr];
            const currentTimestamp = new Date(row.created_at).getTime();

            if (!existingTimestamp || currentTimestamp > existingTimestamp) {
                student.scores[dateStr] = row.total_score !== null ? row.total_score : null;
                student._timestamps[dateStr] = currentTimestamp;
            }
        }

        // --- Also include students from the batch who may have NO evaluations on selected dates ---
        const allStudentsResult = await pool.query(
            `SELECT DISTINCT s.email, s.name 
             FROM students s 
             WHERE s.college_id = $1 AND s.batch_id = $2
             ORDER BY s.name`,
            [college_id, batch_id]
        );

        // Merge: ensure every student in batch appears in the result
        for (const row of allStudentsResult.rows) {
            if (!studentMap.has(row.email)) {
                studentMap.set(row.email, {
                    email: row.email,
                    name: row.name,
                    scores: {},
                    _timestamps: {},
                });
            }
        }

        // --- Calculate average and improvement ---
        const comparison = [];

        for (const [, student] of studentMap) {
            const validScores = sortedDates
                .map(d => student.scores[d])
                .filter(s => s !== undefined && s !== null);

            // Average of available scores
            const average = validScores.length > 0
                ? parseFloat((validScores.reduce((a, b) => a + b, 0) / validScores.length).toFixed(1))
                : null;

            // Improvement: difference between earliest and latest available score
            let improvement = null;
            if (validScores.length >= 2) {
                // Find earliest and latest dates that have actual scores
                const datesWithScores = sortedDates.filter(
                    d => student.scores[d] !== undefined && student.scores[d] !== null
                );
                if (datesWithScores.length >= 2) {
                    const earliest = student.scores[datesWithScores[0]];
                    const latest = student.scores[datesWithScores[datesWithScores.length - 1]];
                    improvement = latest - earliest;
                }
            }

            // Build scores object with N/A for missing dates
            const scoresOutput = {};
            for (const d of sortedDates) {
                scoresOutput[d] = student.scores[d] !== undefined && student.scores[d] !== null
                    ? student.scores[d]
                    : 'N/A';
            }

            comparison.push({
                email: student.email,
                name: student.name,
                scores: scoresOutput,
                average,
                improvement,
            });

            // Clean up internal field
        }

        // Sort by name
        comparison.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

        res.json({
            college_id: parseInt(college_id),
            batch_id: parseInt(batch_id),
            dates: sortedDates,
            students: comparison,
            total: comparison.length,
        });
    } catch (err) {
        console.error('Compare performance error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
});

// ============================================
// GET /api/compare-performance/dates
// Get available evaluation dates for a batch
// Query: ?college_id=X&batch_id=Y
// ============================================
router.get('/dates', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { college_id, batch_id } = req.query;

        if (!college_id || !batch_id) {
            return res.status(400).json({ error: 'college_id and batch_id are required.' });
        }

        const result = await pool.query(
            `SELECT DISTINCT DATE(e.created_at) as eval_date, COUNT(*) as count
             FROM evaluations e
             JOIN students s ON e.student_id = s.id
             WHERE s.college_id = $1 AND s.batch_id = $2
             GROUP BY DATE(e.created_at)
             ORDER BY eval_date`,
            [college_id, batch_id]
        );

        const dates = result.rows.map(r => ({
            date: new Date(r.eval_date).toISOString().split('T')[0],
            count: parseInt(r.count),
        }));

        res.json(dates);
    } catch (err) {
        console.error('Get evaluation dates error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
});

module.exports = router;
