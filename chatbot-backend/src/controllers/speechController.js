import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { fileTypeFromBuffer } from 'file-type';
import env from '../config/env.js';
import { deleteFile } from '../utils/fileUpload.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const GROQ_TRANSCRIPTION_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const GROQ_WHISPER_MODEL = env.GROQ_WHISPER_MODEL || 'whisper-large-v3-turbo';

/**
 * Transcribes an audio file using Groq's Whisper endpoint (OpenAI-compatible).
 * @param {string} audioPath - Path to the uploaded audio file
 * @returns {Promise<{success: boolean, text?: string, error?: string}>}
 */
async function transcribeAudio(audioPath) {
  if (!env.GROQ_KEY) {
    return { success: false, error: 'GROQ_KEY is not configured' };
  }

  const buffer = await fs.promises.readFile(audioPath);

  // Sniff the real format — browsers often upload webm/opus data with a .wav name
  const sniffed = await fileTypeFromBuffer(buffer).catch(() => null);
  const ext = sniffed?.ext || path.extname(audioPath).replace('.', '') || 'wav';
  const mimeType = sniffed?.mime || 'application/octet-stream';
  const filename = `audio.${ext}`;

  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mimeType }), filename);
  form.append('model', GROQ_WHISPER_MODEL);
  form.append('response_format', 'json');

  const response = await fetch(GROQ_TRANSCRIPTION_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.GROQ_KEY}` },
    body: form,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    return {
      success: false,
      error: `Groq transcription error ${response.status}${text ? `: ${text}` : ''}`,
    };
  }

  const data = await response.json();
  const text = typeof data?.text === 'string' ? data.text : '';
  if (!text) {
    return { success: false, error: 'No transcription text in response' };
  }
  return { success: true, text };
}

/**
 * Handles speech-to-text conversion
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const convertSpeechToText = async (req, res) => {
  if (!req.file) {
    return res.status(400).json({
      success: false,
      error: 'No audio file provided'
    });
  }

  const audioPath = req.file.path;
  console.log('File uploaded to:', audioPath);

  try {
    // Verify file exists and is not empty
    if (!fs.existsSync(audioPath)) {
      throw new Error(`Audio file not found at path: ${audioPath}`);
    }

    const stats = fs.statSync(audioPath);
    console.log('File stats:', {
      size: stats.size,
      modified: stats.mtime,
      isFile: stats.isFile()
    });

    if (stats.size === 0) {
      throw new Error('Uploaded audio file is empty');
    }

    // Transcribe the audio using Groq's Whisper API
    const result = await transcribeAudio(audioPath);

    if (!result.success) {
      console.error('Transcription failed:', result.error);
      throw new Error(result.error || 'Failed to transcribe audio');
    }

    console.log('Transcription successful');
    return res.json({
      success: true,
      text: result.text
    });
  } catch (error) {
    console.error('Error in speech-to-text conversion:', {
      message: error.message,
      stack: error.stack,
      name: error.name,
      code: error.code,
      time: new Date().toISOString(),
      filePath: audioPath,
      fileExists: fs.existsSync(audioPath)
    });

    return res.status(500).json({
      success: false,
      error: 'Failed to process speech-to-text',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  } finally {
    // Always clean up the uploaded file
    if (audioPath && fs.existsSync(audioPath)) {
      try {
        fs.unlinkSync(audioPath);
        console.log('Temporary file deleted:', audioPath);
      } catch (err) {
        console.error('Error deleting temporary file:', err);
      }
    }
  }
};

export default {
  convertSpeechToText
};
