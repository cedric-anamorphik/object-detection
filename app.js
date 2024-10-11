const output = document.getElementById("output");
const videoContainer = document.getElementById("video-container");
const video = document.getElementById("video");
const loader = document.getElementById("loader");
const cameraButton = document.getElementById("camera-button");
const detectionsCanvas = document.getElementById("detections");
const ctx = detectionsCanvas.getContext("2d");
let model;
let stream;
let videoWidth;
let videoHeight;

const MODEL_VERSION = "1"; // Update this when you want to invalidate the cache

async function loadModel() {
  try {
    // Try to load the model configuration from cache first
    const cachedConfig = await loadFromIndexedDB("cocoSsdConfig");
    console.log("cachedConfig", cachedConfig);

    const cachedModel = await loadFromIndexedDB("ssdlite_mobilenet_v2");
    console.log("cachedModel", cachedModel);

    if (cachedConfig && cachedModel) {
      const cachedModelBlob = new Blob([cachedModel.buffer], { type: cachedModel.type });
      const cachedModelUrl = URL.createObjectURL(cachedModelBlob);
      console.log("cachedModelUrl", cachedModelUrl);

      console.log("Model configuration loaded from IndexedDB cache");
      // model = await cocoSsd.load(cachedConfig);

      const model = await tf.loadGraphModel(cachedModelUrl, cachedConfig);
      console.log(model);
    } else {
      console.log("Model configuration not found in cache. Loading default model...");
      model = await cocoSsd.load();

      // Save the model configuration to IndexedDB
      const modelConfig = model.modelUrl || "lite_mobilenet_v2";
      await saveToIndexedDB("cocoSsdConfig", modelConfig);
      console.log("Model configuration saved to IndexedDB cache");

      const modelFile = model.path || "https://storage.googleapis.com/tfjs-models/savedmodel/ssdlite_mobilenet_v2/model.json";
      // const response = await fetch(modelFile);
      // modelData = await response.json();

      const modelData = await fetchMedia(modelFile);
      console.log("fetched modelData", modelData);

      await saveToIndexedDB("ssdlite_mobilenet_v2", modelData);
      console.log("ssdlite_mobilenet_v2 saved to IndexedDB cache");
    }

    console.log("model", model);

    loader.style.display = "none";
    cameraButton.style.display = "inline-block";
  } catch (error) {
    console.error("Error loading the model:", error);
    alert("Failed to load the object detection model. Please refresh the page and try again.");
  }
}

async function loadFromIndexedDB(key) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("ModelCache", 1);

    request.onerror = () => reject("IndexedDB access denied");

    request.onsuccess = (event) => {
      const db = event.target.result;
      const transaction = db.transaction(["models"], "readonly");
      const objectStore = transaction.objectStore("models");
      const modelRequest = objectStore.get(key);

      modelRequest.onerror = () => reject("Error fetching from IndexedDB");
      modelRequest.onsuccess = () => {
        const config = modelRequest.result;
        if (config && config.version === MODEL_VERSION) {
          resolve(config.modelConfig);
        } else {
          resolve(null); // Config not found or version mismatch
        }
      };
    };

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      db.createObjectStore("models", { keyPath: "key" });
      db.createObjectStore("files", { keyPath: "key" });
    };
  });
}

async function saveToIndexedDB(key, modelConfig) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("ModelCache", 1);

    request.onerror = () => reject("IndexedDB access denied");

    request.onsuccess = (event) => {
      const db = event.target.result;
      const transaction = db.transaction(["models"], "readwrite");
      const objectStore = transaction.objectStore("models");

      const configData = {
        key: key,
        modelConfig: modelConfig,
        version: MODEL_VERSION,
      };

      const saveRequest = objectStore.put(configData);
      saveRequest.onerror = () => reject("Error saving to IndexedDB");
      saveRequest.onsuccess = () => resolve();
    };
  });
}

