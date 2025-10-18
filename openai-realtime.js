const ari = require('ari-client');
const WebSocket = require('ws');
const fs = require('fs');
const { spawn } = require('child_process');
const axios = require('axios');

const ARI_URL = process.env.ARI_URL;
const ARI_USER = process.env.ARI_USER;
const ARI_PASS = process.env.ARI_PASS;

// 🔑 Твой OpenAI API ключ
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_REALTIME_URL = 'wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17';

const LOCAL_IP = '0.0.0.0'; // слушаем все интерфейсы
const LOCAL_PORT = 9000;

// 🗣️ Синтез речи через OpenAI
async function synthesizeText(text) {
  const filePath = `/tmp/tts_${Date.now()}.mp3`;
  const resp = await axios.post(
    'https://api.openai.com/v1/audio/speech',
    {
      model: 'gpt-4o-mini-tts',
      voice: 'alloy',
      input: text,
    },
    {
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
      responseType: 'arraybuffer',
    }
  );
  fs.writeFileSync(filePath, resp.data);
  return filePath;
}

// подключение к ARI
ari.connect(ARI_URL, ARI_USER, ARI_PASS, async (err, client) => {
  if (err) throw err;

  client.on('StasisStart', async (event, channel) => {
//    console.log(`📞 Вызов от ${channel.caller.number}`);
    await channel.answer();

    // создаём externalMedia, направляем UDP на этот сервер
    const external = await client.channels.externalMedia({
      app: 'openai-app',
      external_host: `${LOCAL_IP}:${LOCAL_PORT}`,
      format: 'slin16'
    });

    console.log('Проверка доступных модулей ARI:', Object.keys(client));

    const bridge = await client.Bridges.create({ type: 'mixing' });
    await bridge.addChannel({ channel: [channel.id, external.id] });

    // ffmpeg — слушает UDP и выводит PCM в stdout
    const ffmpeg = spawn('ffmpeg', [
      '-f', 's16le', '-ar', '16000', '-ac', '1',
      `-i`, `udp://${LOCAL_IP}:${LOCAL_PORT}?listen`,
      '-f', 'wav',
      'pipe:1'
    ]);

    const ws = new WebSocket(OPENAI_REALTIME_URL, {
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'OpenAI-Beta': 'realtime=v1'
      }
    });

    ws.on('open', () => console.log('🧠 Подключено к OpenAI Realtime'));

    ffmpeg.stdout.on('data', chunk => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(chunk);
      }
    });

    ws.on('message', async (msg) => {
      try {
        const data = JSON.parse(msg.toString());
        if (data?.text) {
          console.log('🎤 Распознано:', data.text);

          const reply = `Вы сказали: ${data.text}`;
          const ttsFile = await synthesizeText(reply);

          await channel.play({ media: `sound:${ttsFile}` });
        }
      } catch (err) {
        console.error('Ошибка парсинга:', err.message);
      }
    });

    ws.on('close', () => console.log('🔌 Соединение с OpenAI закрыто'));
  });

  client.start('openai-app');
});
