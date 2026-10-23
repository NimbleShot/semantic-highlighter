// The tests drive the installed Chrome and Firefox (see test/e2e.mjs), so `npm ci` must not
// download Puppeteer's own browsers. Kept here rather than in an environment variable so plain
// `npm ci` works in every shell, PowerShell and cmd included.
module.exports = { skipDownload: true };
