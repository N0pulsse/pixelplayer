'use strict';
const fs = require('node:fs');
const path = require('node:path');

/** electron-builder's portable launcher points to the real EXE, not its temporary extraction folder. */
function configureStorage(app, env = process.env) {
  const portableDir = env.PORTABLE_EXECUTABLE_DIR;
  if (!portableDir) return { portable: false, portableDir: null, userData: app.getPath('userData') };
  if (!path.isAbsolute(portableDir)) throw new Error('Путь к portable-версии должен быть абсолютным.');
  const userData = path.join(portableDir, 'PixelPlayer-data');
  try {
    fs.mkdirSync(userData, { recursive: true });
    const probe = path.join(userData, `.write-test-${process.pid}`);
    const fd = fs.openSync(probe, 'wx');
    fs.closeSync(fd);
    fs.unlinkSync(probe);
    for (const folder of ['session', 'logs', 'crashes']) fs.mkdirSync(path.join(userData, folder), { recursive: true });
    // Set all Chromium storage locations before app readiness / creating a session.
    app.setPath('userData', userData);
    app.setPath('sessionData', path.join(userData, 'session'));
    app.setPath('crashDumps', path.join(userData, 'crashes'));
    app.setAppLogsPath(path.join(userData, 'logs'));
  } catch (error) {
    throw new Error(`Не удаётся сохранить данные portable-версии:\n${userData}\n\nПереместите EXE в папку с правом записи (например, на флешку или в «Документы»).\n${error.message}`);
  }
  return { portable: true, portableDir: path.resolve(portableDir), userData };
}

module.exports = { configureStorage };
