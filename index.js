'use strict';

var assert = require('assert');
var characterParser = require('character-parser');
var error = require('jade-error');

module.exports = lex;
module.exports.Lexer = Lexer;
function lex(str, filename) {
  var lexer = new Lexer(str, filename);
  return JSON.parse(JSON.stringify(lexer.getTokens()));
}

/**
 * Initialize `Lexer` with the given `str`.
 *
 * @param {String} str
 * @param {String} filename
 * @api private
 */

function Lexer(str, filename, options) {
  options = options || {};
  //Strip any UTF-8 BOM off of the start of `str`, if it exists.
  str = str.replace(/^\uFEFF/, '');
  this.input = str.replace(/\r\n|\r/g, '\n');
  this.originalInput = this.input;
  this.filename = filename;
  this.interpolated = options.interpolated || false;
  this.lineno = options.startingLine || 1;
  this.indentStack = [0];
  this.indentRe = null;
  this.pipeless = false;
  this.startedPipeless = false;
  // If #{} or !{} syntax is allowed when adding text
  this.interpolationAllowed = true;

  this.tokens = [];
  this.ended = false;
};

/**
 * Lexer prototype.
 */

Lexer.prototype = {

  constructor: Lexer,

  error: function (code, message) {
    var err = error(code, message, {line: this.lineno, filename: this.filename, src: this.originalInput});
    throw err;
  },

  assert: function (value, message) {
    if (!value) this.error('ASSERT_FAILED', message);
  },

  assertExpression: function (exp) {
    //this verifies that a JavaScript expression is valid
    try {
      Function('', 'return (' + exp + ')');
    } catch (ex) {
      var msg = 'Syntax Error: ' + ex.message;
      this.error('SYNTAX_ERROR', msg);
    }
  },

  assertNestingCorrect: function (exp) {
    //this verifies that code is properly nested, but allows
    //invalid JavaScript such as the contents of `attributes`
    var res = characterParser(exp)
    if (res.isNesting()) {
      this.error('INCORRECT_NESTING', 'Nesting must match on expression `' + exp + '`')
    }
  },

  /**
   * Construct a token with the given `type` and `val`.
   *
   * @param {String} type
   * @param {String} val
   * @return {Object}
   * @api private
   */

  tok: function(type, val){
    return val === undefined ?
      {type: type, line: this.lineno} :
      {type: type, line: this.lineno, val: val};
  },

  /**
   * Consume the given `len` of input.
   *
   * @param {Number} len
   * @api private
   */

  consume: function(len){
    this.input = this.input.substr(len);
  },

  /**
   * Scan for `type` with the given `regexp`.
   *
   * @param {String} type
   * @param {RegExp} regexp
   * @return {Object}
   * @api private
   */

  scan: function(regexp, type){
    var captures;
    if (captures = regexp.exec(this.input)) {
      this.consume(captures[0].length);
      return this.tok(type, captures[1]);
    }
  },
  scanEndOfLine: function (regexp, type) {
    var captures;
    if (captures = regexp.exec(this.input)) {
      var newInput = this.input.substr(captures[0].length);
      if (newInput[0] === ':') {
        this.input = newInput;
        return this.tok(type, captures[1]);
      }
      if (/^[ \t]*(\n|$)/.test(newInput)) {
        this.input = newInput.substr(/^[ \t]*/.exec(newInput)[0].length);
        return this.tok(type, captures[1]);
      }
    }
  },

  /**
   * Return the indexOf `(` or `{` or `[` / `)` or `}` or `]` delimiters.
   *
   * @return {Number}
   * @api private
   */

  bracketExpression: function(skip){
    skip = skip || 0;
    var start = this.input[skip];
    assert(start === '(' || start === '{' || start === '[',
           'The start character should be "(", "{" or "["');
    var end = ({'(': ')', '{': '}', '[': ']'})[start];
    var range;
    try {
      range = characterParser.parseMaxBracket(this.input, end, {start: skip + 1});
    } catch (ex) {
      this.error('BRACKET_MISMATCH', ex.message);
    }
    return range;
  },

  scanIndentation: function() {
    var captures, re;

    // established regexp
    if (this.indentRe) {
      captures = this.indentRe.exec(this.input);
    // determine regexp
    } else {
      // tabs
      re = /^\n(\t*) */;
      captures = re.exec(this.input);

      // spaces
      if (captures && !captures[1].length) {
        re = /^\n( *)/;
        captures = re.exec(this.input);
      }

      // established
      if (captures && captures[1].length) this.indentRe = re;
    }

    return captures;
  },

  /**
   * end-of-source.
   */

  eos: function() {
    if (this.input.length) return;
    if (this.interpolated) {
      this.error('NO_END_BRACKET', 'End of line was reached with no closing bracket for interpolation.');
    }
    for (var i = 0; this.indentStack[i]; i++) {
      this.tokens.push(this.tok('outdent'));
    }
    this.tokens.push(this.tok('eos'));
    this.ended = true;
    return true;
  },

  /**
   * Blank line.
   */

  blank: function() {
    var captures;
    if (captures = /^\n[ \t]*\n/.exec(this.input)) {
      this.consume(captures[0].length - 1);
      ++this.lineno;
      if (this.startedPipeless) this.tokens.push(this.tok('text', ''));
      return true;
    }
  },

  /**
   * Comment.
   */

  comment: function() {
    var captures;
    if (captures = /^\/\/(-)?([^\n]*)/.exec(this.input)) {
      this.consume(captures[0].length);
      var tok = this.tok('comment', captures[2]);
      tok.buffer = '-' != captures[1];
      this.pipeless = true;
      this.interpolationAllowed = tok.buffer;
      this.tokens.push(tok);
      return true;
    }
  },

  /**
   * Interpolated tag.
   */

  interpolation: function() {
    if (/^#\{/.test(this.input)) {
      var match = this.bracketExpression(1);
      this.consume(match.end + 1);
      var tok = this.tok('interpolation', match.src);
      this.tokens.push(tok);
      return true;
    }
  },

  /**
   * Tag.
   */

  tag: function() {
    var captures;
    if (captures = /^(\w(?:[-:\w]*\w)?)/.exec(this.input)) {
      this.consume(captures[0].length);
      var tok, name = captures[1];
      tok = this.tok('tag', name);
      this.tokens.push(tok);
      return true;
    }
  },

  /**
   * Filter.
   */

  filter: function(opts) {
    var tok = this.scan(/^:([\w\-]+)/, 'filter');
    var inInclude = opts && opts.inInclude;
    if (tok) {
      if (!inInclude) {
        this.pipeless = true;
        this.interpolationAllowed = false;
      }
      this.tokens.push(tok);
      return true;
    }
  },

  /**
   * Doctype.
   */

  doctype: function() {
    if (this.scan(/^!!! *([^\n]+)?/, 'doctype')) {
      this.error('OLD_DOCTYPE', '`!!!` is deprecated, you must now use `doctype`');
    }
    var node = this.scanEndOfLine(/^doctype *([^\n]*)/, 'doctype');
    if (node && node.val.trim() === '5') {
      this.error('OLD_DOCTYPE', '`doctype 5` is deprecated, you must now use `doctype html`');
    }
    if (node) {
      this.tokens.push(node);
      return true;
    }
  },

  /**
   * Id.
   */

  id: function() {
    var tok = this.scan(/^#([\w-]+)/, 'id');
    if (tok) {
      this.tokens.push(tok);
      return true;
    }
    if (/^#/.test(this.input)) {
      this.error('INVALID_ID', '"' + /.[^ \t\(\#\.\:]*/.exec(this.input.substr(1))[0] + '" is not a valid ID.');
    }
  },

  /**
   * Class.
   */

  className: function() {
    var tok = this.scan(/^\.(\-?[_a-z][_a-z0-9\-]*)/i, 'class');
    if (tok) {
      this.tokens.push(tok);
      return true;
    }
    if (/^\.\-/i.test(this.input)) {
      this.error('INVALID_CLASS_NAME', 'If a class name begins with a "-", it must be followed by a letter or underscore.');
    }
    if (/^\.[0-9]/i.test(this.input)) {
      this.error('INVALID_CLASS_NAME', 'Class names must begin with "-", "_" or a letter.');
    }
    if (/^\./.test(this.input)) {
      this.error('INVALID_CLASS_NAME', '"' + /.[^ \t\(\#\.\:]*/.exec(this.input.substr(1))[0] + '" is not a valid class name.  Class names must begin with "-", "_" or a letter and can only contain "_", "-", a-z and 0-9.');
    }
  },

  /**
   * Text.
   */
  endInterpolation: function () {
    if (this.interpolated && this.input[0] === ']') {
      this.input = this.input.substr(1);
      this.ended = true;
      return true;
    }
  },
  addText: function (value, prefix) {
    if (value + prefix === '') return;
    prefix = prefix || '';
    var indexOfEnd = this.interpolated ? value.indexOf(']') : -1;
    var indexOfStart = value.indexOf('#[');
    var indexOfEscaped = value.indexOf('\\#[');
    var matchOfStringInterp = /(\\)?([#!]){((?:.|\n)*)$/.exec(value);
    var indexOfStringInterp = this.interpolationAllowed && matchOfStringInterp ? matchOfStringInterp.index : Infinity;

    if (indexOfEnd === -1) indexOfEnd = Infinity;
    if (indexOfStart === -1) indexOfStart = Infinity;
    if (indexOfEscaped === -1) indexOfEscaped = Infinity;

    if (indexOfEscaped !== Infinity && indexOfEscaped < indexOfEnd && indexOfEscaped < indexOfStart && indexOfEscaped < indexOfStringInterp) {
      prefix = prefix + value.substring(0, indexOfEscaped) + '#[';
      return this.addText(value.substring(indexOfEscaped + 3), prefix);
    }
    if (indexOfStart !== Infinity && indexOfStart < indexOfEnd && indexOfStart < indexOfEscaped && indexOfStart < indexOfStringInterp) {
      this.tokens.push(this.tok('text', prefix + value.substring(0, indexOfStart)));
      this.tokens.push(this.tok('start-jade-interpolation'));
      var child = new this.constructor(value.substr(indexOfStart + 2), this.filename, {
        interpolated: true,
        startingLine: this.lineno
      });
      var interpolated = child.getTokens();
      this.tokens = this.tokens.concat(interpolated);
      this.tokens.push(this.tok('end-jade-interpolation'));
      this.addText(child.input);
      return;
    }
    if (indexOfEnd !== Infinity && indexOfEnd < indexOfStart && indexOfEnd < indexOfEscaped && indexOfEnd < indexOfStringInterp) {
      if (prefix + value.substring(0, indexOfEnd)) {
        this.addText(value.substring(0, indexOfEnd), prefix);
      }
      this.ended = true;
      this.input = value.substr(value.indexOf(']') + 1) + this.input;
      return;
    }
    if (indexOfStringInterp !== Infinity) {
      if (matchOfStringInterp[1]) {
        prefix = prefix + value.substring(0, indexOfStringInterp) + '#{';
        return this.addText(value.substring(indexOfStringInterp + 3), prefix);
      }
      var before = value.substr(0, indexOfStringInterp);
      if (prefix || before) this.tokens.push(this.tok('text', prefix + before));

      var rest = matchOfStringInterp[3];
      var range = characterParser.parseMaxBracket(rest, '}');
      var tok = this.tok('interpolated-code', range.src);
      tok.mustEscape = matchOfStringInterp[2] === '#';
      tok.buffer = true;
      this.tokens.push(tok);
      if (range.end + 1 < rest.length) this.addText(rest.substr(range.end + 1));
      return;
    }

    this.tokens.push(this.tok('text', prefix + value));
  },

  text: function() {
    var tok = this.scan(/^(?:\| ?| )([^\n]+)/, 'text') ||
      this.scan(/^\|?( )/, 'text');
    if (tok) {
      this.addText(tok.val);
      return true;
    }
  },

  textHtml: function () {
    var tok = this.scan(/^(<[^\n]*)/, 'text-html');
    if (tok) {
      this.tokens.push(tok);
      return true;
    }
  },

  /**
   * Dot.
   */

  dot: function() {
    var tok;
    if (tok = this.scanEndOfLine(/^\./, 'dot')) {
      this.pipeless = true;
      this.tokens.push(tok);
      return true;
    }
  },

  /**
   * Extends.
   */

  "extends": function() {
    var tok = this.scan(/^extends?(?= |$|\n)/, 'extends');
    if (tok) {
      this.tokens.push(tok);
      if (!this.path()) {
        this.error('NO_EXTENDS_PATH', 'missing path for extends');
      }
      return true;
    }
    if (this.scan(/^extends?\b/)) {
      this.error('MALFORMED_EXTENDS', 'malformed extends');
    }
  },

  /**
   * Block prepend.
   */

  prepend: function() {
    var captures;
    if (captures = /^prepend +([^\n]+)/.exec(this.input)) {
      var mode = 'prepend'
        , name = captures[1].trim()
        , tok = this.tok('block', name);
      if (!name) return;
      this.consume(captures[0].length);
      tok.mode = mode;
      this.tokens.push(tok);
      return true;
    }
  },

  /**
   * Block append.
   */

  append: function() {
    var captures;
    if (captures = /^append +([^\n]+)/.exec(this.input)) {
      var mode = 'append'
        , name = captures[1].trim()
        , tok = this.tok('block', name);
      if (!name) return;
      this.consume(captures[0].length);
      tok.mode = mode;
      this.tokens.push(tok);
      return true;
    }
  },

  /**
   * Block.
   */

  block: function() {
    var captures;
    if (captures = /^block\b *(?:(prepend|append) +)?([^\n]+)/.exec(this.input)) {
      var mode = captures[1] || 'replace'
        , name = captures[2].trim()
        , tok = this.tok('block', name);
      if (!name) return;
      this.consume(captures[0].length);

      tok.mode = mode;
      this.tokens.push(tok);
      return true;
    }
  },

  /**
   * Mixin Block.
   */

  mixinBlock: function() {
    var tok;
    if (tok = this.scanEndOfLine(/^block/, 'mixin-block')) {
      this.tokens.push(tok);
      return true;
    }
  },

  /**
   * Yield.
   */

  'yield': function() {
    var tok = this.scanEndOfLine(/^yield/, 'yield');
    if (tok) {
      this.tokens.push(tok);
      return true;
    }
  },

  /**
   * Include.
   */

  include: function() {
    var tok = this.scan(/^include(?=:| |$|\n)/, 'include');
    if (tok) {
      this.tokens.push(tok);
      while (this.filter({ inInclude: true })) {
        this.attrs();
      }
      if (!this.path()) {
        if (/^[^ \n]+/.test(this.input)) {
          // if there is more text
          this.fail();
        } else {
          // if not
          this.error('NO_INCLUDE_PATH', 'missing path for include');
        }
      }
      return true;
    }
    if (this.scan(/^include\b/)) {
      this.error('MALFORMED_INCLUDE', 'malformed include');
    }
  },

  /**
   * Path
   */

  path: function() {
    var tok = this.scanEndOfLine(/^ +([^\n]+)/, 'path');
    // the .trim() is necessary since we want to avoid `  ` from being
    // matched, as the second space satisfies `[^\n]+`
    if (tok && tok.val.trim()) {
      this.tokens.push(tok);
      return true;
    }
  },

  /**
   * Case.
   */

  "case": function() {
    var tok = this.scanEndOfLine(/^case +([^\n]+)/, 'case');
    if (tok) {
      this.tokens.push(tok);
      return true;
    }
    if (this.scan(/^case\b/)) {
      this.error('NO_CASE_EXPRESSION', 'missing expression for case');
    }
  },

  /**
   * When.
   */

  when: function() {
    var tok = this.scanEndOfLine(/^when +([^:\n]+)/, 'when');
    if (tok) {
      this.tokens.push(tok);
      return true;
    }
    if (this.scan(/^when\b/)) {
      this.error('NO_WHEN_EXPRESSION', 'missing expression for when');
    }
  },

  /**
   * Default.
   */

  "default": function() {
    var tok = this.scanEndOfLine(/^default/, 'default');
    if (tok) {
      this.tokens.push(tok);
      return true;
    }
    if (this.scan(/^default\b/)) {
      this.error('DEFAULT_WITH_EXPRESSION', 'default should not have an expression');
    }
  },

  /**
   * Call mixin.
   */

  call: function(){

    var tok, captures;
    if (captures = /^\+(\s*)(([-\w]+)|(#\{))/.exec(this.input)) {
      // try to consume simple or interpolated call
      if (captures[3]) {
        // simple call
        this.consume(captures[0].length);
        tok = this.tok('call', captures[3]);
      } else {
        // interpolated call
        var match = this.bracketExpression(2 + captures[1].length);
        this.consume(match.end + 1);
        this.assertExpression(match.src);
        tok = this.tok('call', '#{'+match.src+'}');
      }

      tok.args = null;
      // Check for args (not attributes)
      if (captures = /^ *\(/.exec(this.input)) {
        var range = this.bracketExpression(captures[0].length - 1);
        if (!/^\s*[-\w]+ *=/.test(range.src)) { // not attributes
          this.consume(range.end + 1);
          tok.args = range.src;
          this.assertExpression('[' + tok.args + ']');
          this.lineno += tok.args.split("\n").length - 1;
        }
      }
      this.tokens.push(tok);
      return true;
    }
  },

  /**
   * Mixin.
   */

  mixin: function(){
    var captures;
    if (captures = /^mixin +([-\w]+)(?: *\((.*)\))? */.exec(this.input)) {
      this.consume(captures[0].length);
      var tok = this.tok('mixin', captures[1]);
      tok.args = captures[2] || null;
      this.tokens.push(tok);
      return true;
    }
  },

  /**
   * Conditional.
   */

  conditional: function() {
    var captures;
    if (captures = /^(if|unless|else if|else)\b([^\n]*)/.exec(this.input)) {
      this.consume(captures[0].length);
      var type = captures[1].replace(/ /g, '-');
      var js = captures[2] && captures[2].trim();

      switch (type) {
        case 'if':
        case 'else-if':
          this.assertExpression(js);
          break;
        case 'unless':
          this.assertExpression(js);
          js = '!(' + js + ')';
          type = 'if';
          break;
        case 'else':
          if (js) {
            this.error(
              'ELSE_CONDITION',
              '`else` cannot have a condition, perhaps you meant `else if`'
            );
          }
          break;
      }
      // type can be "if", "else-if" and "else"
      this.tokens.push(this.tok(type, js));
      return true;
    }
  },

  /**
   * While.
   */

  "while": function() {
    var captures;
    if (captures = /^while +([^\n]+)/.exec(this.input)) {
      this.consume(captures[0].length);
      this.assertExpression(captures[1])
      this.tokens.push(this.tok('while', captures[1]));
      return true;
    }
    if (this.scan(/^while\b/)) {
      this.error('NO_WHILE_EXPRESSION', 'missing expression for while');
    }
  },

  /**
   * Each.
   */

  each: function() {
    var captures;
    if (captures = /^(?:each|for) +([a-zA-Z_$][\w$]*)(?: *, *([a-zA-Z_$][\w$]*))? * in *([^\n]+)/.exec(this.input)) {
      this.consume(captures[0].length);
      var tok = this.tok('each', captures[1]);
      tok.key = captures[2] || null;
      this.assertExpression(captures[3])
      tok.code = captures[3];
      this.tokens.push(tok);
      return true;
    }
    if (this.scan(/^(?:each|for)\b/)) {
      this.error('MALFORMED_EACH', 'malformed each');
    }
  },

  /**
   * Code.
   */

  code: function() {
    var captures;
    if (captures = /^(!?=|-)[ \t]*([^\n]+)/.exec(this.input)) {
      var flags = captures[1];
      var code = captures[2];
      var shortened = 0;
      if (this.interpolated) {
        var parsed;
        try {
          parsed = characterParser.parseMaxBracket(code, ']');
        } catch (err) {
          this.error('NO_END_BRACKET', 'End of line was reached with no closing bracket for interpolation.');
        }
        shortened = code.length - parsed.end;
        code = parsed.src;
      }
      this.consume(captures[0].length - shortened);
      var tok = this.tok('code', code);
      tok.mustEscape = flags.charAt(0) === '=';
      tok.buffer = flags.charAt(0) === '=' || flags.charAt(1) === '=';
      if (tok.buffer) this.assertExpression(code);
      this.tokens.push(tok);
      return true;
    }
  },

  /**
   * Block code.
   */
  blockCode: function() {
    var tok
    if (tok = this.scanEndOfLine(/^-/, 'blockcode')) {
      this.tokens.push(tok);
      this.pipeless = true;
      this.interpolationAllowed = false;
      return true;
    }
  },

  /**
   * Attributes.
   */

  attrs: function() {
    if ('(' == this.input.charAt(0)) {
      this.tokens.push(this.tok('start-attributes'));
      var index = this.bracketExpression().end
        , str = this.input.substr(1, index-1);

      this.assertNestingCorrect(str);

      var quote = '';
      var self = this;

      this.consume(index + 1);

      var whitespaceRe = /[ \n\t]/;
      var quoteRe = /['"]/;

      var escapedAttr = true
      var key = '';
      var val = '';
      var state = characterParser.defaultState();
      var lineno = this.lineno;
      var loc = 'key';
      var isEndOfAttribute = function (i) {
        // if the key is not started, then the attribute cannot be ended
        if (key.trim() === '') return false;
        // if there's nothing more then the attribute must be ended
        if (i === str.length) return true;

        if (loc === 'key') {
          if (whitespaceRe.test(str[i])) {
            // find the first non-whitespace character
            for (var x = i; x < str.length; x++) {
              if (!whitespaceRe.test(str[x])) {
                // starts a `value`
                if (str[x] === '=' || str[x] === '!') return false;
                // will be handled when x === i
                else if (str[x] === ',') return false;
                // attribute ended
                else return true;
              }
            }
          }
          // if there's no whitespace and the character is not ',', the
          // attribute did not end.
          return str[i] === ',';
        } else if (loc === 'value') {
          // if the character is in a string or in parentheses/brackets/braces
          if (state.isNesting() || state.isString()) return false;
          try {
            // if the current value expression is not valid JavaScript, then
            // assume that the user did not end the value
            self.assertExpression(val);
          } catch (ex) {
            return false;
          }
          if (whitespaceRe.test(str[i])) {
            // find the first non-whitespace character
            for (var x = i; x < str.length; x++) {
              if (!whitespaceRe.test(str[x])) {
                // if it is a JavaScript punctuator, then assume that it is
                // a part of the value
                return !characterParser.isPunctuator(str[x]) && !quoteRe.test(str[x]);
              }
            }
          }
          // if there's no whitespace and the character is not ',', the
          // attribute did not end.
          return str[i] === ',';
        }
      }

      for (var i = 0; i <= str.length; i++) {
        if (isEndOfAttribute(i)) {
          val = val.trim();
          if (val) this.assertExpression(val)
          if (key[0] === ':' || key[key.length - 1] === ':') {
            this.error('COLON_ATTRIBUTE', '":" is not valid as the start or end of an un-quoted attribute.');
          }
          key = key.trim();
          key = key.replace(/^['"]|['"]$/g, '');

          var tok = this.tok('attribute');
          tok.name = key;
          tok.val = '' == val ? true : val;
          tok.mustEscape = escapedAttr;
          this.tokens.push(tok);

          key = val = '';
          loc = 'key';
          escapedAttr = false;
          this.lineno = lineno;
        } else {
          switch (loc) {
            case 'key-char':
              if (str[i] === quote) {
                loc = 'key';
                if (i + 1 < str.length && !/[ ,!=\n\t]/.test(str[i + 1]))
                  this.error('INVALID_KEY_CHARACTER', 'Unexpected character "' + str[i + 1] + '" expected ` `, `\\n`, `\t`, `,`, `!` or `=`');
              } else {
                key += str[i];
              }
              break;
            case 'key':
              if (key === '' && quoteRe.test(str[i])) {
                loc = 'key-char';
                quote = str[i];
              } else if (str[i] === '!' || str[i] === '=') {
                escapedAttr = str[i] !== '!';
                if (str[i] === '!') i++;
                if (str[i] !== '=') this.error('INVALID_KEY_CHARACTER', 'Unexpected character ' + str[i] + ' expected `=`');
                loc = 'value';
                state = characterParser.defaultState();
              } else {
                key += str[i]
              }
              break;
            case 'value':
              state = characterParser.parseChar(str[i], state);
              val += str[i];
              break;
          }
        }
        if (str[i] === '\n') {
          // Save the line number locally to keep this.lineno at the start of
          // the attribute.
          lineno++;
          // If the key has not been started, update this.lineno immediately.
          if (!key.trim()) this.lineno = lineno;
        }
      }

      this.tokens.push(this.tok('end-attributes'));
      return true;
    }
  },

  /**
   * &attributes block
   */
  attributesBlock: function () {
    var captures;
    if (/^&attributes\b/.test(this.input)) {
      this.consume(11);
      var args = this.bracketExpression();
      this.consume(args.end + 1);
      this.tokens.push(this.tok('&attributes', args.src));
      return true;
    }
  },

  /**
   * Indent | Outdent | Newline.
   */

  indent: function() {
    var captures = this.scanIndentation();

    if (captures) {
      var tok
        , indents = captures[1].length;

      ++this.lineno;
      this.consume(indents + 1);

      if (' ' == this.input[0] || '\t' == this.input[0]) {
        this.error('INVALID_INDENTATION', 'Invalid indentation, you can use tabs or spaces but not both');
      }

      // blank line
      if ('\n' == this.input[0]) {
        this.pipeless = false;
        this.interpolationAllowed = true;
        return this.tok('newline');
      }

      // outdent
      if (indents < this.indentStack[0]) {
        while (this.indentStack[0] > indents) {
          if (this.indentStack[1] < indents) {
            this.error('INCONSISTENT_INDENTATION', 'Inconsistent indentation. Expecting either ' + this.indentStack[1] + ' or ' + this.indentStack[0] + ' spaces/tabs.');
          }
          this.tokens.push(this.tok('outdent'));
          this.indentStack.shift();
        }
      // indent
      } else if (indents && indents != this.indentStack[0]) {
        this.indentStack.unshift(indents);
        this.tokens.push(this.tok('indent', indents));
      // newline
      } else {
        this.tokens.push(this.tok('newline'));
      }

      this.pipeless = false;
      this.interpolationAllowed = true;
      return true;
    }
  },

  /**
   * Pipe-less text consumed only when
   * pipeless is true;
   */

  pipelessText: function(indents) {
    if (!this.pipeless) return;
    var captures = this.scanIndentation();

    indents = indents || captures && captures[1].length;
    if (indents > this.indentStack[0]) {
      this.tokens.push(this.tok('start-pipeless-text'));
      this.startedPipeless = true;
      var tokens = [];
      var isMatch;
      // Index in this.input. Can't use this.consume because we might need to
      // retry lexing the block.
      var stringPtr = 0;
      do {
        // text has `\n` as a prefix
        var i = this.input.substr(stringPtr + 1).indexOf('\n');
        if (-1 == i) i = this.input.length - stringPtr - 1;
        var str = this.input.substr(stringPtr + 1, i);
        var lineCaptures = this.indentRe.exec('\n' + str);
        var lineIndents = lineCaptures && lineCaptures[1].length;
        isMatch = lineIndents >= indents || !str.trim();
        if (isMatch) {
          // consume test along with `\n` prefix if match
          stringPtr += str.length + 1;
          tokens.push(str.substr(indents));
        } else if (lineIndents > this.indentStack[0]) {
          // line is indented less than the first line but is still indented
          // need to retry lexing the text block
          this.tokens.pop();
          return this.pipelessText(lineCaptures[1].length);
        }
      } while((this.input.length - stringPtr) && isMatch);
      this.consume(stringPtr);
      while (this.input.length === 0 && tokens[tokens.length - 1] === '') tokens.pop();
      tokens.forEach(function (token, i) {
        this.lineno++;
        if (i !== 0) this.tokens.push(this.tok('newline'));
        this.addText(token);
      }.bind(this));
      this.startedPipeless = false;
      this.tokens.push(this.tok('end-pipeless-text'));
      return true;
    }
  },

  /**
   * Slash.
   */

  slash: function() {
    var tok = this.scan(/^\//, 'slash');
    if (tok) {
      this.tokens.push(tok);
      return true;
    }
  },

  /**
   * ':'
   */

  colon: function() {
    var tok = this.scan(/^: +/, ':');
    if (tok) {
      this.tokens.push(tok);
      return true;
    }
  },

  fail: function () {
    this.error('UNEXPECTED_TEXT', 'unexpected text "' + this.input.substr(0, 5) + '"');
  },

  /**
   * Move to the next token
   *
   * @api private
   */

  advance: function() {
    return this.blank()
      || this.eos()
      || this.endInterpolation()
      || this.pipelessText()
      || this.yield()
      || this.doctype()
      || this.interpolation()
      || this["case"]()
      || this.when()
      || this["default"]()
      || this["extends"]()
      || this.append()
      || this.prepend()
      || this.block()
      || this.mixinBlock()
      || this.include()
      || this.mixin()
      || this.call()
      || this.conditional()
      || this.each()
      || this["while"]()
      || this.tag()
      || this.filter()
      || this.blockCode()
      || this.code()
      || this.id()
      || this.dot()
      || this.className()
      || this.attrs()
      || this.attributesBlock()
      || this.indent()
      || this.text()
      || this.textHtml()
      || this.comment()
      || this.slash()
      || this.colon()
      || this.fail();
  },

  /**
   * Return an array of tokens for the current file
   *
   * @returns {Array.<Token>}
   * @api public
   */
  getTokens: function () {
    while (!this.ended) {
      this.advance();
    }
    return this.tokens;
  }
};
