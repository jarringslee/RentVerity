-- 用户头像：存相对路径，如 /uploads/avatars/1-1730000000000.jpg
-- 在与 server/.env 中 DB_NAME 一致的数据库连接上执行；新环境建议库名 rentverity。

ALTER TABLE users
  ADD COLUMN avatar_url VARCHAR(512) NULL DEFAULT NULL COMMENT '头像 URL 相对路径' AFTER city;
