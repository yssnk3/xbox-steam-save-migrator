import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const STORE_PATH = path.join(__dirname, '..', 'custom_games.json');

/**
 * User-defined custom games — persisted to custom_games.json.
 * Lets users register games not in the built-in GAME_DATABASE so they get
 * scanned and migrated like preset games.
 */

function ensureStore() {
  if (!fs.existsSync(STORE_PATH)) {
    fs.writeFileSync(STORE_PATH, '[]', 'utf8');
  }
}

export function getCustomGames() {
  ensureStore();
  try {
    const raw = fs.readFileSync(STORE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function addCustomGame(game) {
  const games = getCustomGames();
  const id = game.id || `custom-${Date.now()}`;
  const entry = {
    id,
    name: game.name,
    steamAppId: game.steamAppId || '',
    steamSaveRelPath: game.steamSaveRelPath || '',
    xboxPackageName: game.xboxPackageName || '',
    category: game.category || 'A',
    saveFilePattern: game.saveFilePattern || '*',
    notes: game.notes || '用户自定义游戏',
    isCustom: true,
  };
  games.push(entry);
  fs.writeFileSync(STORE_PATH, JSON.stringify(games, null, 2), 'utf8');
  return entry;
}

export function deleteCustomGame(id) {
  const games = getCustomGames().filter(g => g.id !== id);
  fs.writeFileSync(STORE_PATH, JSON.stringify(games, null, 2), 'utf8');
  return true;
}
