-- 房源地图坐标（百度 BD-09）
-- 在与 server/.env 中 DB_NAME 一致的数据库连接上执行；新环境建议库名 rentverity。

ALTER TABLE houses
  ADD COLUMN lng DECIMAL(10, 6) NULL DEFAULT NULL COMMENT '经度 BD-09' AFTER location,
  ADD COLUMN lat DECIMAL(10, 6) NULL DEFAULT NULL COMMENT '纬度 BD-09' AFTER lng;

-- 已有数据：在西安市区范围内按 id 散开，避免全部重叠（新发布请用真实坐标或地理编码）
UPDATE houses
SET
  lng = 108.920 + (id % 20) * 0.006,
  lat = 34.230 + (id % 15) * 0.005
WHERE lng IS NULL OR lat IS NULL;
