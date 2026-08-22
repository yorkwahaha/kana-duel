import js from "@eslint/js";
export default [
  {
    ignores: ["node_modules/**", "assets/**"],
  },
  {
    ...js.configs.recommended,
    files: ["*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: {
        window: "readonly",
        document: "readonly",
        console: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        requestAnimationFrame: "readonly",
        cancelAnimationFrame: "readonly",
        Audio: "readonly",
        Image: "readonly",
        URL: "readonly",
        Promise: "readonly",
        Math: "readonly",
        performance: "readonly",
        location: "readonly",
        KANA_QUESTIONS: "readonly",
        navigator: "readonly",
        fetch: "readonly"
      }
    },
    rules: {
      ...js.configs.recommended.rules,
      "no-unused-vars": ["error", { "vars": "local", "args": "none" }],
      "no-undef": "error",
      "no-empty": ["error", { "allowEmptyCatch": true }]
    }
  },
  {
    ...js.configs.recommended,
    files: ["tests/**/*.test.mjs"],
    languageOptions: {
      globals: {
        Request: "readonly",
        setTimeout: "readonly"
      }
    }
  },
  {
    ...js.configs.recommended,
    files: ["worker/**/*.mjs"],
    languageOptions: {
      globals: {
        crypto: "readonly",
        DurableObject: "readonly",
        Headers: "readonly",
        Response: "readonly",
        Uint8Array: "readonly",
        URL: "readonly",
        WebSocket: "readonly",
        WebSocketPair: "readonly"
      }
    },
    rules: {
      "no-control-regex": "off",
      "no-empty": ["error", { "allowEmptyCatch": true }],
      "no-unused-vars": ["error", { "args": "none", "caughtErrors": "none" }]
    }
  },
  {
    ...js.configs.recommended,
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      globals: {
        Buffer: "readonly",
        fetch: "readonly",
        process: "readonly",
        setTimeout: "readonly"
      }
    }
  }
];
