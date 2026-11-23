# Deploy the primary and fallback analysis servers

Both servers use the root Dockerfile, the same seven-Surah data and the pinned Quran Muaalem checkpoint. The image runs as UID 1000 and provides FFmpeg, ffprobe, Python 3.12 and one Uvicorn worker on port 7860. One worker owns the 40-slot admission limit. Request 41 receives HTTP 503 with code `busy`. Benchmark the intended GPU and recording lengths before relying on 40 simultaneous inferences in production.

## Primary GPU server

Use a Linux host with Docker, NVIDIA Container Toolkit and a driver compatible with the PyTorch 2.8 CUDA 12.8 build. From the project root:

```sh
docker build -t faseeh:2.1 .
docker volume create faseeh-model-cache
docker run -d --name faseeh-primary --restart unless-stopped --gpus all \
  -p 127.0.0.1:7860:7860 \
  -v faseeh-model-cache:/home/faseeh/.cache/huggingface \
  -e FORWARDED_ALLOW_IPS='*' \
  faseeh:2.1
```

Terminate HTTPS at the host's reverse proxy and forward to the loopback port. Configure it to **replace** X-Forwarded-Proto with the actual client protocol and to accept at least 25,065,536 bytes per multipart request. Trusting the proxy with `FORWARDED_ALLOW_IPS=*` in the example assumes the backend port is reachable only by trusted infrastructure. On shared networks, use the TLS proxy's trusted IP addresses or CIDRs. Configure read and upstream timeouts for long recordings, including first-run model downloads.

On a build network that uses an organization TLS certificate authority, add `--secret id=build_ca_bundle,src=/path/to/trusted-ca-bundle.pem` to the build command. The certificate bundle is available to pip during the build only.

The engine fetches the public checkpoint when first needed. Provide outbound HTTPS to Hugging Face's model download service or mount a verified local snapshot read-only and set `FASEEH_MODEL_PATH` to its path inside the container. The HF cache or persistent volume must be writable by UID 1000. For a CPU-only build, use `docker build --build-arg TORCH_INDEX_URL=https://download.pytorch.org/whl/cpu -t faseeh:cpu .` and omit the GPU flag at runtime.

## Hugging Face Docker Space

Create a Docker Space on the desired hardware, with GPU hardware for the intended workload. Use the project files at the root of the Space. Include these lines as YAML front matter in the **Space's** README.md:

```yaml
---
title: Faseeh Recitation
sdk: docker
app_port: 7860
---
```

Set `FASEEH_ALLOWED_ORIGINS` on both servers to the comma-separated HTTPS origins that host the reader. On the Space, select an appropriate `FORWARDED_ALLOW_IPS` for its trusted HTTPS ingress and keep the app behind that ingress. Set `HF_HOME` to a writable persistent cache location when persistent storage is available. Audio contributions are disabled until `FASEEH_RECORDINGS_DIR` is explicitly set to a private directory outside the public web tree. Mount access-controlled storage there only when collecting consented contributions. Keep the same consent policy on both servers.

## Connect the reader

Set `window.FASEEH_CONFIG.analysisEndpoints` in `web/config.js` in priority order, using the HTTPS `/api/analyze` URL of the primary and the Space's direct HTTPS app origin plus `/api/analyze`. Use the Space's app hostname, for example `https://OWNER-SPACE.hf.space`; its huggingface.co project overview serves HTML. Origin or endpoint changes inside the static configuration require republishing the static assets.

Check `GET /health` on each server for FFmpeg/ffprobe availability and the recording limits. This checks the web service and decoder. Complete a recording of the selected Ayah to verify the model, result coverage and feedback. With the primary temporarily unavailable, submit another clip and verify that the fallback produces a result. The reference text, cached model files and expert audio may be retained independently of user recordings. Unless a user actively opts in to an enabled private contribution store, the application deletes temporary recordings after each request.
