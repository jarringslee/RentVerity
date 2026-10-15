-- 扩展用户资料：性别、所在市、多选个人偏好（JSON）
-- 在 MySQL 中执行一次（若列已存在会报错，可忽略对应语句）

-- 在与 server/.env 中 DB_NAME 一致的数据库连接上执行；新环境建议库名 rentverity。

ALTER TABLE users
  ADD COLUMN gender VARCHAR(10) NULL DEFAULT NULL COMMENT 'male / female' AFTER phone,
  ADD COLUMN city VARCHAR(64) NULL DEFAULT NULL AFTER gender,
  ADD COLUMN preferences_json TEXT NULL DEFAULT NULL COMMENT 'JSON string array of preference keys' AFTER preference;

-- 将旧版单选 preference 迁移为多选 JSON（可选）
UPDATE users
SET preferences_json = JSON_ARRAY(preference)
WHERE preference IS NOT NULL
  AND TRIM(preference) <> ''
  AND (preferences_json IS NULL OR preferences_json = '' OR preferences_json = 'null');
