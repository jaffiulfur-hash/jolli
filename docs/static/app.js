const API_BASE = (window.JOLLI_API_BASE || "").replace(/\/$/, "");

const messages = document.getElementById("messages");
const form = document.getElementById("chat-form");
const input = document.getElementById("message-input");
const voiceBtn = document.getElementById("voice-btn");
const statusDot = document.getElementById("status-dot");
const statusText = document.getElementById("status-text");

const newChatBtn = document.getElementById("new-chat-btn");
const refreshHistoryBtn = document.getElementById("refresh-history-btn");
const chatHistory = document.getElementById("chat-history");
const activeChatTitle = document.getElementById("active-chat-title");
const saveStatus = document.getElementById("save-status");

let isBusy = false;
let currentChatId = null;
let currentChatTitle = "New chat";
let currentUser = null;

/* ---------------------------------------------------------
 * Auth storage
 * --------------------------------------------------------- */

function getToken() {
    return localStorage.getItem("jolli_token");
}

function setToken(token) {
    localStorage.setItem("jolli_token", token);
}

function clearToken() {
    localStorage.removeItem("jolli_token");
}

function isLoggedIn() {
    return !!getToken();
}

/* ---------------------------------------------------------
 * API helper
 * --------------------------------------------------------- */

function apiUrl(path) {
    return `${API_BASE}${path}`;
}

function apiConfigured() {
    return API_BASE.startsWith("https://");
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal,
        });

        return response;
    } finally {
        clearTimeout(timeout);
    }
}

async function apiFetch(path, options = {}, timeoutMs = 15000) {
    const token = getToken();

    const headers = {
        ...(options.headers || {}),
    };

    if (!(options.body instanceof FormData)) {
        headers["Content-Type"] = headers["Content-Type"] || "application/json";
    }

    if (token) {
        headers.Authorization = `Bearer ${token}`;
    }

    const response = await fetchWithTimeout(
        apiUrl(path),
        {
            ...options,
            headers,
        },
        timeoutMs
    );

    if (response.status === 401) {
        clearToken();
        currentUser = null;
        showAuthScreen("Your session expired. Please log in again.");
        throw new Error("Not authenticated");
    }

    return response;
}

/* ---------------------------------------------------------
 * UI helpers
 * --------------------------------------------------------- */

function setSaveStatus(text) {
    if (saveStatus) {
        saveStatus.textContent = text;
    }
}

function setBackendStatus(text, ok) {
    if (statusText) {
        statusText.textContent = text;
    }

    if (!statusDot) {
        return;
    }

    if (ok) {
        statusDot.classList.remove("bad");
        statusDot.classList.add("ok");
    } else {
        statusDot.classList.remove("ok");
        statusDot.classList.add("bad");
    }
}

function clearMessages() {
    messages.innerHTML = "";
}

function addMessage(name, text, type) {
    const wrapper = document.createElement("div");
    wrapper.className = `message ${type}`;

    const nameDiv = document.createElement("div");
    nameDiv.className = "name";
    nameDiv.textContent = name;

    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.textContent = text;

    wrapper.appendChild(nameDiv);
    wrapper.appendChild(bubble);
    messages.appendChild(wrapper);
    messages.scrollTop = messages.scrollHeight;

    return bubble;
}

