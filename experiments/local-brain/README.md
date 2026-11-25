# Nimo local brain experiment (Raspberry Pi / Ollama)

**Isolated experiment.** Does NOT call OpenAI, Cloudflare, Nimo's live Worker, D1 or the real Oracle; does not control the live character. The first benchmark tests only five representative situations to see whether a small model can obey tools and world rules.

## Hardware starting point

Start with Raspberry Pi 5 **8 GB**, official 27W PSU, active cooler, and 64 GB storage. A 16 GB Pi is not needed for the first 1.7B experiment and is significantly more expensive. CPU-only inference can be slow. Pi 4 is possible for 1.7B but may be much slower. Use Raspberry Pi OS 64-bit.

## Install (on the Pi)

```bash
sudo apt update
sudo apt install -y curl git nodejs npm
curl -fsSL https://ollama.com/install.sh | sh
ollama pull qwen3:1.7b
ollama list
```

Review external install scripts before running them if you prefer; Ollama also documents manual ARM64 installation.

Clone the repo, switch to branch `experiment/local-pi-brain`, then:

```bash
cd experiments/local-brain
node --test benchmark.test.mjs
node benchmark.mjs
```

The benchmark connects only to `http://127.0.0.1:11434/api/chat` and writes a report under `reports/`. It runs **no actual world actions**. It records validation results, elapsed time and Ollama token counts.

To experiment with another model:

```bash
ollama pull qwen3:4b
OLLAMA_MODEL=qwen3:4b node benchmark.mjs
```

Results are not guarantees of autonomy. A useful next benchmark should replay 50–100 anonymised real decision situations from the daily archive, then compare tool correctness, latency, output structure and error rates. **Do not enable remote access or substitute this model for Nimo's live brain until that test passes.**

### Security

Keep Ollama bound to localhost on the Pi; do not open port 11434 publicly, put API secrets in the repository, or expose a public unauthenticated proxy. A future Worker-to-Pi connection should use authentication and a secured tunnel or outbound polling design. Until then, everything stays offline.
