import logging

import cv2
import numpy as np
from PIL import Image
from facenet_pytorch import MTCNN
from transformers import pipeline

# dima806/deepfake_vs_real_image_detection is an EfficientNetB0 trained on a
# face-focused deepfake dataset. Labels: "fake" / "real".
MODEL_ID = "dima806/deepfake_vs_real_image_detection"
N_FRAMES = 20

logger = logging.getLogger(__name__)


class DeepfakeDetector:
    def __init__(self) -> None:
        logger.info("Initializing MTCNN...")
        self.mtcnn = MTCNN(keep_all=False, post_process=False, select_largest=True)
        logger.info("Initializing classifier (dima806/deepfake_vs_real_image_detection)...")
        self.classifier = pipeline("image-classification", model=MODEL_ID, top_k=2)

    def _extract_frames(self, video_path: str) -> list[np.ndarray]:
        cap = cv2.VideoCapture(video_path)
        total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        fps = cap.get(cv2.CAP_PROP_FPS) or 30.0

        # Cap at 5 min of footage to keep inference time sane.
        max_frames = min(total, int(fps * 300))
        indices = np.linspace(0, max_frames - 1, N_FRAMES, dtype=int)

        frames: list[np.ndarray] = []
        for idx in indices:
            cap.set(cv2.CAP_PROP_POS_FRAMES, int(idx))
            ret, frame = cap.read()
            if ret:
                frames.append(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))

        cap.release()
        return frames

    def _crop_face(self, rgb_array: np.ndarray) -> Image.Image | None:
        pil = Image.fromarray(rgb_array)
        face_tensor = self.mtcnn(pil)
        if face_tensor is None:
            return None
        face_np = face_tensor.permute(1, 2, 0).cpu().numpy()
        face_np = np.clip(face_np, 0, 255).astype(np.uint8)
        return Image.fromarray(face_np)

    def analyze(self, video_path: str) -> dict:
        frames = self._extract_frames(video_path)
        if not frames:
            raise ValueError("No se pudieron extraer frames del video")

        logger.info("Extracted %d frames from video", len(frames))

        fake_scores: list[float] = []
        faces_found = 0

        for frame in frames:
            face_pil = self._crop_face(frame)
            if face_pil is None:
                continue

            faces_found += 1
            results = self.classifier(face_pil)
            for r in results:
                if "fake" in r["label"].lower():
                    fake_scores.append(float(r["score"]))
                    break

        logger.info("Faces detected across frames: %d", faces_found)

        if not fake_scores:
            return {
                "verdict": "UNKNOWN",
                "confidence": 0.0,
                "faces_found": faces_found,
                "frames_analyzed": len(frames),
                "temporal_inconsistency": 0.0,
                "detail": "No se detectaron rostros en ningún frame del video",
            }

        mean_score = float(np.mean(fake_scores))
        std_score = float(np.std(fake_scores))

        # High frame-to-frame variance is itself a deepfake signal — boost confidence slightly.
        confidence = float(np.clip(mean_score + 0.15 * std_score, 0.0, 1.0))
        verdict = "FAKE" if confidence > 0.5 else "REAL"

        return {
            "verdict": verdict,
            "confidence": round(confidence, 4),
            "faces_found": faces_found,
            "frames_analyzed": len(frames),
            "temporal_inconsistency": round(std_score, 4),
            "per_frame_scores": [round(s, 4) for s in fake_scores],
            "detail": f"{faces_found} rostros analizados en {len(frames)} frames",
        }
