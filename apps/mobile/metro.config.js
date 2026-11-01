const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

/** @type {import("expo/metro-config").MetroConfig} */
const config = getDefaultConfig(__dirname);

// The repo root pins a different React (web app). Resolve react and
// react-native from this package so Metro bundles exactly one copy.
const own = (name) => path.dirname(require.resolve(`${name}/package.json`));
config.resolver = {
  ...config.resolver,
  extraNodeModules: {
    ...config.resolver?.extraNodeModules,
    react: own("react"),
    "react-native": own("react-native"),
  },
};

module.exports = config;
