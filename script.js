const API = "app.php";
const nameRegex = /^[A-Za-z ]+$/;
const phoneRegex = /^[0-9]+$/;
const emojis = ["\u{1F600}", "\u{1F602}", "\u{1F60D}", "\u{1F60E}", "\u{1F970}", "\u{1F44D}", "\u{2728}", "\u{2764}\u{FE0F}", "\u{1F64F}", "\u{1F525}"];
const stickers = ["\u{1F338}", "\u{1F98B}", "\u{1F353}", "\u{2601}\u{FE0F}", "\u{1F308}", "\u{2B50}", "\u{1F380}", "\u{1F370}", "\u{1F48C}", "\u{1F49F}"];

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
const chatList = $("#chatList");
const storiesStrip = $("#storiesStrip");
const statusForm = $("#statusForm");
const cameraModal = $("#cameraModal");
const cameraPreview = $("#cameraPreview");
const cameraCanvas = $("#cameraCanvas");

function setNotice(text, isError = false) {
  authStatus.textContent = text;
  authStatus.style.color = isError ? "#d9435f" : "";
}

function readResponse(response) {
  return response.json()
    .catch(() => ({ ok: false, error: "El servidor no respondio JSON valido." }))
    .then((payload) => {
      if (!response.ok || !payload.ok) throw new Error(payload.error || "No se pudo completar.");
      return payload;
    });
}

function api(action, data = {}) {
  const options = data instanceof FormData
    ? { method: "POST", body: data }
    : {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
      };
  return fetch(`${API}?action=${encodeURIComponent(action)}`, options).then(readResponse);
}

function apiGet(action, params = {}) {
  const query = new URLSearchParams({ action, ...params });
  return fetch(`${API}?${query}`).then(readResponse);
}

function cleanLetters(input) {
  input.value = input.value.replace(/[^A-Za-z ]/g, "");
}

function cleanNumbers(input) {
  input.value = input.value.replace(/[^0-9]/g, "");
}

function validateProfile(form) {
  const name = form.elements.name?.value.trim();
  const phone = form.elements.phone?.value.trim();
  if (name !== undefined && !nameRegex.test(name)) throw new Error("El nombre solo acepta letras.");
  if (phone !== undefined && !phoneRegex.test(phone)) throw new Error("El telefono solo acepta numeros.");
}

function esc(value) {
  const div = document.createElement("div");
  div.textContent = value || "";
  return div.innerHTML;
}

function initials(name) {
  return (name || "U").trim().slice(0, 2).toUpperCase();
}

function showAuthTab(login) {
  loginTab.classList.toggle("active", login);
  registerTab.classList.toggle("active", !login);
  loginForm.classList.toggle("active", login);
  registerForm.classList.toggle("active", !login);
  setNotice("");
}

function setUser(user) {
  currentUser = user;
  $("#userName").textContent = user.name;
  $("#userEmail").textContent = user.email;
  $("#userAvatar").textContent = initials(user.name);
  accountForm.elements.name.value = user.name;
  accountForm.elements.phone.value = user.phone || "";
}

function enterApp(user) {
  setUser(user);
  authPanel.classList.add("hidden");
  messenger.classList.remove("hidden");
  selectChat(0, "Servidor general");
  refreshAll();
  clearInterval(pollTimer);
  pollTimer = setInterval(refreshAll, 4000);
}

function leaveApp() {
  currentUser = null;
  clearInterval(pollTimer);
  messenger.classList.add("hidden");
  authPanel.classList.remove("hidden");
  messagesBox.innerHTML = "";
  chatList.innerHTML = "";
  storiesStrip.innerHTML = "";
}

function selectChat(id, name) {
  currentChat = { id: Number(id) || 0, name };
  recipientId.value = currentChat.id || "";
  $("#chatTitle").textContent = currentChat.id ? name : "Servidor general";
  $("#chatAvatar").textContent = currentChat.id ? initials(name) : "S";
  $("#chatHint").textContent = currentChat.id
    ? "Chat privado. Puedes enviar fotos, audios y archivos."
    : "Chat del servidor. Todos los usuarios registrados lo ven.";
  resetComposer();
  loadMessages();
  markActiveChat();
}

function markActiveChat() {
  document.querySelectorAll(".contact").forEach((button) => {
    button.classList.toggle("active", Number(button.dataset.id) === currentChat.id);
  });
}

