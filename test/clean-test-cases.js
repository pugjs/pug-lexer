'use strict';

var fs = require('fs');

var dir = __dirname + '/cases/';
fs.readdirSync(dir).forEach(function (testCase) {
  if (/\.actual\.json$/.test(testCase)) {
    fs.unlink(dir + testCase);
  }
});
