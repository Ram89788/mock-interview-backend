const bcrypt = require('bcryptjs');
const pool = require('./config/db');

async function seed() {
    const client = await pool.connect();
    try {
        console.log('🌱 Seeding database...');

        // Clear existing data
        await client.query('DELETE FROM evaluations');
        await client.query('DELETE FROM students');
        await client.query('DELETE FROM users');
        await client.query('DELETE FROM colleges');

        // Reset sequences
        await client.query("ALTER SEQUENCE colleges_id_seq RESTART WITH 1");
        await client.query("ALTER SEQUENCE users_id_seq RESTART WITH 1");
        await client.query("ALTER SEQUENCE students_id_seq RESTART WITH 1");
        await client.query("ALTER SEQUENCE evaluations_id_seq RESTART WITH 1");

        // 1. Seed Colleges
        const colleges = [
            { name: 'JNTU Hyderabad', location: 'Hyderabad, Telangana' },
            { name: 'VIT University', location: 'Vellore, Tamil Nadu' },
            { name: 'CBIT', location: 'Hyderabad, Telangana' },
        ];

        for (const c of colleges) {
            await client.query('INSERT INTO colleges (name, location) VALUES ($1, $2)', [c.name, c.location]);
        }
        console.log('  ✅ Colleges seeded');

        // 2. Seed Admin User
        const adminPassword = await bcrypt.hash('admin123', 10);
        await client.query(
            "INSERT INTO users (name, email, password, role) VALUES ($1, $2, $3, 'admin')",
            ['Admin User', 'admin@crt.com', adminPassword]
        );
        console.log('  ✅ Admin user seeded (admin@crt.com / admin123)');

        // 3. Seed Interviewers
        const interviewerPassword = await bcrypt.hash('interviewer123', 10);
        const interviewers = [
            { name: 'Rajesh Kumar', email: 'rajesh@crt.com', collegeId: 1 },
            { name: 'Priya Sharma', email: 'priya@crt.com', collegeId: 2 },
            { name: 'Anil Reddy', email: 'anil@crt.com', collegeId: 3 },
        ];

        for (const i of interviewers) {
            await client.query(
                "INSERT INTO users (name, email, password, role, assigned_college_id) VALUES ($1, $2, $3, 'interviewer', $4)",
                [i.name, i.email, interviewerPassword, i.collegeId]
            );
        }
        console.log('  ✅ Interviewers seeded (password: interviewer123)');

        // 4. Seed Students
        const students = [
            { name: 'Arjun Patel', email: 'arjun@student.com', phone: '9876543210', collegeId: 1, branch: 'Computer Science', year: '4th Year' },
            { name: 'Sneha Reddy', email: 'sneha@student.com', phone: '9876543211', collegeId: 1, branch: 'Information Technology', year: '4th Year' },
            { name: 'Vikram Singh', email: 'vikram@student.com', phone: '9876543212', collegeId: 1, branch: 'Computer Science', year: '3rd Year' },
            { name: 'Meera Nair', email: 'meera@student.com', phone: '9876543213', collegeId: 2, branch: 'Computer Science', year: '4th Year' },
            { name: 'Karthik Iyer', email: 'karthik@student.com', phone: '9876543214', collegeId: 2, branch: 'Electronics', year: '4th Year' },
            { name: 'Divya Joshi', email: 'divya@student.com', phone: '9876543215', collegeId: 3, branch: 'Computer Science', year: '4th Year' },
            { name: 'Rohit Verma', email: 'rohit@student.com', phone: '9876543216', collegeId: 3, branch: 'Mechanical', year: '3rd Year' },
            { name: 'Ananya Das', email: 'ananya@student.com', phone: '9876543217', collegeId: 3, branch: 'Computer Science', year: '4th Year' },
        ];

        for (const s of students) {
            await client.query(
                'INSERT INTO students (name, email, phone, college_id, branch, year) VALUES ($1, $2, $3, $4, $5, $6)',
                [s.name, s.email, s.phone, s.collegeId, s.branch, s.year]
            );
        }
        console.log('  ✅ Students seeded');

        // 5. Seed Sample Evaluations
        const evaluations = [
            {
                studentId: 1, interviewerId: 2,
                scores: { selfIntro: 4, communication: 4, confidence: 3, programming: 8, oops: 7, dsa: 6, coreSubject: 8, logical: 7, approach: 7, hrHandling: 8, strengths: 4, attitude: 4, career: 4 },
                strengths: 'Strong programming skills and good communication. Handles technical questions well.',
                improvements: 'Can improve DSA problem-solving speed and confidence in HR rounds.',
                comments: 'A promising candidate with strong technical foundation. Needs more practice in competitive coding.',
            },
            {
                studentId: 4, interviewerId: 3,
                scores: { selfIntro: 3, communication: 3, confidence: 3, programming: 6, oops: 5, dsa: 4, coreSubject: 6, logical: 5, approach: 5, hrHandling: 6, strengths: 3, attitude: 4, career: 3 },
                strengths: 'Good attitude and enthusiasm. Basic technical concepts are clear.',
                improvements: 'Needs significant improvement in DSA and problem-solving. Should practice more HR questions.',
                comments: 'Has the potential but requires dedicated practice and preparation.',
            },
        ];

        for (const e of evaluations) {
            const total = Object.values(e.scores).reduce((sum, v) => sum + v, 0);
            let rec = 'Not Recommended';
            if (total >= 80) rec = 'Highly Recommended';
            else if (total >= 60) rec = 'Recommended';
            else if (total >= 40) rec = 'Needs Improvement';

            await client.query(
                `INSERT INTO evaluations (
                    student_id, interviewer_id, total_score, recommendation,
                    score_self_intro, score_communication, score_confidence,
                    score_programming, score_oops, score_dsa, score_core_subject,
                    score_logical, score_approach,
                    score_hr_handling, score_strengths, score_attitude, score_career,
                    strengths_text, improvements, comments
                ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
                [
                    e.studentId, e.interviewerId, total, rec,
                    e.scores.selfIntro, e.scores.communication, e.scores.confidence,
                    e.scores.programming, e.scores.oops, e.scores.dsa, e.scores.coreSubject,
                    e.scores.logical, e.scores.approach,
                    e.scores.hrHandling, e.scores.strengths, e.scores.attitude, e.scores.career,
                    e.strengths, e.improvements, e.comments,
                ]
            );
        }
        console.log('  ✅ Sample evaluations seeded');

        console.log('\n🎉 Database seeded successfully!');
        console.log('\n📋 Login Credentials:');
        console.log('   Admin:        admin@crt.com / admin123');
        console.log('   Interviewer:  rajesh@crt.com / interviewer123');
        console.log('   Interviewer:  priya@crt.com / interviewer123');
        console.log('   Interviewer:  anil@crt.com / interviewer123\n');
    } catch (err) {
        console.error('❌ Seed failed:', err.message);
        process.exit(1);
    } finally {
        client.release();
        await pool.end();
    }
}

seed();