function renderContact(user, preview = "") {
  const online = Number(user.online) === 1 ? "En linea" : "Usuario";
  return `<button class="contact" type="button" data-id="${user.id}" data-name="${esc(user.name)}">
    <span class="avatar">${esc(initials(user.name))}</span>
    <span>
      <strong>${esc(user.name)}</strong>
      <span>${esc(preview || user.last_message || online)}</span>
    </span>
  </button>`;
}

function renderChatList(chats) {
  const general = `<button class="contact" type="button" data-id="0" data-name="Servidor general">
    <span class="avatar">S</span>
    <span><strong>Servidor general</strong><span>Chat publico de la red</span></span>
  </button>`;
  chatList.innerHTML = general + chats.map((chat) => renderContact(chat)).join("");
  markActiveChat();
}

function renderAttachment(message) {
  if (!message.file_name) return "";
  const src = `${API}?action=file&id=${encodeURIComponent(message.id)}`;
  const name = esc(message.file_name);
  const type = message.file_type || "";
  if (type.startsWith("image/")) return `<div class="attachment"><img src="${src}" alt="${name}"></div>`;
  if (type.startsWith("audio/")) return `<div class="attachment"><audio controls src="${src}"></audio></div>`;
  if (type.startsWith("video/")) return `<div class="attachment"><video controls src="${src}"></video></div>`;
  return `<div class="attachment"><a class="download" href="${src}" download="${name}">Descargar ${name}</a></div>`;
}

function renderMessages(messages) {
  if (!messages.length) {
    messagesBox.innerHTML = `<div class="empty">No hay mensajes todavia.</div>`;
    return;
  }

  messagesBox.innerHTML = messages.map((message) => {
    const mine = Number(message.user_id) === Number(currentUser.id);
    const tools = mine
      ? `<div class="message-tools">
          <button class="tool edit" data-id="${message.id}" type="button">Editar</button>
          <button class="tool delete" data-id="${message.id}" type="button">Borrar</button>
        </div>`
      : "";
    const expires = message.expires_at ? `<span>Expira ${esc(message.expires_at)}</span>` : "";
    return `<article class="bubble ${mine ? "mine" : ""}">
      <div class="meta"><span>${esc(message.user_name)}</span><time>${esc(message.created_at)}</time></div>
      <div class="body-text">${esc(message.body)}</div>
      ${message.sticker ? `<span class="sticker">${esc(message.sticker)}</span>` : ""}
      ${renderAttachment(message)}
      ${expires}
      ${tools}
    </article>`;
  }).join("");
  messagesBox.scrollTop = messagesBox.scrollHeight;
}

function renderStatuses(statuses) {
  if (!statuses.length) {
    storiesStrip.innerHTML = `<article class="story"><strong>Estados</strong><span>Sin estados aun</span></article>`;
    return;
  }

  storiesStrip.innerHTML = statuses.map((status) => {
    const src = `${API}?action=status_file&id=${encodeURIComponent(status.id)}`;
    const type = status.file_type || "";
    let media = "";
    if (type.startsWith("image/")) media = `<img class="story-media" src="${src}" alt="">`;
    if (type.startsWith("audio/")) media = `<audio class="story-audio" controls src="${src}"></audio>`;
    if (type.startsWith("video/")) media = `<video class="story-media" controls src="${src}"></video>`;
    return `<article class="story">
      <strong>${esc(status.user_name)}</strong>
      <span>${esc(status.note || "Estado multimedia")}</span>
      ${media}
    </article>`;
  }).join("");
}

function loadMessages() {
  if (!currentUser) return Promise.resolve();
  return apiGet("messages", { recipient_id: currentChat.id || "" })
    .then((payload) => renderMessages(payload.messages))
    .catch((error) => { $("#chatHint").textContent = error.message; });
}

function loadChats() {
  if (!currentUser) return Promise.resolve();
  return apiGet("chats")
    .then((payload) => renderChatList(payload.chats))
    .catch(() => renderChatList([]));
}

function loadStatuses() {
  if (!currentUser) return Promise.resolve();
  return apiGet("statuses")
    .then((payload) => renderStatuses(payload.statuses))
    .catch((error) => {
      storiesStrip.innerHTML = `<article class="story"><strong>Error</strong><span>${esc(error.message)}</span></article>`;
    });
}

function refreshAll() {
  loadMessages();
  loadChats();
  loadStatuses();
}

