'use strict';
/* 統一格式的伺服器紀錄（stdout → journald）：時間 [等級] 訊息 {meta} */
function log(level, msg, meta) {
  const line = `${new Date().toISOString()} [${level}] ${msg}${meta ? ' ' + JSON.stringify(meta) : ''}`;
  if (level === 'error') console.error(line);
  else console.log(line);
}
module.exports = {
  info: (msg, meta) => log('info', msg, meta),
  warn: (msg, meta) => log('warn', msg, meta),
  error: (msg, meta) => log('error', msg, meta),
};
