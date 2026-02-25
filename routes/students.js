const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const pool = require('../config/db');
const { authMiddleware, adminOnly } = require('../middleware/auth');

const router = express.Router();

// ============================================
// Multer config — store uploaded files in memory
// ============================================
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB max
    fileFilter: (req, file, cb) => {
        const allowedMimes = [
            'text/csv',
            'application/vnd.ms-excel',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/octet-stream', // some browsers send CSV as this
        ];
        const allowedExts = ['.csv', '.xls', '.xlsx'];
        const ext = file.originalname.toLowerCase().slice(file.originalname.lastIndexOf('.'));

        if (allowedMimes.includes(file.mimetype) || allowedExts.includes(ext)) {
            cb(null, true);
        } else {
            cb(new Error('Only .csv, .xls, and .xlsx files are allowed.'));
        }
    },
});

// ============================================
// Helper — normalise column headers
// ============================================
function normalizeHeader(header) {
    if (!header) return '';
    const h = String(header).trim().toLowerCase().replace(/[\s_-]+/g, '_');
    const map = {
        'student_name': 'name',
        'student_email': 'email',
        'email_id': 'email',
        'email_address': 'email',
        'mobile': 'phone',
        'phone_number': 'phone',
        'mobile_number': 'phone',
        'contact': 'phone',
        'college': 'college_name',
        'college_name': 'college_name',
        'college_id': 'college_id',
        'department': 'branch',
        'stream': 'branch',
        'specialization': 'branch',
        'year_of_study': 'year',
        'batch': 'batch_name',
        'batch_name': 'batch_name',
        'batch_id': 'batch_id',
    };
    return map[h] || h;
}

// ============================================
// Helper — parse uploaded file buffer → rows
// ============================================
function parseFile(buffer, originalName) {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) throw new Error('The uploaded file has no sheets.');

    const sheet = workbook.Sheets[sheetName];
    const jsonRows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

    if (jsonRows.length === 0) throw new Error('The uploaded file contains no data rows.');

    // Normalise headers
    return jsonRows.map((row) => {
        const normalised = {};
        for (const key of Object.keys(row)) {
            normalised[normalizeHeader(key)] = String(row[key]).trim();
        }
        return normalised;
    });
}