function resetComposer() {
  messageForm.reset();
  selectedSticker = "";
  attachedFile = null;
  editingId.value = "";
  recipientId.value = currentChat.id || "";
  expiresIn.value = "0";
  fileName.textContent = "";
  messageForm.querySelector(".send").textContent = "Enviar";
}

function putAttachedFile(formData) {
  if (attachedFile) formData.set("file", attachedFile, attachedFile.name);
}

function buildPicker(container, items, onPick) {
  container.innerHTML = "";
  items.forEach((item) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = item;
    button.addEventListener("click", () => onPick(item));
    container.appendChild(button);
  });
}

document.addEventListener("input", (event) => {
  if (event.target.matches('input[name="name"], #userSearch')) cleanLetters(event.target);
  if (event.target.matches('input[name="phone"]')) cleanNumbers(event.target);
});

loginTab.addEventListener("click", () => showAuthTab(true));
registerTab.addEventListener("click", () => showAuthTab(false));

loginForm.addEventListener("submit", (event) => {
  event.preventDefault();
  setNotice("Entrando...");
  api("login", Object.fromEntries(new FormData(loginForm)))
    .then((payload) => {
      setNotice("");
      enterApp(payload.user);
    })
    .catch((error) => setNotice(error.message, true));
});

registerForm.addEventListener("submit", (event) => {
  event.preventDefault();
  setNotice("Creando cuenta...");
  try {
    validateProfile(registerForm);
  } catch (error) {
    setNotice(error.message, true);
    return;
  }
  api("register", Object.fromEntries(new FormData(registerForm)))
    .then((payload) => {
      registerForm.reset();
      setNotice("");
      enterApp(payload.user);
    })
    .catch((error) => setNotice(error.message, true));
});

messageForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const formData = new FormData(messageForm);
  formData.append("sticker", selectedSticker);
  putAttachedFile(formData);

  if (!formData.get("body").trim() && !selectedSticker && !fileInput.files.length && !attachedFile && !editingId.value) return;

  api(editingId.value ? "update_message" : "create_message", formData)
    .then(() => {
      resetComposer();
      refreshAll();
    })
    .catch((error) => { $("#chatHint").textContent = error.message; });
});

statusForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const formData = new FormData(statusForm);
  api("create_status", formData)
    .then(() => {
      statusForm.reset();
      loadStatuses();
    })
    .catch((error) => { $("#chatHint").textContent = error.message; });
});

messagesBox.addEventListener("click", (event) => {
  const edit = event.target.closest(".edit");
  const del = event.target.closest(".delete");
  if (edit) {
    const bubble = edit.closest(".bubble");
    editingId.value = edit.dataset.id;
    messageBody.value = bubble.querySelector(".body-text").textContent;
    messageBody.focus();
    messageForm.querySelector(".send").textContent = "Guardar";
  }
  if (del && confirm("Quieres borrar este mensaje?")) {
    api("delete_message", { id: del.dataset.id })
      .then(refreshAll)
      .catch((error) => { $("#chatHint").textContent = error.message; });
  }
});

chatList.addEventListener("click", (event) => {
  const contact = event.target.closest(".contact");
  if (contact) selectChat(contact.dataset.id, contact.dataset.name);
});

userResults.addEventListener("click", (event) => {
  const contact = event.target.closest(".contact");
  if (contact) selectChat(contact.dataset.id, contact.dataset.name);
});

userSearch.addEventListener("input", () => {
  const q = userSearch.value.trim();
  if (!q) {
    userResults.innerHTML = "";
    return;
  }
  apiGet("search_users", { q })
    .then((payload) => {
      userResults.innerHTML = payload.users.map((user) => renderContact(user, Number(user.online) === 1 ? "En linea" : "Disponible")).join("")
        || `<div class="contact"><span class="avatar">?</span><span><strong>Sin resultados</strong><span>Prueba otro nombre</span></span></div>`;
    })
    .catch((error) => {
      userResults.innerHTML = `<div class="contact"><span class="avatar">!</span><span><strong>Error</strong><span>${esc(error.message)}</span></span></div>`;
    });
});

document.addEventListener("play", (event) => {
  if (!event.target.matches("audio, video")) return;
  document.querySelectorAll("audio, video").forEach((media) => {
    if (media !== event.target) media.pause();
  });
}, true);

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

