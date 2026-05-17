"""
Lightweight deepfake detector using OpenCV heuristics only.
No PyTorch, no transformers — builds in seconds on HF free tier.

Approach: temporal consistency analysis + compression artifact detection.
Deepfake videos often show:
- Unnatural blending artifacts at face boundaries
- Temporal inconsistency (frame-to-frame jitter in face regions)
- High-frequency noise patterns from generation/compression
"""
import cv2
import numpy as np
import logging

logger = logging.getLogger(__name__)

# Haar cascade for face detection (built into OpenCV — zero download)
FACE_CASCADE = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
FRAME_SAMPLES = 20


class DeepfakeDetector:
    def __init__(self):
        logger.info("DeepfakeDetector initialized (OpenCV heuristics mode)")

    def _face_region(self, gray: np.ndarray):
        """Return first detected face ROI or None."""
        faces = FACE_CASCADE.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(60, 60))
        if len(faces) == 0:
            return None
        x, y, w, h = faces[0]
        return gray[y:y+h, x:x+w]

    def _laplacian_score(self, roi: np.ndarray) -> float:
        """High-frequency noise score via Laplacian variance. Deepfakes often have
        unnatural smoothing/sharpening patterns around face regions."""
        lap = cv2.Laplacian(roi, cv2.CV_64F)
        return float(np.var(lap))

    def _edge_density(self, roi: np.ndarray) -> float:
        """Edge density in face region. Blended deepfakes have irregular edges."""
        edges = cv2.Canny(roi, 50, 150)
        return float(np.sum(edges > 0) / edges.size)

    def analyze(self, video_path: str) -> dict:
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            raise ValueError(f"Cannot open video: {video_path}")

        total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        if total <= 0:
            raise ValueError("No frames in video")

        indices = np.linspace(0, total - 1, min(FRAME_SAMPLES, total), dtype=int)
        laplacians, edges, face_diffs = [], [], []
        frame_scores: list[float] = []
        prev_face = None
        faces_found = 0

        for idx in indices:
            cap.set(cv2.CAP_PROP_POS_FRAMES, int(idx))
            ok, frame = cap.read()
            if not ok:
                continue

            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            face = self._face_region(gray)

            if face is not None:
                faces_found += 1
                face_resized = cv2.resize(face, (64, 64))
                lap = self._laplacian_score(face_resized)
                edg = self._edge_density(face_resized)
                laplacians.append(lap)
                edges.append(edg)

                diff = 0.0
                if prev_face is not None:
                    diff = float(np.mean(np.abs(face_resized.astype(float) - prev_face.astype(float))))
                    face_diffs.append(diff)
                prev_face = face_resized

                # Per-frame score: combine edge anomaly + laplacian signal.
                # Normalised independently so each frame gets a 0-1 suspicion value.
                frame_edge_score = min(abs(edg - 0.08) / 0.12, 1.0)
                frame_lap_score = min(lap / 800.0, 1.0)
                frame_diff_score = min(diff / 20.0, 1.0)
                frame_score = 0.4 * frame_edge_score + 0.35 * frame_lap_score + 0.25 * frame_diff_score
                frame_scores.append(round(min(frame_score, 1.0), 3))

        cap.release()

        if not laplacians:
            # No faces found — analyze full frame
            cap = cv2.VideoCapture(video_path)
            for idx in indices[:5]:
                cap.set(cv2.CAP_PROP_POS_FRAMES, int(idx))
                ok, frame = cap.read()
                if ok:
                    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
                    small = cv2.resize(gray, (128, 128))
                    lap = self._laplacian_score(small)
                    edg = self._edge_density(small)
                    laplacians.append(lap)
                    edges.append(edg)
                    frame_edge_score = min(abs(edg - 0.08) / 0.12, 1.0)
                    frame_lap_score = min(lap / 800.0, 1.0)
                    frame_scores.append(round(min(0.5 * frame_edge_score + 0.5 * frame_lap_score, 1.0), 3))
            cap.release()
            if not laplacians:
                raise ValueError("No frames could be analyzed")

        # Scoring heuristics
        avg_lap = float(np.mean(laplacians))
        lap_std = float(np.std(laplacians)) if len(laplacians) > 1 else 0.0
        avg_edge = float(np.mean(edges))
        temporal_inconsistency = float(np.std(face_diffs)) if len(face_diffs) > 1 else 0.0

        # Deepfakes tend to have: unusual edge density, high temporal inconsistency,
        # and high Laplacian variance std (inconsistent sharpening across frames)
        score = 0.0
        score += min(temporal_inconsistency / 15.0, 0.4)   # up to 0.4
        score += min(lap_std / 500.0, 0.3)                 # up to 0.3
        score += min(abs(avg_edge - 0.08) / 0.1, 0.3)      # up to 0.3

        confidence = min(score, 1.0)
        verdict = "FAKE" if confidence >= 0.8 else "UNCERTAIN" if confidence >= 0.4 else "REAL"

        logger.info("verdict=%s confidence=%.3f faces=%d frames=%d",
                    verdict, confidence, faces_found, len(laplacians))

        return {
            "verdict": verdict,
            "confidence": round(confidence, 3),
            "faces_found": faces_found,
            "frames_analyzed": len(laplacians),
            "temporal_inconsistency": round(temporal_inconsistency, 3),
            "frame_scores": frame_scores,
        }
