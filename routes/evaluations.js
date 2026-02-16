const express = require('express');
const pool = require('../config/db');
const nodemailer = require('nodemailer');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// GET /api/evaluations - List all evaluations
router.get('/', authMiddleware, async (req, res) => {
    try {
        let query = `
            SELECT e.*, 
                   s.name as student_name, s.email as student_email, 
                   s.branch as student_branch, s.year as student_year,
                   c.name as college_name,
                   u.name as interviewer_name
            FROM evaluations e
            JOIN students s ON e.student_id = s.id
            JOIN colleges c ON s.college_id = c.id
            LEFT JOIN users u ON e.interviewer_id = u.id
        `;
        const params = [];

        if (req.user.role === 'interviewer') {
            query += ' WHERE e.interviewer_id = $1';
            params.push(req.user.id);
        }

        query += ' ORDER BY e.created_at DESC';
        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (err) {
        console.error('Get evaluations error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
});

// GET /api/evaluations/:id
router.get('/:id', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT e.*, 
                    s.name as student_name, s.email as student_email,
                    s.branch as student_branch, s.year as student_year,
                    c.name as college_name,
                    u.name as interviewer_name
             FROM evaluations e
             JOIN students s ON e.student_id = s.id
             JOIN colleges c ON s.college_id = c.id
             LEFT JOIN users u ON e.interviewer_id = u.id
             WHERE e.id = $1`,
            [req.params.id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Evaluation not found.' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Get evaluation error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
});

// POST /api/evaluations - Submit evaluation
router.post('/', authMiddleware, async (req, res) => {
    try {
        const {
            student_id,
            score_self_intro, score_communication, score_confidence,
            score_programming, score_oops, score_dsa, score_core_subject,
            score_logical, score_approach,
            score_hr_handling, score_strengths, score_attitude, score_career,
            strengths_text, improvements, comments
        } = req.body;

        if (!student_id) {
            return res.status(400).json({ error: 'Student is required.' });
        }

        const total_score = (score_self_intro || 0) + (score_communication || 0) + (score_confidence || 0) +
            (score_programming || 0) + (score_oops || 0) + (score_dsa || 0) + (score_core_subject || 0) +
            (score_logical || 0) + (score_approach || 0) +
            (score_hr_handling || 0) + (score_strengths || 0) + (score_attitude || 0) + (score_career || 0);

        let recommendation;
        if (total_score >= 80) recommendation = 'Highly Recommended';
        else if (total_score >= 60) recommendation = 'Recommended';
        else if (total_score >= 40) recommendation = 'Needs Improvement';
        else recommendation = 'Not Recommended';

        const result = await pool.query(
            `INSERT INTO evaluations (
                student_id, interviewer_id, total_score, recommendation,
                score_self_intro, score_communication, score_confidence,
                score_programming, score_oops, score_dsa, score_core_subject,
                score_logical, score_approach,
                score_hr_handling, score_strengths, score_attitude, score_career,
                strengths_text, improvements, comments
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
            RETURNING *`,
            [
                student_id, req.user.id, total_score, recommendation,
                score_self_intro || 0, score_communication || 0, score_confidence || 0,
                score_programming || 0, score_oops || 0, score_dsa || 0, score_core_subject || 0,
                score_logical || 0, score_approach || 0,
                score_hr_handling || 0, score_strengths || 0, score_attitude || 0, score_career || 0,
                strengths_text || '', improvements || '', comments || ''
            ]
        );

        // Return with student info
        const evaluation = await pool.query(
            `SELECT e.*, 
                    s.name as student_name, s.email as student_email,
                    s.branch as student_branch, s.year as student_year,
                    c.name as college_name,
                    u.name as interviewer_name
             FROM evaluations e
             JOIN students s ON e.student_id = s.id
             JOIN colleges c ON s.college_id = c.id
             LEFT JOIN users u ON e.interviewer_id = u.id
             WHERE e.id = $1`,
            [result.rows[0].id]
        );

        res.status(201).json(evaluation.rows[0]);
    } catch (err) {
        console.error('Create evaluation error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
});

// POST /api/evaluations/:id/send-email - Send report to student email
router.post('/:id/send-email', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT e.*, 
                    s.name as student_name, s.email as student_email,
                    s.branch as student_branch, s.year as student_year,
                    c.name as college_name,
                    u.name as interviewer_name
             FROM evaluations e
             JOIN students s ON e.student_id = s.id
             JOIN colleges c ON s.college_id = c.id
             LEFT JOIN users u ON e.interviewer_id = u.id
             WHERE e.id = $1`,
            [req.params.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Evaluation not found.' });
        }

        const evaluation = result.rows[0];

        // Generate suggestions
        const suggestions = generateSuggestions(evaluation);

        // Build email HTML
        const emailHtml = buildEmailTemplate(evaluation, suggestions);

        // Send email
        const transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: parseInt(process.env.SMTP_PORT || '587'),
            secure: false,
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS,
            },
        });

        await transporter.sendMail({
            from: process.env.SMTP_FROM || process.env.SMTP_USER,
            to: evaluation.student_email,
            subject: `CRT Mock Interview Report — ${evaluation.student_name}`,
            html: emailHtml,
        });

        // Update email_sent flag
        await pool.query(
            'UPDATE evaluations SET email_sent = true, email_sent_at = CURRENT_TIMESTAMP WHERE id = $1',
            [req.params.id]
        );

        res.json({ message: `Report sent to ${evaluation.student_email}` });
    } catch (err) {
        console.error('Send email error:', err);
        res.status(500).json({ error: 'Failed to send email. Check SMTP settings.' });
    }
});

