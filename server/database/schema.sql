-- 仅供新建的空数据库；完整快照已包含历史迁移 002—006，不再重复执行它们。
-- 不指定 USE、不建库、不 DROP、不修改现有数据；由 db:init 检查目标为空后逐条执行。
CREATE TABLE users (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(50) NOT NULL,
  phone VARCHAR(20) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  gender VARCHAR(10) NULL,
  city VARCHAR(64) NULL,
  preference VARCHAR(64) NULL,
  preferences_json TEXT NULL,
  avatar_url VARCHAR(512) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uk_users_username (username),
  UNIQUE KEY uk_users_phone (phone)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE houses (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(120) NOT NULL,
  city VARCHAR(64) NULL COMMENT '标准城市名；旧地址不明确时不猜测',
  house_type VARCHAR(16) NULL COMMENT '结构化房型；NULL 为旧数据未知',
  price INT UNSIGNED NOT NULL,
  location VARCHAR(255) NOT NULL,
  lng DECIMAL(10,6) NULL COMMENT '百度 BD-09，NULL 为无坐标',
  lat DECIMAL(10,6) NULL COMMENT '百度 BD-09，示例点不代表真实房源',
  description TEXT NOT NULL,
  image VARCHAR(255) NOT NULL DEFAULT '/images/houses/house-1.jpg',
  tags VARCHAR(255) NULL,
  risk_level VARCHAR(16) NULL DEFAULT NULL COMMENT '仅兼容旧表，非 AI 评分，不对外展示',
  area INT UNSIGNED NULL,
  floor VARCHAR(40) NOT NULL DEFAULT '',
  orientation VARCHAR(40) NOT NULL DEFAULT '',
  landlord_name VARCHAR(50) NOT NULL DEFAULT '房东',
  landlord_phone VARCHAR(20) NOT NULL DEFAULT '',
  owner_user_id INT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_house_created (created_at, id),
  KEY idx_house_price (price, id),
  KEY idx_house_city_price (city, price, id),
  KEY idx_house_owner (owner_user_id),
  CONSTRAINT fk_house_owner FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE favorites (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  house_id INT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uk_favorites_user_house (user_id, house_id),
  KEY idx_favorite_house (house_id),
  CONSTRAINT fk_favorite_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_favorite_house FOREIGN KEY (house_id) REFERENCES houses(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE chat_conversations (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  house_id INT UNSIGNED NULL,
  house_id_key INT UNSIGNED NOT NULL DEFAULT 0,
  user_low INT UNSIGNED NOT NULL,
  user_high INT UNSIGNED NOT NULL,
  last_message_at DATETIME(3) NULL,
  last_message_preview VARCHAR(255) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uk_chat_conv (user_low, user_high, house_id_key),
  KEY idx_chat_user_high (user_high),
  KEY idx_chat_house (house_id),
  CONSTRAINT fk_conv_low FOREIGN KEY (user_low) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_conv_high FOREIGN KEY (user_high) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_conv_house FOREIGN KEY (house_id) REFERENCES houses(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE chat_messages (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  conversation_id BIGINT UNSIGNED NOT NULL,
  sender_id INT UNSIGNED NOT NULL,
  content TEXT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_msg_conv_time (conversation_id, id),
  KEY idx_msg_sender (sender_id),
  CONSTRAINT fk_msg_conv FOREIGN KEY (conversation_id) REFERENCES chat_conversations(id) ON DELETE CASCADE,
  CONSTRAINT fk_msg_sender FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE chat_user_state (
  user_id INT UNSIGNED NOT NULL,
  conversation_id BIGINT UNSIGNED NOT NULL,
  last_read_message_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id, conversation_id),
  CONSTRAINT fk_state_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_chat_state_conv FOREIGN KEY (conversation_id) REFERENCES chat_conversations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
