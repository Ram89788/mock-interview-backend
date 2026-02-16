-- ============================================
-- Migration 002: Multi-College Assignment
-- Allows interviewers to be assigned to multiple colleges
-- ============================================

-- 1. Create junction table for interviewer-college many-to-many relationship
CREATE TABLE IF NOT EXISTS interviewer_colleges (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    college_id INT NOT NULL REFERENCES colleges(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, college_id)
);

-- 2. Migrate existing assigned_college_id data into the junction table
INSERT INTO interviewer_colleges (user_id, college_id)
SELECT id, assigned_college_id
FROM users
WHERE role = 'interviewer' AND assigned_college_id IS NOT NULL
ON CONFLICT (user_id, college_id) DO NOTHING;

-- 3. Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_interviewer_colleges_user_id ON interviewer_colleges(user_id);
CREATE INDEX IF NOT EXISTS idx_interviewer_colleges_college_id ON interviewer_colleges(college_id);

-- Note: We keep the assigned_college_id column for backwards compatibility
-- but it will no longer be used by the application.
-- You can optionally drop it later:
-- ALTER TABLE users DROP COLUMN assigned_college_id;
