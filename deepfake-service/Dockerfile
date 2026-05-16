# Hugging Face Spaces requires the app to listen on port 7860.
FROM python:3.11-slim

WORKDIR /app

# OpenCV headless needs libgl1 + libglib2.0-0
RUN apt-get update && \
    apt-get install -y --no-install-recommends libgl1 libglib2.0-0 && \
    rm -rf /var/lib/apt/lists/*

# Install CPU-only PyTorch first (smaller image, ~800 MB vs 2.5 GB for CUDA)
RUN pip install --no-cache-dir \
    torch==2.4.1 torchvision==0.19.1 \
    --index-url https://download.pytorch.org/whl/cpu

COPY requirements.txt .
# torch/torchvision already installed above — skip them here
RUN grep -v "^torch" requirements.txt | pip install --no-cache-dir -r /dev/stdin

COPY . .

# Pre-download models at build time so the first request is fast
RUN python - <<'EOF'
from facenet_pytorch import MTCNN
MTCNN()
from transformers import pipeline
pipeline("image-classification", model="dima806/deepfake_vs_real_image_detection")
EOF

EXPOSE 7860

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "7860"]
