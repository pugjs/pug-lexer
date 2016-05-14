2.0.0 / 2016-05-14
==================

  * Take the `filename` as an option rather than special casing it.  This means that lex only takes 2 arguments rather than 3
  * Add support for an inline comment after a block.  This means block names can no longer contain `//`
  * Add type checking on arguments

1.2.0 / 2016-05-14
==================

  * Throw a more helpful error if someone attempts to use the old `- each foo in bar` syntax (it should not have the `- ` prefix)
  * Add Error reporting for invalid case expressions

1.0.1 / 2016-04-18
==================

  * Update dependencies
    - Update to `is-expression@2` which allows ES2015-style template strings
      by default.

1.0.0 / 2015-12-23
==================

  * First stable release
