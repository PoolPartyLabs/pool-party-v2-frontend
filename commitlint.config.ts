const config = {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "scope-case": [0],
    "type-enum": [
      2,
      "always",
      [
        "feat",
        "fix",
        "chore",
        "docs",
        "style",
        "refactor",
        "test",
        "perf",
        "i18n",
        "ci",
        "build",
        "revert",
      ],
    ],
  },
};

export default config;
