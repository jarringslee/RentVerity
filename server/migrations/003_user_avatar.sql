-- 用户头像：存相对路径，如 /uploads/avatars/1-1730000000000.jpg
USE xian_rent;

ALTER TABLE users
  ADD COLUMN avatar_url VARCHAR(512) NULL DEFAULT NULL COMMENT '头像 URL 相对路径' AFTER city;
