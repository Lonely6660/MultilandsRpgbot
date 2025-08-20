// Database schema updates for auto RP and character selection

const userSettingsTable = `
CREATE TABLE IF NOT EXISTS user_settings (
  user_id VARCHAR(255) PRIMARY KEY,
  auto_rp_enabled BOOLEAN DEFAULT FALSE,
  auto_rp_character_id INTEGER REFERENCES characters(id),
  auto_rp_character_name VARCHAR(255),
  auto_rp_character_avatar TEXT,
  selected_character_id INTEGER REFERENCES characters(id),
  selected_character_name VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
`;

const characterSelectionUpdate = `
-- Add selected character tracking to user_settings
-- This replaces the old set_default functionality
`;

const autoRPTriggerTable = `
-- Optional: Add message tracking for auto RP
CREATE TABLE IF NOT EXISTS auto_rp_messages (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL,
  channel_id VARCHAR(255) NOT NULL,
  message_id VARCHAR(255) NOT NULL,
  character_name VARCHAR(255),
  original_content TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
`;

module.exports = {
  userSettingsTable,
  characterSelectionUpdate,
  autoRPTriggerTable
};
