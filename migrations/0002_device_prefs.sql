-- Language choices synced between devices: JSON { uiLang, secondLang, questionLang, updated }.
-- Each device stores its own; the app applies the most recently updated one.
ALTER TABLE devices ADD COLUMN prefs TEXT NOT NULL DEFAULT '{}';
