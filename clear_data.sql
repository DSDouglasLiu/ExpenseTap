-- 此指令用於清空所有「消費紀錄」與「附件連結」，但不影響身份、名片、朋友等基本資料。

-- 1. 清空附件關聯表
TRUNCATE TABLE expense_attachments CASCADE;

-- 2. 清空消費紀錄表
TRUNCATE TABLE expenses CASCADE;

-- 注意：此操作無法復原。
-- 另外，Supabase Storage 中的實體圖片檔案不會自動刪除。
-- 若要清空圖片，請至 Supabase Dashboard > Storage > receipts bucket 中手動刪除所有檔案。
