-- Add 'title' column to expenses table
ALTER TABLE expenses ADD COLUMN title text;

-- Optional: If you want to enforce it at DB level for FUTURE rows (since you cleared DB, safe to do)
-- ALTER TABLE expenses ALTER COLUMN title SET NOT NULL;
