const mqtt = require('mqtt');
const http = require('http');
const path = require('path');

const {
  initializeApp,
  cert,
  applicationDefault,
} = require('firebase-admin/app');

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

// Render health server.
// Render assigns the port through process.env.PORT.
const PORT = process.env.PORT || 3000;

http
  .createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Swift Secure8 push backend running');
  })
  .listen(PORT, () => {
    console.log(`[HTTP] health server listening on port ${PORT}`);
  });

// MQTT configuration.
const MQTT_HOST =
  process.env.MQTT_HOST ||
  'mqtts://cc187a17787c475ebb712129e0cb24e5.s1.eu.hivemq.cloud:8883';

const MQTT_USERNAME = process.env.MQTT_USERNAME || 'espuser';
const MQTT_PASSWORD = process.env.MQTT_PASSWORD || 'secretP@ss1';

// Optional panel allowlist.
// Example Render variable:
// ALLOWED_PANELS=DEA47F,3204B8,31FD3F
const ALLOWED_PANELS = new Set(
  (process.env.ALLOWED_PANELS || '')
    .split(',')
    .map((x) => x.trim().toUpperCase())
    .filter(Boolean)
);

console.log(`[MQTT] host: ${MQTT_HOST}`);
console.log(
  `[MQTT] allowed panels: ${
    ALLOWED_PANELS.size > 0 ? [...ALLOWED_PANELS].join(', ') : 'ALL'
  }`
);

const client = mqtt.connect(MQTT_HOST, {
  username: MQTT_USERNAME,
  password: MQTT_PASSWORD,
  clientId: `swift_secure8_push_${Date.now()}`,
  protocolVersion: 4,
  reconnectPeriod: 3000,
  keepalive: 30,
});

function topicForPanel(chipid) {
  return `panel_${String(chipid || '').toUpperCase()}`;
}

function notificationForEvent(event, payload) {
  const panelName = payload.panelName || `Panel ${payload.chipid || ''}`.trim();
  const zone = payload.Zone || payload.zone || '00';

  switch (event) {
    case 'alarm':
      return {
        title: '🚨 Alarm Triggered',
        body: `${panelName}: Zone ${parseInt(zone, 10) || zone} triggered`,
        priority: 'high',
      };

    case 'panic':
      return {
        title: '🚨 Panic Alarm',
        body: `${panelName}: Panic alarm activated`,
        priority: 'high',
      };

    case 'tamper':
      return {
        title: '⚠️ Tamper Detected',
        body: `${panelName}: Panel enclosure tamper detected`,
        priority: 'high',
      };

    case 'tamper_restore':
      return {
        title: 'Tamper Restored',
        body: `${panelName}: Tamper switch restored`,
        priority: 'normal',
      };

    case 'arm':
      return {
        title: 'System Armed',
        body: `${panelName} is now armed`,
        priority: 'normal',
      };

    case 'disarm':
      return {
        title: 'System Disarmed',
        body: `${panelName} is now disarmed`,
        priority: 'normal',
      };

    case 'arm_rejected':
      return {
        title: 'Arm Rejected',
        body: `${panelName}: Check open zones`,
        priority: 'normal',
      };

    case 'arm_rejected_tamper':
      return {
        title: 'Arm Rejected',
        body: `${panelName}: Tamper active`,
        priority: 'high',
      };

    case 'offline':
      return {
        title: 'Panel Offline',
        body: `${panelName} is offline`,
        priority: 'high',
      };

    default:
      return null;
  }
}

async function sendFcmToPanelTopic(chipid, event, payload) {
  const notification = notificationForEvent(event, payload);
  if (!notification || !chipid) return;

  const topic = topicForPanel(chipid);

  const message = {
    topic,
    notification: {
      title: notification.title,
      body: notification.body,
    },
    data: {
      panelId: String(chipid).toUpperCase(),
      event: String(event),
      zone: String(payload.Zone || payload.zone || '00'),
      state: String(payload.state || ''),
      raw: JSON.stringify(payload),
    },
    android: {
    priority: notification.priority === 'high' ? 'high' : 'normal',
    notification: {
      channelId:
        event === 'panic'
          ? 'panic_sound_alerts_v3'
          : notification.priority === 'high'
            ? 'alarm_sound_alerts_v3'
            : 'alarm_status',
      sound:
        event === 'panic'
          ? 'panic_sound'
          : notification.priority === 'high'
            ? 'alarm_sound'
            : 'default',
    },
  },
  };

  try {
    console.log(`[FCM] sending ${event} to topic ${topic}`);
    const id = await getMessaging().send(message);
    console.log(`[FCM] sent ${event} to topic ${topic}: ${id}`);
  } catch (err) {
    console.error('[FCM] send failed:', err);
  }
}

async function sendTestToToken(token) {
  const message = {
    token,
    notification: {
      title: 'Swift Secure8 Test',
      body: 'Direct FCM token test notification',
    },
    data: {
      event: 'test',
    },
    android: {
      priority: 'high',
      notification: {
        channelId: 'alarm_alerts',
        sound: 'default',
      },
    },
  };

  try {
    const id = await getMessaging().send(message);
    console.log(`[FCM] direct token test sent: ${id}`);
  } catch (err) {
    console.error('[FCM] direct token test failed:', err);
  }
}

client.on('connect', () => {
  console.log('[MQTT] connected');

  client.subscribe('security/system/#', { qos: 1 }, (err) => {
    if (err) {
      console.error('[MQTT] subscribe failed:', err);
    } else {
      console.log('[MQTT] subscribed to security/system/#');
    }
  });
});

client.on('reconnect', () => {
  console.log('[MQTT] reconnecting...');
});

client.on('close', () => {
  console.log('[MQTT] connection closed');
});

client.on('offline', () => {
  console.log('[MQTT] offline');
});

client.on('error', (err) => {
  console.error('[MQTT] error:', err.message);
});

client.on('message', async (topic, buffer) => {
  const payloadText = buffer.toString();

  const parts = topic.split('/');

  if (
    parts.length < 3 ||
    parts[0] !== 'security' ||
    parts[1] !== 'system'
  ) {
    return;
  }

  const chipidFromTopic = parts[2].toUpperCase();

  if (ALLOWED_PANELS.size > 0 && !ALLOWED_PANELS.has(chipidFromTopic)) {
    return;
  }

  // Ignore frequent status messages completely.
  // Do not log them.
  if (topic.endsWith('/status')) {
    return;
  }

  // Only log useful non-status MQTT messages.
  console.log(`[MQTT] ${topic}: ${payloadText}`);

  // Availability topic payload is plain text: online/offline.
  if (topic.endsWith('/availability')) {
    if (payloadText.trim().toLowerCase() === 'offline') {
      await sendFcmToPanelTopic(chipidFromTopic, 'offline', {
        chipid: chipidFromTopic,
      });
    }

    return;
  }

  let payload;

  try {
    payload = JSON.parse(payloadText);
  } catch (_) {
    return;
  }

  const event = String(payload.event || '').toLowerCase();
  const chipid = String(payload.chipid || chipidFromTopic).toUpperCase();

  await sendFcmToPanelTopic(chipid, event, payload);
});
