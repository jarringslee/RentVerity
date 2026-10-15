-- 会话已读游标：按用户统计对方发来的未读条数
-- 在与 server/.env 中 DB_NAME 一致的数据库连接上执行；新环境建议库名 rentverity。

CREATE TABLE IF NOT EXISTS chat_user_state (
  user_id INT UNSIGNED NOT NULL,
  conversation_id BIGINT UNSIGNED NOT NULL,
  last_read_message_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id, conversation_id),
  KEY idx_state_user (user_id),
  CONSTRAINT fk_chat_state_conv FOREIGN KEY (conversation_id) REFERENCES chat_conversations (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 历史数据：双方已读位置设为当前会话最大消息 id（避免上线后整段历史都算未读）
INSERT IGNORE INTO chat_user_state (user_id, conversation_id, last_read_message_id)
SELECT c.user_low, c.id, COALESCE((SELECT MAX(m.id) FROM chat_messages m WHERE m.conversation_id = c.id), 0)
FROM chat_conversations c;

INSERT IGNORE INTO chat_user_state (user_id, conversation_id, last_read_message_id)
SELECT c.user_high, c.id, COALESCE((SELECT MAX(m.id) FROM chat_messages m WHERE m.conversation_id = c.id), 0)
FROM chat_conversations c;