// Helper: Generate improvement suggestions based on scores
function generateSuggestions(eval_data) {
    const suggestions = [];
    if (eval_data.score_self_intro < 3) suggestions.push('Practice your self-introduction — keep it concise (60-90 seconds), structured, and confident. Record yourself and review.');
    if (eval_data.score_communication < 3) suggestions.push('Improve communication skills — join speaking clubs, practice explaining technical concepts in simple words, read more.');
    if (eval_data.score_confidence < 3) suggestions.push('Work on body language — maintain eye contact, sit upright, practice mock interviews with peers to build confidence.');
    if (eval_data.score_programming < 6) suggestions.push('Strengthen programming fundamentals — practice daily on platforms like LeetCode, HackerRank. Focus on language basics and syntax.');
    if (eval_data.score_oops < 6) suggestions.push('Revise OOP concepts — understand inheritance, polymorphism, abstraction, encapsulation with real-world examples.');
    if (eval_data.score_dsa < 6) suggestions.push('Dedicate time to DSA practice — start with arrays, strings, then move to trees, graphs. Solve at least 2-3 problems daily.');
    if (eval_data.score_core_subject < 6) suggestions.push('Review core subjects — focus on DBMS, OS, Computer Networks, and Software Engineering. Prepare short notes.');
    if (eval_data.score_logical < 6) suggestions.push('Improve logical thinking — practice puzzles, aptitude questions, and mathematical reasoning.');
    if (eval_data.score_approach < 6) suggestions.push('Learn structured problem-solving — always think aloud, break down problems, discuss trade-offs before coding.');
    if (eval_data.score_hr_handling < 6) suggestions.push('Prepare for common HR questions using the STAR method (Situation, Task, Action, Result).');
    if (eval_data.score_strengths < 3) suggestions.push('Be honest and specific about strengths and weaknesses — always tie weaknesses to actions you\'re taking to improve.');
    if (eval_data.score_attitude < 3) suggestions.push('Work on professional demeanor — be punctual, dress formally, show enthusiasm and a positive attitude.');
    if (eval_data.score_career < 3) suggestions.push('Develop career clarity — research companies, understand different roles, and align your skills with career goals.');
    if (suggestions.length === 0) suggestions.push('Excellent performance! Continue practicing to maintain and improve your skills.');
    return suggestions;
}