async function saveFileToIndexedDB(key, file) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("ModelCache", 1);

    request.onerror = () => reject("IndexedDB access denied");

    request.onsuccess = (event) => {
      const db = event.target.result;
      const transaction = db.transaction(["files"], "readwrite");
      const objectStore = transaction.objectStore("files");

      const blob = new Blob([file], { type: "application/octet-stream" });

      const fileData = {
        key: key,
        url: URL.createObjectURL(blob),
      };

      const saveRequest = objectStore.put(fileData);
      saveRequest.onerror = () => reject("Error saving to IndexedDB");
      saveRequest.onsuccess = () => resolve();
    };
  });
}

async function loadFileFromIndexedDB(key) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("ModelCache", 1);

    request.onerror = () => reject("IndexedDB access denied");

    request.onsuccess = (event) => {
      const db = event.target.result;
      const transaction = db.transaction(["files"], "readonly");
      const objectStore = transaction.objectStore("files");

      const loadRequest = objectStore.get(key);
      loadRequest.onerror = () => reject("Error loading from IndexedDB");
      loadRequest.onsuccess = (event) => {
        const result = event.target.result;
        if (result) {
          resolve(result.url);
        } else {
          resolve(null); // Config not found or version mismatch
        }
      };
    };
  });
}

// Fetch media file from URL
async function fetchMedia(url) {
  console.info("fetching media…", url);

  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.error(`Error fetching image ${url}`, response.status);
      return null;
    }

    const blob = await response.blob();
    const buffer = await blob.arrayBuffer();
    const type = blob?.type || "";

    // NOTE: (Safari…) Do not store blob in database but the buffer and type
    // then recreate the blob when loading images:
    // const blob = new Blob([value.buffer], { type: value.type });
    // URL.createObjectURL(blob);

    return {
      buffer: buffer,
      type: type,
    };
  } catch (error) {
    console.error("Error fetching media:", error);
    return null;
  }
}

async function setupVideoStream(stream) {
  video.srcObject = stream;

  await new Promise((resolve) => {
    video.onloadedmetadata = resolve;
  });

  const videoWidth = video.videoWidth;
  const videoHeight = video.videoHeight;
  const aspectRatio = videoWidth / videoHeight;

  // Set video dimensions based on aspect ratio
  if (aspectRatio > 1) {
    video.style.width = "100vw";
    video.style.height = "auto";
  } else {
    video.style.width = "auto";
    video.style.height = "100vh";
  }

  // Setup detection canvas
  detectionsCanvas.width = videoWidth;
  detectionsCanvas.height = videoHeight;
  detectionsCanvas.style.aspectRatio = aspectRatio;

  await video.play();
  detectFrame();
}

async function startDetection() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { exact: "environment" },
      },
    });

    await setupVideoStream(stream);
  } catch (err) {
    console.error("Error accessing the back camera:", err);
    try {
      // Fallback: try to access any available camera
      const fallbackStream = await navigator.mediaDevices.getUserMedia({ video: true });
      await setupVideoStream(fallbackStream);
    } catch (fallbackErr) {
      console.error("Error accessing any camera:", fallbackErr);
      // Handle the error (e.g., show a message to the user)
    }
  }
}

async function detectFrame() {
  const predictions = await model.detect(video);
  renderDetections(predictions);
  requestAnimationFrame(detectFrame);
}

function renderDetections(predictions) {
  ctx.clearRect(0, 0, detectionsCanvas.width, detectionsCanvas.height);
  predictions.forEach((prediction) => {
    const [x, y, width, height] = prediction.bbox;
    const score = prediction.score;
    const className = prediction.class;

    ctx.beginPath();
    ctx.rect(x, y, width, height);
    ctx.lineWidth = 2;
    ctx.strokeStyle = "red";
    ctx.stroke();

    ctx.font = "16px Arial";
    ctx.fillStyle = "red";
    ctx.fillText(`${className} (${Math.round(score * 100)}%)`, x, y > 10 ? y - 5 : 10);

    output.innerHTML = `${className} (${Math.round(score * 100)}%)`;
  });
}

cameraButton.addEventListener("click", () => {
  cameraButton.style.display = "none";
  startDetection();
});

loadModel();

// toggle videoContainer fullscreen on double tap
videoContainer.addEventListener("dblclick", () => {
  if (document.fullscreenElement) {
    document.exitFullscreen();
  } else {
    videoContainer.requestFullscreen();
  }
});
