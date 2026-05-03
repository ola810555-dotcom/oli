const API = "app.php";
const nameRegex = /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ ]+$/u;
const phoneRegex = /^[0-9]+$/;
const emojis = ["😀", "😂", "😍", "😎", "🥰", "😇", "👍", "🙏", "✨", "💬", "❤️", "🌟"];
const stickers = ["💟", "🌸", "🦋", "🍓", "☁️", "🌈", "⭐", "🎀", "🍰", "💌"];

let currentUser = null;
let currentChat = { id: 0, name: "Servidor general" };
let selectedSticker = "";
let attachedFile = null;
let pollTimer = null;
let cameraStream = null;
let audioRecorder = null;
let audioChunks = [];

const $ = (selector) => document.querySelector(selector);

const authPanel = $("#authPanel");
const messenger = $("#messenger");
const authStatus = $("#authStatus");
const loginForm = $("#loginForm");
const registerForm = $("#registerForm");
const loginTab = $("#loginTab");
const registerTab = $("#registerTab");
const messagesBox = $("#messages");
const messageForm = $("#messageForm");
const messageBody = $("#messageBody");
const editingId = $("#editingId");
const recipientId = $("#recipientId");
const expiresIn = $("#expiresIn");
const fileInput = $("#fileInput");
const fileName = $("#fileName");
const emojiPicker = $("#emojiPicker");
const stickerPicker = $("#stickerPicker");
const accountForm = $("#accountForm");
const userSearch = $("#userSearch");
const userResults = $("#userResults");
const storiesStrip = $("#storiesStrip");
const statusForm = $("#statusForm");
const cameraModal = $("#cameraModal");
const cameraPreview = $("#cameraPreview");
const cameraCanvas = $("#cameraCanvas");

function setStatus(text, isError = false) {
  authStatus.textContent = text;
  authStatus.style.color = isError ? "#d6455d" : "#736d86";
}

function api(action, data = null) {
  const options = data instanceof FormData
    ? { method: "POST", body: data }
    : {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data || {})
      };

  return fetch(`${API}?action=${encodeURIComponent(action)}`, options).then(readResponse);
}

function apiGet(action, params = {}) {
  const query = new URLSearchParams({ action, ...params });
  return fetch(`${API}?${query.toString()}`).then(readResponse);
}

async function readResponse(response) {
  const payload = await response.json().catch(() => ({ ok: false, error: "Respuesta invalida del servidor." }));
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || "No se pudo completar la accion.");
  }
  return payload;
}

function cleanLettersInput(input) {
  input.value = input.value.replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ ]/gu, "");
}

function cleanNumbersInput(input) {
  input.value = input.value.replace(/[^0-9]/g, "");
}

function validateNamePhone(form) {
  const name = form.elements.name?.value.trim();
  const phone = form.elements.phone?.value.trim();

  if (name !== undefined && !nameRegex.test(name)) {
    throw new Error("El nombre solo puede llevar letras y espacios.");
  }
  if (phone !== undefined && !phoneRegex.test(phone)) {
    throw new Error("El telefono solo puede llevar numeros.");
  }
}

function showLoginMode(isLogin) {
  loginTab.classList.toggle("active", isLogin);
  registerTab.classList.toggle("active", !isLogin);
  loginForm.classList.toggle("active", isLogin);
  registerForm.classList.toggle("active", !isLogin);
  setStatus("");
}

function setUser(user) {
  currentUser = user;
  $("#userName").textContent = user.name;
  $("#userEmail").textContent = user.email;
  $("#userAvatar").textContent = user.name.charAt(0).toUpperCase();
  accountForm.elements.name.value = user.name;
  accountForm.elements.phone.value = user.phone || "";
}

function enterApp(user) {
  setUser(user);
  authPanel.classList.add("hidden");
  messenger.classList.remove("hidden");
  selectChat(0, "Servidor general");
  loadStatuses();
  clearInterval(pollTimer);
  pollTimer = setInterval(() => {
    loadMessages();
    loadStatuses();
  }, 4500);
}

function leaveApp() {
  currentUser = null;
  messenger.classList.add("hidden");
  authPanel.classList.remove("hidden");
  clearInterval(pollTimer);
  messagesBox.innerHTML = "";
  storiesStrip.innerHTML = "";
}

