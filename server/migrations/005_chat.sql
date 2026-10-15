-- 在线聊天：会话、消息；房源发布者 owner_user_id 用于「联系房东」
-- 在与 server/.env 中 DB_NAME 一致的数据库连接上执行；新环境建议库名 rentverity。

ALTER TABLE houses
  ADD COLUMN owner_user_id INT NULL DEFAULT NULL COMMENT '发布者用户ID' AFTER landlord_phone;

CREATE TABLE IF NOT EXISTS chat_conversations (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  house_id INT NULL,
  house_id_key INT NOT NULL DEFAULT 0 COMMENT '无房源会话为 0，否则等于 house_id',
  user_low INT UNSIGNED NOT NULL,
  user_high INT UNSIGNED NOT NULL,
  last_message_at DATETIME(3) NULL,
  last_message_preview VARCHAR(255) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uk_chat_conv (user_low, user_high, house_id_key),
  KEY idx_chat_user_low (user_low),
  KEY idx_chat_user_high (user_high)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS chat_messages (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  conversation_id BIGINT UNSIGNED NOT NULL,
  sender_id INT UNSIGNED NOT NULL,
  content TEXT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_msg_conv_time (conversation_id, id),
  CONSTRAINT fk_msg_conv FOREIGN KEY (conversation_id) REFERENCES chat_conversations (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
