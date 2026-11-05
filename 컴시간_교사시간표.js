// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: blue; icon-glyph: chalkboard-teacher;

/**
 * 컴시간 교사 시간표 위젯 — 홈 화면 위젯(중간 크기) + 탭하면 열리는 확대 화면
 *
 * 처음 설정
 *  1) 이 스크립트를 실행하면 설정 화면이 열립니다. 학교 코드를 넣고 선생님을 고른 뒤
 *     교시 시각을 확인하고 저장합니다. (학교 코드는 컴시간알리미 앱이나
 *     컴시간교사.kr에서 학교를 검색하면 나옵니다.)
 *  2) 홈 화면에 Scriptable 위젯을 "중간 크기"로 추가하고 이 스크립트를 선택합니다.
 *
 * 사용
 *  - 위젯을 탭하면 주간/반별 시간표가 열립니다. 학교·선생님·교시 설정과 테마 색은
 *    확대 화면 맨 아래 ⚙ 설정에서 바꿉니다.
 *  - 설정은 iCloud의 Scriptable 폴더에 "컴시간_설정.json"으로 저장되어, 같은 iCloud를 쓰는
 *    아이폰·아이패드가 함께 씁니다. 새 버전 스크립트로 덮어써도 설정은 그대로입니다.
 *  - "오류 ›" 표시가 뜨면 확대 화면에서 눌러 원인과 해결 방법을 볼 수 있습니다.
 *    "⚠ 오프라인"은 인터넷 연결 문제라 기다리면 됩니다.
 *  - (선택) 위젯 편집의 Parameter에 교사 번호를 적으면 그 선생님 시간표를 보여줍니다.
 *  - (선택) 단축어의 "스크립트 실행" 입력을 텍스트 silent-refresh로 주면 화면 없이 자료만 갱신합니다.
 *
 * 참고: 컴시간은 공식 API가 없어 사이트가 크게 바뀌면 동작이 멈출 수 있고, 사이트가
 * http라 통신 내용이 암호화되지 않습니다.
 */

// ===== 내부 상수 =====
const HOST = 'http://comci.net:4082';
const SC_PREFIX = '70909_';
const DATA_PATH = '/662119_T';
const ENDPOINT_FILE_NAME = 'endpoint.json';
const SCRIPT_VERSION = '2026-11-05';
const UPDATE_INFO_URL = 'https://raw.githubusercontent.com/qdx167/comcigan-widget/main/version.json';
const UPDATE_CHECK_FILE_NAME = 'update-check.json';
const UPDATE_CHECK_INTERVAL_HOURS = 24;
const UPDATE_RETRY_HOURS = 3;
const UPDATE_TIMEOUT_SEC = 5;
const UPDATE_MAX_BYTES = 4096;
const UPDATE_TEXT_MAX = 200;
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';
const REQUEST_TIMEOUT_SEC = 10;
const MAX_RESPONSE_BYTES = 20 * 1000 * 1000;
const CACHE_DIR_NAME = 'comcigan-cache';
const PREFS_FILE_NAME = 'prefs.json';
const HEARTBEAT_FILE_NAME = 'widget-heartbeat.json';
const HEARTBEAT_STALE_MINUTES = 5;
const WEEKDAY_KO = ['일', '월', '화', '수', '목', '금', '토'];

const COLUMN_GAP = 4;
const PERIOD_LAYOUT = {
  6: { pnumFont: 10.5, subjFont: 16.5, clsFont: 13.5 },
  7: { pnumFont: 9.5, subjFont: 14.5, clsFont: 12.5 },
};
const PERIOD_LAYOUT_IPAD = {
  6: { pnumFont: 9.5, subjFont: 14.5, clsFont: 12 },
  7: { pnumFont: 8.5, subjFont: 13, clsFont: 11 },
};

// 기기별 위젯 크기(pt)·여백. 키는 Device.screenResolution()의 "짧은변x긴변"(px). 없는 기기는 근사치로 그림.
const DEVICE_WIDGET_PROFILES = {
  '1170x2532': { // iPhone 12/13/14
    widgetWidth: 342,
    padding: { top: 20, left: 16, bottom: 18, right: 20 },
    periodLayout: PERIOD_LAYOUT,
  },
  '1206x2622': { // iPhone 18 Pro
    widgetWidth: 350,
    padding: { top: 17, left: 16, bottom: 18, right: 17 },
    periodLayout: PERIOD_LAYOUT,
  },
  '2064x2752': { // iPad Pro 13인치(M4)
    widgetWidth: 412,
    padding: { top: 22, left: 22, bottom: 22, right: 22 },
    periodLayout: PERIOD_LAYOUT_IPAD,
  },
};

function getDeviceProfile() {
  try {
    const r = Device.screenResolution();
    if (r && r.width && r.height) {
      const a = Math.min(r.width, r.height);
      const b = Math.max(r.width, r.height);
      const known = DEVICE_WIDGET_PROFILES[`${a}x${b}`];
      if (known) return known;
    }
  } catch (e) {}

  let screenWidth = 390;
  try {
    const size = Device.screenSize();
    if (size && size.width) screenWidth = size.width;
  } catch (e) {}
  let widgetWidth;
  if (screenWidth <= 375) widgetWidth = 333;
  else if (screenWidth <= 393) widgetWidth = 342;
  else if (screenWidth <= 414) widgetWidth = 364;
  else widgetWidth = 368;
  return {
    widgetWidth,
    padding: { top: 20, left: 16, bottom: 18, right: 20 },
    periodLayout: PERIOD_LAYOUT,
  };
}

function getWidgetContentWidth() {
  const profile = getDeviceProfile();
  const SAFETY_MARGIN = 2;
  return profile.widgetWidth - profile.padding.left - profile.padding.right - SAFETY_MARGIN;
}

function getWidgetTableWidth() {
  return getWidgetContentWidth();
}

function getWidgetColumnWidth(maxPeriod) {
  const totalGap = COLUMN_GAP * (maxPeriod - 1);
  const colWidth = (getWidgetTableWidth() - totalGap) / maxPeriod;
  return Math.max(26, colWidth);
}

// ===== 색 팔레트 =====
const BASE_PALETTE = {
  light: { bg: '#ffffff', card: '#f2f2f7', text: '#1c1c1e', sub: '#6e6e73' },
  dark: { bg: '#1c1c1e', card: '#2c2c2e', text: '#f2f2f7', sub: '#9a9a9e' },
};
const ACCENT_PALETTE = {
  blue: { light: { accent: '#0a66ff' }, dark: { accent: '#4d94ff' } },
  brown: { light: { accent: '#8a4b26' }, dark: { accent: '#b8672f' } },
  green: { light: { accent: '#1f6b4a' }, dark: { accent: '#2f9463' } },
};
const DARK_DIVIDER = { light: '#44464b', dark: '#5a5c62' };
const MARKER_HEX = '#ff3b30';
const ERROR_HEX = '#ff3b30';
const OFFLINE_HEX = '#b5580a';

// ===== 보안 / 방어적 코딩 헬퍼 =====

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

function sanitizeSchoolCode(code) {
  return String(code ?? '').replace(/[^0-9]/g, '');
}

function sanitizeWeekParam(r) {
  const n = String(r ?? '').replace(/[^0-9]/g, '');
  return n || '1';
}

function parseGradeClass(str) {
  const m = String(str ?? '').match(/^(\d{1,2})-(\d{1,3})$/);
  if (!m) return null;
  const grade = Number(m[1]);
  const cls = Number(m[2]);
  if (grade < 1 || grade > 6 || cls < 1 || cls > 99) return null;
  return { grade, cls };
}

function isValidSchoolData(data) {
  if (!data || typeof data !== 'object') return false;
  if (!Array.isArray(data['자료446'])) return false;
  if (!Array.isArray(data['자료492'])) return false;
  if (!Array.isArray(data['자료542'])) return false;
  if (!Array.isArray(data['자료481'])) return false;
  return true;
}

function safeArrayGet(arr, idx) {
  if (!Array.isArray(arr)) return undefined;
  if (typeof idx !== 'number' || idx < 0 || idx >= arr.length) return undefined;
  return arr[idx];
}

function classSourceArray(data) {
  const detailed = data['자료147'];
  if (Array.isArray(detailed) && detailed.length) return detailed;
  return Array.isArray(data['자료481']) ? data['자료481'] : [];
}

function countLeaves(node, acc) {
  if (Array.isArray(node)) {
    for (let i = 1; i < node.length; i++) countLeaves(node[i], acc);
  } else if (typeof node === 'number') {
    acc.num++;
  } else if (typeof node === 'string') {
    if (node.charAt(0) === '>') acc.gt++;
    else acc.str++;
  }
  return acc;
}

function normalizeSchoolData(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const teacherCount = Number(raw['교사수']);
  let names = null, subjects = null, teacherTable = null, updated = null;
  let classPlain = null, classMarked = null;
  let bestPlain = -1, bestMarked = -1;

  for (const key of Object.keys(raw)) {
    if (!/^자료\d+$/.test(key)) continue;
    const v = raw[key];
    if (typeof v === 'string') {
      if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(v)) updated = v;
      continue;
    }
    if (!Array.isArray(v) || v.length < 2) continue;
    const nested = Array.isArray(v[1]);
    if (!nested) {
      const strs = v.slice(1).filter((x) => typeof x === 'string').length;
      if (v[0] === '' && strs === v.length - 1 && (!teacherCount || v.length >= teacherCount)) names = v;
      else if (typeof v[0] === 'number' && strs === v.length - 1) subjects = v;
      continue;
    }
    if (teacherCount && v.length === teacherCount + 1 && v[0] === teacherCount) {
      teacherTable = v;
      continue;
    }
    const c = countLeaves(v, { num: 0, gt: 0, str: 0 });
    if (c.str > c.num) continue;
    if (c.gt > 0 && c.gt > bestMarked) { classMarked = v; bestMarked = c.gt; }
    else if (c.gt === 0 && c.num > bestPlain) { classPlain = v; bestPlain = c.num; }
  }

  const out = {};
  for (const key of Object.keys(raw)) {
    if (!/^자료\d+$/.test(key)) out[key] = raw[key];
  }
  if (names) out['자료446'] = names;
  if (subjects) out['자료492'] = subjects;
  if (teacherTable) out['자료542'] = teacherTable;
  if (updated) out['자료244'] = updated;
  const plain = classPlain || classMarked;
  if (plain) out['자료481'] = plain;
  if (classMarked || classPlain) out['자료147'] = classMarked || classPlain;
  return out;
}

// ===== 설정 (학교·선생님·교시) =====

const SETTINGS_FILE_NAME = '컴시간_설정.json';
const DEFAULT_PERIOD_TIMES = [
  { start: '09:00', end: '09:45' },
  { start: '09:55', end: '10:40' },
  { start: '10:50', end: '11:35' },
  { start: '11:45', end: '12:30' },
  { start: '13:40', end: '14:25' },
  { start: '14:35', end: '15:20' },
  { start: '15:30', end: '16:15' },
];

function blankSettings() {
  return {
    schoolCode: '',
    teacherId: 0,
    maxPeriod: 6,
    homeroomClass: '',
    schoolNameOverride: '',
    teacherNameOverride: '',
    periodTimes: DEFAULT_PERIOD_TIMES.map((p) => ({ start: p.start, end: p.end })),
    lunchAfterPeriod: 4,
  };
}

function cleanDisplayName(v) {
  return String(v ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 30);
}

function isTimeStr(v) {
  return typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
}

/** 파일이나 설정 화면에서 온 값 중 형식이 맞는 것만 남김. */
function sanitizeSettings(raw) {
  const s = blankSettings();
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const code = sanitizeSchoolCode(src.schoolCode);
  if (code.length >= 1 && code.length <= 8) s.schoolCode = code;
  const tid = Number(src.teacherId);
  if (Number.isInteger(tid) && tid >= 0 && tid <= 5000) s.teacherId = tid;
  if (Number(src.maxPeriod) === 7) s.maxPeriod = 7;
  if (parseGradeClass(src.homeroomClass)) s.homeroomClass = String(src.homeroomClass);
  s.schoolNameOverride = cleanDisplayName(src.schoolNameOverride);
  s.teacherNameOverride = cleanDisplayName(src.teacherNameOverride);
  if (Array.isArray(src.periodTimes)) {
    for (let i = 0; i < s.periodTimes.length; i++) {
      const p = src.periodTimes[i];
      if (p && isTimeStr(p.start) && isTimeStr(p.end)) s.periodTimes[i] = { start: p.start, end: p.end };
    }
  }
  const lunch = Number(src.lunchAfterPeriod);
  if (Number.isInteger(lunch) && lunch >= 0 && lunch < s.maxPeriod) s.lunchAfterPeriod = lunch;
  return s;
}

/** 저장 전에 확인할 것. 문제가 있으면 사람이 읽을 문장을, 없으면 null. */
function settingsProblem(s, school) {
  if (!s.schoolCode) return '학교 코드를 입력해주세요.';
  if (!school || school.code !== s.schoolCode) return '학교 코드 옆의 "확인"을 눌러 학교를 먼저 확인해주세요.';
  if (!school.teachers.some((t) => t[0] === s.teacherId)) return '선생님을 골라주세요.';
  let prevEnd = -1;
  for (let i = 0; i < s.maxPeriod; i++) {
    const start = timeStrToMinutes(s.periodTimes[i].start);
    const end = timeStrToMinutes(s.periodTimes[i].end);
    if (start == null || end == null || end <= start) return `${i + 1}교시 끝나는 시각이 시작 시각보다 늦어야 해요.`;
    if (start < prevEnd) return `${i + 1}교시가 ${i}교시보다 먼저 시작해요. 시각을 확인해주세요.`;
    prevEnd = end;
  }
  return null;
}