function renderPicker(container, items, handler) {
  container.innerHTML = "";
  items.forEach((item) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "picker-item";
    button.textContent = item;
    button.addEventListener("click", () => handler(item));
    container.appendChild(button);
  });
}

function escapeText(value) {
  const div = document.createElement("div");
  div.textContent = value || "";
  return div.innerHTML;
}

function renderAttachment(message) {
  if (!message.file_name) return "";

  const src = `${API}?action=file&id=${encodeURIComponent(message.id)}`;
  const name = escapeText(message.file_name);
  const type = message.file_type || "";

  if (type.startsWith("image/")) {
    return `<div class="attachment"><img src="${src}" alt="${name}"></div>`;
  }
  if (type.startsWith("audio/")) {
    return `<div class="attachment"><audio controls src="${src}"></audio></div>`;
  }
  if (type.startsWith("video/")) {
    return `<div class="attachment"><video controls src="${src}"></video></div>`;
  }
  return `<div class="attachment"><a class="download-link" href="${src}" download="${name}">Descargar ${name}</a></div>`;
}

function renderMessages(messages) {
  if (!messages.length) {
    messagesBox.innerHTML = `<div class="empty-state">Aun no hay mensajes.</div>`;
    return;
  }

  messagesBox.innerHTML = messages.map((message) => {
    const mine = currentUser && Number(message.user_id) === Number(currentUser.id);
    const expires = message.expires_at ? `<span>Expira ${escapeText(message.expires_at)}</span>` : "";
    const tools = mine
      ? `<div class="message-tools">
          <button class="tool-button edit" data-id="${message.id}" type="button">Editar</button>
          <button class="tool-button delete" data-id="${message.id}" type="button">Borrar</button>
        </div>`
      : "";
    return `<article class="message ${mine ? "mine" : ""}">
      <div class="message-meta">
        <span>${escapeText(message.user_name)}</span>
        <time>${escapeText(message.created_at)}</time>
      </div>
      <div class="message-body">${escapeText(message.body)}</div>
      ${message.sticker ? `<span class="sticker">${escapeText(message.sticker)}</span>` : ""}
      ${renderAttachment(message)}
      ${expires}
      ${tools}
    </article>`;
  }).join("");

  messagesBox.scrollTop = messagesBox.scrollHeight;
}

function renderStatuses(statuses) {
  if (!statuses.length) {
    storiesStrip.innerHTML = `<div class="story-card"><strong>Feed</strong><span>Sin estados todavia</span></div>`;
    return;
  }

  storiesStrip.innerHTML = statuses.map((status) => {
    const src = `${API}?action=status_file&id=${encodeURIComponent(status.id)}`;
    const type = status.file_type || "";
    let media = "";
    if (type.startsWith("image/")) media = `<img class="story-media" src="${src}" alt="">`;
    if (type.startsWith("audio/")) media = `<audio class="story-audio" controls src="${src}"></audio>`;
    if (type.startsWith("video/")) media = `<video class="story-media" controls src="${src}"></video>`;
    return `<article class="story-card">
      <strong>${escapeText(status.user_name)}</strong>
      <span>${escapeText(status.note || "Estado multimedia")}</span>
      <span>${escapeText(status.created_at)}</span>
      ${media}
    </article>`;
  }).join("");
}

async function loadMessages() {
  if (!currentUser) return;
  try {
    const payload = await apiGet("messages", { recipient_id: currentChat.id || "" });
    renderMessages(payload.messages);
  } catch (error) {
    $("#chatHint").textContent = error.message;
  }
}

async function loadStatuses() {
  if (!currentUser) return;
  try {
    const payload = await apiGet("statuses");
    renderStatuses(payload.statuses);
  } catch (error) {
    storiesStrip.innerHTML = `<div class="story-card"><strong>Feed</strong><span>${escapeText(error.message)}</span></div>`;
  }
}

