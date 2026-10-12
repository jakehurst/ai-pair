// Stylelint for the panel's stylesheet, by Google's HTML/CSS Style Guide (#132). Prettier does the
// formatting rules: indentation, spacing, one selector and one declaration per line, semicolons.
// lint_web.ts runs Stylelint with it: Stylelint can't load a TypeScript config itself.

import type { Config } from 'stylelint';

/** Stylelint's configuration for the panel's stylesheet. */
export const config: Config = {
  extends: ['stylelint-config-recommended'],
  plugins: ['@stylistic/stylelint-plugin', 'stylelint-order'],
  rules: {
    // Not in the guide; fixing its hits would split the file's sections.
    // Stylelint turns a rule off with `null`.
    // oxlint-disable-next-line unicorn/no-null
    'no-descending-specificity': null,
    // Capitalization: lowercase.
    '@stylistic/at-rule-name-case': 'lower',
    '@stylistic/color-hex-case': 'lower',
    'function-name-case': 'lower',
    '@stylistic/media-feature-name-case': 'lower',
    '@stylistic/property-case': 'lower',
    '@stylistic/selector-pseudo-class-case': 'lower',
    '@stylistic/selector-pseudo-element-case': 'lower',
    'selector-type-case': 'lower',
    '@stylistic/unit-case': 'lower',
    'value-keyword-case': 'lower',
    // Protocol: HTTPS.
    'function-url-no-scheme-relative': true,
    'function-url-scheme-disallowed-list': ['http'],
    // Class Naming, Class Name Delimiters: words separated by hyphens.
    'selector-class-pattern': '^[a-z][a-z0-9]*(-[a-z0-9]+)*$',
    // Type Selectors, ID Selectors.
    'selector-no-qualifying-type': [true, { ignore: ['attribute'] }],
    'selector-max-id': 0,
    // Shorthand Properties.
    'declaration-block-no-redundant-longhand-properties': true,
    'shorthand-property-no-redundant-values': true,
    // 0 and Units, Leading 0s, Hexadecimal Notation.
    'length-zero-no-unit': true,
    '@stylistic/number-leading-zero': 'always',
    'color-hex-length': 'short',
    // Important Declarations.
    'declaration-no-important': true,
    // Declaration Order: alphabetical.
    'order/properties-alphabetical-order': true,
    // Rule Separation: a blank line between rules.
    'rule-empty-line-before': ['always-multi-line', { except: ['first-nested'], ignore: ['after-comment'] }],
    // CSS Quotation Marks: single, and none in url().
    '@stylistic/string-quotes': 'single',
    'function-url-quotes': 'never',
  },
};