function configFromSettings(s) {
  return {
    SCHOOL_CODE: s.schoolCode,
    TEACHER_ID: s.teacherId,
    MAX_PERIOD: s.maxPeriod,
    HOMEROOM_CLASS: s.homeroomClass,
    SCHOOL_NAME_OVERRIDE: s.schoolNameOverride,
    TEACHER_NAME_OVERRIDE: s.teacherNameOverride,
    PERIOD_TIMES: s.periodTimes,
    LUNCH_AFTER_PERIOD: s.lunchAfterPeriod,
  };
}

let SETTINGS = blankSettings();
let CONFIG = configFromSettings(SETTINGS);

/** iCloud를 쓰면 iCloud의 Scriptable 폴더, 아니면 이 기기의 Scriptable 폴더. */
function settingsFileManager() {
  try {
    const f = FileManager.iCloud();
    f.documentsDirectory();
    return f;
  } catch (e) {
    return FileManager.local();
  }
}

async function loadSettings() {
  try {
    const f = settingsFileManager();
    const path = f.joinPath(f.documentsDirectory(), SETTINGS_FILE_NAME);
    if (typeof f.downloadFileFromiCloud === 'function') {
      try {
        await f.downloadFileFromiCloud(path);
      } catch (e) {}
    }
    if (!f.fileExists(path)) return null;
    return sanitizeSettings(JSON.parse(f.readString(path)));
  } catch (e) {
    return null;
  }
}

function saveSettings(s) {
  const f = settingsFileManager();
  f.writeString(f.joinPath(f.documentsDirectory(), SETTINGS_FILE_NAME), JSON.stringify(s, null, 2));
}

function applySettings(s) {
  SETTINGS = s;
  CONFIG = configFromSettings(s);
}

function currentTeacherId() {
  return Number(args.widgetParameter) || Number(CONFIG.TEACHER_ID) || 0;
}

function gradeOptionsFromData(data) {
  const classCounts = Array.isArray(data['학급수']) ? data['학급수'] : [];
  const out = [];
  for (let g = 1; g <= 6; g++) {
    const count = Number(classCounts[g]) || 0;
    if (count > 0 && count <= 50) out.push({ grade: g, count });
  }
  return out;
}

/** 설정 화면에 보여줄 학교 정보(이름, 선생님 목록, 반 목록, 컴시간에 등록된 교시 시작 시각). */
function schoolInfoFromData(code, data) {
  const names = Array.isArray(data['자료446']) ? data['자료446'] : [];
  const teachers = [];
  for (let i = 1; i < names.length; i++) {
    if (names[i]) teachers.push([i, String(names[i])]);
  }
  const starts = (Array.isArray(data['일과시간']) ? data['일과시간'] : []).map((v) => {
    const m = String(v).match(/\((\d{1,2}):(\d{2})\)/);
    return m ? `${m[1].padStart(2, '0')}:${m[2]}` : '';
  }).slice(0, 7);
  return {
    code,
    name: String(data['학교명'] || ''),
    region: String(data['지역명'] || ''),
    teachers,
    classes: gradeOptionsFromData(data),
    starts,
  };
}

// ===== 네트워크 / 캐시 =====

function endpointFilePath() {
  return fm().joinPath(cacheDir(), ENDPOINT_FILE_NAME);
}

function isValidEndpoint(ep) {
  return !!ep && /^\d{1,10}_$/.test(String(ep.prefix)) && /^\/\d{1,10}_T$/.test(String(ep.path));
}

function loadEndpoint() {
  try {
    const path = endpointFilePath();
    if (fm().fileExists(path)) {
      const ep = JSON.parse(fm().readString(path));
      if (isValidEndpoint(ep)) return { prefix: ep.prefix, path: ep.path };
    }
  } catch (e) {}
  return { prefix: SC_PREFIX, path: DATA_PATH };
}

function endpointFoundAt() {
  try {
    const path = endpointFilePath();
    if (fm().fileExists(path)) {
      const ep = JSON.parse(fm().readString(path));
      const t = Number(ep && ep.foundAt);
      if (isValidEndpoint(ep) && Number.isFinite(t) && t > 0) return t;
    }
  } catch (e) {}
  return 0;
}

function saveEndpoint(ep) {
  try {
    fm().writeString(endpointFilePath(), JSON.stringify({ prefix: ep.prefix, path: ep.path, foundAt: Date.now() }));
  } catch (e) {}
}

function extractEndpointFromPage(page) {
  let text = page;
  const blockRe = /\(function\(a,k\)\{[\s\S]*?\}\)\((\[\[[\s\S]*?\]\]),\s*(\d+)\)/g;
  let m;
  while ((m = blockRe.exec(page)) !== null) {
    try {
      const parts = JSON.parse(m[1]);
      const k = Number(m[2]);
      let s = '';
      for (const part of parts) {
        if (!Array.isArray(part)) continue;
        const b = String(part[1] || '');
        if (part[0]) { s += b; continue; }
        for (let j = 0; j + 4 <= b.length; j += 4) {
          s += String.fromCharCode(parseInt(b.substr(j, 4), 16) ^ ((k + (j / 4) * 13) & 255));
        }
      }
      text += '\n' + s;
    } catch (e) {}
  }
  const p = text.match(/sc_data\(\s*'(\d{1,10}_)'/);
  const d = text.match(/'\.\/(\d{1,10}_T)\?'/);
  if (!p || !d) return null;
  const ep = { prefix: p[1], path: '/' + d[1] };
  return isValidEndpoint(ep) ? ep : null;
}

async function discoverEndpoint() {
  const req = new Request(`${HOST}/th`);
  req.headers = { 'User-Agent': USER_AGENT };
  req.timeoutInterval = REQUEST_TIMEOUT_SEC;
  let bytes;
  try {
    bytes = (await req.load()).getBytes();
  } catch (e) {
    throw appError('offline', '컴시간 사이트에 연결하지 못했습니다.', errText(e));
  }
  const status = httpStatus(req);
  if (status >= 400) throw appError('server', '컴시간 사이트가 오류를 돌려주었습니다.', `HTTP ${status}`);
  if (!bytes || bytes.length > MAX_RESPONSE_BYTES) return null;
  let page = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    page += String.fromCharCode.apply(null, bytes.slice(i, i + 8192));
  }
  return extractEndpointFromPage(page);
}

function appError(code, message, detail) {
  const e = new Error(message);
  e.code = code;
  if (detail) e.detail = String(detail).slice(0, 500);
  return e;
}

function httpStatus(req) {
  try {
    return Number(req.response && req.response.statusCode) || 0;
  } catch (e) {
    return 0;
  }
}

function errText(e) {
  return e && e.message ? String(e.message) : String(e);
}

function classifyDataError(e, ep) {
  const where = `${ep.prefix} ${ep.path}`;
  if (e.code === 'school-code') return e;
  if (e.code === 'network') return appError('server', e.message, `${e.detail || ''} [${where}]`);
  return appError('site-changed', e.message, `${e.detail || ''} [${where}]`);
}

async function fetchSchoolData(schoolCode, r) {
  const ep = loadEndpoint();
  let firstErr;
  try {
    return await fetchSchoolDataWith(ep, schoolCode, r);
  } catch (e) {
    firstErr = e;
  }
  if (firstErr.code === 'config-school') throw firstErr;

  const found = await discoverEndpoint();
  if (!found) {
    throw appError('site-changed', '컴시간 사이트에서 시간표 요청 주소를 찾지 못했습니다.',
      `${firstErr.message} ${firstErr.detail || ''} [${ep.prefix} ${ep.path}]`);
  }
  if (found.prefix === ep.prefix && found.path === ep.path) throw classifyDataError(firstErr, ep);

  try {
    const data = await fetchSchoolDataWith(found, schoolCode, r);
    saveEndpoint(found);
    return data;
  } catch (e) {
    throw classifyDataError(e, found);
  }
}

async function fetchSchoolDataWith(ep, schoolCode, r) {
  const safeCode = sanitizeSchoolCode(schoolCode);
  if (!safeCode) {
    throw appError('config-school', '학교 코드가 비어있거나 올바르지 않습니다.');
  }
  const safeR = sanitizeWeekParam(r);

  const paramString = `${ep.prefix}${safeCode}_0_${safeR}`;
  const encoded = Data.fromString(paramString).toBase64String();
  const url = `${HOST}${ep.path}?${encoded}`;

  const req = new Request(url);
  req.headers = { 'User-Agent': USER_AGENT, 'Referer': `${HOST}/th` };
  req.timeoutInterval = REQUEST_TIMEOUT_SEC;

  let body;
  try {
    body = await req.loadString();
  } catch (e) {
    throw appError('network', '시간표 자료를 받지 못했습니다.', errText(e));
  }
  const status = httpStatus(req);
  if (status >= 400) throw appError('network', '시간표 자료를 받지 못했습니다.', `HTTP ${status}`);

  if (!body || typeof body !== 'string' || body.indexOf('{') === -1) {
    throw appError('bad-response', '서버 응답이 비어있습니다.');
  }
  if (body.length > MAX_RESPONSE_BYTES) {
    throw appError('bad-response', '서버 응답이 비정상적으로 큽니다.');
  }

  const jsonString = body.substring(0, body.lastIndexOf('}') + 1);
  let parsed;
  try {
    parsed = JSON.parse(jsonString);
  } catch (e) {
    throw appError('bad-response', '서버 응답을 해석하지 못했습니다.', errText(e));
  }
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && Object.keys(parsed).length === 0) {
    throw appError('school-code', '이 학교 코드로 등록된 학교가 없습니다.');
  }
  const data = normalizeSchoolData(parsed);
  if (!isValidSchoolData(data)) {
    const keys = parsed && typeof parsed === 'object' ? Object.keys(parsed).slice(0, 40).join(',') : typeof parsed;
    throw appError('bad-response', '시간표 자료의 형식이 예상과 다릅니다.', `keys: ${keys}`);
  }
  return data;
}

function fm() {
  return FileManager.local();
}

function cacheDir() {
  const f = fm();
  const dir = f.joinPath(f.libraryDirectory(), CACHE_DIR_NAME);
  if (!f.fileExists(dir)) f.createDirectory(dir);
  return dir;
}

function cacheFilePath(schoolCode, r) {
  return fm().joinPath(cacheDir(), `school_${sanitizeSchoolCode(schoolCode)}_r${sanitizeWeekParam(r)}.json`);
}

function prefsFilePath() {
  return fm().joinPath(cacheDir(), PREFS_FILE_NAME);
}

function heartbeatFilePath() {
  return fm().joinPath(cacheDir(), HEARTBEAT_FILE_NAME);
}

function writeHeartbeat() {
  try {
    fm().writeString(heartbeatFilePath(), JSON.stringify({ lastRenderedAt: Date.now() }));
  } catch (e) {}
}

function isHeartbeatStale(thresholdMinutes) {
  try {
    const path = heartbeatFilePath();
    if (!fm().fileExists(path)) return true;
    const raw = JSON.parse(fm().readString(path));
    const last = Number(raw && raw.lastRenderedAt);
    if (!last) return true;
    return (Date.now() - last) > thresholdMinutes * 60 * 1000;
  } catch (e) {
    return true;
  }
}

async function getWeekData(schoolCode, r) {
  const path = cacheFilePath(schoolCode, r);
  try {
    const data = await fetchSchoolData(schoolCode, r);
    const fetchedAt = Date.now();
    try {
      fm().writeString(path, JSON.stringify({ fetchedAt, data }));
    } catch (e) {}
    return { data, fetchedAt, fromCache: false };
  } catch (err) {
    if (fm().fileExists(path)) {
      try {
        const cached = JSON.parse(fm().readString(path));
        if (cached && isValidSchoolData(cached.data)) {
          return { data: cached.data, fetchedAt: cached.fetchedAt, fromCache: true, error: err };
        }
      } catch (e2) {}
    }
    throw err;
  }
}

// ===== 새 버전 알림 / 공지 =====
// GitHub의 version.json을 하루에 한 번 읽어 글자로만 보여준다. 받은 내용은 실행하거나 HTML로 해석하지 않는다.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const REMOTE_JUNK_RE = new RegExp('[' +
  '\\u0000-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u2028-\\u202e\\u2066-\\u2069\\ufeff' + ']+', 'g');

function updateCheckFilePath() {
  return fm().joinPath(cacheDir(), UPDATE_CHECK_FILE_NAME);
}

function cleanRemoteText(v) {
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string') return null;
  const s = v.replace(REMOTE_JUNK_RE, ' ').replace(/\s+/g, ' ').trim();
  return s.length <= UPDATE_TEXT_MAX ? s : null;
}

function cleanRemoteDate(v) {
  if (v === undefined || v === null || v === '') return '';
  return typeof v === 'string' && DATE_RE.test(v) ? v : null;
}

/** version.json 내용 검사. 하나라도 형식이 맞지 않으면 null. */
function parseUpdateInfo(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const latestVersion = typeof raw.latestVersion === 'string' && DATE_RE.test(raw.latestVersion) ? raw.latestVersion : null;
  const notes = cleanRemoteText(raw.notes);
  const notice = cleanRemoteText(raw.notice);
  const noticeUntil = cleanRemoteDate(raw.noticeUntil);
  if (latestVersion === null || notes === null || notice === null || noticeUntil === null) return null;
  return { latestVersion, notes, notice, noticeUntil };
}

function loadUpdateCheck() {
  try {
    const path = updateCheckFilePath();
    if (fm().fileExists(path)) {
      const s = JSON.parse(fm().readString(path));
      const checkedAt = Number(s && s.checkedAt);
      if (!Number.isFinite(checkedAt) || checkedAt <= 0) return null;
      const info = s.info ? parseUpdateInfo(s.info) : null;
      return { checkedAt, ok: s.ok === true && !!info, info };
    }
  } catch (e) {}
  return null;
}

function saveUpdateCheck(check) {
  try {
    fm().writeString(updateCheckFilePath(), JSON.stringify(check));
  } catch (e) {}
}

async function fetchUpdateInfo() {
  const req = new Request(UPDATE_INFO_URL);
  req.timeoutInterval = UPDATE_TIMEOUT_SEC;
  req.headers = { 'Cache-Control': 'no-cache' };
  const body = await req.loadString();
  const status = httpStatus(req);
  if (status >= 400) throw new Error(`HTTP ${status}`);
  if (typeof body !== 'string' || body.length > UPDATE_MAX_BYTES) throw new Error('응답 크기 이상');
  const info = parseUpdateInfo(JSON.parse(body));
  if (!info) throw new Error('형식 이상');
  return info;
}

