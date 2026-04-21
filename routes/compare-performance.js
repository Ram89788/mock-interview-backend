const express = require('express');
const pool = require('../config/db');
const { authMiddleware, adminOnly } = require('../middleware/auth');

const router = express.Router();

// ============================================
// POST /api/compare-performance
// Compare student performance across multiple batches
// Body: { college_id, batch_ids: [1, 2, 3, ...] }
// ============================================
router.post('/', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { college_id, batch_ids } = req.body;

        // --- Validation ---
        if (!college_id) {
            return res.status(400).json({ error: 'College is required.' });
        }
        if (!batch_ids || !Array.isArray(batch_ids) || batch_ids.length < 2) {
            return res.status(400).json({ error: 'At least 2 batches are required for comparison.' });
        }

        // Fetch batch names for labeling
        const batchPlaceholders = batch_ids.map((_, i) => `$${i + 1}`).join(', ');
        const batchesResult = await pool.query(
            `SELECT id, batch_name FROM batches 
             WHERE id IN (${batchPlaceholders}) AND college_id = $${batch_ids.length + 1}
             ORDER BY created_at, batch_name`,
            [...batch_ids, college_id]
        );

        if (batchesResult.rows.length < 2) {
            return res.status(400).json({ error: 'At least 2 valid batches are required from the selected college.' });
        }

        const batchInfo = batchesResult.rows; // [{id, batch_name}, ...]
        const validBatchIds = batchInfo.map(b => b.id);

        // Fetch all students + their latest evaluation for each batch
        // A student may appear in multiple batches (same email, different batch_id)
        const evalPlaceholders = validBatchIds.map((_, i) => `$${i + 1}`).join(', ');

        const evalResult = await pool.query(
            `SELECT 
                s.email,
                s.name as student_name,
                s.batch_id,
                e.total_score,
                e.created_at,
                e.id as evaluation_id
             FROM students s
             LEFT JOIN LATERAL (
                SELECT e2.total_score, e2.created_at, e2.id
                FROM evaluations e2
                WHERE e2.student_id = s.id
                ORDER BY e2.created_at DESC
                LIMIT 1
             ) e ON true
             WHERE s.batch_id IN (${evalPlaceholders})
               AND s.college_id = $${validBatchIds.length + 1}
             ORDER BY s.email, s.batch_id`,
            [...validBatchIds, college_id]
        );

        // --- Group by student email ---
        const studentMap = new Map();

        for (const row of evalResult.rows) {
            const email = row.email;
            const batchId = row.batch_id;

            if (!studentMap.has(email)) {
                studentMap.set(email, {
                    email,
                    name: row.student_name,
                    scores: {},
                });
            }

            const student = studentMap.get(email);
            // Update name to latest non-empty if needed
            if (row.student_name && (!student.name || student.name.length < row.student_name.length)) {
                student.name = row.student_name;
            }

            // Store score for this batch (keep latest evaluation if student has multiple entries in same batch)
            if (row.total_score !== null && row.total_score !== undefined) {
                const existing = student.scores[batchId];
                if (existing === undefined || existing === null) {
                    student.scores[batchId] = row.total_score;
                }
            }
        }

        // --- Calculate average and improvement ---
        const comparison = [];

        for (const [, student] of studentMap) {
            const validScores = validBatchIds
                .map(bid => student.scores[bid])
                .filter(s => s !== undefined && s !== null);

            // Average of available scores
            const average = validScores.length > 0
                ? parseFloat((validScores.reduce((a, b) => a + b, 0) / validScores.length).toFixed(1))
                : null;

            // Improvement: difference between first batch score and last batch score (in order)
            let improvement = null;
            const orderedScores = validBatchIds
                .map(bid => student.scores[bid])
                .filter(s => s !== undefined && s !== null);

            if (orderedScores.length >= 2) {
                improvement = orderedScores[orderedScores.length - 1] - orderedScores[0];
            }

            // Build scores output with N/A for missing batches
            const scoresOutput = {};
            for (const bid of validBatchIds) {
                scoresOutput[bid] = student.scores[bid] !== undefined && student.scores[bid] !== null
                    ? student.scores[bid]
                    : 'N/A';
            }

            comparison.push({
                email: student.email,
                name: student.name,
                scores: scoresOutput,
                average,
                improvement,
            });
        }

        // Sort by name
        comparison.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

        res.json({
            college_id: parseInt(college_id),
            batches: batchInfo, // [{id, batch_name}, ...]
            students: comparison,
            total: comparison.length,
        });
    } catch (err) {
        console.error('Compare performance error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
});

module.exports = router;
