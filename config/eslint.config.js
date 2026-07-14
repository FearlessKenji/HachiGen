// Central ESLint configuration for the standalone HachiGen repository.
// HachiGen uses Electron, so the config includes Node globals for the main
// process and browser globals for the renderer without inheriting Hachi's bot
// source style rules.
const js = require("@eslint/js");

const nodeGlobals = {
	AbortController: "readonly",
	Buffer: "readonly",
	URL: "readonly",
	__dirname: "readonly",
	clearInterval: "readonly",
	clearTimeout: "readonly",
	console: "readonly",
	fetch: "readonly",
	module: "readonly",
	process: "readonly",
	require: "readonly",
	setInterval: "readonly",
	setTimeout: "readonly",
};

const browserGlobals = {
	Blob: "readonly",
	CustomEvent: "readonly",
	Event: "readonly",
	FileReader: "readonly",
	HTMLElement: "readonly",
	KeyboardEvent: "readonly",
	MouseEvent: "readonly",
	URL: "readonly",
	clearInterval: "readonly",
	clearTimeout: "readonly",
	confirm: "readonly",
	console: "readonly",
	document: "readonly",
	navigator: "readonly",
	setInterval: "readonly",
	setTimeout: "readonly",
	window: "readonly",
};

module.exports = [
	{
		ignores: [
			"dist/**",
			"node_modules/**",
		],
	},

	js.configs.recommended,

	{
		files: [
			"*.js",
			"config/**/*.js",
			"scripts/**/*.js",
			"src/**/*.js",
		],

		languageOptions: {
			ecmaVersion: "latest",
			sourceType: "commonjs",
			globals: nodeGlobals,
		},

		rules: {
			"array-bracket-spacing": ["error", "never"],
			"arrow-spacing": ["error", { before: true, after: true }],
			"brace-style": ["error", "1tbs", { allowSingleLine: true }],
			"comma-dangle": ["error", "always-multiline"],
			"comma-spacing": ["error", { before: false, after: true }],
			"comma-style": ["error", "last"],
			"curly": ["error", "all"],
			"dot-location": ["error", "property"],
			"eqeqeq": ["error", "always"],
			"indent": ["error", "tab"],
			"keyword-spacing": ["error"],
			"max-len": ["error", { code: 220, ignoreComments: true, ignoreUrls: true }],
			"max-statements-per-line": ["error", { max: 1 }],
			"multiline-ternary": ["error", "always-multiline"],
			"no-async-promise-executor": "error",
			"no-console": "off",
			"no-duplicate-imports": "error",
			"no-else-return": "error",
			"no-empty-function": "error",
			"no-eval": "error",
			"no-implied-eval": "error",
			"no-lonely-if": "error",
			"no-multi-spaces": "error",
			"no-multiple-empty-lines": ["error", { max: 1, maxEOF: 0 }],
			"no-param-reassign": "error",
			"no-promise-executor-return": "error",
			"no-return-await": "error",
			"no-shadow": ["error", { allow: ["err", "resolve", "reject"] }],
			"no-trailing-spaces": "error",
			"no-undef": "error",
			"no-unneeded-ternary": "error",
			"no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
			"no-useless-catch": "error",
			"no-useless-return": "error",
			"no-var": "error",
			"object-curly-spacing": ["error", "always"],
			"operator-linebreak": ["error", "after"],
			"prefer-const": "error",
			"quotes": ["error", "double", { avoidEscape: true, allowTemplateLiterals: true }],
			"require-atomic-updates": "error",
			"semi": ["error", "always"],
			"space-before-blocks": "error",
			"space-before-function-paren": [
				"error",
				{
					anonymous: "never",
					named: "never",
					asyncArrow: "always",
				},
			],
			"space-in-parens": ["error", "never"],
			"space-infix-ops": "error",
			"spaced-comment": ["error", "always"],
			"template-curly-spacing": ["error", "never"],
			"yoda": "error",
		},
	},

	{
		files: ["renderer/**/*.js"],

		languageOptions: {
			ecmaVersion: "latest",
			sourceType: "script",
			globals: browserGlobals,
		},
	},
];