// Helper: Build professional email HTML template
function buildEmailTemplate(evaluation, suggestions) {
    const scoreColor = evaluation.total_score >= 80 ? '#059669' :
        evaluation.total_score >= 60 ? '#2563eb' :
            evaluation.total_score >= 40 ? '#d97706' : '#dc2626';

    const scoreRow = (label, score, max) => `
        <tr>
            <td style="padding: 8px 12px; border-bottom: 1px solid #f1f5f9; color: #475569; font-size: 14px;">${label}</td>
            <td style="padding: 8px 12px; border-bottom: 1px solid #f1f5f9; text-align: center; font-weight: 600; color: #1e293b;">${score}/${max}</td>
        </tr>`;

    return `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"></head>
    <body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f8fafc;">
        <div style="max-width: 640px; margin: 0 auto; background: #ffffff;">
            <!-- Header -->
            <div style="background: linear-gradient(135deg, #2563eb, #1d4ed8); padding: 32px; text-align: center;">
                <h1 style="color: white; margin: 0; font-size: 22px;">CRT Mock Interview Report</h1>
                <p style="color: rgba(255,255,255,0.8); margin: 8px 0 0; font-size: 14px;">Evaluation Feedback & Improvement Suggestions</p>
            </div>

            <!-- Student Info -->
            <div style="padding: 24px 32px; border-bottom: 1px solid #e2e8f0;">
                <h2 style="margin: 0 0 4px; color: #0f172a; font-size: 20px;">Dear ${evaluation.student_name},</h2>
                <p style="color: #64748b; margin: 0; font-size: 14px;">${evaluation.college_name} • ${evaluation.student_branch || ''} • ${evaluation.student_year || ''}</p>
                <p style="color: #475569; margin: 16px 0 0; font-size: 14px; line-height: 1.6;">
                    Thank you for participating in the CRT Mock Interview. Below is your detailed evaluation report with personalized suggestions for improvement.
                </p>
            </div>

            <!-- Overall Score -->
            <div style="padding: 24px 32px; background: #eff6ff; text-align: center;">
                <p style="color: #64748b; margin: 0 0 4px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em;">Overall Score</p>
                <div style="font-size: 48px; font-weight: 800; color: ${scoreColor}; line-height: 1;">${evaluation.total_score}<span style="font-size: 20px; color: #94a3b8;">/100</span></div>
                <div style="display: inline-block; margin-top: 8px; padding: 4px 16px; border-radius: 20px; background: ${scoreColor}; color: white; font-size: 13px; font-weight: 600;">
                    ${evaluation.recommendation}
                </div>
            </div>

            <!-- Section Scores -->
            <div style="padding: 24px 32px;">
                <h3 style="margin: 0 0 16px; color: #0f172a; font-size: 16px;">📊 Detailed Scores</h3>
                
                <p style="font-weight: 600; color: #334155; margin: 16px 0 8px; font-size: 14px;">Self Introduction & Communication (15 marks)</p>
                <table style="width: 100%; border-collapse: collapse;">
                    ${scoreRow('Clarity of Self Introduction', evaluation.score_self_intro, 5)}
                    ${scoreRow('Communication Skills', evaluation.score_communication, 5)}
                    ${scoreRow('Confidence & Body Language', evaluation.score_confidence, 5)}
                </table>

                <p style="font-weight: 600; color: #334155; margin: 16px 0 8px; font-size: 14px;">Technical Knowledge (40 marks)</p>
                <table style="width: 100%; border-collapse: collapse;">
                    ${scoreRow('Programming Basics', evaluation.score_programming, 10)}
                    ${scoreRow('OOP Concepts', evaluation.score_oops, 10)}
                    ${scoreRow('DSA Basics', evaluation.score_dsa, 10)}
                    ${scoreRow('Core Subject Knowledge', evaluation.score_core_subject, 10)}
                </table>

                <p style="font-weight: 600; color: #334155; margin: 16px 0 8px; font-size: 14px;">Problem Solving (20 marks)</p>
                <table style="width: 100%; border-collapse: collapse;">
                    ${scoreRow('Logical Thinking', evaluation.score_logical, 10)}
                    ${scoreRow('Approach to Solution', evaluation.score_approach, 10)}
                </table>

                <p style="font-weight: 600; color: #334155; margin: 16px 0 8px; font-size: 14px;">HR Evaluation (25 marks)</p>
                <table style="width: 100%; border-collapse: collapse;">
                    ${scoreRow('HR Question Handling', evaluation.score_hr_handling, 10)}
                    ${scoreRow('Strengths & Weakness', evaluation.score_strengths, 5)}
                    ${scoreRow('Attitude & Professionalism', evaluation.score_attitude, 5)}
                    ${scoreRow('Career Clarity', evaluation.score_career, 5)}
                </table>
            </div>

            <!-- Feedback -->
            ${evaluation.strengths_text ? `
            <div style="padding: 16px 32px;">
                <h3 style="margin: 0 0 8px; color: #059669; font-size: 14px;">💪 Your Strengths</h3>
                <p style="color: #475569; font-size: 14px; line-height: 1.6; margin: 0;">${evaluation.strengths_text}</p>
            </div>` : ''}

            ${evaluation.improvements ? `
            <div style="padding: 16px 32px;">
                <h3 style="margin: 0 0 8px; color: #d97706; font-size: 14px;">📈 Areas of Improvement</h3>
                <p style="color: #475569; font-size: 14px; line-height: 1.6; margin: 0;">${evaluation.improvements}</p>
            </div>` : ''}

            ${evaluation.comments ? `
            <div style="padding: 16px 32px;">
                <h3 style="margin: 0 0 8px; color: #2563eb; font-size: 14px;">📝 Interviewer Comments</h3>
                <p style="color: #475569; font-size: 14px; line-height: 1.6; margin: 0;">${evaluation.comments}</p>
            </div>` : ''}

            <!-- Suggestions -->
            <div style="padding: 24px 32px; background: #fffbeb; border-top: 1px solid #fef3c7;">
                <h3 style="margin: 0 0 12px; color: #92400e; font-size: 15px;">🎯 Personalized Improvement Plan</h3>
                ${suggestions.map(s => `
                    <div style="padding: 8px 0; color: #78350f; font-size: 13px; line-height: 1.6;">
                        → ${s}
                    </div>
                `).join('')}
            </div>

            <!-- Footer -->
            <div style="padding: 24px 32px; background: #f8fafc; border-top: 1px solid #e2e8f0; text-align: center;">
                <p style="color: #94a3b8; font-size: 12px; margin: 0;">
                    This report was generated by the CRT Mock Interview Evaluation System.<br>
                    For queries, contact your placement cell coordinator.
                </p>
            </div>
        </div>
    </body>
    </html>`;
}

module.exports = router;