// ============================================
// GET /api/students — list students
// ============================================
router.get('/', authMiddleware, async (req, res) => {
    try {
        const { college_id, batch_id } = req.query;
        let query = `
            SELECT s.*, c.name as college_name,
                   b.batch_name,
                   CASE WHEN COUNT(e.id) > 0 THEN true ELSE false END as is_evaluated,
                   COUNT(e.id)::int as evaluation_count
            FROM students s 
            JOIN colleges c ON s.college_id = c.id
            LEFT JOIN batches b ON s.batch_id = b.id
            LEFT JOIN evaluations e ON e.student_id = s.id
        `;
        const params = [];
        const conditions = [];

        if (req.user.role === 'interviewer') {
            // Get assigned colleges
            const collegeIdsResult = await pool.query(
                'SELECT college_id FROM interviewer_colleges WHERE user_id = $1',
                [req.user.id]
            );
            const assignedCollegeIds = collegeIdsResult.rows.map(r => r.college_id);

            if (assignedCollegeIds.length === 0) {
                return res.json([]);
            }

            // Get assigned batches
            const batchIdsResult = await pool.query(
                'SELECT batch_id FROM interviewer_batches WHERE user_id = $1',
                [req.user.id]
            );
            const assignedBatchIds = batchIdsResult.rows.map(r => r.batch_id);

            if (college_id) {
                if (!assignedCollegeIds.includes(parseInt(college_id))) {
                    return res.json([]);
                }
                conditions.push(`s.college_id = $${params.length + 1}`);
                params.push(college_id);
            } else {
                const placeholders = assignedCollegeIds.map((_, i) => `$${params.length + i + 1}`).join(', ');
                conditions.push(`s.college_id IN (${placeholders})`);
                params.push(...assignedCollegeIds);
            }

            // If interviewer has assigned batches, filter by them
            if (assignedBatchIds.length > 0) {
                if (batch_id) {
                    // Explicit batch filter — verify it's in their assigned list
                    if (!assignedBatchIds.includes(parseInt(batch_id))) {
                        return res.json([]);
                    }
                    conditions.push(`s.batch_id = $${params.length + 1}`);
                    params.push(batch_id);
                } else {
                    // Filter by all assigned batches for the selected college
                    // Get batches that belong to the selected college(s)
                    const collegeScopedBatchIds = [];
                    if (college_id) {
                        // Only keep batches that belong to this specific college
                        const batchCollegeResult = await pool.query(
                            `SELECT b.id FROM batches b 
                             JOIN interviewer_batches ib ON ib.batch_id = b.id 
                             WHERE ib.user_id = $1 AND b.college_id = $2`,
                            [req.user.id, college_id]
                        );
                        collegeScopedBatchIds.push(...batchCollegeResult.rows.map(r => r.id));
                    } else {
                        collegeScopedBatchIds.push(...assignedBatchIds);
                    }

                    if (collegeScopedBatchIds.length > 0) {
                        const batchPlaceholders = collegeScopedBatchIds.map((_, i) => `$${params.length + i + 1}`).join(', ');
                        conditions.push(`s.batch_id IN (${batchPlaceholders})`);
                        params.push(...collegeScopedBatchIds);
                    }
                }
            } else if (batch_id) {
                // No assigned batches but explicit batch_id filter passed
                conditions.push(`s.batch_id = $${params.length + 1}`);
                params.push(batch_id);
            }
        } else {
            if (college_id) {
                conditions.push(`s.college_id = $${params.length + 1}`);
                params.push(college_id);
            }
            if (batch_id) {
                conditions.push(`s.batch_id = $${params.length + 1}`);
                params.push(batch_id);
            }
        }

        if (conditions.length > 0) {
            query += ' WHERE ' + conditions.join(' AND ');
        }

        query += ' GROUP BY s.id, c.name, b.batch_name ORDER BY s.name';
        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (err) {
        console.error('Get students error:', err);
        res.status(500).json({ error: 'Server error.' });
    }
});

// ============================================
// GET /api/students/template — download sample template
// ============================================
router.get('/template', authMiddleware, adminOnly, (req, res) => {
    try {
        const format = (req.query.format || 'xlsx').toLowerCase();

        const sampleData = [
            { Name: 'John Doe', Email: 'john@example.com', Phone: '9876543210', College: 'VIT University', Branch: 'Computer Science', Year: '4th Year', Batch: 'Batch A' },
            { Name: 'Jane Smith', Email: 'jane@example.com', Phone: '9876543211', College: 'JNTU Hyderabad', Branch: 'Electronics', Year: '3rd Year', Batch: 'Batch B' },
        ];

        const ws = XLSX.utils.json_to_sheet(sampleData);

        // Set column widths
        ws['!cols'] = [
            { wch: 20 }, // Name
            { wch: 25 }, // Email
            { wch: 15 }, // Phone
            { wch: 25 }, // College
            { wch: 25 }, // Branch
            { wch: 12 }, // Year
            { wch: 20 }, // Batch
        ];

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Students');

        if (format === 'csv') {
            const csvBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'csv' });
            res.setHeader('Content-Disposition', 'attachment; filename="students_template.csv"');
            res.setHeader('Content-Type', 'text/csv');
            return res.send(csvBuffer);
        }

        const xlsxBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
        res.setHeader('Content-Disposition', 'attachment; filename="students_template.xlsx"');
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.send(xlsxBuffer);
    } catch (err) {
        console.error('Template download error:', err);
        res.status(500).json({ error: 'Failed to generate template.' });
    }
});

// ============================================
// GET /api/students/:id
// ============================================
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

