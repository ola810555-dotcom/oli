const API = "app.php";
const nameRegex = /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ ]+$/u;
const phoneRegex = /^[0-9]+$/;
const emojis = ["😀", "😂", "😍", "😎", "🥰", "😇", "👍", "🙏", "✨", "💬", "❤️", "🌟"];
const stickers = ["💟", "🌸", "🦋", "🍓", "☁️", "🌈", "⭐", "🎀", "🍰", "💌"];

let currentUser = null;
let selectedSticker = "";
let pollTimer = null;

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
const fileInput = $("#fileInput");
const fileName = $("#fileName");
const emojiPicker = $("#emojiPicker");
const stickerPicker = $("#stickerPicker");
const accountForm = $("#accountForm");

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

  return fetch(`${API}?action=${encodeURIComponent(action)}`, options)
    .then(async (response) => {
      const payload = await response.json().catch(() => ({ ok: false, error: "Respuesta invalida del servidor." }));
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "No se pudo completar la accion.");
      }
      return payload;
    });
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
  loadMessages();
  clearInterval(pollTimer);
  pollTimer = setInterval(loadMessages, 4500);
}

function leaveApp() {
  currentUser = null;
  messenger.classList.add("hidden");
  authPanel.classList.remove("hidden");
  clearInterval(pollTimer);
  messagesBox.innerHTML = "";
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
      ${tools}
    </article>`;
  }).join("");

  messagesBox.scrollTop = messagesBox.scrollHeight;
}

async function loadMessages() {
  if (!currentUser) return;
  try {
    const payload = await api("messages");
    renderMessages(payload.messages);
  } catch (error) {
    $("#chatHint").textContent = error.message;
  }
}

function resetComposer() {
  messageForm.reset();
  selectedSticker = "";
  editingId.value = "";
  fileName.textContent = "";
  messageForm.querySelector(".send-button").textContent = "Enviar";
}

document.addEventListener("input", (event) => {
  if (event.target.matches('input[name="name"]')) cleanLettersInput(event.target);
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

  if (!formData.get("body").trim() && !selectedSticker && !fileInput.files.length && !editingId.value) {
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

$("#emojiBtn").addEventListener("click", () => {
  emojiPicker.classList.toggle("hidden");
  stickerPicker.classList.add("hidden");
});

$("#stickerBtn").addEventListener("click", () => {
  stickerPicker.classList.toggle("hidden");
  emojiPicker.classList.add("hidden");
});

fileInput.addEventListener("change", () => {
  fileName.textContent = fileInput.files[0] ? fileInput.files[0].name : "";
});

$("#refreshBtn").addEventListener("click", loadMessages);

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

api("me")
  .then((payload) => {
    if (payload.user) enterApp(payload.user);
  })
  .catch(() => null);
