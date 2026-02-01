-- 1. Create Categories Reference Table
CREATE TABLE ref_categories (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- 2. Insert Default Categories
INSERT INTO ref_categories (name) VALUES 
('交通費'),
('餐飲費'),
('住宿費'),
('交際費'),
('辦公雜支'),
('其他');

-- 3. Add category_id to expenses table
ALTER TABLE expenses ADD COLUMN category_id uuid REFERENCES ref_categories(id);

-- Optional: Enable RLS for ref_categories if you want to protect it, 
-- but for now assuming public read/write if you want to keep it simple like other ref tables
ALTER TABLE ref_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable read access for all users" ON ref_categories
FOR SELECT USING (true);

CREATE POLICY "Enable insert access for all users" ON ref_categories
FOR INSERT WITH CHECK (true);