// ============================================
// POST /api/students — create single student
// ============================================
router.post('/', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { name, email, phone, college_id, branch, year, batch_id } = req.body;
        if (!name || !email || !college_id) {
            return res.status(400).json({ error: 'Name, email, and college are required.' });
        }
        const result = await pool.query(
            `INSERT INTO students (name, email, phone, college_id, branch, year, batch_id) 
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
            [name, email, phone || null, college_id, branch || null, year || null, batch_id || null]
        );

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

// ============================================
// POST /api/students/bulk — bulk upload via file or JSON
// Accepts: multipart/form-data with file field "file"
//      OR: JSON body  { students: [...] }
// ============================================
router.post('/bulk', authMiddleware, adminOnly, upload.single('file'), async (req, res) => {
    try {
        let rows = [];

        // ---- SOURCE 1: Uploaded file (Excel / CSV) ----
        if (req.file) {
            try {
                rows = parseFile(req.file.buffer, req.file.originalname);
            } catch (parseErr) {
                return res.status(400).json({ error: parseErr.message });
            }
        }
        // ---- SOURCE 2: JSON array in body ----
        else if (req.body.students) {
            let students = req.body.students;
            if (typeof students === 'string') {
                try { students = JSON.parse(students); } catch { /* */ }
            }
            if (!Array.isArray(students) || students.length === 0) {
                return res.status(400).json({ error: 'Students array is required.' });
            }
            rows = students;
        } else {
            return res.status(400).json({
                error: 'Please upload an Excel/CSV file or send a students JSON array.',
            });
        }

        // ---- Fixed College/Batch from request ----
        const fixedCollegeId = req.body.college_id ? parseInt(req.body.college_id) : null;
        const fixedBatchId = req.body.batch_id ? parseInt(req.body.batch_id) : null;

        // ---- Build a college-name → id lookup ----
        const collegesResult = await pool.query('SELECT id, name FROM colleges');
        const collegeMap = {};
        for (const c of collegesResult.rows) {
            collegeMap[c.name.toLowerCase().trim()] = c.id;
        }

        // ---- Build a batch-name → id lookup (keyed by college_id + batch_name) ----
        const batchesResult = await pool.query('SELECT id, batch_name, college_id FROM batches');
        const batchMap = {}; // key: "collegeId|batchName" → batch id
        for (const b of batchesResult.rows) {
            batchMap[`${b.college_id}|${b.batch_name.toLowerCase().trim()}`] = b.id;
        }

        // ---- Validate & prepare rows ----
        const errors = [];
        const validStudents = [];

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const rowNum = i + 2; // +2 because row 1 is the header in Excel
            const rowErrors = [];

            const name = (row.name || '').trim();
            const email = (row.email || '').trim();
            const phone = (row.phone || '').trim() || null;
            const branch = (row.branch || '').trim() || null;
            const year = (row.year || '').trim() || null;

            // Resolve college: prefer fixedCollegeId, then row.college_id, fall back to college_name
            let collegeId = fixedCollegeId;
            if (!collegeId && row.college_id) {
                collegeId = parseInt(row.college_id);
                if (isNaN(collegeId)) {
                    rowErrors.push('Invalid college_id');
                    collegeId = null;
                }
            } else if (!collegeId && row.college_name) {
                collegeId = collegeMap[row.college_name.toLowerCase().trim()] || null;
                if (!collegeId) {
                    rowErrors.push(`College "${row.college_name}" not found`);
                }
            }

            // Resolve batch: prefer fixedBatchId, then row.batch_id, then batch_name lookup
            let resolvedBatchId = fixedBatchId;
            if (!resolvedBatchId && row.batch_id) {
                resolvedBatchId = parseInt(row.batch_id);
                if (isNaN(resolvedBatchId)) {
                    rowErrors.push('Invalid batch_id');
                    resolvedBatchId = null;
                }
            } else if (!resolvedBatchId && row.batch_name && collegeId) {
                const batchKey = `${collegeId}|${row.batch_name.toLowerCase().trim()}`;
                resolvedBatchId = batchMap[batchKey] || null;
                if (!resolvedBatchId) {
                    rowErrors.push(`Batch "${row.batch_name}" not found for this college`);
                }
            }

            if (!name) rowErrors.push('Name is required');
            if (!email) rowErrors.push('Email is required');
            if (!collegeId && rowErrors.length === 0) rowErrors.push('College is required');

            // Basic email format check
            if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                rowErrors.push('Invalid email format');
            }

            if (rowErrors.length > 0) {
                errors.push({ row: rowNum, name: name || '(empty)', email: email || '(empty)', errors: rowErrors });
            } else {
                validStudents.push({ name, email, phone, college_id: collegeId, branch, year, batch_id: resolvedBatchId });
            }
        }

        // ---- Insert valid students (within a transaction) ----
        const inserted = [];
        const insertErrors = [];

        if (validStudents.length > 0) {
            const client = await pool.connect();
            try {
                await client.query('BEGIN');

                for (let i = 0; i < validStudents.length; i++) {
                    const s = validStudents[i];
                    try {
                        const result = await client.query(
                            `INSERT INTO students (name, email, phone, college_id, branch, year, batch_id) 
                             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
                            [s.name, s.email, s.phone, s.college_id, s.branch, s.year, s.batch_id]
                        );
                        inserted.push(result.rows[0]);
                    } catch (insertErr) {
                        // Handle duplicate email or other DB errors per-row
                        const msg = insertErr.code === '23505'
                            ? `Duplicate email: ${s.email}`
                            : insertErr.message;
                        insertErrors.push({ name: s.name, email: s.email, error: msg });
                    }
                }

                await client.query('COMMIT');
            } catch (txErr) {
                await client.query('ROLLBACK');
                throw txErr;
            } finally {
                client.release();
            }
        }

        // ---- Build response ----
        const allErrors = [...errors, ...insertErrors.map(e => ({
            row: null,
            name: e.name,
            email: e.email,
            errors: [e.error],
        }))];

        res.status(inserted.length > 0 ? 201 : 400).json({
            message: `${inserted.length} student(s) added successfully.`,
            total_in_file: rows.length,
            successful: inserted.length,
            failed: allErrors.length,
            errors: allErrors.length > 0 ? allErrors : undefined,
            students: inserted,
        });
    } catch (err) {
        console.error('Bulk upload error:', err);
        res.status(500).json({ error: 'Server error during bulk upload.' });
    }
});

