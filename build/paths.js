const path = require('path');
const fs = require('fs');

const appRoot = fs.realpathSync(path.resolve(__dirname, '..'));

let isAsVendor = false;
try {
  isAsVendor = fs.existsSync(path.join(appRoot, '../../RabbyHub/RabbyDesktop'));
} catch {
  isAsVendor = false;
};

if (isAsVendor) {
  console.warn('RabbyX as vendor');
}

const rootResolve = path.resolve.bind(path, appRoot);

module.exports = {
  root: appRoot,
  src: rootResolve('src'),
  popupHtml: rootResolve('src/ui/popup.html'),
  notificationHtml: rootResolve('src/ui/notification.html'),
  indexHtml: rootResolve('src/ui/index.html'),
  backgroundHtml: rootResolve('src/background/background.html'),
  dist: isAsVendor ? rootResolve('../../RabbyHub/RabbyDesktop/assets/chrome_exts/rabby') : rootResolve('dist'),

  rootResolve,
}