$("#cameraBtn").addEventListener("click", () => {
  if (!navigator.mediaDevices?.getUserMedia) {
    $("#chatHint").textContent = "Tu navegador no permite abrir camara aqui.";
    return;
  }
  navigator.mediaDevices.getUserMedia({ video: true, audio: false })
    .then((stream) => {
      cameraStream = stream;
      cameraPreview.srcObject = stream;
      cameraModal.classList.remove("hidden");
    })
    .catch(() => { $("#chatHint").textContent = "No se pudo abrir la camara."; });
});

function closeCamera() {
  if (cameraStream) cameraStream.getTracks().forEach((track) => track.stop());
  cameraStream = null;
  cameraModal.classList.add("hidden");
}

$("#captureBtn").addEventListener("click", () => {
  const width = cameraPreview.videoWidth || 640;
  const height = cameraPreview.videoHeight || 480;
  cameraCanvas.width = width;
  cameraCanvas.height = height;
  cameraCanvas.getContext("2d").drawImage(cameraPreview, 0, 0, width, height);
  cameraCanvas.toBlob((blob) => {
    attachedFile = new File([blob], `foto-${Date.now()}.jpg`, { type: "image/jpeg" });
    fileInput.value = "";
    fileName.textContent = attachedFile.name;
    closeCamera();
  }, "image/jpeg", 0.9);
});

$("#closeCameraBtn").addEventListener("click", closeCamera);

$("#audioBtn").addEventListener("click", () => {
  if (audioRecorder && audioRecorder.state === "recording") {
    audioRecorder.stop();
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
    $("#chatHint").textContent = "Tu navegador no permite grabar audio aqui.";
    return;
  }

  navigator.mediaDevices.getUserMedia({ audio: true })
    .then((stream) => {
      audioChunks = [];
      audioRecorder = new MediaRecorder(stream);
      audioRecorder.addEventListener("dataavailable", (event) => audioChunks.push(event.data));
      audioRecorder.addEventListener("stop", () => {
        stream.getTracks().forEach((track) => track.stop());
        attachedFile = new File(audioChunks, `audio-${Date.now()}.webm`, { type: "audio/webm" });
        fileInput.value = "";
        fileName.textContent = attachedFile.name;
        $("#audioBtn").classList.remove("recording");
        $("#audioBtn").textContent = "Mic";
      });
      audioRecorder.start();
      $("#audioBtn").classList.add("recording");
      $("#audioBtn").textContent = "Stop";
    })
    .catch(() => { $("#chatHint").textContent = "No se pudo abrir el microfono."; });
});

$("#refreshBtn").addEventListener("click", refreshAll);
$("#generalBtn").addEventListener("click", () => selectChat(0, "Servidor general"));

$("#themeBtn").addEventListener("click", () => {
  document.body.classList.toggle("dark");
  localStorage.setItem("pastelchat-theme", document.body.classList.contains("dark") ? "dark" : "light");
});

$("#editAccountBtn").addEventListener("click", () => accountForm.classList.toggle("hidden"));

accountForm.addEventListener("submit", (event) => {
  event.preventDefault();
  try {
    validateProfile(accountForm);
  } catch (error) {
    $("#chatHint").textContent = error.message;
    return;
  }
  api("update_account", Object.fromEntries(new FormData(accountForm)))
    .then((payload) => {
      setUser(payload.user);
      accountForm.classList.add("hidden");
    })
    .catch((error) => { $("#chatHint").textContent = error.message; });
});

$("#deleteAccountBtn").addEventListener("click", () => {
  if (!confirm("Quieres borrar tu cuenta, mensajes y estados?")) return;
  api("delete_account")
    .then(() => {
      leaveApp();
      setNotice("Cuenta borrada.");
    })
    .catch((error) => { $("#chatHint").textContent = error.message; });
});

$("#logoutBtn").addEventListener("click", () => {
  api("logout").catch(() => null).then(leaveApp);
});

buildPicker(emojiPicker, emojis, (emoji) => {
  messageBody.value += emoji;
  messageBody.focus();
});

buildPicker(stickerPicker, stickers, (sticker) => {
  selectedSticker = sticker;
  stickerPicker.classList.add("hidden");
});

if (localStorage.getItem("pastelchat-theme") === "dark") {
  document.body.classList.add("dark");
}

api("me")
  .then((payload) => {
    if (payload.user) enterApp(payload.user);
  })
  .catch(() => null);