// ============================================
// PUT /api/students/:id — update student
// ============================================
router.put('/:id', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { name, email, phone, college_id, branch, year, batch_id } = req.body;

        // We check what was actually provided in the body to allow setting values to NULL
        const updates = [];
        const params = [];

        if (name !== undefined) { updates.push(`name = $${updates.length + 1}`); params.push(name); }
        if (email !== undefined) { updates.push(`email = $${updates.length + 1}`); params.push(email); }
        if (phone !== undefined) { updates.push(`phone = $${updates.length + 1}`); params.push(phone); }
        if (college_id !== undefined) { updates.push(`college_id = $${updates.length + 1}`); params.push(college_id); }
        if (branch !== undefined) { updates.push(`branch = $${updates.length + 1}`); params.push(branch); }
        if (year !== undefined) { updates.push(`year = $${updates.length + 1}`); params.push(year); }
        if (batch_id !== undefined) { updates.push(`batch_id = $${updates.length + 1}`); params.push(batch_id); }

        if (updates.length === 0) {
            return res.status(400).json({ error: 'No fields provided for update.' });
        }

        updates.push(`updated_at = CURRENT_TIMESTAMP`);
        params.push(req.params.id);

        const result = await pool.query(
            `UPDATE students SET ${updates.join(', ')} WHERE id = $${params.length} RETURNING *`,
            params
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

// ============================================
// DELETE /api/students/:id — delete student
// ============================================
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