/** 확대 화면을 열 때 부름. 마지막 확인 뒤 정해진 시간이 지났을 때만 요청하고, 실패해도 예외를 던지지 않는다. */
async function refreshUpdateCheck() {
  const prev = loadUpdateCheck();
  const now = Date.now();
  if (prev && now >= prev.checkedAt) {
    const waitHours = prev.ok ? UPDATE_CHECK_INTERVAL_HOURS : UPDATE_RETRY_HOURS;
    if (now - prev.checkedAt < waitHours * 3600 * 1000) return prev;
  }
  let next;
  try {
    next = { checkedAt: now, ok: true, info: await fetchUpdateInfo() };
  } catch (e) {
    next = { checkedAt: now, ok: false, info: prev ? prev.info : null };
  }
  saveUpdateCheck(next);
  return next;
}

function localDateStr(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function updateStatus(check) {
  const info = check ? check.info : null;
  const hasNew = !!info && info.latestVersion > SCRIPT_VERSION;
  const showNotice = !!info && !!info.notice && (!info.noticeUntil || localDateStr(Date.now()) <= info.noticeUntil);
  let label = '아직 확인 안 함';
  if (check) label = hasNew ? `새 버전 있음 (${info.latestVersion})` : (check.ok ? '최신 버전' : '확인 실패');
  return {
    checkedAt: check ? check.checkedAt : 0,
    label,
    hasNew,
    latestVersion: hasNew ? info.latestVersion : '',
    notes: hasNew ? info.notes : '',
    notice: showNotice ? info.notice : '',
  };
}

/** [항목, 값] — 설정 화면과 오류 내용에 함께 씀. */
function versionInfoRows(status) {
  const foundAt = endpointFoundAt();
  return [
    ['스크립트 버전', SCRIPT_VERSION],
    ['업데이트 확인', status.checkedAt ? `${formatTime(status.checkedAt)} · ${status.label}` : status.label],
    ['주소 정보 갱신', foundAt ? `${formatTime(foundAt)} (자동)` : '기본값 사용 중'],
  ];
}

function updateBannerHtml(status) {
  if (!status) return '';
  let html = '';
  if (status.notice) html += `<div class="remote-notice">📢 ${escapeHtml(status.notice)}</div>`;
  if (status.hasNew) {
    const notes = status.notes ? `<div class="update-notes">${escapeHtml(status.notes)}</div>` : '';
    html += `<div class="update-note"><b>새 버전이 있어요 (${escapeHtml(status.latestVersion)})</b> — 만든 사람에게 받아주세요${notes}</div>`;
  }
  return html;
}

const UPDATE_CSS = `
  .remote-notice, .update-note{ font-size:12px; line-height:1.5; padding:9px 11px; border-radius:8px; margin-top:10px; }
  .remote-notice{ color:var(--warn); background:var(--warn-bg); }
  .update-note{ color:var(--text); background:var(--card); }
  .update-note b{ color:var(--accent); }
  .update-notes{ color:var(--sub); font-size:11.5px; margin-top:3px; }
  .update-wrap{ margin-bottom:18px; }
  .update-wrap > :first-child{ margin-top:0; }
  .settings-group.version-info{ font-size:11px; line-height:1.7; color:var(--sub); text-align:center; margin:22px 0 0; }
`;

// ===== 오류 안내 =====

const ERROR_INFO = {
  'offline': {
    title: '인터넷에 연결되지 않았어요',
    summary: '인터넷 연결이 없거나 컴시간 사이트에 접속할 수 없습니다.',
    fix: 'wait',
    steps: ['인터넷 연결을 확인한 뒤 ↻ 버튼으로 다시 시도해주세요.'],
  },
  'server': {
    title: '컴시간 서버가 응답하지 않아요',
    summary: '컴시간 사이트에는 접속되지만 시간표 자료를 받지 못했습니다. 서버 점검 중이거나 일시적인 문제일 수 있어요.',
    fix: 'wait',
    steps: [
      '잠시 후 ↻ 버튼으로 다시 시도해주세요.',
      '하루 넘게 계속되면 아래 "오류 내용 보내기"를 눌러 만든 사람에게 보내주세요.',
    ],
  },
  'site-changed': {
    title: '컴시간 사이트가 바뀌었어요',
    summary: '컴시간 사이트가 개편되어 시간표를 읽는 방법을 자동으로 찾지 못했습니다.',
    fix: 'no',
    steps: [
      '스크립트 업데이트가 필요해요. 아래 "오류 내용 보내기"를 눌러 만든 사람에게 보내주세요.',
      '업데이트 전까지는 마지막으로 받아둔 시간표가 표시됩니다.',
    ],
  },
  'school-code': {
    title: '학교 코드를 찾을 수 없어요',
    summary: '저장된 학교 코드로 등록된 학교가 컴시간에 없습니다.',
    fix: 'yes',
    steps: [
      '설정 화면에서 학교 코드를 다시 확인해주세요.',
      '학교 코드는 컴시간알리미 앱이나 컴시간교사.kr에서 학교를 검색하면 나오는 숫자예요.',
    ],
  },
  'config-school': {
    title: '처음 설정이 필요해요',
    summary: '아직 학교와 선생님을 정하지 않았습니다.',
    fix: 'yes',
    steps: ['위젯을 탭하면 설정 화면이 열려요.'],
  },
  'config-teacher': {
    title: '선생님을 골라주세요',
    summary: '어느 선생님의 시간표를 보여줄지 아직 정하지 않았습니다.',
    fix: 'yes',
    steps: ['위젯을 탭하면 설정 화면이 열려요.'],
  },
  'teacher-id': {
    title: '선생님을 찾을 수 없어요',
    summary: '저장된 선생님이 지금 학교 시간표에 없습니다. 학교 시간표가 바뀌었을 수 있어요.',
    fix: 'yes',
    steps: [
      '위젯을 탭해 설정 화면에서 선생님을 다시 골라주세요.',
      '위젯 편집의 Parameter에 번호를 적었다면 지우거나 고쳐주세요.',
    ],
  },
  'widget-size': {
    title: '이 위젯 크기는 지원하지 않아요',
    summary: '이 스크립트는 중간(Medium) 크기 위젯만 지원합니다.',
    fix: 'yes',
    steps: ['위젯을 지우고 중간 크기(가로로 긴 직사각형)로 다시 추가해주세요.'],
  },
  'unknown': {
    title: '알 수 없는 오류가 생겼어요',
    summary: '예상하지 못한 문제가 발생했습니다.',
    fix: 'no',
    steps: ['아래 "오류 내용 보내기"를 눌러 만든 사람에게 보내주세요.'],
  },
};

const FIX_LABEL = {
  yes: '직접 고칠 수 있어요',
  wait: '기다리면 해결될 수 있어요',
  no: '직접 고칠 수 없어요 — 스크립트 업데이트가 필요해요',
};

function formatDateTime(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function buildErrorReport(err) {
  const code = err && Object.keys(ERROR_INFO).includes(err.code) ? err.code : 'unknown';
  const info = ERROR_INFO[code];
  const ep = loadEndpoint();
  const lines = [
    '[컴시간 위젯 오류]',
    `종류: ${code} (${info.title})`,
    `내용: ${errText(err)}`,
  ];
  if (err && err.detail) lines.push(`세부: ${err.detail}`);
  lines.push(
    `학교 코드: ${sanitizeSchoolCode(CONFIG.SCHOOL_CODE) || '-'}`,
    `요청 주소: ${ep.prefix} ${ep.path}`,
    ...versionInfoRows(updateStatus(loadUpdateCheck())).map(([k, v]) => `${k}: ${v}`),
    `발생 시각: ${formatDateTime(Date.now())}`,
  );
  return {
    code,
    title: info.title,
    summary: info.summary,
    fix: info.fix,
    steps: info.steps,
    text: lines.join('\n'),
  };
}

function isShownAsError(report) {
  return !!report && report.code !== 'offline';
}

function errorPanelHtml(report) {
  const steps = report.steps.map((s) => `<li>${escapeHtml(s)}</li>`).join('');
  return `<div class="err-title">${escapeHtml(report.title)}</div>
<div class="err-summary">${escapeHtml(report.summary)}</div>
<div class="err-fix err-fix-${escapeHtml(report.fix)}">${escapeHtml(FIX_LABEL[report.fix] || '')}</div>
<ol class="err-steps">${steps}</ol>
<div class="err-tech-label">오류 내용</div>
<pre class="err-tech">${escapeHtml(report.text)}</pre>
<div class="err-actions">
<button class="err-share" id="err-share-btn">오류 내용 보내기</button>
<button class="err-copy" id="err-copy-btn">오류 내용 복사</button>
</div>
<div class="err-copied" id="err-copied" hidden>복사했어요</div>`;
}

const ERROR_CSS = `
  .err-badge{
    display:inline-block; font-family:inherit; font-size:10.5px; font-weight:700; line-height:1.4;
    color:var(--err); background:none; border:1px solid var(--err); border-radius:5px;
    padding:0 6px; margin-right:6px; cursor:pointer; vertical-align:baseline;
  }
  .err-title{ font-size:18px; font-weight:700; color:var(--err); margin-bottom:8px; }
  .err-summary{ font-size:13px; line-height:1.5; margin-bottom:12px; }
  .err-fix{ display:inline-block; font-size:12px; font-weight:700; padding:4px 10px; border-radius:999px; margin-bottom:10px; }
  .err-fix-yes{ color:var(--accent); border:1px solid var(--accent); }
  .err-fix-wait{ color:var(--warn); border:1px solid var(--warn); }
  .err-fix-no{ color:var(--err); border:1px solid var(--err); }
  .err-steps{ font-size:13px; line-height:1.6; padding-left:20px; margin:0 0 14px; }
  .err-tech-label{ font-size:11px; font-weight:700; color:var(--sub); margin-bottom:6px; }
  .err-tech{ font-family:ui-monospace,Menlo,monospace; font-size:11px; line-height:1.5; white-space:pre-wrap; word-break:break-all;
    background:var(--card); border-radius:9px; padding:10px 12px; margin:0 0 12px; }
  .err-actions{ display:flex; gap:8px; }
  .err-share, .err-copy{ flex:1; font-family:inherit; font-size:14px; font-weight:700; padding:11px 0; border-radius:10px;
    border:1px solid var(--accent); cursor:pointer; }
  .err-share{ background:var(--accent); color:#fff; }
  .err-copy{ background:none; color:var(--accent); }
  .err-copied{ font-size:12px; color:var(--sub); text-align:center; margin-top:8px; }
`;

const DEFAULT_PREFS = {
  accent: 'blue',
  dividerStyle: 'bright',
  widgetAppearance: 'system',
  appAppearance: 'system',
  highlightChanged: true,
};

function sanitizePrefs(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = Object.assign({}, DEFAULT_PREFS);
  if (Object.keys(ACCENT_PALETTE).includes(src.accent)) out.accent = src.accent;
  if (['bright', 'normal', 'dark'].includes(src.dividerStyle)) out.dividerStyle = src.dividerStyle;
  if (['system', 'light', 'dark'].includes(src.widgetAppearance)) out.widgetAppearance = src.widgetAppearance;
  if (['system', 'light', 'dark'].includes(src.appAppearance)) out.appAppearance = src.appAppearance;
  if (typeof src.highlightChanged === 'boolean') out.highlightChanged = src.highlightChanged;
  return out;
}

function loadPrefs() {
  const path = prefsFilePath();
  if (!fm().fileExists(path)) return Object.assign({}, DEFAULT_PREFS);
  try {
    return sanitizePrefs(JSON.parse(fm().readString(path)));
  } catch (e) {
    return Object.assign({}, DEFAULT_PREFS);
  }
}

function savePrefs(prefs) {
  try {
    fm().writeString(prefsFilePath(), JSON.stringify(prefs));
  } catch (e) {}
}

// ===== 디코딩 =====

function mTh(mm, div) {
  return div === 100 ? Math.floor(mm / div) : mm % div;
}
function mSb(mm, div) {
  return div === 100 ? mm % div : Math.floor(mm / div);
}

function normalizeRaw(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  let changed = false;
  let num = raw;
  if (typeof raw === 'string') {
    if (raw.charAt(0) === '>') {
      changed = true;
      num = raw.slice(1);
    }
    num = Number(num);
  }
  if (typeof num !== 'number' || !isFinite(num) || num <= 0) return null;
  return { num, changed };
}

function decodeTeacherCell(data, raw) {
  const n = normalizeRaw(raw);
  if (!n) return null;
  const classCode = n.num % 1000;
  const grade = Math.floor(classCode / 100);
  const cls = classCode % 100;
  if (grade < 1 || grade > 6 || cls < 1 || cls > 99) return null;

  const division = Number(data['분리']) || 100;
  const subjRaw = Math.floor(n.num / 1000);
  const subjIdx = subjRaw % division;
  const subject = safeArrayGet(data['자료492'], subjIdx) || '';
  return { grade, cls, subject: String(subject), changed: n.changed };
}

function decodeClassCell(data, raw) {
  const n = normalizeRaw(raw);
  if (!n) return null;
  const division = Number(data['분리']) || 100;
  const teacherId = mTh(n.num, division);
  const subjIdx = mSb(n.num, division);
  const teacher = safeArrayGet(data['자료446'], teacherId);
  if (teacher === undefined) return null;
  const subject = safeArrayGet(data['자료492'], subjIdx) || '';
  return { teacher: String(teacher), subject: String(subject), changed: n.changed };
}

function teacherName(data, teacherId) {
  const name = safeArrayGet(data['자료446'], Number(teacherId));
  return name ? String(name) : `#${teacherId}`;
}

function displayTeacherName(data, teacherId) {
  const override = String(CONFIG.TEACHER_NAME_OVERRIDE || '').trim();
  return override || teacherName(data, teacherId);
}

function displaySchoolName(data) {
  const override = String(CONFIG.SCHOOL_NAME_OVERRIDE || '').trim();
  return override || String(data['학교명'] || '');
}

function getTeacherDay(data, teacherId, day, maxPeriod) {
  const result = [];
  const sched = safeArrayGet(data['자료542'], Number(teacherId));
  const dayArr = sched ? safeArrayGet(sched, day) : undefined;
  for (let p = 1; p <= maxPeriod; p++) {
    const raw = dayArr ? safeArrayGet(dayArr, p) : undefined;
    result.push({ period: p, decoded: decodeTeacherCell(data, raw) });
  }
  return result;
}

function extractWeekPayload(data, teacherId) {
  return {
    teacherSched: safeArrayGet(data['자료542'], Number(teacherId)) || [],
    classRaw: classSourceArray(data),
    homeroom: Array.isArray(data['담임']) ? data['담임'] : [],
    todayR: String(data['오늘r'] ?? ''),
    dateRanges: Array.isArray(data['일자자료']) ? data['일자자료'] : [],
    updatedServer: String(data['자료244'] || ''),
  };
}

// ===== 교시/마커 판정 (홈 화면 위젯 전용) =====

function timeStrToMinutes(str) {
  const m = String(str ?? '').match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function getActivePeriodTimes(maxPeriod) {
  const list = Array.isArray(CONFIG.PERIOD_TIMES) ? CONFIG.PERIOD_TIMES : [];
  const result = [];
  for (let p = 1; p <= maxPeriod; p++) {
    const entry = list[p - 1];
    const start = entry ? timeStrToMinutes(entry.start) : null;
    const end = entry ? timeStrToMinutes(entry.end) : null;
    result.push((start != null && end != null && end > start)
      ? { period: p, start, end, startStr: entry.start, endStr: entry.end }
      : null);
  }
  return result;
}

function computeMarkerInfo(periodTimes, lunchAfterPeriod) {
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const valid = periodTimes.filter(Boolean);
  if (valid.length === 0) return { target: null, text: '', mode: null, nextBoundaryMin: null };

  const first = valid[0];
  const last = valid[valid.length - 1];
  if (nowMin >= last.end) return { target: null, text: '', mode: null, nextBoundaryMin: null };

  for (const pt of valid) {
    if (nowMin >= pt.start && nowMin < pt.end) {
      return { target: pt.period, text: `${pt.period}교시 종료 ${pt.endStr}`, mode: 'column', column: pt.period, nextBoundaryMin: pt.end };
    }
  }

  let next = null;
  for (const pt of valid) {
    if (nowMin < pt.start) { next = pt; break; }
  }
  if (!next) return { target: null, text: '', mode: null, nextBoundaryMin: null };

  const beforeSchool = nowMin < first.start;
  const isLunchGap = !beforeSchool && (next.period - 1 === lunchAfterPeriod);

  if (isLunchGap) {
    return { target: next.period, text: `점심시간 종료 ${next.startStr}`, mode: 'boundary', boundaryAfter: lunchAfterPeriod, nextBoundaryMin: next.start };
  }
  if (beforeSchool) {
    return { target: null, text: '', mode: null, nextBoundaryMin: next.start };
  }
  return { target: next.period, text: `${next.period}교시 종료 ${next.endStr}`, mode: 'column', column: next.period, nextBoundaryMin: next.start };
}

// ===== 색상 해석 =====

function dyn(lightHex, darkHex, appearance) {
  if (appearance === 'light') return new Color(lightHex);
  if (appearance === 'dark') return new Color(darkHex);
  return Color.dynamic(new Color(lightHex), new Color(darkHex));
}

function dynAlpha(lightHex, darkHex, lightAlpha, darkAlpha, appearance) {
  if (appearance === 'light') return new Color(lightHex, lightAlpha);
  if (appearance === 'dark') return new Color(darkHex, darkAlpha);
  return Color.dynamic(new Color(lightHex, lightAlpha), new Color(darkHex, darkAlpha));
}

function buildColors(appearance, accentKey, dividerStyle) {
  const acc = ACCENT_PALETTE[accentKey] || ACCENT_PALETTE.blue;
  const bg = dyn(BASE_PALETTE.light.bg, BASE_PALETTE.dark.bg, appearance);
  const card = dyn(BASE_PALETTE.light.card, BASE_PALETTE.dark.card, appearance);
  const text = dyn(BASE_PALETTE.light.text, BASE_PALETTE.dark.text, appearance);
  const sub = dyn(BASE_PALETTE.light.sub, BASE_PALETTE.dark.sub, appearance);
  const accent = dyn(acc.light.accent, acc.dark.accent, appearance);
  const todaybg = dynAlpha(acc.light.accent, acc.dark.accent, 0.12, 0.28, appearance);
  const changedBg = dynAlpha('#b5580a', '#f2a34d', 0.16, 0.30, appearance);
  const changedDivider = dyn('#b5580a', '#f2a34d', appearance);
  let divider;
  if (dividerStyle === 'bright') divider = accent;
  else if (dividerStyle === 'dark') divider = dyn(DARK_DIVIDER.light, DARK_DIVIDER.dark, appearance);
  else divider = sub;
  return { bg, card, text, sub, accent, todaybg, changedBg, changedDivider, divider };
}

// ===== 위젯(홈 화면) 그리기 =====

function formatTime(ms) {
  if (!ms) return '-';
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}`;
}

function formatServerUpdated(raw) {
  if (!raw) return '-';
  const s = String(raw);
  const m = s.match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!m) return s;
  return `${Number(m[2])}/${Number(m[3])} ${m[4]}:${m[5]}`;
}

function centeredText(parent, text, font, color, width) {
  const row = parent.addStack();
  row.layoutHorizontally();
  row.size = new Size(width, 0);
  row.addSpacer();
  const t = row.addText(text);
  t.font = font;
  t.textColor = color;
  t.lineLimit = 1;
  t.minimumScaleFactor = 0.5;
  row.addSpacer();
  return t;
}
function centeredBar(parent, width, barWidth, barHeight, color) {
  const row = parent.addStack();
  row.layoutHorizontally();
  row.size = new Size(width, 0);
  row.addSpacer();
  const bar = row.addStack();
  bar.size = new Size(barWidth, barHeight);
  bar.backgroundColor = color;
  bar.cornerRadius = barHeight / 2;
  row.addSpacer();
}

function buildWidget(data, teacherId, prefs, meta) {
  const c = buildColors(prefs.widgetAppearance, prefs.accent, prefs.dividerStyle);
  const profile = getDeviceProfile();
  const w = new ListWidget();
  w.backgroundColor = c.bg;
  w.setPadding(profile.padding.top, profile.padding.left, profile.padding.bottom, profile.padding.right);

  const now = new Date();
  const jsDay = now.getDay();
  const isWeekend = jsDay === 0 || jsDay === 6;
  const name = displayTeacherName(data, teacherId);
  const schoolDisplay = displaySchoolName(data);

  const header = w.addStack();
  header.layoutHorizontally();
  header.topAlignContent();
  const who = header.addStack();
  who.layoutHorizontally();
  who.bottomAlignContent();
  who.spacing = 8;
  who.size = new Size(200, 0);
  const nameText = who.addText(`${name} 선생님`);
  nameText.font = Font.boldSystemFont(18);
  nameText.textColor = c.text;
  nameText.lineLimit = 1;
  if (schoolDisplay) {
    const schoolText = who.addText(schoolDisplay);
    schoolText.font = Font.systemFont(13);
    schoolText.textColor = c.sub;
    schoolText.lineLimit = 1;
  }
  header.addSpacer();
  const dateText = header.addText(`${now.getMonth() + 1}/${now.getDate()}(${WEEKDAY_KO[jsDay]})`);
  dateText.font = Font.systemFont(14);
  dateText.textColor = c.sub;
  dateText.lineLimit = 1;

  w.addSpacer(10);

  let marker = { target: null, text: '', mode: null, nextBoundaryMin: null };

  if (isWeekend) {
    w.addSpacer();
    const weekendRow = w.addStack();
    weekendRow.layoutHorizontally();
    weekendRow.size = new Size(getWidgetContentWidth(), 0);
    weekendRow.addSpacer();
    const weekendText = weekendRow.addText('🏖 주말이에요');
    weekendText.font = Font.systemFont(13);
    weekendText.textColor = c.sub;
    weekendRow.addSpacer();
    w.addSpacer();
  } else {
    const maxPeriod = (CONFIG.MAX_PERIOD === 7) ? 7 : 6;
    const layout = (profile.periodLayout || PERIOD_LAYOUT)[maxPeriod];
    const colWidth = getWidgetColumnWidth(maxPeriod);
    const rows = getTeacherDay(data, teacherId, jsDay, maxPeriod);

    const tableWidth = getWidgetTableWidth();
    const table = w.addStack();
    table.layoutHorizontally();
    table.size = new Size(tableWidth, 0);
    table.spacing = COLUMN_GAP;

    rows.forEach((row) => {
      const col = table.addStack();
      col.layoutVertically();
      col.topAlignContent();
      col.size = new Size(colWidth, 0);
      col.spacing = 6;

      centeredText(col, String(row.period), Font.heavySystemFont(layout.pnumFont), c.sub, colWidth);

      const cell = col.addStack();
      cell.layoutVertically();
      cell.size = new Size(colWidth, 0);
      cell.cornerRadius = 8;
      cell.setPadding(6, 1, 6, 1);
      cell.spacing = 3;

      const innerWidth = colWidth - 2;
      if (row.decoded) {
        const isChanged = row.decoded.changed && prefs.highlightChanged !== false;
        cell.backgroundColor = isChanged ? c.changedBg : c.todaybg;
        const dividerColor = isChanged ? c.changedDivider : c.divider;
        centeredText(cell, row.decoded.subject, Font.boldSystemFont(layout.subjFont), c.text, innerWidth);
        centeredBar(cell, innerWidth, Math.max(10, colWidth * 0.5), 2, dividerColor);
        centeredText(cell, `${row.decoded.grade}-${row.decoded.cls}`, Font.boldSystemFont(layout.clsFont), c.text, innerWidth);
      } else {
        cell.backgroundColor = Color.clear();
        centeredText(cell, ' ', Font.boldSystemFont(layout.subjFont), Color.clear(), innerWidth);
        centeredBar(cell, innerWidth, Math.max(10, colWidth * 0.5), 2, Color.clear());
        centeredText(cell, ' ', Font.boldSystemFont(layout.clsFont), Color.clear(), innerWidth);
      }
    });

    marker = computeMarkerInfo(getActivePeriodTimes(maxPeriod), CONFIG.LUNCH_AFTER_PERIOD);
    w.addSpacer(4);
    const markerRow = w.addStack();
    markerRow.layoutHorizontally();
    markerRow.size = new Size(tableWidth, 8);
    for (let p = 1; p <= maxPeriod; p++) {
      const cell = markerRow.addStack();
      cell.layoutHorizontally();
      cell.size = new Size(colWidth, 8);
      if (marker.mode === 'column' && p === marker.column) {
        centeredText(cell, '▲', Font.boldSystemFont(9.5), new Color(MARKER_HEX), colWidth);
      } else if (marker.mode === 'boundary' && p === marker.boundaryAfter + 1) {
        const edge = cell.addStack();
        edge.layoutHorizontally();
        edge.size = new Size(colWidth, 8);
        const t = edge.addText('▲');
        t.font = Font.boldSystemFont(9.5);
        t.textColor = new Color(MARKER_HEX);
        t.lineLimit = 1;
        edge.addSpacer();
      }
      if (p < maxPeriod) markerRow.addSpacer(COLUMN_GAP);
    }
  }

  w.addSpacer(4);

  const footer = w.addStack();
  footer.layoutHorizontally();
  footer.bottomAlignContent();
  footer.size = new Size(getWidgetContentWidth(), 0);
  if (marker.text) {
    footer.addSpacer(10);
    const markerText = footer.addText(marker.text);
    markerText.font = Font.boldSystemFont(11);
    markerText.textColor = c.text;
    markerText.lineLimit = 1;
    markerText.minimumScaleFactor = 0.7;
    footer.addSpacer(24);
  } else {
    footer.addSpacer();
  }
  const showErr = isShownAsError(meta.report);
  const offline = meta.fromCache && !showErr;
  if (showErr) {
    addErrorBadge(footer, 8.5);
    footer.addSpacer(4);
  }
  const footerText = footer.addText(
    `${offline ? '⚠ 오프라인 · ' : ''}시간표 수정 ${formatServerUpdated(data['자료244'])} · 새로고침 ${formatTime(meta.fetchedAt)}`
  );
  footerText.font = Font.systemFont(9.5);
  footerText.textColor = offline ? new Color(OFFLINE_HEX) : c.sub;
  footerText.lineLimit = 1;
  footerText.minimumScaleFactor = 0.7;

  if (marker.nextBoundaryMin != null) {
    const boundary = new Date(now.getFullYear(), now.getMonth(), now.getDate(),
      Math.floor(marker.nextBoundaryMin / 60), marker.nextBoundaryMin % 60, 5);
    w.refreshAfterDate = boundary;
  } else {
    const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5);
    w.refreshAfterDate = nextMidnight;
  }
  return w;
}

// ===== 확대 화면 (WebView) — HTML 생성 =====

const APP_TODAY = {
  blue: { light: '#e6f0ff', dark: '#12305c' },
  brown: { light: '#f3e6d8', dark: '#2e1d10' },
  green: { light: '#e3f3ea', dark: '#0f2a1d' },
};

function themeCss() {
  const light = '--bg:#ffffff; --card:#f2f2f7; --text:#1c1c1e; --sub:#6e6e73; --warn:#b5580a; --warn-bg:#fdf1e2; --changed:#ffe1a8; --err:#d70015;';
  const dark = '--bg:#1c1c1e; --card:#2c2c2e; --text:#f2f2f7; --sub:#9a9a9e; --warn:#f2a34d; --warn-bg:#3a2a12; --changed:#4a3510; --err:#ff6961;';
  const accLight = [], accSystemDark = [], accDark = [];
  for (const key of Object.keys(ACCENT_PALETTE)) {
    const a = ACCENT_PALETTE[key];
    const t = APP_TODAY[key];
    accLight.push(`:root[data-accent="${key}"]{ --accent:${a.light.accent}; --today:${t.light}; }`);
    accSystemDark.push(`:root:not([data-theme="light"])[data-accent="${key}"]{ --accent:${a.dark.accent}; --today:${t.dark}; }`);
    accDark.push(`:root[data-theme="dark"][data-accent="${key}"]{ --accent:${a.dark.accent}; --today:${t.dark}; }`);
  }
  return `
  :root{ ${light} }
  ${accLight.join('\n  ')}
  @media (prefers-color-scheme: dark){
    :root:not([data-theme="light"]){ ${dark} }
    ${accSystemDark.join('\n    ')}
  }
  :root[data-theme="dark"]{ ${dark} }
  ${accDark.join('\n  ')}
  *{ box-sizing:border-box; -webkit-tap-highlight-color:transparent; }
  body{
    margin:0; background:var(--bg); color:var(--text);
    font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",Arial,sans-serif;
    padding:18px 16px 24px;
  }
  .settings-back{
    display:flex; align-items:center; gap:4px; background:none; border:none; padding:0 0 18px;
    color:var(--accent); font-family:inherit; font-size:13px; font-weight:700; cursor:pointer;
  }
  [hidden]{ display:none !important; }`;
}

function htmlRootAttrs(prefs) {
  const theme = prefs.appAppearance === 'dark' ? ' data-theme="dark"'
    : prefs.appAppearance === 'light' ? ' data-theme="light"' : '';
  const accent = ACCENT_PALETTE[prefs.accent] ? prefs.accent : 'blue';
  return `${theme} data-accent="${accent}"`;
}

function buildErrorPageHtml(report, prefs, update) {
  return `<!DOCTYPE html>
<html lang="ko"${htmlRootAttrs(prefs)}>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<title>오류</title>
<style>${themeCss()}${ERROR_CSS}${UPDATE_CSS}</style>
</head>
<body>
${update && (update.notice || update.hasNew) ? `<div class="update-wrap">${updateBannerHtml(update)}</div>` : ''}
<div id="err-panel">${errorPanelHtml(report)}</div>
<script>
(function(){
  'use strict';
  document.addEventListener('click', function(e){
    if (e.target && e.target.id === 'err-copy-btn') location.href = 'comcigan-copy://error';
    if (e.target && e.target.id === 'err-share-btn') location.href = 'comcigan-share://error';
  });
  window.__copied = function(){ var el = document.getElementById('err-copied'); if (el) el.hidden = false; };
})();
</script>
</body>
</html>`;
}

function embedJson(obj) {
  return JSON.stringify(obj)
    .replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

/** 학교·선생님·교시 설정 화면. school은 확인된 학교 정보(없으면 null). */
function buildSetupHtml(settings, school, notice, canCancel, prefs) {
  const embedded = { settings, school, canCancel: !!canCancel };
  const noticeHtml = notice
    ? `<div class="notice"><b>${escapeHtml(notice.title)}</b><br>${escapeHtml(notice.summary)}</div>`
    : '';
  return `<!DOCTYPE html>
<html lang="ko"${htmlRootAttrs(prefs)}>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<title>설정</title>
<style>${themeCss()}
  h1{ font-size:20px; margin:0 0 4px; }
  .lead{ font-size:12.5px; color:var(--sub); margin:0 0 16px; line-height:1.5; }
  .notice{ font-size:12.5px; line-height:1.5; color:var(--warn); background:var(--warn-bg); border-radius:9px; padding:10px 12px; margin-bottom:16px; }
  .group{ margin-bottom:20px; }
  .label{ font-size:12px; font-weight:700; color:var(--accent); margin-bottom:6px; }
  .help{ font-size:11px; color:var(--sub); margin-top:5px; line-height:1.5; }
  .row{ display:flex; gap:8px; }
  input, select{
    font-family:inherit; font-size:15px; color:var(--text); background:var(--card); border:none; border-radius:9px;
    padding:10px 11px; width:100%; -webkit-appearance:none; appearance:none;
  }
  input[type=time]{ width:auto; flex:1; min-width:0; text-align:center; }
  select:disabled{ opacity:.5; }
  .btn{
    font-family:inherit; font-size:14px; font-weight:700; border-radius:9px; padding:10px 14px; cursor:pointer;
    border:1px solid var(--accent); background:none; color:var(--accent); flex:none;
  }
  .btn.primary{ width:100%; background:var(--accent); color:#fff; font-size:16px; padding:13px 0; }
  .btn.small{ font-size:12px; padding:6px 10px; margin-top:8px; }
  .btn:disabled{ opacity:.5; }
  .status{ font-size:12.5px; color:var(--sub); margin-top:7px; line-height:1.5; }
  .status.ok{ color:var(--accent); font-weight:700; }
  .status.err{ color:var(--err); }
  .disabled{ opacity:.45; pointer-events:none; }
  .pills{ display:flex; gap:8px; }
  .pill{ font-family:inherit; font-size:14px; padding:8px 18px; border-radius:999px; border:none; background:var(--card); color:var(--sub); cursor:pointer; }
  .pill[aria-pressed="true"]{ background:var(--accent); color:#fff; }
  .time-row{ display:flex; align-items:center; gap:8px; margin-bottom:6px; }
  .time-row .no{ width:44px; font-size:13px; color:var(--sub); flex:none; }
  .time-row .tilde{ color:var(--sub); }
  .save-msg{ font-size:13px; margin-top:10px; text-align:center; line-height:1.5; }
  .save-msg.err{ color:var(--err); }
</style>
</head>
<body>
  ${canCancel ? '<button class="settings-back" id="cancel-btn">‹ 시간표로</button>' : ''}
  <h1>학교·선생님 설정</h1>
  <p class="lead">한 번 저장하면 같은 iCloud를 쓰는 아이폰·아이패드에서 함께 쓰여요.</p>
  ${noticeHtml}

  <div class="group">
    <div class="label">학교 코드</div>
    <div class="row">
      <input id="school-code" inputmode="numeric" pattern="[0-9]*" maxlength="8" placeholder="예: 12345" autocomplete="off">
      <button class="btn" id="lookup-btn">확인</button>
    </div>
    <div class="status" id="school-status">학교 코드를 넣고 "확인"을 눌러주세요.</div>
    <div class="help">컴시간알리미 앱이나 컴시간교사.kr에서 학교를 검색하면 나오는 숫자예요.</div>
  </div>

  <div id="school-dependent">
    <div class="group">
      <div class="label">선생님</div>
      <select id="teacher"></select>
    </div>

    <div class="group">
      <div class="label">하루 교시 수</div>
      <div class="pills" id="period-pills">
        <button class="pill" data-p="6">6교시</button>
        <button class="pill" data-p="7">7교시</button>
      </div>
    </div>

    <div class="group">
      <div class="label">교시별 시각</div>
      <div id="times"></div>
      <button class="btn small" id="starts-btn" hidden>컴시간에 등록된 시작 시각으로 채우기</button>
      <div class="help" id="times-help">위젯에서 지금 몇 교시인지 표시할 때 써요.</div>
    </div>

    <div class="group">
      <div class="label">점심시간</div>
      <select id="lunch"></select>
    </div>

    <div class="group">
      <div class="label">담임 반 (선택)</div>
      <select id="homeroom"></select>
      <div class="help">반별 시간표에서 처음 보여줄 반이에요.</div>
    </div>

    <div class="group">
      <div class="label">화면에 보일 이름 (선택)</div>
      <input id="school-name-override" maxlength="30" autocomplete="off">
      <div style="height:8px"></div>
      <input id="teacher-name-override" maxlength="30" autocomplete="off">
      <div class="help">컴시간은 이름 끝 글자를 *로 가려요. 비워두면 컴시간에 나오는 이름을 써요.</div>
    </div>
  </div>

  <button class="btn primary" id="save-btn">저장</button>
  <div class="save-msg" id="save-msg"></div>

<script>
(function(){
  'use strict';
  var E = ${embedJson(embedded)};
  var S = E.settings;
  var SCHOOL = E.school;
  function $(id){ return document.getElementById(id); }
  var codeInput = $('school-code'), statusEl = $('school-status'), lookupBtn = $('lookup-btn');
  var teacherSel = $('teacher'), homeroomSel = $('homeroom'), lunchSel = $('lunch');
  var timesBox = $('times'), saveBtn = $('save-btn'), saveMsg = $('save-msg');
  var schoolNameInput = $('school-name-override'), teacherNameInput = $('teacher-name-override');

  function setStatus(text, kind){ statusEl.textContent = text; statusEl.className = 'status' + (kind ? ' ' + kind : ''); }
  function setSaveMsg(text, isErr){ saveMsg.textContent = text; saveMsg.className = 'save-msg' + (isErr ? ' err' : ''); }
  function option(value, label, selected){
    var o = document.createElement('option'); o.value = value; o.textContent = label; if (selected) o.selected = true; return o;
  }
  function addMinutes(hhmm, mins){
    var p = hhmm.split(':'); var t = Number(p[0]) * 60 + Number(p[1]) + mins;
    t = Math.min(t, 23 * 60 + 59);
    return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0');
  }

  function readTimes(){
    Array.prototype.forEach.call(timesBox.querySelectorAll('.time-row'), function(row){
      var i = Number(row.dataset.i);
      S.periodTimes[i] = { start: row.querySelector('.start').value, end: row.querySelector('.end').value };
    });
  }
  function renderTimes(){
    timesBox.innerHTML = '';
    for (var i = 0; i < S.maxPeriod; i++){
      var row = document.createElement('div');
      row.className = 'time-row'; row.dataset.i = String(i);
      var no = document.createElement('span'); no.className = 'no'; no.textContent = (i + 1) + '교시';
      var a = document.createElement('input'); a.type = 'time'; a.className = 'start'; a.value = S.periodTimes[i].start;
      var tilde = document.createElement('span'); tilde.className = 'tilde'; tilde.textContent = '~';
      var b = document.createElement('input'); b.type = 'time'; b.className = 'end'; b.value = S.periodTimes[i].end;
      row.appendChild(no); row.appendChild(a); row.appendChild(tilde); row.appendChild(b);
      timesBox.appendChild(row);
    }
  }
  function renderLunch(){
    lunchSel.innerHTML = '';
    lunchSel.appendChild(option('0', '없음', S.lunchAfterPeriod === 0));
    for (var p = 1; p < S.maxPeriod; p++) lunchSel.appendChild(option(String(p), p + '교시와 ' + (p + 1) + '교시 사이', S.lunchAfterPeriod === p));
  }
  function renderPeriodPills(){
    Array.prototype.forEach.call(document.querySelectorAll('#period-pills .pill'), function(b){
      b.setAttribute('aria-pressed', String(Number(b.dataset.p) === S.maxPeriod));
    });
  }
  function updateTeacherPlaceholder(){
    var opt = teacherSel.options[teacherSel.selectedIndex];
    var name = opt && opt.value ? opt.textContent.replace(/ \\(\\d+번\\)$/, '') : '';
    teacherNameInput.placeholder = name ? '선생님 이름 (컴시간: ' + name + ')' : '선생님 이름';
  }
  function renderSchool(){
    var on = !!SCHOOL;
    $('school-dependent').classList.toggle('disabled', !on);
    teacherSel.innerHTML = ''; homeroomSel.innerHTML = '';
    if (!on){
      teacherSel.appendChild(option('', '학교를 먼저 확인해주세요', true));
      $('starts-btn').hidden = true;
      return;
    }
    setStatus((SCHOOL.region ? SCHOOL.region + ' ' : '') + SCHOOL.name + ' — 이 학교가 맞나요?', 'ok');
    var known = SCHOOL.teachers.some(function(t){ return t[0] === S.teacherId; });
    teacherSel.appendChild(option('', '선생님을 골라주세요', !known));
    SCHOOL.teachers.forEach(function(t){
      teacherSel.appendChild(option(String(t[0]), t[1] + ' (' + t[0] + '번)', known && t[0] === S.teacherId));
    });
    homeroomSel.appendChild(option('', '없음', !S.homeroomClass));
    SCHOOL.classes.forEach(function(g){
      var og = document.createElement('optgroup'); og.label = g.grade + '학년';
      for (var c = 1; c <= g.count; c++){
        var v = g.grade + '-' + c;
        og.appendChild(option(v, g.grade + '학년 ' + c + '반', v === S.homeroomClass));
      }
      homeroomSel.appendChild(og);
    });
    schoolNameInput.placeholder = '학교 이름 (컴시간: ' + SCHOOL.name + ')';
    $('starts-btn').hidden = !SCHOOL.starts.some(Boolean);
    updateTeacherPlaceholder();
  }

  codeInput.value = S.schoolCode;
  schoolNameInput.value = S.schoolNameOverride;
  teacherNameInput.value = S.teacherNameOverride;
  renderPeriodPills(); renderTimes(); renderLunch(); renderSchool();

  teacherSel.addEventListener('change', updateTeacherPlaceholder);
  codeInput.addEventListener('input', function(){
    var code = codeInput.value.replace(/\\D/g, '');
    if (SCHOOL && code !== SCHOOL.code) { SCHOOL = null; renderSchool(); setStatus('"확인"을 눌러 학교를 확인해주세요.'); }
  });
  lookupBtn.addEventListener('click', function(){
    var code = codeInput.value.replace(/\\D/g, '');
    codeInput.value = code;
    if (!code) { setStatus('학교 코드를 입력해주세요.', 'err'); return; }
    lookupBtn.disabled = true;
    setStatus('확인 중…');
    location.href = 'comcigan-setup://school?code=' + code;
  });
  window.__schoolResult = function(res){
    lookupBtn.disabled = false;
    if (res && res.ok) { SCHOOL = res.school; renderSchool(); }
    else { SCHOOL = null; renderSchool(); setStatus((res && res.message) || '학교를 확인하지 못했어요.', 'err'); }
  };

  Array.prototype.forEach.call(document.querySelectorAll('#period-pills .pill'), function(b){
    b.addEventListener('click', function(){
      readTimes();
      S.maxPeriod = Number(b.dataset.p);
      if (S.lunchAfterPeriod >= S.maxPeriod) S.lunchAfterPeriod = 0;
      renderPeriodPills(); renderTimes(); renderLunch();
    });
  });
  lunchSel.addEventListener('change', function(){ S.lunchAfterPeriod = Number(lunchSel.value); });
  $('starts-btn').addEventListener('click', function(){
    if (!SCHOOL) return;
    readTimes();
    for (var i = 0; i < S.maxPeriod; i++){
      var st = SCHOOL.starts[i];
      if (st) S.periodTimes[i] = { start: st, end: addMinutes(st, 45) };
    }
    renderTimes();
    $('times-help').textContent = '끝나는 시각은 45분 수업 기준으로 채웠어요. 학교에 맞게 고쳐주세요.';
  });

  saveBtn.addEventListener('click', function(){
    readTimes();
    window.__SETUP_DATA__ = {
      schoolCode: codeInput.value.replace(/\\D/g, ''),
      teacherId: Number(teacherSel.value) || 0,
      maxPeriod: S.maxPeriod,
      homeroomClass: homeroomSel.value || '',
      schoolNameOverride: schoolNameInput.value,
      teacherNameOverride: teacherNameInput.value,
      periodTimes: S.periodTimes,
      lunchAfterPeriod: Number(lunchSel.value) || 0
    };
    saveBtn.disabled = true;
    setSaveMsg('저장하는 중…');
    location.href = 'comcigan-setup://save';
  });
  window.__saveResult = function(res){
    saveBtn.disabled = false;
    setSaveMsg((res && res.message) || '저장하지 못했어요.', true);
  };

  var cancelBtn = $('cancel-btn');
  if (cancelBtn) cancelBtn.addEventListener('click', function(){ location.href = 'comcigan-setup://cancel'; });
})();
</script>
</body>
</html>`;
}

function buildAppHtml(data, teacherId, prefs, meta) {
  const maxPeriod = (CONFIG.MAX_PERIOD === 7) ? 7 : 6;
  const schoolOverride = String(CONFIG.SCHOOL_NAME_OVERRIDE || '').trim();
  const schoolLine = escapeHtml(schoolOverride || `${data['지역명'] || ''} ${data['학교명'] || ''}`.trim());
  const teacherNm = escapeHtml(displayTeacherName(data, teacherId));
  const updatedServer = escapeHtml(formatServerUpdated(data['자료244']));
  const updatedFetched = escapeHtml(formatTime(meta.fetchedAt));

  const gradeOptions = gradeOptionsFromData(data);

  const embedded = {
    teacherId: Number(teacherId),
    maxPeriod,
    division: Number(data['분리']) || 100,
    names: Array.isArray(data['자료446']) ? data['자료446'] : [],
    subjects: Array.isArray(data['자료492']) ? data['자료492'] : [],
    gradeOptions,
    homeroomClassDefault: parseGradeClass(CONFIG.HOMEROOM_CLASS) ? CONFIG.HOMEROOM_CLASS : '',
    weeks: { '1': extractWeekPayload(data, teacherId) },
  };

  const embeddedJson = embedJson(embedded);

  const setupSummary = escapeHtml([
    displaySchoolName(data),
    `${displayTeacherName(data, teacherId)} 선생님`,
    `${maxPeriod}교시`,
  ].filter(Boolean).join(' · '));

  const versionLines = versionInfoRows(meta.update || updateStatus(null))
    .map(([k, v]) => `<div>${escapeHtml(k)} ${escapeHtml(v)}</div>`).join('');

  const report = meta.report || null;
  const showErr = isShownAsError(report);
  const offline = meta.fromCache && !showErr;

  return `<!DOCTYPE html>
<html lang="ko"${htmlRootAttrs(prefs)}>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<title>시간표</title>
<style>
${themeCss()}
${ERROR_CSS}
${UPDATE_CSS}
  .headrow{ display:flex; align-items:flex-start; justify-content:space-between; gap:8px; }
  .title{ font-size:19px; font-weight:700; }
  .sub{ font-size:12px; color:var(--sub); margin-top:2px; }
  .highlight-toggle{
    display:flex; align-items:center; gap:6px; margin-top:8px; font-size:11.5px; color:var(--sub); cursor:pointer;
  }
  .highlight-toggle input{ width:15px; height:15px; accent-color:var(--warn); margin:0; }
  .updated{ font-size:10.5px; color:var(--sub); margin-top:8px; padding-bottom:12px; border-bottom:1px solid var(--card); transition:opacity .15s; }
  .updated.warn{ color:var(--warn); }
  .refresh-btn{
    width:30px; height:30px; border-radius:50%; border:none; background:var(--card); color:var(--accent);
    font-size:15px; line-height:1; cursor:pointer; flex:none; display:flex; align-items:center; justify-content:center;
    transition:transform .5s ease;
  }
  .refresh-btn.spinning{ transform:rotate(360deg); }
  .refresh-btn:disabled{ opacity:.5; }
  .section-label-row{ display:flex; align-items:center; justify-content:space-between; gap:8px; margin:16px 0 4px; }
  .section-label{ font-size:12px; font-weight:700; color:var(--accent); }
  select.weekpick{
    font-size:11px; font-family:inherit; color:var(--sub); background:var(--card);
    border:none; border-radius:999px; padding:5px 10px; -webkit-appearance:none; appearance:none;
  }
  .week-range{ font-size:10.5px; color:var(--sub); margin-bottom:6px; }
  .week-warn{ font-size:11.5px; color:var(--warn); background:var(--warn-bg); padding:9px 11px; border-radius:8px; margin-bottom:8px; }
  table.grid{ width:100%; border-collapse:collapse; table-layout:fixed; }
  table.grid th{ font-size:10px; font-weight:700; color:var(--sub); padding:5px 0; }
  table.grid th.today{ color:var(--accent); }
  table.grid td{ font-size:9px; text-align:center; padding:3px 2px; vertical-align:top; }
  table.grid tr td:first-child{ vertical-align:middle; }
  .cell{
    border-radius:6px; min-height:42px; padding:6px 2px; display:flex; flex-direction:column;
    align-items:center; justify-content:center; gap:3px;
  }
  .cell.on{ background:var(--card); }
  .cell.today.on{ background:var(--today); }
  .cell.changed.on{ background:var(--changed); }
  .cell .subj{ color:var(--text); font-weight:600; line-height:1.3; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:100%; }
  .cell .meta{ color:var(--sub); font-size:8.5px; line-height:1.3; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:100%; }
  @media (min-width: 600px){
    table.grid td{ font-size:15px; padding:5px 3px; }
    .cell{ border-radius:9px; min-height:72px; padding:10px 4px; gap:5px; }
    .cell .meta{ font-size:12px; }
  }
  select.classpick{
    width:100%; font-size:13px; font-family:inherit; color:var(--text); background:var(--card);
    border:none; border-radius:9px; padding:9px 10px; margin-top:4px; -webkit-appearance:none; appearance:none;
  }
  .homeroom-line{ font-size:11px; color:var(--sub); margin-top:7px; }
  .homeroom-line b{ color:var(--text); font-weight:600; }
  .open-settings-link{
    display:block; width:100%; margin-top:28px; padding:14px 0; text-align:center;
    background:none; border:none; border-top:1px solid var(--card); color:var(--sub);
    font-family:inherit; font-size:12px; cursor:pointer;
  }
  .settings-group{ margin-bottom:18px; }
  .settings-group.credit{
    margin-top:8px; padding-top:14px; border-top:1px solid var(--card);
    font-size:13px; color:var(--sub); text-align:center;
  }
  .setup-summary{ font-size:13px; margin-bottom:8px; }
  .settings-label{ font-size:11px; font-weight:700; color:var(--sub); margin-bottom:8px; }
  .mode-row{ display:flex; gap:7px; flex-wrap:wrap; }
  .pill{
    font-family:inherit; font-size:11px; padding:6px 12px; border-radius:999px; border:none;
    background:var(--card); color:var(--sub); cursor:pointer;
  }
  .pill[aria-pressed="true"]{ background:var(--accent); color:#fff; }
  .theme-row{ display:flex; align-items:center; gap:10px; }
  .theme-dot{
    width:22px; height:22px; border-radius:50%; border:2px solid transparent; padding:0; cursor:pointer;
    box-shadow:0 0 0 1px var(--card) inset;
  }
  .theme-dot[aria-pressed="true"]{ border-color:var(--text); }
</style>
</head>
<body>
  <div id="tab-schedule">
    <div class="headrow">
      <div>
        <div class="title">${teacherNm} 선생님</div>
        <div class="sub">${schoolLine}</div>
      </div>
      <button class="refresh-btn" id="refresh-btn" title="새로고침" aria-label="새로고침">↻</button>
    </div>
    <label class="highlight-toggle">
      <input type="checkbox" id="highlight-changed-checkbox">
      변경 시간표 색칠하기
    </label>
    <div class="updated${offline ? ' warn' : ''}" id="updated-line"><button class="err-badge" id="err-badge"${showErr ? '' : ' hidden'}>오류 ›</button><span id="updated-text">${offline ? '⚠ 오프라인 · ' : ''}시간표 수정 ${updatedServer} · 새로고침 ${updatedFetched}</span></div>
    ${updateBannerHtml(meta.update)}

    <div class="section-label-row">
      <span class="section-label">주간 시간표</span>
      <select class="weekpick" id="teacher-weekpick">
        <option value="this">이번주</option>
        <option value="next">다음주</option>
      </select>
    </div>
    <div class="week-range" id="teacher-week-range"></div>
    <div class="week-warn" id="teacher-week-warn" hidden></div>
    <table class="grid" id="teacher-grid"></table>

    <div class="section-label-row">
      <span class="section-label">반별 시간표</span>
      <select class="weekpick" id="class-weekpick">
        <option value="this">이번주</option>
        <option value="next">다음주</option>
      </select>
    </div>
    <select class="classpick" id="classpick"></select>
    <div class="homeroom-line" id="homeroom-line"></div>
    <div class="week-range" id="class-week-range"></div>
    <div class="week-warn" id="class-week-warn" hidden></div>
    <table class="grid" id="class-grid" style="margin-top:8px;"></table>

    <button class="open-settings-link" id="open-settings-btn">⚙ 설정</button>
  </div>

  <div id="tab-settings" hidden>
    <button class="settings-back" id="back-btn">‹ 시간표로</button>
    <div class="settings-group">
      <div class="settings-label">학교·선생님·교시</div>
      <div class="setup-summary">${setupSummary}</div>
      <button class="pill" id="open-setup-btn">바꾸기</button>
    </div>
    <div class="settings-group">
      <div class="settings-label">테마 색상</div>
      <div class="theme-row">
        <button class="theme-dot" data-accent="blue" title="하늘색" style="background:#0a66ff"></button>
        <button class="theme-dot" data-accent="brown" title="갈색" style="background:#8a4b26"></button>
        <button class="theme-dot" data-accent="green" title="초록" style="background:#1f6b4a"></button>
      </div>
    </div>
    <div class="settings-group">
      <div class="settings-label">구분선 밝기 (위젯 블럭 안 선)</div>
      <div class="mode-row" id="divider-row">
        <button class="pill" data-divider="bright">밝게</button>
        <button class="pill" data-divider="normal">보통</button>
        <button class="pill" data-divider="dark">어둡게</button>
      </div>
    </div>
    <div class="settings-group">
      <div class="settings-label">위젯 화면 모드</div>
      <div class="mode-row" id="widget-mode-row">
        <button class="pill" data-mode="system">시스템</button>
        <button class="pill" data-mode="light">라이트</button>
        <button class="pill" data-mode="dark">다크</button>
      </div>
    </div>
    <div class="settings-group">
      <div class="settings-label">확대 화면 모드</div>
      <div class="mode-row" id="app-mode-row">
        <button class="pill" data-mode="system">시스템</button>
        <button class="pill" data-mode="light">라이트</button>
        <button class="pill" data-mode="dark">다크</button>
      </div>
    </div>
    <div class="settings-group version-info">${versionLines}</div>
    <div class="settings-group credit">만든 사람: 박현태</div>
  </div>

  <div id="tab-error" hidden>
    <button class="settings-back" id="err-back-btn">‹ 시간표로</button>
    <div id="err-panel">${showErr ? errorPanelHtml(report) : ''}</div>
  </div>

<script>
(function(){
  'use strict';
  var EMBEDDED = ${embeddedJson};
  var PREFS = { accent: ${JSON.stringify(prefs.accent)}, dividerStyle: ${JSON.stringify(prefs.dividerStyle)},
                widgetAppearance: ${JSON.stringify(prefs.widgetAppearance)}, appAppearance: ${JSON.stringify(prefs.appAppearance)},
                highlightChanged: ${JSON.stringify(prefs.highlightChanged !== false)} };
  var WEEKDAY = ['월','화','수','목','금'];
  var REAL_TODAY_JSDAY = new Date().getDay();

  function escapeHtml(str){
    return String(str == null ? '' : str).replace(/[&<>"']/g, function(ch){
      return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch];
    });
  }
  function formatServerUpdated(raw){
    if (!raw) return '-';
    var s = String(raw);
    var m = s.match(/(\\d{4})-(\\d{2})-(\\d{2})[ T](\\d{2}):(\\d{2})/);
    if (!m) return s;
    return Number(m[2]) + '/' + Number(m[3]) + ' ' + m[4] + ':' + m[5];
  }
  function mTh(mm, div){ return div === 100 ? Math.floor(mm/div) : mm % div; }
  function mSb(mm, div){ return div === 100 ? mm % div : Math.floor(mm/div); }

  function normalizeRaw(raw){
    if (raw === null || raw === undefined || raw === '') return null;
    var changed = false;
    var num = raw;
    if (typeof raw === 'string'){
      if (raw.charAt(0) === '>'){ changed = true; num = raw.slice(1); }
      num = Number(num);
    }
    if (typeof num !== 'number' || !isFinite(num) || num <= 0) return null;
    return { num: num, changed: changed };
  }

  function decodeTeacherCell(raw){
    var n = normalizeRaw(raw);
    if (!n) return null;
    var classCode = n.num % 1000;
    var grade = Math.floor(classCode/100), cls = classCode % 100;
    if (grade < 1 || grade > 6 || cls < 1 || cls > 99) return null;
    var subjRaw = Math.floor(n.num/1000);
    var subjIdx = subjRaw % EMBEDDED.division;
    var subject = EMBEDDED.subjects[subjIdx];
    return { grade: grade, cls: cls, subject: subject || '', changed: n.changed };
  }
  function decodeClassCell(raw){
    var n = normalizeRaw(raw);
    if (!n) return null;
    var teacherId = mTh(n.num, EMBEDDED.division);
    var subjIdx = mSb(n.num, EMBEDDED.division);
    var teacher = EMBEDDED.names[teacherId];
    if (teacher === undefined) return null;
    var subject = EMBEDDED.subjects[subjIdx];
    return { teacher: teacher || '', subject: subject || '', changed: n.changed };
  }

  function buildGridHtml(getDayRaw, decodeFn, metaFn, todayCol){
    var head = '<tr><th></th>' + WEEKDAY.map(function(n,i){
      return '<th class="' + (i+1===todayCol ? 'today' : '') + '">' + n + '</th>';
    }).join('') + '</tr>';
    var body = '';
    for (var p = 1; p <= EMBEDDED.maxPeriod; p++){
      body += '<tr><td style="color:var(--sub);">' + p + '</td>';
      for (var day = 1; day <= 5; day++){
        var raw = getDayRaw(day, p);
        var d = decodeFn(raw);
        var isToday = day === todayCol;
        if (d){
          var meta = metaFn(d);
          var changedClass = (d.changed && PREFS.highlightChanged) ? ' changed' : '';
          body += '<td><div class="cell on' + (isToday ? ' today' : '') + changedClass + '">' +
            '<span class="subj">' + escapeHtml(d.subject) + '</span>' +
            '<span class="meta">' + escapeHtml(meta) + '</span>' +
            '</div></td>';
        } else {
          body += '<td><div class="cell' + (isToday ? ' today' : '') + '"></div></td>';
        }
      }
      body += '</tr>';
    }
    return head + body;
  }

  // ===== 주차(이번주/다음주) 상태 =====
  var weekState = { teacher: 'this', class: 'this' };
  var pendingWeekCallbacks = {};

  function resolveR(which){
    var base = EMBEDDED.weeks['1'];
    var todayR = String((base && base.todayR) || '1').replace(/[^0-9]/g, '') || '1';
    if (which === 'this') return todayR;
    return String(Number(todayR) + 1);
  }
  function findRangeLabel(weekPayload, r){
    var found = null;
    (weekPayload.dateRanges || []).forEach(function(entry){
      if (Array.isArray(entry) && String(entry[0]) === String(r)) found = entry[1];
    });
    return found;
  }
  function parseRangeStr(s){
    var m = String(s || '').match(/(\\d{2})-(\\d{2})-(\\d{2})\\s*~\\s*(\\d{2})-(\\d{2})-(\\d{2})/);
    if (!m) return null;
    var start = new Date(2000+Number(m[1]), Number(m[2])-1, Number(m[3]), 0, 0, 0);
    var end = new Date(2000+Number(m[4]), Number(m[5])-1, Number(m[6]), 23, 59, 59);
    var label = m[2] + '/' + m[3] + ' ~ ' + m[5] + '/' + m[6];
    return { start: start, end: end, label: label };
  }
  function isTodayWithin(range){
    var now = new Date();
    return !!range && now >= range.start && now <= range.end;
  }

  function requestWeeks(rs){
    location.href = 'comcigan-week://request?r=' + rs.join(',');
  }
  function ensureWeek(r, cb){
    if (EMBEDDED.weeks[r]) { cb(EMBEDDED.weeks[r], null); return; }
    pendingWeekCallbacks[r] = pendingWeekCallbacks[r] || [];
    pendingWeekCallbacks[r].push(cb);
    requestWeeks([r]);
  }

  function currentClassGradeCls(){
    var m = pick.value.match(/^(\\d+)-(\\d+)$/);
    return m ? { grade: Number(m[1]), cls: Number(m[2]) } : null;
  }

  function renderTeacherGrid(weekPayload, todayCol){
    var html = buildGridHtml(
      function(day, p){ return (weekPayload.teacherSched[day] || [])[p]; },
      decodeTeacherCell,
      function(d){ return d.grade + '-' + d.cls; },
      todayCol
    );
    document.getElementById('teacher-grid').innerHTML = html;
  }

  function renderClassGrid(weekPayload, gradeCls, todayCol){
    var homeroomLine = document.getElementById('homeroom-line');
    if (!gradeCls) { document.getElementById('class-grid').innerHTML = ''; homeroomLine.textContent = ''; return; }
    var grade = gradeCls.grade, cls = gradeCls.cls;
    var gradeArr = weekPayload.classRaw[grade] || [];
    var clsArr = gradeArr[cls] || [];
    var homeroomArr = weekPayload.homeroom[grade-1];
    var homeroomId = homeroomArr ? homeroomArr[cls-1] : 0;
    if (homeroomId && EMBEDDED.names[homeroomId]) {
      homeroomLine.innerHTML = '<b>' + escapeHtml(EMBEDDED.names[homeroomId]) + '</b> 담임 선생님';
    } else {
      homeroomLine.textContent = '담임 정보 없음';
    }
    var html = buildGridHtml(
      function(day, p){ return (clsArr[day] || [])[p]; },
      decodeClassCell,
      function(d){ return d.teacher; },
      todayCol
    );
    document.getElementById('class-grid').innerHTML = html;
  }

  function renderSection(section){
    var which = weekState[section];
    var r = resolveR(which);
    var rangeEl = document.getElementById(section + '-week-range');
    var warnEl = document.getElementById(section + '-week-warn');

    function clearGrid(){
      document.getElementById(section === 'teacher' ? 'teacher-grid' : 'class-grid').innerHTML = '';
    }
    function paint(weekPayload){
      if (!weekPayload){
        warnEl.hidden = false;
        warnEl.textContent = '⚠ 시간표를 불러오지 못했습니다.';
        rangeEl.textContent = '';
        clearGrid();
        return;
      }
      var rangeLabel = findRangeLabel(weekPayload, r);
      var range = parseRangeStr(rangeLabel);
      rangeEl.textContent = range ? range.label : '';
      if (which === 'this' && range && !isTodayWithin(range)){
        warnEl.hidden = false;
        warnEl.textContent = '⚠ 시간표 정보를 확인할 수 없어요';
        clearGrid();
        return;
      }
      warnEl.hidden = true;
      var todayCol = (which === 'this') ? REAL_TODAY_JSDAY : -1;
      if (section === 'teacher') {
        renderTeacherGrid(weekPayload, todayCol);
      } else {
        renderClassGrid(weekPayload, currentClassGradeCls(), todayCol);
      }
    }

    if (EMBEDDED.weeks[r]) {
      paint(EMBEDDED.weeks[r]);
    } else {
      warnEl.hidden = true;
      rangeEl.textContent = '불러오는 중…';
      clearGrid();
      ensureWeek(r, function(weekPayload){ paint(weekPayload); });
    }
  }

  window.__applyWeekResult = function(payload){
    var results = (payload && payload.results) || {};
    var anyOk = false;
    Object.keys(results).forEach(function(r){
      var res = results[r];
      if (res.ok) { EMBEDDED.weeks[r] = res.data; if (!res.stale) anyOk = true; }
      var cbs = pendingWeekCallbacks[r] || [];
      delete pendingWeekCallbacks[r];
      cbs.forEach(function(cb){ cb(res.ok ? res.data : null); });
    });
    renderSection('teacher');
    renderSection('class');
    var report = payload && payload.report;
    var showErr = !!(report && report.code !== 'offline');
    if (showErr) {
      document.getElementById('err-panel').innerHTML = report.html;
      errBadge.hidden = false;
    } else if (anyOk) {
      errBadge.hidden = true;
    }
    var thisWeek = EMBEDDED.weeks[resolveR('this')];
    if (thisWeek) {
      var offline = !anyOk && !showErr;
      updatedText.textContent = (offline ? '⚠ 오프라인 · ' : '') + '시간표 수정 ' + formatServerUpdated(thisWeek.updatedServer) +
        ' · 새로고침 ' + (anyOk ? '방금' : '실패');
      updatedLine.classList.toggle('warn', offline);
    }
    endRefreshUI();
  };

  var pick = document.getElementById('classpick');
  EMBEDDED.gradeOptions.forEach(function(g){
    var og = document.createElement('optgroup');
    og.label = g.grade + '학년';
    for (var c = 1; c <= g.count; c++){
      var opt = document.createElement('option');
      opt.value = g.grade + '-' + c;
      opt.textContent = g.grade + '학년 ' + c + '반';
      og.appendChild(opt);
    }
    pick.appendChild(og);
  });
  var defaultClass = EMBEDDED.homeroomClassDefault;
  if (defaultClass && pick.querySelector('option[value="' + defaultClass + '"]')) {
    pick.value = defaultClass;
  } else if (pick.options.length > 0) {
    pick.selectedIndex = 0;
  }
  pick.addEventListener('change', function(){ renderSection('class'); });

  var teacherWeekpick = document.getElementById('teacher-weekpick');
  var classWeekpick = document.getElementById('class-weekpick');
  teacherWeekpick.addEventListener('change', function(){ weekState.teacher = teacherWeekpick.value; renderSection('teacher'); });
  classWeekpick.addEventListener('change', function(){ weekState.class = classWeekpick.value; renderSection('class'); });

  var highlightCheckbox = document.getElementById('highlight-changed-checkbox');
  highlightCheckbox.checked = PREFS.highlightChanged;
  highlightCheckbox.addEventListener('change', function(){
    PREFS.highlightChanged = highlightCheckbox.checked;
    window.__EXPORTED_PREFS__ = Object.assign({}, PREFS);
    renderSection('teacher');
    renderSection('class');
  });

  renderSection('teacher');
  renderSection('class');

  var REFRESH_COOLDOWN_MS = 5000;
  var REFRESH_TIMEOUT_MS = 15000;
  var lastRefreshAt = 0;
  var refreshTimeoutId = null;
  var refreshBtn = document.getElementById('refresh-btn');
  var updatedLine = document.getElementById('updated-line');
  var updatedText = document.getElementById('updated-text');
  var errBadge = document.getElementById('err-badge');

  function showRefreshError(msg){
    updatedText.textContent = '⚠ ' + msg;
    updatedLine.classList.add('warn');
  }
  function endRefreshUI(){
    if (refreshTimeoutId) { clearTimeout(refreshTimeoutId); refreshTimeoutId = null; }
    refreshBtn.classList.remove('spinning');
    refreshBtn.disabled = false;
    updatedLine.style.opacity = '1';
  }

  refreshBtn.addEventListener('click', function(){
    var now = Date.now();
    if (now - lastRefreshAt < REFRESH_COOLDOWN_MS) return;
    if (refreshBtn.classList.contains('spinning')) return;
    lastRefreshAt = now;

    refreshBtn.classList.add('spinning');
    refreshBtn.disabled = true;
    updatedLine.style.opacity = '0.5';
    updatedText.textContent = '새로고침 중…';
    updatedLine.classList.remove('warn');

    refreshTimeoutId = setTimeout(function(){
      endRefreshUI();
      showRefreshError('새로고침이 너무 오래 걸려서 중단했습니다. 다시 시도해주세요.');
    }, REFRESH_TIMEOUT_MS);

    var rTeacher = resolveR(weekState.teacher);
    var rClass = resolveR(weekState.class);
    var rs = rTeacher === rClass ? [rTeacher] : [rTeacher, rClass];
    requestWeeks(rs);
  });

  document.getElementById('open-settings-btn').addEventListener('click', function(){
    document.getElementById('tab-schedule').hidden = true;
    document.getElementById('tab-settings').hidden = false;
  });
  document.getElementById('back-btn').addEventListener('click', function(){
    document.getElementById('tab-settings').hidden = true;
    document.getElementById('tab-schedule').hidden = false;
  });
  document.getElementById('open-setup-btn').addEventListener('click', function(){
    location.href = 'comcigan-setup://open';
  });
  errBadge.addEventListener('click', function(){
    document.getElementById('tab-schedule').hidden = true;
    document.getElementById('tab-error').hidden = false;
    window.scrollTo(0, 0);
  });
  document.getElementById('err-back-btn').addEventListener('click', function(){
    document.getElementById('tab-error').hidden = true;
    document.getElementById('tab-schedule').hidden = false;
  });
  document.addEventListener('click', function(e){
    if (e.target && e.target.id === 'err-copy-btn') location.href = 'comcigan-copy://error';
    if (e.target && e.target.id === 'err-share-btn') location.href = 'comcigan-share://error';
  });
  window.__copied = function(){ var el = document.getElementById('err-copied'); if (el) el.hidden = false; };

  window.__EXPORTED_PREFS__ = Object.assign({}, PREFS);

  function setPressed(container, matchFn){
    Array.prototype.forEach.call(container.querySelectorAll('button'), function(btn){
      btn.setAttribute('aria-pressed', String(matchFn(btn)));
    });
  }
  function refreshSettingsUI(){
    setPressed(document.querySelector('.theme-row'), function(b){ return b.dataset.accent === PREFS.accent; });
    setPressed(document.getElementById('divider-row'), function(b){ return b.dataset.divider === PREFS.dividerStyle; });
    setPressed(document.getElementById('widget-mode-row'), function(b){ return b.dataset.mode === PREFS.widgetAppearance; });
    setPressed(document.getElementById('app-mode-row'), function(b){ return b.dataset.mode === PREFS.appAppearance; });
  }
  refreshSettingsUI();

  Array.prototype.forEach.call(document.querySelectorAll('.theme-dot'), function(dot){
    dot.addEventListener('click', function(){
      PREFS.accent = dot.dataset.accent;
      document.documentElement.setAttribute('data-accent', PREFS.accent);
      window.__EXPORTED_PREFS__ = Object.assign({}, PREFS);
      refreshSettingsUI();
    });
  });
  function wireModeRow(id, key){
    Array.prototype.forEach.call(document.querySelectorAll('#' + id + ' button'), function(btn){
      btn.addEventListener('click', function(){
        PREFS[key] = btn.dataset.mode || btn.dataset.divider;
        window.__EXPORTED_PREFS__ = Object.assign({}, PREFS);
        refreshSettingsUI();
      });
    });
  }
  wireModeRow('divider-row', 'dividerStyle');
  wireModeRow('widget-mode-row', 'widgetAppearance');
  wireModeRow('app-mode-row', 'appAppearance');
})();
</script>
</body>
</html>`;
}

// ===== 확대 화면 표시 + 종료 후 설정값 회수 =====

async function handleWeekRequest(webView, schoolCode, teacherId, rs, state) {
  const results = {};
  let report = null;
  for (const r of rs) {
    try {
      const data = await fetchSchoolData(schoolCode, r);
      try {
        fm().writeString(cacheFilePath(schoolCode, r), JSON.stringify({ fetchedAt: Date.now(), data }));
      } catch (e) {}
      results[r] = { ok: true, data: extractWeekPayload(data, teacherId) };
    } catch (e) {
      const rep = buildErrorReport(e);
      if (!report || (!isShownAsError(report) && isShownAsError(rep))) report = rep;
      let served = false;
      try {
        const path = cacheFilePath(schoolCode, r);
        if (fm().fileExists(path)) {
          const cached = JSON.parse(fm().readString(path));
          if (cached && isValidSchoolData(cached.data)) {
            results[r] = { ok: true, stale: true, data: extractWeekPayload(cached.data, teacherId) };
            served = true;
          }
        }
      } catch (e2) {}
      if (!served) results[r] = { ok: false };
    }
  }
  if (isShownAsError(report)) state.report = report;
  else if (!report) state.report = null;
  const payload = {
    results,
    report: report ? { code: report.code, html: isShownAsError(report) ? errorPanelHtml(report) : '' } : null,
  };
  const js = `window.__applyWeekResult && window.__applyWeekResult(${JSON.stringify(payload)});`;
  try {
    await webView.evaluateJavaScript(js);
  } catch (e) {}
}

function parseQuery(url) {
  const qIdx = url.indexOf('?');
  const query = qIdx === -1 ? '' : url.slice(qIdx + 1);
  const params = {};
  query.split('&').forEach((pair) => {
    if (!pair) return;
    const [k, v] = pair.split('=');
    if (!k) return;
    try {
      params[decodeURIComponent(k)] = decodeURIComponent(v || '');
    } catch (e) {}
  });
  return params;
}

function parseWeekBridgeUrl(url) {
  const seen = new Set();
  const rs = (parseQuery(url).r || '').split(',')
    .map((s) => s.replace(/[^0-9]/g, ''))
    .filter((s) => s && s.length <= 3 && !seen.has(s) && seen.add(s))
    .slice(0, 4);
  return { rs };
}

function handleCopyRequest(webView, state) {
  if (!state.report) return;
  try {
    Pasteboard.copy(state.report.text);
    webView.evaluateJavaScript('window.__copied && window.__copied();').catch(() => {});
  } catch (e) {}
}

function handleShareRequest(state) {
  if (!state.report) return;
  try {
    ShareSheet.present([state.report.text]).catch(() => {});
  } catch (e) {}
}

// ===== 확대 화면 세션 (시간표 ↔ 설정 화면 ↔ 오류 화면) =====

const SETUP_CODES = ['config-school', 'config-teacher', 'teacher-id', 'school-code'];

function isValidTeacher(data, teacherId) {
  const names = data['자료446'];
  return Number.isInteger(teacherId) && teacherId >= 1 && Array.isArray(names) &&
    teacherId < names.length && !!names[teacherId];
}

function teacherError(teacherId) {
  return teacherId
    ? appError('teacher-id', `교사 번호 ${teacherId}번이 시간표에 없습니다.`)
    : appError('config-teacher', '선생님이 설정되지 않았습니다.');
}

function noticeFor(report) {
  return report ? { title: report.title, summary: report.summary } : null;
}

async function evalInPage(session, js) {
  try {
    return await session.webView.evaluateJavaScript(js);
  } catch (e) {
    return null;
  }
}

/** 시간표 화면에서 바꾼 테마 등은 화면을 바꾸거나 닫기 전에 저장. */
async function capturePrefs(session) {
  if (session.page !== 'app') return;
  try {
    const parsed = JSON.parse(await evalInPage(session, 'JSON.stringify(window.__EXPORTED_PREFS__ || {})'));
    if (parsed && typeof parsed === 'object') {
      session.prefs = sanitizePrefs(Object.assign({}, session.prefs, parsed));
      savePrefs(session.prefs);
    }
  } catch (e) {}
}

async function showSetupPage(session, notice) {
  await capturePrefs(session);
  if (!session.school && session.data && SETTINGS.schoolCode) {
    session.school = schoolInfoFromData(SETTINGS.schoolCode, session.data);
  }
  session.page = 'setup';
  await session.webView.loadHTML(buildSetupHtml(SETTINGS, session.school, notice, session.appReady, session.prefs));
}

async function sessionUpdateStatus(session) {
  try {
    return updateStatus(await session.updatePromise);
  } catch (e) {
    return updateStatus(loadUpdateCheck());
  }
}

async function showErrorPage(session, report) {
  const update = await sessionUpdateStatus(session);
  session.state.report = report;
  session.page = 'error';
  await session.webView.loadHTML(buildErrorPageHtml(report, session.prefs, update));
}

async function showAppPage(session) {
  const schoolCode = sanitizeSchoolCode(CONFIG.SCHOOL_CODE);
  const teacherId = currentTeacherId();
  if (!schoolCode) return showSetupPage(session, null);

  let week;
  try {
    week = await getWeekData(schoolCode, '1');
  } catch (e) {
    await sessionUpdateStatus(session); // 오류 내용에 이번 업데이트 확인 결과가 들어가도록 먼저 기다림
    const report = buildErrorReport(e);
    if (SETUP_CODES.includes(report.code)) return showSetupPage(session, noticeFor(report));
    return showErrorPage(session, report);
  }
  session.data = week.data;
  session.school = schoolInfoFromData(schoolCode, week.data);
  if (!isValidTeacher(week.data, teacherId)) {
    return showSetupPage(session, teacherId ? noticeFor(buildErrorReport(teacherError(teacherId))) : null);
  }

  const update = await sessionUpdateStatus(session);
  const meta = {
    fetchedAt: week.fetchedAt,
    fromCache: week.fromCache,
    report: week.error ? buildErrorReport(week.error) : null,
    update,
  };
  session.state.report = isShownAsError(meta.report) ? meta.report : null;
  session.page = 'app';
  session.appReady = true;
  await session.webView.loadHTML(buildAppHtml(week.data, teacherId, session.prefs, meta));
}

async function handleSchoolLookup(session, code) {
  let res;
  if (!code) {
    res = { ok: false, message: '학교 코드를 입력해주세요.' };
  } else {
    try {
      const week = await getWeekData(code, '1');
      session.school = schoolInfoFromData(code, week.data);
      res = { ok: true, school: session.school };
    } catch (e) {
      const rep = buildErrorReport(e);
      session.school = null;
      res = {
        ok: false,
        message: rep.code === 'school-code'
          ? '이 학교 코드로 등록된 학교가 없어요. 숫자를 다시 확인해주세요.'
          : `${rep.title}. ${rep.summary}`,
      };
    }
  }
  await evalInPage(session, `window.__schoolResult && window.__schoolResult(${JSON.stringify(res)});`);
}

async function handleSetupSave(session) {
  let raw = null;
  try {
    raw = JSON.parse(await evalInPage(session, 'JSON.stringify(window.__SETUP_DATA__ || null)'));
  } catch (e) {}
  const s = sanitizeSettings(raw);
  const reply = (message) => evalInPage(session, `window.__saveResult && window.__saveResult(${JSON.stringify({ message })});`);
  const problem = settingsProblem(s, session.school);
  if (problem) return reply(problem);
  try {
    saveSettings(s);
  } catch (e) {
    return reply(`설정을 저장하지 못했어요. (${errText(e)})`);
  }
  applySettings(s);
  await showAppPage(session);
}

async function handleSetupRequest(session, url) {
  const action = url.slice('comcigan-setup://'.length).split('?')[0];
  if (action === 'school') return handleSchoolLookup(session, sanitizeSchoolCode(parseQuery(url).code).slice(0, 8));
  if (action === 'save') return handleSetupSave(session);
  if (action === 'open') return showSetupPage(session, null);
  if (action === 'cancel') return showAppPage(session);
}

function routeRequest(session, url) {
  if (url.indexOf('comcigan-week://request') === 0) {
    const { rs } = parseWeekBridgeUrl(url);
    if (rs.length) {
      handleWeekRequest(session.webView, sanitizeSchoolCode(CONFIG.SCHOOL_CODE), currentTeacherId(), rs, session.state)
        .catch(() => {});
    }
    return false;
  }
  if (url.indexOf('comcigan-copy://') === 0) {
    handleCopyRequest(session.webView, session.state);
    return false;
  }
  if (url.indexOf('comcigan-share://') === 0) {
    handleShareRequest(session.state);
    return false;
  }
  if (url.indexOf('comcigan-setup://') === 0) {
    handleSetupRequest(session, url).catch(() => {});
    return false;
  }
  return true;
}

async function runAppSession(prefs) {
  const webView = new WebView();
  const session = {
    webView, prefs, state: { report: null }, page: null, data: null, school: null, appReady: false,
    updatePromise: refreshUpdateCheck(),
  };
  webView.shouldAllowRequest = (request) => routeRequest(session, request && request.url ? request.url : '');
  await showAppPage(session);
  await webView.present(true);
  await capturePrefs(session);
}

// ===== 조용한(silent) 새로고침 모드 — iOS 단축어 자동화용 =====

function isSilentRefreshParam(param) {
  if (!param) return false;
  if (typeof param === 'string') return param.trim() === 'silent-refresh';
  if (typeof param === 'object') return param.mode === 'silent-refresh';
  return false;
}

async function runSilentRefresh(schoolCode) {
  try {
    await getWeekData(schoolCode, '1');
  } catch (e) {}
  const needsRetry = isHeartbeatStale(HEARTBEAT_STALE_MINUTES);
  if (typeof Script !== 'undefined' && typeof Script.setShortcutOutput === 'function') {
    Script.setShortcutOutput(needsRetry);
  }
}

// ===== 진입점 =====

function errorWidget(report, prefs) {
  const c = buildColors(prefs.widgetAppearance, prefs.accent, prefs.dividerStyle);
  const w = new ListWidget();
  w.backgroundColor = c.bg;
  w.setPadding(16, 16, 16, 16);
  w.addSpacer();
  if (report.code === 'config-school' || report.code === 'config-teacher') {
    const setup = w.addText('⚙ 설정 필요');
    setup.font = Font.boldSystemFont(13);
    setup.textColor = c.accent;
  } else if (isShownAsError(report)) {
    addErrorBadge(w, 13);
  } else {
    const off = w.addText('⚠ 오프라인');
    off.font = Font.boldSystemFont(13);
    off.textColor = new Color(OFFLINE_HEX);
  }
  w.addSpacer(8);
  const title = w.addText(report.title);
  title.font = Font.boldSystemFont(15);
  title.textColor = c.text;
  title.minimumScaleFactor = 0.7;
  w.addSpacer(4);
  const hint = w.addText(SETUP_CODES.includes(report.code) ? '탭해서 설정하기 ›' : '탭해서 자세히 보기 ›');
  hint.font = Font.systemFont(12);
  hint.textColor = c.sub;
  w.addSpacer();
  return w;
}

function addErrorBadge(parent, fontSize) {
  const badge = parent.addStack();
  badge.borderWidth = 1;
  badge.borderColor = new Color(ERROR_HEX);
  badge.cornerRadius = 4;
  badge.setPadding(1, 5, 1, 5);
  const t = badge.addText('오류 ›');
  t.font = Font.boldSystemFont(fontSize);
  t.textColor = new Color(ERROR_HEX);
  t.lineLimit = 1;
  return badge;
}

async function run() {
  applySettings((await loadSettings()) || blankSettings());
  const schoolCode = sanitizeSchoolCode(CONFIG.SCHOOL_CODE);

  if (isSilentRefreshParam(args.shortcutParameter)) {
    if (schoolCode) await runSilentRefresh(schoolCode);
    Script.complete();
    return;
  }

  const prefs = loadPrefs();
  if (!config.runsInWidget) {
    await runAppSession(prefs);
    Script.complete();
    return;
  }

  try {
    if (config.widgetFamily && config.widgetFamily !== 'medium') {
      throw appError('widget-size', 'Medium 크기 위젯만 지원합니다.');
    }
    if (!schoolCode) throw appError('config-school', '학교가 설정되지 않았습니다.');
    const teacherId = currentTeacherId();
    const { data, fetchedAt, fromCache, error } = await getWeekData(schoolCode, '1');
    if (!isValidTeacher(data, teacherId)) throw teacherError(teacherId);
    const meta = { fetchedAt, fromCache, report: error ? buildErrorReport(error) : null };
    Script.setWidget(buildWidget(data, teacherId, prefs, meta));
    writeHeartbeat();
  } catch (e) {
    Script.setWidget(errorWidget(buildErrorReport(e), prefs));
  }
  Script.complete();
}

await run();
