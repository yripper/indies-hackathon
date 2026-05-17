"""
Pure FastAPI deepfake detector — no Gradio dependency.
Runs on HF Spaces Docker SDK, port 7860.

Endpoints:
  GET  /health   → {"status":"ok","model_loaded":bool}
  POST /analyze  → multipart/form-data, field "file" (video binary)
                   → {"verdict":"REAL|UNCERTAIN|FAKE","confidence":0.0-1.0,
                       "faces_found":int,"frames_analyzed":int,"temporal_inconsistency":float}
"""
import os
import logging
import tempfile
from contextlib import asynccontextmanager

from fastapi import FastAPI, File, UploadFile
from fastapi.responses import JSONResponse

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

_detector = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Eagerly load detector on startup so first request isn't slow."""
    global _detector
    from detector import DeepfakeDetector
    _detector = DeepfakeDetector()
    logger.info("Detector ready")
    yield

app = FastAPI(
    title="Veritas Deepfake Video Detector",
    description="Lightweight OpenCV-based deepfake detection for videos.",
    version="1.0.0",
    lifespan=lifespan,
)

@app.get("/health")
def health():
    return {"status": "ok", "model_loaded": _detector is not None}

@app.post("/analyze")
async def analyze(file: UploadFile = File(...)):
    """
    Upload a video file and receive a deepfake verdict.
    Returns JSON with verdict, confidence, and diagnostic fields.
    """
    data = await file.read()
    suffix = os.path.splitext(file.filename or "video.mp4")[1] or ".mp4"

    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(data)
        tmp_path = tmp.name

    try:
        result = _detector.analyze(tmp_path)
        return JSONResponse(content=result)
    except Exception as e:
        logger.error("Analysis failed: %s", e)
        return JSONResponse(status_code=500, content={"error": str(e)})
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
