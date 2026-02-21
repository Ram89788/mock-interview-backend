-- ============================================
-- Migration 003: College Role, Batches, Recommendation Type
-- ============================================

-- 1. Update users table to allow 'college' role
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'interviewer', 'college'));

-- 2. Add college_id column to users for college-role users
-- (reusing existing assigned_college_id column for college users as well)

-- 3. Create batches table
CREATE TABLE IF NOT EXISTS batches (
    id SERIAL PRIMARY KEY,
    batch_name VARCHAR(255) NOT NULL,
    college_id INT NOT NULL REFERENCES colleges(id) ON DELETE CASCADE,
    year VARCHAR(20),
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 4. Add batch_id to students table
ALTER TABLE students ADD COLUMN IF NOT EXISTS batch_id INT REFERENCES batches(id) ON DELETE SET NULL;

-- 5. Add recommendation_type to evaluations (normalized classification)
ALTER TABLE evaluations ADD COLUMN IF NOT EXISTS recommendation_type VARCHAR(30);

-- 6. Backfill recommendation_type from total_score for existing evaluations
UPDATE evaluations SET recommendation_type = 
    CASE 
        WHEN total_score >= 85 THEN 'Highly Recommended'
        WHEN total_score >= 70 THEN 'Recommended'
        ELSE 'Not Recommended'
    END
WHERE recommendation_type IS NULL;

-- 7. Indexes
CREATE INDEX IF NOT EXISTS idx_batches_college_id ON batches(college_id);
CREATE INDEX IF NOT EXISTS idx_students_batch_id ON students(batch_id);
CREATE INDEX IF NOT EXISTS idx_evaluations_recommendation_type ON evaluations(recommendation_type);
CREATE INDEX IF NOT EXISTS idx_users_college_role ON users(role, assigned_college_id);
