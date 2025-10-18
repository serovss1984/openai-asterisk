import AriClient from 'ari-client';
import WebSocket from 'ws';
import fs from 'fs';
import { spawn } from 'child_process';
import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const ARI_URL = process.env.ARI_URL;
const ARI_USER = process.env.ARI_USER;
const ARI_PASS = process.env.ARI_PASS;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_REALTIME_URL = process.env.OPENAI_REALTIME_URL;
const STASIS_APP = 'openai-app';

AriClient.connect(ARI_URL, ARI_USER, ARI_PASS, async (err, ari) => {
  if (err) {
    console.error('❌ Ошибка подключения к ARI:', err);
    return;
  }

  console.log('✅ Подключено к Asterisk ARI');

  ari.on('StasisStart', async (event, channel) => {
    const caller = channel.caller.number || 'неизвестно';
    console.log(`📞 Новый вызов от ${caller}`);

    try {
      await channel.answer();
      console.log('☎️ Канал отвечен');

      // создаём мост
      const bridge = await ari.bridges.create({ type: 'mixing' });
      console.log('🔗 Создан bridge:', bridge.id);
      await bridge.addChannel({ channel: channel.id });

      // подключение к OpenAI realtime
      const ws = new WebSocket(OPENAI_REALTIME_URL, {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          'OpenAI-Beta': 'realtime=v1',
        },
      });

      ws.on('open', async () => {
        console.log('🧠 Подключено к OpenAI Realtime API');
        ws.send(
          JSON.stringify({
            type: 'response.create',
            response: {
              modalities: ['text'],
              instructions: 'Скажи коротко приветствие: соединение установлено.',
            },
          })
        );
        await channel.play({ media: 'sound:demo-congrats' });
      });

      ws.on('message', (msg) => {
        try {
          const data = JSON.parse(msg);
          if (data?.type === 'response.output_text.delta') {
            console.log('💬 OpenAI:', data.delta);
          } else if (data?.type === 'response.completed') {
            console.log('✅ Ответ завершён');
          }
        } catch (e) {
          console.error('Ошибка парсинга OpenAI ответа:', e.message);
        }
      });

      ws.on('close', () => console.log('🔌 WebSocket закрыт'));
      ws.on('error', (e) => console.error('❌ Ошибка WS:', e.message));

      setTimeout(async () => {
        console.log('📴 Завершение вызова');
        await channel.hangup();
      }, 820000);
    } catch (err) {
      console.error('Ошибка в обработке звонка:', err);
      try {
        await channel.hangup();
      } catch {}
    }
  });

  ari.start(STASIS_APP);
});
