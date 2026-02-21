-- ============================================
-- Migration 004: Interviewer-Batch Assignment
-- Allows assigning specific batches to interviewers
-- so they only see students from assigned batches
-- ============================================

-- 1. Create junction table for interviewer-batch many-to-many relationship
CREATE TABLE IF NOT EXISTS interviewer_batches (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    batch_id INT NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, batch_id)
);

-- 2. Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_interviewer_batches_user_id ON interviewer_batches(user_id);
CREATE INDEX IF NOT EXISTS idx_interviewer_batches_batch_id ON interviewer_batches(batch_id);
