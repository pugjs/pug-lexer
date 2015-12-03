# jade-lexer

The jade lexer.  This module is responsible for taking a string and converting it into an array of tokens.

[![Build Status](https://img.shields.io/travis/jadejs/jade-lexer/master.svg)](https://travis-ci.org/jadejs/jade-lexer)
[![Dependency Status](https://img.shields.io/gemnasium/jadejs/jade-lexer.svg)](https://gemnasium.com/jadejs/jade-lexer)
[![NPM version](https://img.shields.io/npm/v/jade-lexer.svg)](https://www.npmjs.org/package/jade-lexer)

## Installation

    npm install jade-lexer

## Usage

```js
var lex = require('jade-lexer');
```

### `lex(str, filename, options)`

Convert Jade string to an array of tokens.

`filename`, if provided, is used in error handling.

`options` can contain the following property:

- `plugins` (array): An array of plugins, in the order they should be applied.

```js
console.log(JSON.stringify(lex('div(data-foo="bar")', 'my-file.jade'), null, '  '))
```

```json
[
  {
    "type": "tag",
    "line": 1,
    "val": "div",
    "selfClosing": false
  },
  {
    "type": "attrs",
    "line": 1,
    "attrs": [
      {
        "name": "data-foo",
        "val": "\"bar\"",
        "escaped": true
      }
    ]
  },
  {
    "type": "eos",
    "line": 1
  }
]
```

### `new lex.Lexer(str, filename, options)`

Constructor for a Lexer class. This is not meant to be used directly unless you know what you are doing.

`options` may contain the following properties:

- `interpolated` (boolean): if the Lexer is created as a child lexer for inline tag interpolation (e.g. `#[p Hello]`). Defaults to `false`.
- `startingLine` (integer): the real line number of the first line in the input. It is also used for inline tag interpolation. Defaults to `1`.
- `plugins` (array): An array of plugins, in the order they should be applied.

## License

  MIT
