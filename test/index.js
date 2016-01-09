'use strict';

var fs = require('fs');
var assert = require('assert');
var lex = require('../');
var checkLexerFunctions = require('./check-lexer-functions');

checkLexerFunctions();

var dir = __dirname + '/cases/';
fs.readdirSync(dir).forEach(function (testCase) {
  if (/\.pug$/.test(testCase)) {
    console.dir(testCase);
    var expected = require(dir + testCase.replace(/\.pug$/, '.expected.json'))
    var result = lex(fs.readFileSync(dir + testCase, 'utf8'), dir + testCase);
    fs.writeFileSync(dir + testCase.replace(/\.pug$/, '.actual.json'),
                     result.map(JSON.stringify).join('\n'));
    assert.deepEqual(expected, result);
  }
});


var edir = __dirname + '/errors/';
fs.readdirSync(edir).forEach(function (testCase) {
  if (/\.pug$/.test(testCase)) {
    console.dir(testCase);
    var expected = require(edir + testCase.replace(/\.pug$/, '.json'));
    var actual;
    try {
      lex(fs.readFileSync(edir + testCase, 'utf8'), edir + testCase);
      throw new Error('Expected ' + testCase + ' to throw an exception.');
    } catch (ex) {
      if (!ex || !ex.code || !ex.code.indexOf('PUG:') === 0) throw ex;
      actual = {
        msg: ex.msg,
        code: ex.code,
        line: ex.line,
        column: ex.column
      };
    }
    assert.deepEqual(expected, actual);
  }
});
