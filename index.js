const mqtt = require('mqtt');
const path = require('path');
const http = require('http');
const { initializeApp, cert, applicationDefault } = require('firebase-admin/app');
const { getMessaging } = require('firebase-admin/messaging');

function initializeFirebaseAdmin() {
  const serviceAccountBase64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;

  if (serviceAccountBase64 && serviceAccountBase64.trim().length > 0) {
    const json = Buffer.from(serviceAccountBase64, 'base64').toString('utf8');
    const serviceAccount = JSON.parse(json);

    initializeApp({
      credential: cert(serviceAccount),
    });

    console.log('[FCM] Firebase initialized from FIREBASE_SERVICE_ACCOUNT_BASE64');
    return;
  }

  const credentialPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;

  if (credentialPath && credentialPath.trim().length > 0) {
    const absolutePath = path.resolve(process.cwd(), credentialPath);
    const serviceAccount = require(absolutePath);

    initializeApp({
      credential: cert(serviceAccount),
    });

    console.log(`[FCM] Firebase initialized with service account: ${absolutePath}`);
    return;
  }

  initializeApp({
    credential: applicationDefault(),
  });

  console.log('[FCM] Firebase initialized with application default credentials');
}

initializeFirebaseAdmin();

const http = require('http');
const PORT = process.env.PORT || 3000;

http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('MQTT Service is Running\n');
}).listen(PORT, () => {
  console.log(`Dummy HTTP server listening on port ${PORT}`);
});