import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

// Files to update with the new version
const FILES_TO_UPDATE = [
  {
    path: 'package.json',
    type: 'json',
    keyPath: ['version']
  },
  {
    path: 'desktop/package.json',
    type: 'json',
    keyPath: ['version']
  },
  {
    path: 'desktop/src-tauri/tauri.conf.json',
    type: 'json',
    keyPath: ['version']
  },
  {
    path: 'desktop/src-tauri/Cargo.toml',
    type: 'toml',
    regex: /^version\s*=\s*"([^"]+)"/m
  },
  {
    path: 'packages/kova-react/package.json',
    type: 'json',
    keyPath: ['version']
  },
  {
    path: 'mobile/package.json',
    type: 'json',
    keyPath: ['version']
  },
  {
    path: 'mobile/src-tauri/tauri.conf.json',
    type: 'json',
    keyPath: ['version']
  },
  {
    path: 'mobile/src-tauri/Cargo.toml',
    type: 'toml',
    regex: /^version\s*=\s*"([^"]+)"/m
  }
];

function getLatestTag() {
  try {
    return execSync('git describe --tags --abbrev=0', { encoding: 'utf8' }).trim();
  } catch (error) {
    console.log('⚠️ No git tags found. Defaulting to v0.0.0.');
    return 'v0.0.0';
  }
}

function getCommitsSince(tag) {
  try {
    const log = execSync(`git log ${tag}..HEAD --oneline`, { encoding: 'utf8' }).trim();
    return log ? log.split('\n') : [];
  } catch (error) {
    console.error(`❌ Failed to get commits since ${tag}:`, error.message);
    return [];
  }
}

function determineBumpType(commits) {
  if (commits.length === 0) {
    return 'none';
  }

  let bump = 'none';

  for (const commit of commits) {
    // Clean up the hash to get the message
    const message = commit.substring(commit.indexOf(' ') + 1).trim();

    // Check for breaking change markers
    const isBreaking = message.includes('BREAKING CHANGE') || 
                       /^[a-zA-Z0-9_-]+\([^)]+\)!:/.test(message) || 
                       /^[a-zA-Z0-9_-]+!:/.test(message);

    if (isBreaking) {
      return 'major'; // Highest precedence
    }

    if (message.startsWith('feat')) {
      bump = 'minor'; // Takes precedence over patch
    } else if ((message.startsWith('fix') || message.startsWith('perf')) && bump !== 'minor') {
      bump = 'patch';
    } else if (bump === 'none') {
      // For chores, docs, refactor, ci, etc., default to patch bump if there are changes
      bump = 'patch';
    }
  }

  return bump;
}

function bumpVersion(currentVersion, bumpType) {
  const parts = currentVersion.replace(/^v/, '').split('.').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) {
    throw new Error(`Invalid version format: ${currentVersion}`);
  }

  let [major, minor, patch] = parts;

  switch (bumpType) {
    case 'major':
      major += 1;
      minor = 0;
      patch = 0;
      break;
    case 'minor':
      minor += 1;
      patch = 0;
      break;
    case 'patch':
      patch += 1;
      break;
    default:
      break;
  }

  return `${major}.${minor}.${patch}`;
}

function getNestedValue(obj, keyPath) {
  let current = obj;
  for (const key of keyPath) {
    if (current === undefined || current === null) return undefined;
    current = current[key];
  }
  return current;
}

function setNestedValue(obj, keyPath, value) {
  let current = obj;
  for (let i = 0; i < keyPath.length - 1; i++) {
    const key = keyPath[i];
    if (!(key in current)) {
      current[key] = {};
    }
    current = current[key];
  }
  current[keyPath[keyPath.length - 1]] = value;
}

function updateFile(fileInfo, newVersion) {
  const filePath = path.resolve(process.cwd(), fileInfo.path);
  if (!fs.existsSync(filePath)) {
    console.log(`⚠️ File not found, skipping: ${fileInfo.path}`);
    return false;
  }

  const content = fs.readFileSync(filePath, 'utf8');

  if (fileInfo.type === 'json') {
    const json = JSON.parse(content);
    setNestedValue(json, fileInfo.keyPath, newVersion);
    // Write back with 2 spaces indentation and trailing newline
    fs.writeFileSync(filePath, JSON.stringify(json, null, 2) + '\n', 'utf8');
    console.log(`✅ Updated JSON: ${fileInfo.path} -> ${newVersion}`);
    return true;
  } 
  
  if (fileInfo.type === 'toml') {
    if (fileInfo.regex) {
      const match = content.match(fileInfo.regex);
      if (match) {
        // Replace first occurrence of version = "..."
        const updatedContent = content.replace(fileInfo.regex, `version = "${newVersion}"`);
        fs.writeFileSync(filePath, updatedContent, 'utf8');
        console.log(`✅ Updated TOML: ${fileInfo.path} -> ${newVersion}`);
        return true;
      }
    }
    console.log(`⚠️ Could not match version regex in TOML: ${fileInfo.path}`);
    return false;
  }

  return false;
}

function main() {
  console.log('🔍 Analyzing Git history for version recommendation...');

  const latestTag = getLatestTag();
  console.log(`📌 Latest release tag: ${latestTag}`);

  const commits = getCommitsSince(latestTag);
  console.log(`📝 Commits since ${latestTag}: ${commits.length}`);
  commits.forEach(commit => console.log(`   - ${commit}`));

  const bumpType = determineBumpType(commits);
  console.log(`📈 Recommended bump type: ${bumpType.toUpperCase()}`);

  if (bumpType === 'none') {
    console.log('✅ No new release commits detected. Version remains unchanged.');
    return;
  }

  // Get current version from root package.json
  const rootPackagePath = path.resolve(process.cwd(), 'package.json');
  const rootJson = JSON.parse(fs.readFileSync(rootPackagePath, 'utf8'));
  const currentVersion = rootJson.version;

  const nextVersion = bumpVersion(currentVersion, bumpType);
  console.log(`🚀 Bumping version: ${currentVersion} -> ${nextVersion}`);

  // Check if dry run (passed via CLI flag)
  const isDryRun = process.argv.includes('--dry-run');
  if (isDryRun) {
    console.log('\n✨ [DRY RUN] Would update the following files:');
    FILES_TO_UPDATE.forEach(file => {
      const filePath = path.resolve(process.cwd(), file.path);
      if (fs.existsSync(filePath)) {
        console.log(`   - ${file.path}`);
      }
    });
    return;
  }

  console.log('\n✏️ Writing updates...');
  let updatedCount = 0;
  for (const file of FILES_TO_UPDATE) {
    if (updateFile(file, nextVersion)) {
      updatedCount++;
    }
  }

  console.log(`\n🎉 Success! Updated ${updatedCount} files to version ${nextVersion}.`);
  console.log('👉 Next steps:');
  console.log(`   1. Commit these changes: git commit -m "chore(release): bump version to ${nextVersion}"`);
  console.log(`   2. Tag the release: git tag v${nextVersion}`);
  console.log(`   3. Push the tag: git push origin v${nextVersion}`);
}

main();
