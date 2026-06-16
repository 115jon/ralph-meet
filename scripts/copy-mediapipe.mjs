import fs from 'fs';
import path from 'path';
import https from 'https';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const srcDir = path.resolve(__dirname, '../node_modules/@mediapipe/tasks-vision/wasm');
const destDir = path.resolve(__dirname, '../public/mediapipe');

if (!fs.existsSync(destDir)) {
  fs.mkdirSync(destDir, { recursive: true });
}

// 1. Copy wasm files from node_modules
if (fs.existsSync(srcDir)) {
  const files = fs.readdirSync(srcDir);
  for (const file of files) {
    fs.copyFileSync(path.join(srcDir, file), path.join(destDir, file));
    console.log(`Copied ${file} to public/mediapipe`);
  }
} else {
  console.error(`Source directory not found: ${srcDir}. Make sure node_modules is installed.`);
}

// 2. Download selfie_segmenter.tflite
const tfliteUrl = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/1/selfie_segmenter.tflite';
const tfliteDest = path.join(destDir, 'selfie_segmenter.tflite');

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    if (fs.existsSync(dest)) {
      console.log(`${path.basename(dest)} already exists, skipping download.`);
      resolve();
      return;
    }

    console.log(`Downloading ${url} to ${dest}...`);
    const file = fs.createWriteStream(dest);
    
    const request = https.get(url, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        // Handle redirect
        downloadFile(response.headers.location, dest).then(resolve).catch(reject);
        return;
      }
      
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download: ${response.statusCode}`));
        return;
      }
      
      response.pipe(file);
      
      file.on('finish', () => {
        file.close();
        console.log(`Download complete: ${dest}`);
        resolve();
      });
    });
    
    request.on('error', (err) => {
      fs.unlink(dest, () => {}); // Delete temp file
      reject(err);
    });
  });
}

downloadFile(tfliteUrl, tfliteDest)
  .then(() => console.log('MediaPipe assets prep complete.'))
  .catch((err) => {
    console.error('Error preparing MediaPipe assets:', err);
    process.exit(1);
  });