function addTypingMessage() {
    const wrapper = document.createElement("div");
    wrapper.className = "message assistant";

    const nameDiv = document.createElement("div");
    nameDiv.className = "name";
    nameDiv.textContent = "Jolli";

    const bubble = document.createElement("div");
    bubble.className = "bubble typing-bubble";

    const dots = document.createElement("span");
    dots.className = "typing-dots";
    dots.innerHTML = "<span></span><span></span><span></span>";

    bubble.appendChild(dots);
    wrapper.appendChild(nameDiv);
    wrapper.appendChild(bubble);
    messages.appendChild(wrapper);
    messages.scrollTop = messages.scrollHeight;

    return bubble;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function typeIntoBubble(bubble, text) {
    bubble.classList.remove("typing-bubble");
    bubble.textContent = "";

    const typingSpeed = 18;

    for (let i = 0; i < text.length; i++) {
        bubble.textContent += text[i];
        messages.scrollTop = messages.scrollHeight;

        if (text[i] === "." || text[i] === "!" || text[i] === "?") {
            await sleep(90);
        } else if (text[i] === "," || text[i] === ";") {
            await sleep(45);
        } else if (text[i] === "\n") {
            await sleep(60);
        } else {
            await sleep(typingSpeed);
        }
    }
}

function setActiveChatTitle(title) {
    currentChatTitle = title || "New chat";

    if (activeChatTitle) {
        activeChatTitle.textContent = currentChatTitle;
    }
}

function makeChatTitle(firstMessage) {
    const clean = firstMessage.trim().replace(/\s+/g, " ");

    if (!clean) {
        return "New chat";
    }

    if (clean.length <= 42) {
        return clean;
    }

    return clean.slice(0, 42) + "...";
}

function renderWelcomeMessage() {
    clearMessages();

    if (currentUser) {
        addMessage("Jolli", `Welcome back, ${currentUser.username || currentUser.email}. Ask me something.`, "assistant");
    } else {
        addMessage("Jolli", "Jolli Web online. Log in or create an account to chat.", "assistant");
    }
}

/* ---------------------------------------------------------
 * Auth UI
 * --------------------------------------------------------- */

function removeAuthScreen() {
    const existing = document.getElementById("auth-screen");
    if (existing) {
        existing.remove();
    }
}

function showAuthScreen(message = "") {
    removeAuthScreen();

    const overlay = document.createElement("div");
    overlay.id = "auth-screen";
    overlay.style.position = "fixed";
    overlay.style.inset = "0";
    overlay.style.zIndex = "9999";
    overlay.style.background = "rgba(0, 0, 0, 0.88)";
    overlay.style.display = "flex";
    overlay.style.alignItems = "center";
    overlay.style.justifyContent = "center";
    overlay.style.padding = "20px";

    overlay.innerHTML = `
        <div style="
            width: 100%;
            max-width: 420px;
            background: #111118;
            border: 1px solid #2a2a35;
            border-radius: 18px;
            padding: 24px;
            color: white;
            box-shadow: 0 20px 80px rgba(0,0,0,0.5);
        ">
            <h2 style="margin-top:0;">Jolli Account</h2>
            <p style="color:#aaa;">Log in or create an account so your chats stay private.</p>

            ${message ? `<p id="auth-message" style="color:#ffb4b4;">${escapeHtml(message)}</p>` : `<p id="auth-message" style="display:none;"></p>`}

            <label style="display:block;margin-top:14px;">Username</label>
            <input id="auth-username" type="text" autocomplete="username" style="
                width:100%;
                box-sizing:border-box;
                padding:12px;
                margin-top:6px;
                border-radius:10px;
                border:1px solid #333;
                background:#08080c;
                color:white;
            ">

            <label style="display:block;margin-top:14px;">Email</label>
            <input id="auth-email" type="email" autocomplete="email" style="
                width:100%;
                box-sizing:border-box;
                padding:12px;
                margin-top:6px;
                border-radius:10px;
                border:1px solid #333;
                background:#08080c;
                color:white;
            ">

            <label style="display:block;margin-top:14px;">Password</label>
            <input id="auth-password" type="password" autocomplete="current-password" style="
                width:100%;
                box-sizing:border-box;
                padding:12px;
                margin-top:6px;
                border-radius:10px;
                border:1px solid #333;
                background:#08080c;
                color:white;
            ">

            <div style="display:flex;gap:10px;margin-top:20px;">
                <button id="login-btn" type="button" style="
                    flex:1;
                    padding:12px;
                    border-radius:10px;
                    border:0;
                    cursor:pointer;
                ">Login</button>

                <button id="register-btn" type="button" style="
                    flex:1;
                    padding:12px;
                    border-radius:10px;
                    border:0;
                    cursor:pointer;
                ">Register</button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    document.getElementById("login-btn").addEventListener("click", loginFromAuthScreen);
    document.getElementById("register-btn").addEventListener("click", registerFromAuthScreen);

    document.getElementById("auth-password").addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            loginFromAuthScreen();
        }
    });

    document.getElementById("auth-email").focus();
}

function setAuthMessage(text, ok = false) {
    const msg = document.getElementById("auth-message");

    if (!msg) {
        return;
    }

    msg.style.display = "block";
    msg.style.color = ok ? "#9cffb1" : "#ffb4b4";
    msg.textContent = text;
}

function escapeHtml(text) {
    return String(text)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

async function loginFromAuthScreen() {
    const email = document.getElementById("auth-email").value.trim();
    const password = document.getElementById("auth-password").value;

    if (!email || !password) {
        setAuthMessage("Enter username and password.");
        return;
    }

    try {
        await login(email, password);
        removeAuthScreen();
        await bootLoggedIn();
    } catch (error) {
        setAuthMessage(error.message || "Login failed.");
    }
}

async function registerFromAuthScreen() {
    const username = document.getElementById("auth-username").value.trim();
    const email = document.getElementById("auth-email").value.trim();
    const password = document.getElementById("auth-password").value;

    if (!username || !email || !password) {
        setAuthMessage("Enter username, email, and password.");
        return;
    }

    try {
        await register(username, email, password);
        removeAuthScreen();
        await bootLoggedIn();
    } catch (error) {
        setAuthMessage(error.message || "Register failed.");
    }
}

async function login(email, password) {
    const response = await fetchWithTimeout(apiUrl("/api/login"), {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ email, password }),
    }, 15000);

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(data.detail || `Login failed. HTTP ${response.status}`);
    }

    setToken(data.token);
    currentUser = data.user;

    return data.user;
}

async function register(username, email, password) {
    const response = await fetchWithTimeout(apiUrl("/api/register"), {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ username, email, password }),
    }, 15000);

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(data.detail || `Register failed. HTTP ${response.status}`);
    }

    setToken(data.token);
    currentUser = data.user;

    return data.user;
}

async function loadMe() {
    const response = await apiFetch("/api/me", {}, 10000);

    if (!response.ok) {
        throw new Error(`Could not load user. HTTP ${response.status}`);
    }

    const data = await response.json();
    currentUser = data.user;
    return currentUser;
}

function addLogoutButton() {
    if (!newChatBtn || document.getElementById("logout-btn")) {
        return;
    }

    const logoutBtn = document.createElement("button");
    logoutBtn.id = "logout-btn";
    logoutBtn.className = "new-chat-btn";
    logoutBtn.type = "button";
    logoutBtn.textContent = "Logout";

    logoutBtn.addEventListener("click", () => {
        clearToken();
        currentUser = null;
        currentChatId = null;
        setActiveChatTitle("New chat");
        setSaveStatus("Logged out");
        renderWelcomeMessage();
        showAuthScreen();
    });

    newChatBtn.insertAdjacentElement("afterend", logoutBtn);
}

/* ---------------------------------------------------------
 * Backend status
 * --------------------------------------------------------- */

async function checkStatus() {
    if (!apiConfigured()) {
        setBackendStatus(
            "API config missing. Set window.JOLLI_API_BASE in static/config.js.",
            false
        );
        return;
    }

    try {
        const response = await fetchWithTimeout(apiUrl("/api/status"), {}, 10000);

        if (!response.ok) {
            setBackendStatus(`Backend error: HTTP ${response.status}`, false);
            return;
        }

        const data = await response.json();

        if (data.ollama_ready) {
            setBackendStatus(data.ollama_status || "Jolli backend online.", true);
        } else {
            setBackendStatus(data.ollama_status || "Jolli backend reached, but Ollama is not ready.", false);
        }
    } catch (error) {
        if (error.name === "AbortError") {
            setBackendStatus("Backend timed out. Check api.jolli.live.", false);
        } else {
            setBackendStatus("Could not reach Jolli backend. Check CORS/API URL.", false);
        }
    }
}

/* ---------------------------------------------------------
 * Chat history API
 * --------------------------------------------------------- */

async function createChat(title) {
    if (!apiConfigured()) {
        throw new Error("API config missing.");
    }

    setSaveStatus("Creating chat...");

    const response = await apiFetch("/api/chats", {
        method: "POST",
        body: JSON.stringify({
            title: title || "New chat",
        }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(data.detail || `Failed to create chat. HTTP ${response.status}`);
    }

    const chat = data.chat || data;

    currentChatId = chat.id;
    setActiveChatTitle(chat.title || title || "New chat");
    setSaveStatus("Chat created");

    await loadChatHistory();

    return chat;
}

async function loadChatHistory() {
    if (!chatHistory) {
        return;
    }

    if (!apiConfigured()) {
        chatHistory.innerHTML = "";

        const failed = document.createElement("div");
        failed.className = "history-empty";
        failed.textContent = "API config missing.";
        chatHistory.appendChild(failed);
        return;
    }

    if (!isLoggedIn()) {
        chatHistory.innerHTML = "";

        const empty = document.createElement("div");
        empty.className = "history-empty";
        empty.textContent = "Log in to see your chats.";
        chatHistory.appendChild(empty);
        return;
    }

    try {
        const response = await apiFetch("/api/chats", {}, 10000);

        if (!response.ok) {
            throw new Error(`Failed to load chat history. HTTP ${response.status}`);
        }

        const data = await response.json();
        const chats = data.chats || [];

        chatHistory.innerHTML = "";

        if (chats.length === 0) {
            const empty = document.createElement("div");
            empty.className = "history-empty";
            empty.textContent = "No saved chats yet.";
            chatHistory.appendChild(empty);
            return;
        }

        for (const chat of chats) {
            const item = document.createElement("button");
            item.type = "button";
            item.className = "history-item";

            if (chat.id === currentChatId) {
                item.classList.add("active");
            }

            const title = document.createElement("span");
            title.className = "history-title";
            title.textContent = chat.title || "Untitled chat";

            const date = document.createElement("span");
            date.className = "history-date";
            date.textContent = chat.updated_at || chat.created_at || "";

            item.appendChild(title);
            item.appendChild(date);

            item.addEventListener("click", () => {
                loadChat(chat.id);
            });

            chatHistory.appendChild(item);
        }
    } catch (error) {
        chatHistory.innerHTML = "";

        const failed = document.createElement("div");
        failed.className = "history-empty";
        failed.textContent = "Could not load chat history.";
        chatHistory.appendChild(failed);
    }
}

async function loadChat(chatId) {
    if (isBusy || !apiConfigured() || !isLoggedIn()) {
        return;
    }

    try {
        setSaveStatus("Loading chat...");

        const response = await apiFetch(`/api/chats/${chatId}`, {}, 10000);

        if (!response.ok) {
            throw new Error(`Failed to load chat. HTTP ${response.status}`);
        }

        const data = await response.json();

        currentChatId = data.id;
        setActiveChatTitle(data.title || "Untitled chat");

        clearMessages();

        const chatMessages = data.messages || [];

        if (chatMessages.length === 0) {
            addMessage("Jolli", "This chat is empty.", "assistant");
        } else {
            for (const msg of chatMessages) {
                if (msg.role === "user") {
                    addMessage("You", msg.content, "user");
                } else {
                    addMessage("Jolli", msg.content, "assistant");
                }
            }
        }

        setSaveStatus("Loaded");
        await loadChatHistory();
    } catch (error) {
        setSaveStatus("Load failed");
        addMessage("Jolli", "Could not load that chat: " + error, "assistant");
    }
}

function startNewChat() {
    if (isBusy) {
        return;
    }

    currentChatId = null;
    setActiveChatTitle("New chat");
    setSaveStatus("Ready");
    renderWelcomeMessage();
    loadChatHistory();
}

/* ---------------------------------------------------------
 * Send message
 * --------------------------------------------------------- */

async function sendMessage(text) {
    if (isBusy) {
        return;
    }

    if (!apiConfigured()) {
        addMessage(
            "Jolli",
            "API config missing. Set window.JOLLI_API_BASE in static/config.js.",
            "assistant"
        );
        return;
    }

    if (!isLoggedIn()) {
        showAuthScreen("Please log in before chatting.");
        return;
    }

    isBusy = true;

    const firstMessageInChat = currentChatId === null;
    const title = firstMessageInChat ? makeChatTitle(text) : currentChatTitle;

    input.value = "";
    input.disabled = true;
    voiceBtn.disabled = true;

    try {
        if (!currentChatId) {
            await createChat(title);
        }

        addMessage("You", text, "user");

        const jolliBubble = addTypingMessage();

        const response = await apiFetch("/api/chat", {
            method: "POST",
            body: JSON.stringify({
                message: text,
                chat_id: currentChatId,
            }),
        }, 120000);

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
            throw new Error(data.detail || `Failed to talk to Jolli backend. HTTP ${response.status}`);
        }

        if (data.chat_id) {
            currentChatId = data.chat_id;
        }

        const reply = data.reply || "I did not get a response.";

        await typeIntoBubble(jolliBubble, reply);

        speakText(reply);
        setSaveStatus("Saved");
        await loadChatHistory();
    } catch (error) {
        const errorText = "Jolli backend error: " + error.message;
        addMessage("Jolli", errorText, "assistant");
        setSaveStatus("Error");
    } finally {
        input.disabled = false;
        voiceBtn.disabled = false;
        input.focus();
        isBusy = false;
    }
}

/* ---------------------------------------------------------
 * Browser speech
 * --------------------------------------------------------- */

function speakText(text) {
    if (!("speechSynthesis" in window)) {
        return;
    }

    speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.95;
    utterance.pitch = 0.9;
    speechSynthesis.speak(utterance);
}

function startBrowserSpeechRecognition() {
    if (isBusy) {
        return;
    }

    const SpeechRecognition =
        window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
        addMessage(
            "Jolli",
            "Your browser does not support speech recognition. Try Chromium or Google Chrome.",
            "assistant"
        );
        return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    addMessage("Jolli", "Listening from browser microphone...", "assistant");

    recognition.start();

    recognition.onresult = (event) => {
        const text = event.results[0][0].transcript;
        sendMessage(text);
    };

    recognition.onerror = (event) => {
        addMessage("Jolli", "Speech recognition error: " + event.error, "assistant");
    };
}

/* ---------------------------------------------------------
 * Events
 * --------------------------------------------------------- */

form.addEventListener("submit", (event) => {
    event.preventDefault();

    const text = input.value.trim();

    if (!text) {
        return;
    }

    sendMessage(text);
});

voiceBtn.addEventListener("click", () => {
    startBrowserSpeechRecognition();
});

if (newChatBtn) {
    newChatBtn.addEventListener("click", () => {
        startNewChat();
    });
}

if (refreshHistoryBtn) {
    refreshHistoryBtn.addEventListener("click", () => {
        loadChatHistory();
    });
}

/* ---------------------------------------------------------
 * Boot
 * --------------------------------------------------------- */

async function bootLoggedIn() {
    addLogoutButton();
    renderWelcomeMessage();
    await checkStatus();
    await loadChatHistory();
}

async function boot() {
    if (!apiConfigured()) {
        renderWelcomeMessage();
        await checkStatus();
        return;
    }

    await checkStatus();

    if (!isLoggedIn()) {
        renderWelcomeMessage();
        showAuthScreen();
        await loadChatHistory();
        return;
    }

    try {
        await loadMe();
        await bootLoggedIn();
    } catch (error) {
        clearToken();
        currentUser = null;
        renderWelcomeMessage();
        showAuthScreen("Please log in again.");
    }
}

boot();
setInterval(checkStatus, 10000);
