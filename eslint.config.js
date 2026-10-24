import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "node_modules/**",
      "logs/**",
      "graphify-out/**",
      ".archify/**",
      "docs/**",
      "openspec/**",
      "**/*.json",
    ],
  },
  tseslint.configs.base,
  {
    files: ["**/*.ts"],
    rules: {
      "@typescript-eslint/no-magic-numbers": [
        "error",
        {
          ignore: [-1, 0, 1],
          ignoreArrayIndexes: true,
          ignoreDefaultValues: true,
          ignoreClassFieldInitialValues: true,
          enforceConst: true,
          ignoreNumericLiteralTypes: true,
          ignoreEnums: true,
          ignoreReadonlyClassProperties: true,
          ignoreTypeIndexes: true,
        },
      ],
      "@typescript-eslint/explicit-module-boundary-types": "error",
    },
  },
  {
    files: ["**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-magic-numbers": "off",
    },
  }
);