function selectChat(id, name) {
  currentChat = { id: Number(id) || 0, name };
  recipientId.value = currentChat.id || "";
  $("#chatTitle").textContent = currentChat.id ? `Chat con ${name}` : "Servidor general";
  $("#chatHint").textContent = currentChat.id ? "Mensaje directo privado." : "Feed del servidor general.";
  resetComposer();
  loadMessages();
}

function resetComposer() {
  messageForm.reset();
  selectedSticker = "";
  attachedFile = null;
  editingId.value = "";
  recipientId.value = currentChat.id || "";
  expiresIn.value = "0";
  fileName.textContent = "";
  messageForm.querySelector(".send-button").textContent = "Enviar";
}

function addFileToForm(formData) {
  if (attachedFile) {
    formData.set("file", attachedFile, attachedFile.name);
  }
}

document.addEventListener("input", (event) => {
  if (event.target.matches('input[name="name"], #userSearch')) cleanLettersInput(event.target);
  if (event.target.matches('input[name="phone"]')) cleanNumbersInput(event.target);
});

loginTab.addEventListener("click", () => showLoginMode(true));
registerTab.addEventListener("click", () => showLoginMode(false));

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setStatus("Entrando...");
  try {
    const payload = await api("login", Object.fromEntries(new FormData(loginForm)));
    setStatus("");
    enterApp(payload.user);
  } catch (error) {
    setStatus(error.message, true);
  }
});

registerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setStatus("Creando cuenta...");
  try {
    validateNamePhone(registerForm);
    const payload = await api("register", Object.fromEntries(new FormData(registerForm)));
    registerForm.reset();
    setStatus("");
    enterApp(payload.user);
  } catch (error) {
    setStatus(error.message, true);
  }
});

messageForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(messageForm);
  formData.append("sticker", selectedSticker);
  addFileToForm(formData);

  if (!formData.get("body").trim() && !selectedSticker && !fileInput.files.length && !attachedFile && !editingId.value) {
    return;
  }

  try {
    await api(editingId.value ? "update_message" : "create_message", formData);
    resetComposer();
    await loadMessages();
  } catch (error) {
    $("#chatHint").textContent = error.message;
  }
});

statusForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(statusForm);
  try {
    await api("create_status", formData);
    statusForm.reset();
    await loadStatuses();
  } catch (error) {
    $("#chatHint").textContent = error.message;
  }
});

messagesBox.addEventListener("click", async (event) => {
  const editButton = event.target.closest(".edit");
  const deleteButton = event.target.closest(".delete");

  if (editButton) {
    const message = editButton.closest(".message");
    editingId.value = editButton.dataset.id;
    messageBody.value = message.querySelector(".message-body").textContent;
    messageBody.focus();
    messageForm.querySelector(".send-button").textContent = "Guardar";
  }

  if (deleteButton && confirm("Quieres borrar este mensaje?")) {
    try {
      await api("delete_message", { id: deleteButton.dataset.id });
      await loadMessages();
    } catch (error) {
      $("#chatHint").textContent = error.message;
    }
  }
});

document.addEventListener("play", (event) => {
  if (!event.target.matches("audio, video")) return;
  document.querySelectorAll("audio, video").forEach((media) => {
    if (media !== event.target) media.pause();
  });
}, true);

userSearch.addEventListener("input", async () => {
  const q = userSearch.value.trim();
  if (!q) {
    userResults.innerHTML = `<button class="user-pill" type="button" data-id="0" data-name="Servidor general">Servidor general</button>`;
    return;
  }

  try {
    const payload = await apiGet("search_users", { q });
    userResults.innerHTML = payload.users.map((user) => (
      `<button class="user-pill" type="button" data-id="${user.id}" data-name="${escapeText(user.name)}">${escapeText(user.name)}</button>`
    )).join("") || `<div class="user-pill">Sin resultados</div>`;
  } catch (error) {
    userResults.innerHTML = `<div class="user-pill">${escapeText(error.message)}</div>`;
  }
});

userResults.addEventListener("click", (event) => {
  const button = event.target.closest(".user-pill[data-id]");
  if (button) selectChat(button.dataset.id, button.dataset.name);
});

$("#emojiBtn").addEventListener("click", () => {
  emojiPicker.classList.toggle("hidden");
  stickerPicker.classList.add("hidden");
});

