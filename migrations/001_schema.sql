-- ============================================
-- CRT Mock Interview Evaluation System
-- PostgreSQL Database Schema
-- ============================================

-- Drop tables if they exist (in reverse dependency order)
DROP TABLE IF EXISTS evaluations CASCADE;
DROP TABLE IF EXISTS students CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS colleges CASCADE;

-- ============================================
-- 1. Colleges Table
-- ============================================
CREATE TABLE colleges (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    location VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- 2. Users Table (Admin + Interviewers)
-- ============================================
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'interviewer')),
    assigned_college_id INT REFERENCES colleges(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- 3. Students Table
-- ============================================
CREATE TABLE students (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    phone VARCHAR(20),
    college_id INT REFERENCES colleges(id) ON DELETE CASCADE,
    branch VARCHAR(255),
    year VARCHAR(20),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- 4. Evaluations Table
-- ============================================
CREATE TABLE evaluations (
    id SERIAL PRIMARY KEY,
    student_id INT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    interviewer_id INT REFERENCES users(id) ON DELETE SET NULL,
    total_score INT NOT NULL DEFAULT 0,
    recommendation VARCHAR(50) NOT NULL,

    -- Self Introduction & Communication (15 marks)
    score_self_intro INT DEFAULT 0,
    score_communication INT DEFAULT 0,
    score_confidence INT DEFAULT 0,

    -- Technical Knowledge (40 marks)
    score_programming INT DEFAULT 0,
    score_oops INT DEFAULT 0,
    score_dsa INT DEFAULT 0,
    score_core_subject INT DEFAULT 0,

    -- Problem Solving (20 marks)
    score_logical INT DEFAULT 0,
    score_approach INT DEFAULT 0,

    -- HR Evaluation (25 marks)
    score_hr_handling INT DEFAULT 0,
    score_strengths INT DEFAULT 0,
    score_attitude INT DEFAULT 0,
    score_career INT DEFAULT 0,

    -- Feedback
    strengths_text TEXT,
    improvements TEXT,
    comments TEXT,

    -- Email tracking
    email_sent BOOLEAN DEFAULT FALSE,
    email_sent_at TIMESTAMP,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- Indexes for performance
-- ============================================
CREATE INDEX idx_students_college_id ON students(college_id);
CREATE INDEX idx_evaluations_student_id ON evaluations(student_id);
CREATE INDEX idx_evaluations_interviewer_id ON evaluations(interviewer_id);
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_assigned_college ON users(assigned_college_id);
