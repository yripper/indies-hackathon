import logging
import os
import tempfile
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.responses import JSONResponse

from detector import DeepfakeDetector

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger(__name__)

MAX_UPLOAD_BYTES = 100 * 1024 * 1024  # 100 MB

detector: DeepfakeDetector
model_loaded: bool = False


@asynccontextmanager
async def lifespan(app: FastAPI):
    global detector, model_loaded
    logger.info("Loading MTCNN + EfficientNetB0 model...")
    detector = DeepfakeDetector()
    model_loaded = True
    logger.info("Models loaded. Service ready on :7860")
    yield


app = FastAPI(title="Deepfake Video Detector", lifespan=lifespan)


@app.get("/health")
def health():
    return {"status": "ok", "model_loaded": model_loaded}


@app.post("/analyze")
async def analyze_video(file: UploadFile):
    contents = await file.read()
    file_size = len(contents)

    if file_size > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"File too large: {file_size} bytes (max {MAX_UPLOAD_BYTES} bytes)",
        )

    logger.info("Analyzing video: filename=%s size=%d bytes", file.filename, file_size)

    suffix = os.path.splitext(file.filename or ".mp4")[1] or ".mp4"

    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(contents)
        tmp_path = tmp.name

    try:
        result = detector.analyze(tmp_path)
        logger.info(
            "Result: verdict=%s confidence=%.2f",
            result.get("verdict"),
            result.get("confidence", 0.0),
        )
        return JSONResponse(result)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        os.unlink(tmp_path)
