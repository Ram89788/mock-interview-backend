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

        // Get batch info for the selected batches
        const batchPlaceholders = batch_ids.map((_, i) => `$${i + 2}`).join(', ');
        const batchInfoResult = await pool.query(
            `SELECT id, batch_name FROM batches 
             WHERE college_id = $1 AND id IN (${batchPlaceholders})
             ORDER BY batch_name`,
            [college_id, ...batch_ids]
        );

        if (batchInfoResult.rows.length < 2) {
            return res.status(400).json({ error: 'At least 2 valid batches are required.' });
        }

        const batchInfo = batchInfoResult.rows;
        const validBatchIds = batchInfo.map(b => b.id);

        // For each batch, get students and their evaluation scores
        // We'll get all evaluations for students in the selected batches
        const evalPlaceholders = validBatchIds.map((_, i) => `$${i + 2}`).join(', ');
        const evalQuery = `
            SELECT 
                s.email,
                s.name as student_name,
                s.batch_id,
                e.total_score,
                e.created_at
            FROM students s
            LEFT JOIN evaluations e ON e.student_id = s.id
            WHERE s.college_id = $1
              AND s.batch_id IN (${evalPlaceholders})
            ORDER BY s.email, s.batch_id, e.created_at DESC
        `;

        const evalResult = await pool.query(evalQuery, [college_id, ...validBatchIds]);

        // Group data by student email
        const studentMap = new Map();

        for (const row of evalResult.rows) {
            const email = row.email;

            if (!studentMap.has(email)) {
                studentMap.set(email, {
                    email,
                    name: row.student_name,
                    batches: {},      // { batchId: { scores: [], batchName: '' } }
                });
            }

            const student = studentMap.get(email);
            const batchId = row.batch_id;

            if (!student.batches[batchId]) {
                const bInfo = batchInfo.find(b => b.id === batchId);
                student.batches[batchId] = {
                    batch_name: bInfo ? bInfo.batch_name : `Batch ${batchId}`,
                    scores: [],
                };
            }

            // Add the score if there is an evaluation
            if (row.total_score !== null && row.total_score !== undefined) {
                student.batches[batchId].scores.push(row.total_score);
            }
        }

        // Find students who appear in at least 2 of the selected batches
        // (common students for comparison)
        const comparison = [];

        for (const [, student] of studentMap) {
            const batchCount = Object.keys(student.batches).length;

            // Build per-batch average scores
            const batchScores = {};
            let totalScore = 0;
            let totalCount = 0;

            for (const batchId of validBatchIds) {
                if (student.batches[batchId]) {
                    const scores = student.batches[batchId].scores;
                    if (scores.length > 0) {
                        const avg = parseFloat(
                            (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1)
                        );
                        batchScores[batchId] = avg;
                        totalScore += avg;
                        totalCount++;
                    } else {
                        batchScores[batchId] = 'N/A';
                    }
                } else {
                    batchScores[batchId] = 'N/A';
                }
            }

            // Overall average across all batches
            const overallAvg = totalCount > 0
                ? parseFloat((totalScore / totalCount).toFixed(1))
                : null;

            // Improvement: difference between first batch score and last batch score (where available)
            let improvement = null;
            const numericScores = validBatchIds
                .map(id => batchScores[id])
                .filter(s => s !== 'N/A');
            if (numericScores.length >= 2) {
                improvement = parseFloat((numericScores[numericScores.length - 1] - numericScores[0]).toFixed(1));
            }

            comparison.push({
                email: student.email,
                name: student.name,
                batch_count: batchCount,
                scores: batchScores,
                average: overallAvg,
                improvement,
                is_common: batchCount >= 2,
            });
        }

        // Sort: common students first, then by name
        comparison.sort((a, b) => {
            if (a.is_common !== b.is_common) return b.is_common ? 1 : -1;
            return (a.name || '').localeCompare(b.name || '');
        });

        res.json({
            college_id: parseInt(college_id),
            batches: batchInfo.map(b => ({ id: b.id, name: b.batch_name })),
            batch_ids: validBatchIds,
            students: comparison,
            total: comparison.length,
            common_count: comparison.filter(s => s.is_common).length,
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
// (Kept for backward compatibility, but no longer used by the new UI)
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
