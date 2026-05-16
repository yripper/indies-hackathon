# Deepfake Video Detector — ML Service

FastAPI service that analyzes video frames for deepfake artifacts using MTCNN (face detection) + EfficientNetB0 (classification).

## Local Development

```bash
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 7860
```

## Deploy to Hugging Face Spaces

1. Create a new Space at https://huggingface.co/new-space
   - SDK: **Docker**
   - Visibility: Public (required for free tier)

2. Clone and push:
```bash
# From the repo root:
git subtree split --prefix deepfake-service -b hf-deploy
git push https://huggingface.co/spaces/YOUR_USER/deepfake-detector hf-deploy:main
```

3. Set the env var in the Node.js bot:
```
DEEPFAKE_SERVICE_URL=https://YOUR_USER-deepfake-detector.hf.space
```

## API

### POST /analyze
Multipart form upload with a `file` field (video).

Response:
```json
{
  "verdict": "FAKE",
  "confidence": 0.87,
  "faces_found": 16,
  "frames_analyzed": 20,
  "temporal_inconsistency": 0.14,
  "detail": "16 rostros analizados en 20 frames"
}
```

### GET /health
Returns `{"status": "ok", "model_loaded": true}`.

## Architecture
- **MTCNN**: face detection per frame (extracts face crops)
- **EfficientNetB0**: binary classification (real vs fake) per face
- **Temporal analysis**: measures inconsistency in predictions across consecutive frames
- Samples up to 20 frames evenly from the video
- CPU-only inference (~10-30s per video depending on length)
