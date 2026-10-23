/**
 * Player identity options. Colours avoid the enemy reds/purples; every colour
 * also has a sigil so colour is never the only way to tell players apart.
 */
export const PLAYER_COLORS = Object.freeze([
  { key: 'cyan', hex: 0x00f3ff, css: '#00f3ff', sigil: '◆' },
  { key: 'lime', hex: 0xb6ff3b, css: '#b6ff3b', sigil: '▲' },
  { key: 'amber', hex: 0xffb020, css: '#ffb020', sigil: '●' },
  { key: 'ice', hex: 0xe8f6ff, css: '#e8f6ff', sigil: '■' },
  { key: 'blue', hex: 0x3d7bff, css: '#3d7bff', sigil: '✚' },
  { key: 'mint', hex: 0x3dffb0, css: '#3dffb0', sigil: '★' },
  { key: 'orange', hex: 0xff7a3d, css: '#ff7a3d', sigil: '⬢' },
  { key: 'rose', hex: 0xff9ad5, css: '#ff9ad5', sigil: '✦' },
]);

export const colorByKey = (key) => PLAYER_COLORS.find((c) => c.key === key) ?? PLAYER_COLORS[0];

const FIRST = ['صقر', 'شبح', 'ظل', 'نسر', 'برق', 'ذئب', 'نجم', 'سهم', 'فهد', 'طيف'];
const SECOND = ['النيون', 'الثانية', 'الساعة', 'الزمن', 'الليل', 'الفضاء', 'الشفق', 'المتاهة'];

export function randomName() {
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  return `${pick(FIRST)} ${pick(SECOND)}`;
}

/** Trims, strips markup/control characters and limits length. Falls back to a random name. */
export function sanitizeName(raw) {
  const clean = String(raw ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 16);
  return clean.length >= 2 ? clean : randomName();
}

/** Room codes avoid look-alike characters (0/O, 1/I). */
export function randomRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 4; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

export const normalizeRoomCode = (raw) =>
  String(raw ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 6);
