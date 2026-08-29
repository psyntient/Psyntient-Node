// Local voice transcription via @fugood/whisper.node (MIT, prebuilt native
// binding, no compile step, no cloud call) — matches the same
// prebuilt-per-platform-binary pattern already proven in this codebase for
// local embeddings. Runs as a resident HTTP worker (see
// voice-transcription-control.mjs) so the model is loaded once and stays
// warm, rather than paying whisper's real model-load cost on every request.
import { createServer } from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { pipeline } from "node:stream/promises";
import { initWhisper } from "@fugood/whisper.node";
import { psyntientHome } from "./psyntient-home.mjs";

const MODEL_DIR = path.join(psyntientHome(), "models", "whisper");
const MODEL_PATH = path.join(MODEL_DIR, "ggml-base.en.bin");
const MODEL_URL =
  "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin";
const PORT = 18790;

async function ensureModel() {
  if (fs.existsSync(MODEL_PATH)) return MODEL_PATH;
  await fsp.mkdir(MODEL_DIR, { recursive: true });
  const tmpPath = `${MODEL_PATH}.download`;
  const res = await fetch(MODEL_URL);
  if (!res.ok || !res.body) {
    throw new Error(`Failed to download whisper model: HTTP ${res.status}`);
  }
  await pipeline(res.body, fs.createWriteStream(tmpPath));
  await fsp.rename(tmpPath, MODEL_PATH);
  return MODEL_PATH;
}

let contextPromise = null;

function getContext() {
  if (!contextPromise) {
    // useGpu: true was tried first and caused a real GPU timeout on this
    // machine's Metal backend (Intel Iris Plus Graphics 645) --
    // ggml_metal_synchronize: "Caused GPU Timeout Error", every transcription
    // failed. CPU-only is slower but actually works across the range of
    // Mac hardware this product targets, not just newer Apple Silicon GPUs.
    contextPromise = ensureModel().then((filePath) =>
      initWhisper({ filePath, useGpu: false }),
    );
  }
  return contextPromise;
}

async function transcribe(audioPath) {
  const context = await getContext();
  const { promise } = context.transcribeFile(audioPath, { language: "en" });
  const result = await promise;
  return result.result.trim();
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function serve() {
  const server = createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (req.method === "POST" && req.url === "/transcribe") {
      try {
        const { audioPath } = await readJsonBody(req);
        if (!audioPath) throw new Error("Missing audioPath");
        const text = await transcribe(audioPath);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, text }));
      } catch (err) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: String(err?.message || err) }));
      }
      return;
    }
    res.writeHead(404);
    res.end();
  });
  // Loopback-only — this worker is never meant to be reachable off-machine.
  server.listen(PORT, "127.0.0.1", () => {
    console.log(`voice-transcription worker listening on 127.0.0.1:${PORT}`);
  });
  // Load (and, on first run, download) the model right away so the first
  // real request doesn't pay that cost — ensureRunning()'s /health poll
  // waits for the process to be up, not for the model to be warm, so we
  // start loading immediately rather than lazily on first /transcribe.
  getContext().catch((err) => {
    console.error("Failed to load whisper model:", err);
  });
}

async function main() {
  const [, , cmd, arg] = process.argv;
  if (cmd === "serve") {
    serve();
    return;
  }
  if (cmd === "transcribe-once") {
    if (!arg) {
      console.error("Usage: node voice-transcription.mjs transcribe-once <wavPath>");
      process.exit(1);
    }
    const text = await transcribe(path.resolve(arg));
    console.log(text);
    process.exit(0);
  }
  console.error("Usage: node voice-transcription.mjs <serve|transcribe-once>");
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export const paths = { MODEL_DIR, MODEL_PATH, PORT };