$("#stickerBtn").addEventListener("click", () => {
  stickerPicker.classList.toggle("hidden");
  emojiPicker.classList.add("hidden");
});

fileInput.addEventListener("change", () => {
  attachedFile = null;
  fileName.textContent = fileInput.files[0] ? fileInput.files[0].name : "";
});

$("#cameraBtn").addEventListener("click", async () => {
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    cameraPreview.srcObject = cameraStream;
    cameraModal.classList.remove("hidden");
  } catch (error) {
    $("#chatHint").textContent = "No se pudo abrir la camara.";
  }
});

$("#captureBtn").addEventListener("click", () => {
  const width = cameraPreview.videoWidth || 640;
  const height = cameraPreview.videoHeight || 480;
  cameraCanvas.width = width;
  cameraCanvas.height = height;
  cameraCanvas.getContext("2d").drawImage(cameraPreview, 0, 0, width, height);
  cameraCanvas.toBlob((blob) => {
    attachedFile = new File([blob], `camara-${Date.now()}.jpg`, { type: "image/jpeg" });
    fileInput.value = "";
    fileName.textContent = attachedFile.name;
    closeCamera();
  }, "image/jpeg", 0.9);
});

function closeCamera() {
  if (cameraStream) {
    cameraStream.getTracks().forEach((track) => track.stop());
    cameraStream = null;
  }
  cameraModal.classList.add("hidden");
}

$("#closeCameraBtn").addEventListener("click", closeCamera);

$("#audioBtn").addEventListener("click", async () => {
  if (audioRecorder && audioRecorder.state === "recording") {
    audioRecorder.stop();
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioChunks = [];
    audioRecorder = new MediaRecorder(stream);
    audioRecorder.addEventListener("dataavailable", (event) => audioChunks.push(event.data));
    audioRecorder.addEventListener("stop", () => {
      stream.getTracks().forEach((track) => track.stop());
      attachedFile = new File(audioChunks, `audio-${Date.now()}.webm`, { type: "audio/webm" });
      fileInput.value = "";
      fileName.textContent = attachedFile.name;
      $("#audioBtn").classList.remove("recording");
      $("#audioBtn").textContent = "🎙️";
    });
    audioRecorder.start();
    $("#audioBtn").classList.add("recording");
    $("#audioBtn").textContent = "■";
  } catch (error) {
    $("#chatHint").textContent = "No se pudo abrir el microfono.";
  }
});

$("#refreshBtn").addEventListener("click", () => {
  loadMessages();
  loadStatuses();
});

$("#themeBtn").addEventListener("click", () => {
  document.body.classList.toggle("dark");
  localStorage.setItem("pastelTheme", document.body.classList.contains("dark") ? "dark" : "light");
});

$("#logoutBtn").addEventListener("click", async () => {
  await api("logout").catch(() => null);
  leaveApp();
});

$("#editAccountBtn").addEventListener("click", () => {
  accountForm.classList.toggle("hidden");
});

accountForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    validateNamePhone(accountForm);
    const payload = await api("update_account", Object.fromEntries(new FormData(accountForm)));
    setUser(payload.user);
    accountForm.classList.add("hidden");
  } catch (error) {
    $("#chatHint").textContent = error.message;
  }
});

$("#deleteAccountBtn").addEventListener("click", async () => {
  if (!confirm("Quieres borrar tu cuenta y tus mensajes?")) return;
  try {
    await api("delete_account");
    leaveApp();
    setStatus("Cuenta borrada.");
  } catch (error) {
    $("#chatHint").textContent = error.message;
  }
});

renderPicker(emojiPicker, emojis, (emoji) => {
  messageBody.value += emoji;
  messageBody.focus();
});

renderPicker(stickerPicker, stickers, (sticker) => {
  selectedSticker = sticker;
  stickerPicker.classList.add("hidden");
});

if (localStorage.getItem("pastelTheme") === "dark") {
  document.body.classList.add("dark");
}

userResults.innerHTML = `<button class="user-pill" type="button" data-id="0" data-name="Servidor general">Servidor general</button>`;

api("me")
  .then((payload) => {
    if (payload.user) enterApp(payload.user);
  })
  .catch(() => null);
