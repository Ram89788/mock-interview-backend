const express = require('express');
const pool = require('../config/db');
const { authMiddleware, adminOnly } = require('../middleware/auth');

const router = express.Router();

// ============================================
// POST /api/top-performers
// Get ranked list of students from selected batches
// Body: { college_id, batch_ids: [1, 2, 3, ...] }
// Returns students sorted by average score (best to worst)
// ============================================
router.post('/', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { college_id, batch_ids } = req.body;

        // --- Validation ---
        if (!college_id) {
            return res.status(400).json({ error: 'College is required.' });
        }
        if (!batch_ids || !Array.isArray(batch_ids) || batch_ids.length < 1) {
            return res.status(400).json({ error: 'At least 1 batch is required.' });
        }

        // Fetch batch names for labeling
        const batchPlaceholders = batch_ids.map((_, i) => `$${i + 1}`).join(', ');
        const batchesResult = await pool.query(
            `SELECT id, batch_name FROM batches 
             WHERE id IN (${batchPlaceholders}) AND college_id = $${batch_ids.length + 1}
             ORDER BY created_at, batch_name`,
            [...batch_ids, college_id]
        );

        if (batchesResult.rows.length < 1) {
            return res.status(400).json({ error: 'No valid batches found for the selected college.' });
        }

        const batchInfo = batchesResult.rows;
        const validBatchIds = batchInfo.map(b => b.id);

        // Fetch all students + their latest evaluation for each batch
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
                    batchNames: [],
                });
            }

            const student = studentMap.get(email);
            if (row.student_name && (!student.name || student.name.length < row.student_name.length)) {
                student.name = row.student_name;
            }

            // Store score for this batch
            if (row.total_score !== null && row.total_score !== undefined) {
                const existing = student.scores[batchId];
                if (existing === undefined || existing === null) {
                    student.scores[batchId] = row.total_score;
                }
            }

            // Track which batch this student belongs to
            const batchName = batchInfo.find(b => b.id === batchId)?.batch_name;
            if (batchName && !student.batchNames.includes(batchName)) {
                student.batchNames.push(batchName);
            }
        }

        // --- Calculate average, highest, lowest ---
        const performers = [];

        for (const [, student] of studentMap) {
            const validScores = validBatchIds
                .map(bid => student.scores[bid])
                .filter(s => s !== undefined && s !== null);

            if (validScores.length === 0) {
                // student has no evaluations — include with null average
                performers.push({
                    email: student.email,
                    name: student.name,
                    scores: {},
                    batches: student.batchNames,
                    totalEvaluations: 0,
                    average: null,
                    highest: null,
                    lowest: null,
                });
                continue;
            }

            const average = parseFloat(
                (validScores.reduce((a, b) => a + b, 0) / validScores.length).toFixed(1)
            );
            const highest = Math.max(...validScores);
            const lowest = Math.min(...validScores);

            // Build scores output
            const scoresOutput = {};
            for (const bid of validBatchIds) {
                if (student.scores[bid] !== undefined && student.scores[bid] !== null) {
                    scoresOutput[bid] = student.scores[bid];
                }
            }

            performers.push({
                email: student.email,
                name: student.name,
                scores: scoresOutput,
                batches: student.batchNames,
                totalEvaluations: validScores.length,
                average,
                highest,
                lowest,
            });
        }

        // Sort by average score descending (best first), nulls at the end
        performers.sort((a, b) => {
            if (a.average === null && b.average === null) return 0;
            if (a.average === null) return 1;
            if (b.average === null) return -1;
            return b.average - a.average;
        });

        // Assign rank
        performers.forEach((p, idx) => {
            p.rank = p.average !== null ? idx + 1 : null;
        });

        res.json({
            college_id: parseInt(college_id),
            batches: batchInfo,
            performers,
            total: performers.length,
            evaluatedCount: performers.filter(p => p.average !== null).length,
        });
    } catch (err) {
        console.error('Top performers error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
});

module.exports = router;
