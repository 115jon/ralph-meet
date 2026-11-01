const { withAppBuildGradle } = require("expo/config-plugins");

// Signs `release` builds with the upload keystore named by environment
// variables (or gradle properties) read at gradle time, so nothing secret is
// written into android/app/build.gradle. Without them the release build keeps
// the template's debug signing, so local release builds still work.
const MARKER = "// ralph-release-signing";

const HELPER = `    ${MARKER}
    def ralphProp = { String name -> System.getenv(name) ?: findProperty(name) }
    def ralphSigning = ["RALPH_UPLOAD_STORE_FILE", "RALPH_UPLOAD_STORE_PASSWORD", "RALPH_UPLOAD_KEY_ALIAS", "RALPH_UPLOAD_KEY_PASSWORD"].every { ralphProp(it) }
`;

const RELEASE_CONFIG = `        if (ralphSigning) {
            release {
                storeFile file(ralphProp("RALPH_UPLOAD_STORE_FILE"))
                storePassword ralphProp("RALPH_UPLOAD_STORE_PASSWORD")
                keyAlias ralphProp("RALPH_UPLOAD_KEY_ALIAS")
                keyPassword ralphProp("RALPH_UPLOAD_KEY_PASSWORD")
            }
        }
`;

const USE_RELEASE =
  "signingConfig ralphSigning ? signingConfigs.release : signingConfigs.debug";

function inject(contents) {
  if (contents.includes(MARKER)) return contents;

  const signingStart = contents.match(/^ {4}signingConfigs \{\n/m);
  const releaseType = contents.match(
    /(buildTypes \{[\s\S]*?\n {8}release \{[\s\S]*?)signingConfig signingConfigs\.debug/,
  );
  if (!signingStart || !releaseType) {
    throw new Error(
      "withReleaseSigning: android/app/build.gradle layout changed; update the plugin.",
    );
  }

  let next = contents.replace(releaseType[0], releaseType[1] + USE_RELEASE);
  const at = next.indexOf(signingStart[0]);
  next = next.slice(0, at) + HELPER + next.slice(at);

  // Add the release config at the end of the signingConfigs block.
  const open = next.indexOf(signingStart[0]) + signingStart[0].length;
  const close = next.indexOf("\n    }\n", open);
  return next.slice(0, close + 1) + RELEASE_CONFIG + next.slice(close + 1);
}

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (nextConfig) => {
    nextConfig.modResults.contents = inject(nextConfig.modResults.contents);
    return nextConfig;
  });
};
