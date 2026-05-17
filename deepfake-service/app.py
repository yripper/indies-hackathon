"""
Pure FastAPI deepfake detector — no Gradio dependency.
Runs on HF Spaces Docker SDK, port 7860.

Endpoints:
  GET  /health          → {"status":"ok","model_loaded":bool}
  POST /analyze         → multipart/form-data, field "file" (video binary)
                           → {"verdict":"REAL|UNCERTAIN|FAKE","confidence":0.0-1.0,
                               "faces_found":int,"frames_analyzed":int,
                               "temporal_inconsistency":float,"frame_scores":[...]}
  POST /analyze-visual  → same upload as /analyze, but also returns
                           "heatmap_b64": base64-encoded PNG of the frame timeline
"""
import base64
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


async def _save_upload(file: UploadFile) -> str:
    """Write the uploaded file to a temp path and return that path."""
    data = await file.read()
    suffix = os.path.splitext(file.filename or "video.mp4")[1] or ".mp4"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(data)
        return tmp.name


@app.post("/analyze")
async def analyze(file: UploadFile = File(...)):
    """
    Upload a video file and receive a deepfake verdict.
    Returns JSON with verdict, confidence, per-frame scores, and diagnostic fields.
    """
    tmp_path = await _save_upload(file)
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


@app.post("/analyze-visual")
async def analyze_visual(file: UploadFile = File(...)):
    """
    Upload a video file and receive a deepfake verdict PLUS a base64-encoded
    PNG heatmap showing per-frame suspicion scores as a colour timeline.

    The heatmap is included in the response under the key ``heatmap_b64``.
    Decode it with ``base64.b64decode(heatmap_b64)`` to get raw PNG bytes.
    """
    tmp_path = await _save_upload(file)
    try:
        result = _detector.analyze(tmp_path)

        frame_scores = result.get("frame_scores", [])
        heatmap_b64: str | None = None
        if frame_scores:
            try:
                from heatmap import generate_heatmap
                png_bytes = generate_heatmap(
                    frame_scores,
                    verdict=result.get("verdict", ""),
                    confidence=result.get("confidence", 0.0),
                )
                heatmap_b64 = base64.b64encode(png_bytes).decode("ascii")
            except Exception as hm_err:
                logger.warning("Heatmap generation failed (non-fatal): %s", hm_err)

        payload = dict(result)
        if heatmap_b64 is not None:
            payload["heatmap_b64"] = heatmap_b64

        return JSONResponse(content=payload)
    except Exception as e:
        logger.error("Visual analysis failed: %s", e)
        return JSONResponse(status_code=500, content={"error": str(e)})
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
