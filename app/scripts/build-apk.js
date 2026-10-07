// Builds the installable Android app (an APK file) on this machine.
//
//   npm run apk                                   -> the app looks for the server on this laptop's Wi-Fi address
//   npm run apk -- https://your-service.onrender.com   -> the app looks for the server there
//
// The address is only the one the app starts with: it can be changed inside the app (first screen, "Server").
// The finished file is copied to release/POTKO-<version>.apk at the top of the project.
// Needs the Android SDK and a JDK 17 or 21. The first build downloads about 1.5 GB of build tools.
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const app = path.resolve(__dirname, '..');
const project = path.resolve(app, '..');
const android = path.join(app, 'android');
const windows = process.platform === 'win32';

function fail(message) {
  console.error(`\n${message}`);
  process.exit(1);
}

// This laptop's address on the Wi-Fi or cable network, e.g. 192.168.1.20
function lanAddress() {
  for (const list of Object.values(os.networkInterfaces())) {
    const found = (list || []).find((a) => a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.'));
    if (found) return found.address;
  }
  return null;
}

// Gradle's Android plugin runs on JDK 17 or 21; a newer default JDK on the machine is skipped.
function javaHome() {
  const candidates = [process.env.POTKO_JAVA_HOME, 'C:/Program Files/Java/jdk-21', 'C:/Program Files/Java/jdk-17', process.env.JAVA_HOME];
  return candidates.find((dir) => dir && fs.existsSync(path.join(dir, 'bin')));
}

function run(command, args, env) {
  const result = spawnSync(command, args, { cwd: env.cwd, env: { ...process.env, ...env.vars }, stdio: 'inherit', shell: windows });
  if (result.status !== 0) fail(`Stopped: "${path.basename(command)} ${args.join(' ')}" did not finish.`);
}

const address = lanAddress();
const server = (process.argv[2] || (address ? `http://${address}:4000` : '')).replace(/\/+$/, '');
if (!/^https?:\/\/[^/]+$/.test(server)) fail('Give the server address, for example: npm run apk -- http://192.168.1.20:4000');

const java = javaHome();
if (!java) fail('No JDK found. Install JDK 21, or set POTKO_JAVA_HOME to its folder.');
const sdk = process.env.ANDROID_HOME || path.join(process.env.LOCALAPPDATA || os.homedir(), 'Android', 'Sdk');
if (!fs.existsSync(sdk)) fail(`No Android SDK at ${sdk}. Install it, or set ANDROID_HOME.`);

const vars = {
  JAVA_HOME: java,
  ANDROID_HOME: sdk,
  ANDROID_SDK_ROOT: sdk,
  GRADLE_USER_HOME: path.join(project, '.gradle-home'), // build caches stay inside the project folder
  JAVA_TOOL_OPTIONS: process.env.JAVA_TOOL_OPTIONS || '-Djava.net.preferIPv4Stack=true', // some networks hang on IPv6 downloads
  NODE_ENV: 'production',
  EXPO_PUBLIC_API_URL: server,
};

// Build settings for a laptop with little memory: a modest Gradle heap and little work in parallel,
// so the C++ compile does not run the machine out of memory. Close other heavy programs (and the
// Android emulator) while this runs. Edit the file to taste on a bigger machine; it is not overwritten.
const gradleSettings = path.join(vars.GRADLE_USER_HOME, 'gradle.properties');
if (!fs.existsSync(gradleSettings)) {
  fs.mkdirSync(vars.GRADLE_USER_HOME, { recursive: true });
  fs.writeFileSync(gradleSettings, 'org.gradle.jvmargs=-Xmx2048m -XX:MaxMetaspaceSize=768m\norg.gradle.workers.max=2\norg.gradle.parallel=false\n');
}

console.log(`Building POTKO for Android. Server address built in: ${server}`);

// The android/ folder is generated from app.json; it is made again whenever it is missing.
if (!fs.existsSync(android)) run('npx', ['expo', 'prebuild', '--platform', 'android'], { cwd: app, vars: { ...vars, CI: '1' } });

// The app's code is bundled afresh every time, so a changed server address is never missed.
run(path.join(android, windows ? 'gradlew.bat' : 'gradlew'), [':app:createBundleReleaseJsAndAssets', '--rerun', ':app:assembleRelease', '--console=plain'], {
  cwd: android,
  vars,
});

const built = path.join(android, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
if (!fs.existsSync(built)) fail(`The build finished but ${built} is missing.`);
const { version } = require(path.join(app, 'app.json')).expo;
const out = path.join(project, 'release', `POTKO-${version}.apk`);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.copyFileSync(built, out);
console.log(`\nDone: ${out} (${(fs.statSync(out).size / 1024 / 1024).toFixed(1)} MB)`);
console.log(`It starts with the server at ${server}. To change that on a phone: first screen -> Server.`);
