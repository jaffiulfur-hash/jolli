const API_BASE = (window.JOLLI_API_BASE || "").replace(/\/$/, "");

const messages = document.getElementById("messages");
const form = document.getElementById("chat-form");
const input = document.getElementById("message-input");
const voiceBtn = document.getElementById("voice-btn");
const statusDot = document.getElementById("status-dot");
const statusText = document.getElementById("status-text");

const newChatBtn = document.getElementById("new-chat-btn");
const newGroupBtn = document.getElementById("new-group-btn");
const refreshHistoryBtn = document.getElementById("refresh-history-btn");
const refreshGroupsBtn = document.getElementById("refresh-groups-btn");

const chatHistory = document.getElementById("chat-history");
const groupHistory = document.getElementById("group-history");

const activeChatTitle = document.getElementById("active-chat-title");
const chatModeLabel = document.getElementById("chat-mode-label");
const saveStatus = document.getElementById("save-status");

const appShell = document.getElementById("app");
const authScreen = document.getElementById("auth-screen");
const sidebar = document.getElementById("mobile-sidebar");
const sidebarOverlay = document.getElementById("sidebar-overlay");
const openSidebarBtn = document.getElementById("open-sidebar-btn");
const closeSidebarBtn = document.getElementById("close-sidebar-btn");

let isBusy = false;
let currentMode = "chat";
let currentChatId = null;
let currentGroupId = null;
let currentChatTitle = "New chat";
let currentGroupTitle = "New group";
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

function authHeaders() {
    const token = getToken();

    if (!token) {
        return {};
    }

    return {
        Authorization: `Bearer ${token}`,
    };
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
        return await fetch(url, {
            ...options,
            signal: controller.signal,
        });
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
 * iOS shell helpers
 * --------------------------------------------------------- */

function showAppShell() {
    if (authScreen) authScreen.classList.add("hidden");
    if (appShell) appShell.classList.remove("hidden");
}

function hideAppShell() {
    if (appShell) appShell.classList.add("hidden");
    if (authScreen) authScreen.classList.remove("hidden");
}

function openSidebar() {
    if (sidebar) sidebar.classList.add("open");
    if (sidebarOverlay) sidebarOverlay.classList.add("show");
}

function closeSidebar() {
    if (sidebar) sidebar.classList.remove("open");
    if (sidebarOverlay) sidebarOverlay.classList.remove("show");
}

/* ---------------------------------------------------------
 * UI helpers
 * --------------------------------------------------------- */

function setSaveStatus(text) {
    if (saveStatus) saveStatus.textContent = text;
}

function setBackendStatus(text, ok) {
    if (statusText) statusText.textContent = text;

    if (!statusDot) return;

    statusDot.classList.toggle("ok", !!ok);
    statusDot.classList.toggle("bad", !ok);
}

function setMode(mode) {
    currentMode = mode;

    if (chatModeLabel) {
        chatModeLabel.textContent = mode === "group" ? "Current group" : "Current chat";
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

    for (let i = 0; i < text.length; i++) {
        bubble.textContent += text[i];
        messages.scrollTop = messages.scrollHeight;
        await sleep(text[i].match(/[.!?]/) ? 90 : text[i].match(/[,;]/) ? 45 : 18);
    }
}

function setActiveChatTitle(title) {
    if (currentMode === "group") {
        currentGroupTitle = title || "New group";
    } else {
        currentChatTitle = title || "New chat";
    }

    if (activeChatTitle) {
        activeChatTitle.textContent = title || (currentMode === "group" ? "New group" : "New chat");
    }
}

function makeChatTitle(firstMessage) {
    const clean = firstMessage.trim().replace(/\s+/g, " ");
    if (!clean) return "New chat";
    return clean.length <= 42 ? clean : clean.slice(0, 42) + "...";
}

function getDisplayName(user) {
    return user?.username || user?.email || "User";
}

function renderWelcomeMessage() {
    clearMessages();

    if (currentUser) {
        addMessage("Jolli", `Welcome back, ${getDisplayName(currentUser)}. Ask me something.`, "assistant");
    } else {
        addMessage("Jolli", "Jolli iOS online. Log in or create an account to chat.", "assistant");
    }
}

function markActiveSidebarItems() {
    document.querySelectorAll(".history-item").forEach(item => item.classList.remove("active"));

    if (currentMode === "chat" && currentChatId) {
        const item = document.querySelector(`[data-chat-id="${currentChatId}"]`);
        if (item) item.classList.add("active");
    }

    if (currentMode === "group" && currentGroupId) {
        const item = document.querySelector(`[data-group-id="${currentGroupId}"]`);
        if (item) item.classList.add("active");
    }
}

/* ---------------------------------------------------------
 * Auth UI
 * --------------------------------------------------------- */

function showAuthScreen(message = "") {
    hideAppShell();

    const msg = document.getElementById("auth-message");
    if (msg) {
        msg.textContent = message;
        msg.style.display = message ? "block" : "none";
    }
}

function setAuthMessage(text, ok = false) {
    const msg = document.getElementById("auth-message");
    if (!msg) return;

    msg.style.display = "block";
    msg.classList.toggle("ok", !!ok);
    msg.textContent = text;
}

async function loginFromAuthScreen() {
    const email = document.getElementById("login-username")?.value.trim()
        || document.getElementById("auth-email")?.value.trim()
        || "";

    const password = document.getElementById("login-password")?.value
        || document.getElementById("auth-password")?.value
        || "";

    if (!email || !password) {
        setAuthMessage("Enter email/username and password.");
        return;
    }

    try {
        await login(email, password);
        showAppShell();
        await bootLoggedIn();
    } catch (error) {
        setAuthMessage(error.message || "Login failed.");
    }
}

async function registerFromAuthScreen() {
    const username = document.getElementById("login-username")?.value.trim()
        || document.getElementById("auth-username")?.value.trim()
        || "";

    const email = username.includes("@") ? username : `${username}@jolli.local`;

    const password = document.getElementById("login-password")?.value
        || document.getElementById("auth-password")?.value
        || "";

    if (!username || !password) {
        setAuthMessage("Enter username and password.");
        return;
    }

    try {
        await register(username, email, password);
        showAppShell();
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
    if (!newChatBtn || document.getElementById("logout-btn")) return;

    const logoutBtn = document.createElement("button");
    logoutBtn.id = "logout-btn";
    logoutBtn.className = "new-chat-btn";
    logoutBtn.type = "button";
    logoutBtn.textContent = "Logout";

    logoutBtn.addEventListener("click", () => {
        clearToken();
        currentUser = null;
        currentChatId = null;
        currentGroupId = null;
        setMode("chat");
        setActiveChatTitle("New chat");
        setSaveStatus("Logged out");
        renderWelcomeMessage();
        loadChatHistory();
        loadGroups();
        showAuthScreen();
        closeSidebar();
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
            setBackendStatus(`Service error: HTTP ${response.status}`, false);
            return;
        }

        const data = await response.json();

        if (data.service_online) {
            setBackendStatus(data.service_status || "Service online", true);
        } else {
            setBackendStatus("Service offline", false);
        }
    } catch (error) {
        if (error.name === "AbortError") {
            setBackendStatus("Service timed out.", false);
        } else {
            setBackendStatus("Could not reach Jolli service.", false);
        }
    }
}

/* ---------------------------------------------------------
 * Weather with browser location
 * --------------------------------------------------------- */

function looksLikeWeatherRequest(text) {
    const lowered = text.toLowerCase();

    const weatherWords = [
        "weather",
        "forecast",
        "temperature",
        "temp",
        "rain",
        "raining",
        "snow",
        "snowing",
        "wind",
        "windy",
        "storm",
        "cloudy",
        "sunny",
        "cold",
        "hot",
        "degrees",
    ];

    return weatherWords.some(word => lowered.includes(word));
}

async function getWeatherWithLocation() {
    if (!navigator.geolocation) {
        throw new Error("Your browser does not support location permission.");
    }

    const position = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
            resolve,
            reject,
            {
                enableHighAccuracy: false,
                timeout: 10000,
                maximumAge: 15 * 60 * 1000,
            }
        );
    });

    const latitude = position.coords.latitude;
    const longitude = position.coords.longitude;

    const response = await apiFetch("/api/weather", {
        method: "POST",
        body: JSON.stringify({
            latitude,
            longitude,
            forecast_days: 3,
        }),
    }, 20000);

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(data.detail || `Weather lookup failed. HTTP ${response.status}`);
    }

    return data;
}

function makeWeatherReply(weatherData) {
    if (!weatherData || !weatherData.summary) {
        return "I could not read the weather data.";
    }

    return weatherData.summary;
}

/* ---------------------------------------------------------
 * Private chat history API
 * --------------------------------------------------------- */

async function createChat(title) {
    setSaveStatus("Creating chat...");

    const response = await apiFetch("/api/chats", {
        method: "POST",
        body: JSON.stringify({ title: title || "New chat" }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(data.detail || `Failed to create chat. HTTP ${response.status}`);
    }

    const chat = data.chat || data;

    currentChatId = chat.id;
    currentGroupId = null;
    setMode("chat");
    setActiveChatTitle(chat.title || title || "New chat");
    setSaveStatus("Chat created");

    await loadChatHistory();
    return chat;
}

async function loadChatHistory() {
    if (!chatHistory) return;

    if (!apiConfigured()) {
        chatHistory.innerHTML = `<div class="history-empty">API config missing.</div>`;
        return;
    }

    if (!isLoggedIn()) {
        chatHistory.innerHTML = `<div class="history-empty">Log in to see your chats.</div>`;
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
            chatHistory.innerHTML = `<div class="history-empty">No saved chats yet.</div>`;
            return;
        }

        for (const chat of chats) {
            const item = document.createElement("button");
            item.type = "button";
            item.className = "history-item";
            item.dataset.chatId = chat.id;

            if (currentMode === "chat" && chat.id === currentChatId) {
                item.classList.add("active");
            }

            item.innerHTML = `
                <span class="history-title"></span>
                <span class="history-date"></span>
            `;

            item.querySelector(".history-title").textContent = chat.title || "Untitled chat";
            item.querySelector(".history-date").textContent = chat.updated_at || chat.created_at || "";

            item.addEventListener("click", () => {
                loadChat(chat.id);
                closeSidebar();
            });

            chatHistory.appendChild(item);
        }
    } catch {
        chatHistory.innerHTML = `<div class="history-empty">Could not load chat history.</div>`;
    }
}

async function loadChat(chatId) {
    if (isBusy || !apiConfigured() || !isLoggedIn()) return;

    try {
        setSaveStatus("Loading chat...");

        const response = await apiFetch(`/api/chats/${chatId}`, {}, 10000);

        if (!response.ok) {
            throw new Error(`Failed to load chat. HTTP ${response.status}`);
        }

        const data = await response.json();

        currentChatId = data.id;
        currentGroupId = null;
        setMode("chat");
        setActiveChatTitle(data.title || "Untitled chat");

        clearMessages();

        const chatMessages = data.messages || [];

        if (chatMessages.length === 0) {
            addMessage("Jolli", "This chat is empty.", "assistant");
        } else {
            for (const msg of chatMessages) {
                addMessage(msg.role === "user" ? "You" : "Jolli", msg.content, msg.role === "user" ? "user" : "assistant");
            }
        }

        setSaveStatus("Loaded");
        await loadChatHistory();
        await loadGroups();
        markActiveSidebarItems();
    } catch (error) {
        setSaveStatus("Load failed");
        addMessage("Jolli", "Could not load that chat: " + error.message, "assistant");
    }
}

function startNewChat() {
    if (isBusy) return;

    currentChatId = null;
    currentGroupId = null;
    setMode("chat");
    setActiveChatTitle("New chat");
    setSaveStatus("Ready");
    renderWelcomeMessage();
    loadChatHistory();
    loadGroups();
    closeSidebar();
}

/* ---------------------------------------------------------
 * Groups API
 * --------------------------------------------------------- */

async function createGroup(name) {
    setSaveStatus("Creating group...");

    const response = await apiFetch("/api/groups", {
        method: "POST",
        body: JSON.stringify({ name: name || "New group" }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(data.detail || `Failed to create group. HTTP ${response.status}`);
    }

    const group = data.group || data;

    currentGroupId = group.id;
    currentChatId = null;
    setMode("group");
    setActiveChatTitle(group.name || name || "New group");
    setSaveStatus("Group created");

    await loadGroups();
    await loadGroup(group.id);

    return group;
}

async function loadGroups() {
    if (!groupHistory) return;

    if (!apiConfigured()) {
        groupHistory.innerHTML = `<div class="history-empty">API config missing.</div>`;
        return;
    }

    if (!isLoggedIn()) {
        groupHistory.innerHTML = `<div class="history-empty">Log in to see your groups.</div>`;
        return;
    }

    try {
        const response = await apiFetch("/api/groups", {}, 10000);

        if (!response.ok) {
            throw new Error(`Failed to load groups. HTTP ${response.status}`);
        }

        const data = await response.json();
        const groups = data.groups || [];

        groupHistory.innerHTML = "";

        if (groups.length === 0) {
            groupHistory.innerHTML = `<div class="history-empty">No groups yet.</div>`;
            return;
        }

        for (const group of groups) {
            const item = document.createElement("button");
            item.type = "button";
            item.className = "history-item";
            item.dataset.groupId = group.id;

            if (currentMode === "group" && group.id === currentGroupId) {
                item.classList.add("active");
            }

            item.innerHTML = `
                <span class="history-title"></span>
                <span class="history-date"></span>
            `;

            item.querySelector(".history-title").textContent = group.name || "Untitled group";
            item.querySelector(".history-date").textContent =
                group.role ? `role: ${group.role}` : (group.updated_at || group.created_at || "");

            item.addEventListener("click", () => {
                loadGroup(group.id);
                closeSidebar();
            });

            groupHistory.appendChild(item);
        }
    } catch {
        groupHistory.innerHTML = `<div class="history-empty">Could not load groups.</div>`;
    }
}

async function loadGroup(groupId) {
    if (isBusy || !apiConfigured() || !isLoggedIn()) return;

    try {
        setSaveStatus("Loading group...");

        const response = await apiFetch(`/api/groups/${groupId}`, {}, 10000);

        if (!response.ok) {
            throw new Error(`Failed to load group. HTTP ${response.status}`);
        }

        const data = await response.json();

        currentGroupId = data.id;
        currentChatId = null;
        setMode("group");
        setActiveChatTitle(data.name || "Untitled group");

        clearMessages();

        const groupMessages = data.messages || [];

        if (groupMessages.length === 0) {
            addMessage("Jolli", "This group is empty. Send a message to start.", "assistant");
        } else {
            for (const msg of groupMessages) {
                if (msg.role === "user") {
                    addMessage(msg.username || msg.email || "User", msg.content, "user");
                } else {
                    addMessage("Jolli", msg.content, "assistant");
                }
            }
        }

        setSaveStatus("Group loaded");
        await loadChatHistory();
        await loadGroups();
        markActiveSidebarItems();
    } catch (error) {
        setSaveStatus("Group load failed");
        addMessage("Jolli", "Could not load that group: " + error.message, "assistant");
    }
}

async function startNewGroup() {
    if (isBusy) return;

    if (!isLoggedIn()) {
        showAuthScreen("Please log in before creating a group.");
        return;
    }

    const name = prompt("Group name:");
    if (!name || !name.trim()) return;

    try {
        await createGroup(name.trim());
        closeSidebar();
    } catch (error) {
        addMessage("Jolli", "Could not create group: " + error.message, "assistant");
        setSaveStatus("Group error");
    }
}

async function addMemberToCurrentGroup() {
    if (!currentGroupId) {
        addMessage("Jolli", "Open a group first before adding members.", "assistant");
        return;
    }

    const identifier = prompt("Enter member email or username:");
    if (!identifier || !identifier.trim()) return;

    try {
        const response = await apiFetch(`/api/groups/${currentGroupId}/members`, {
            method: "POST",
            body: JSON.stringify({ identifier: identifier.trim() }),
        });

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
            throw new Error(data.detail || `Failed to add member. HTTP ${response.status}`);
        }

        addMessage("Jolli", `Member added: ${data.user?.username || data.user?.email || identifier}`, "assistant");
        await loadGroup(currentGroupId);
    } catch (error) {
        addMessage("Jolli", "Could not add member: " + error.message, "assistant");
    }
}

/* ---------------------------------------------------------
 * Send message
 * --------------------------------------------------------- */

async function sendMessage(text) {
    if (isBusy) return;

    if (!apiConfigured()) {
        addMessage("Jolli", "API config missing. Set window.JOLLI_API_BASE in config.js.", "assistant");
        return;
    }

    if (!isLoggedIn()) {
        showAuthScreen("Please log in before chatting.");
        return;
    }

    isBusy = true;
    input.value = "";
    input.disabled = true;
    voiceBtn.disabled = true;

    try {
        if (currentMode === "group") {
            await sendGroupMessage(text);
        } else {
            await sendPrivateMessage(text);
        }
    } catch (error) {
        addMessage("Jolli", "Jolli backend error: " + error.message, "assistant");
        setSaveStatus("Error");
    } finally {
        input.disabled = false;
        voiceBtn.disabled = false;
        input.focus();
        isBusy = false;
    }
}

async function sendPrivateMessage(text) {
    const firstMessageInChat = currentChatId === null;
    const title = firstMessageInChat ? makeChatTitle(text) : currentChatTitle;

    if (!currentChatId) {
        await createChat(title);
    }

    addMessage("You", text, "user");

    const jolliBubble = addTypingMessage();

    if (looksLikeWeatherRequest(text)) {
        try {
            setSaveStatus("Getting weather...");

            const weatherData = await getWeatherWithLocation();
            const reply = makeWeatherReply(weatherData);

            await typeIntoBubble(jolliBubble, reply);
            speakText(reply);

            setSaveStatus("Weather updated");
            return;
        } catch (error) {
            jolliBubble.textContent = "";
            jolliBubble.classList.add("typing-bubble");

            const dots = document.createElement("span");
            dots.className = "typing-dots";
            dots.innerHTML = "<span></span><span></span><span></span>";
            jolliBubble.appendChild(dots);

            setSaveStatus("Weather location unavailable");
        }
    }

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

    if (data.chat_id) currentChatId = data.chat_id;

    const reply = data.reply || "I did not get a response.";

    await typeIntoBubble(jolliBubble, reply);
    speakText(reply);

    setSaveStatus("Saved");
    await loadChatHistory();
}

async function sendGroupMessage(text) {
    if (!currentGroupId) {
        throw new Error("Open or create a group first.");
    }

    addMessage(getDisplayName(currentUser), text, "user");

    const jolliBubble = addTypingMessage();

    const response = await apiFetch(`/api/groups/${currentGroupId}/chat`, {
        method: "POST",
        body: JSON.stringify({ message: text }),
    }, 120000);

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(data.detail || `Failed to talk in group. HTTP ${response.status}`);
    }

    const reply = data.reply || "I did not get a response.";

    await typeIntoBubble(jolliBubble, reply);
    speakText(reply);

    setSaveStatus("Group saved");
    await loadGroups();
}

/* ---------------------------------------------------------
 * Voice: browser fallback + Expo/Vosk bridge
 * --------------------------------------------------------- */

function speakText(text) {
    if (!("speechSynthesis" in window)) return;

    speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.95;
    utterance.pitch = 0.9;
    speechSynthesis.speak(utterance);
}

function startVoiceInput() {
    if (isBusy) return;

    if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
            type: "JOLLI_START_VOSK",
        }));

        addMessage("Jolli", "Listening with Jolli iOS voice...", "assistant");
        return;
    }

    startBrowserSpeechRecognition();
}

function startBrowserSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
        addMessage("Jolli", "Voice is not available here. In the iOS app, connect this button to the Vosk bridge.", "assistant");
        return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    addMessage("Jolli", "Listening from browser microphone...", "assistant");

    recognition.start();

    recognition.onresult = event => {
        const text = event.results[0][0].transcript;
        sendMessage(text);
    };

    recognition.onerror = event => {
        addMessage("Jolli", "Speech recognition error: " + event.error, "assistant");
    };
}

window.jolliReceiveVoiceText = function(text) {
    if (!text || !text.trim()) return;
    input.value = text.trim();
    sendMessage(text.trim());
};

/* ---------------------------------------------------------
 * Events
 * --------------------------------------------------------- */

form.addEventListener("submit", event => {
    event.preventDefault();

    const text = input.value.trim();
    if (!text) return;

    sendMessage(text);
});

voiceBtn.addEventListener("click", startVoiceInput);

if (newChatBtn) {
    newChatBtn.addEventListener("click", startNewChat);
}

if (newGroupBtn) {
    newGroupBtn.addEventListener("click", startNewGroup);

    newGroupBtn.addEventListener("contextmenu", event => {
        event.preventDefault();
        addMemberToCurrentGroup();
    });
}

if (refreshHistoryBtn) {
    refreshHistoryBtn.addEventListener("click", loadChatHistory);
}

if (refreshGroupsBtn) {
    refreshGroupsBtn.addEventListener("click", loadGroups);
}

if (openSidebarBtn) {
    openSidebarBtn.addEventListener("click", openSidebar);
}

if (closeSidebarBtn) {
    closeSidebarBtn.addEventListener("click", closeSidebar);
}

if (sidebarOverlay) {
    sidebarOverlay.addEventListener("click", closeSidebar);
}

const loginBtn = document.getElementById("login-btn");
const createAccountBtn = document.getElementById("create-account-btn");

if (loginBtn) {
    loginBtn.addEventListener("click", loginFromAuthScreen);
}

if (createAccountBtn) {
    createAccountBtn.addEventListener("click", registerFromAuthScreen);
}

["login-username", "login-password"].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
        el.addEventListener("keydown", event => {
            if (event.key === "Enter") {
                loginFromAuthScreen();
            }
        });
    }
});

/* ---------------------------------------------------------
 * Boot
 * --------------------------------------------------------- */

async function bootLoggedIn() {
    showAppShell();
    addLogoutButton();
    renderWelcomeMessage();
    await checkStatus();
    await loadChatHistory();
    await loadGroups();
}

async function boot() {
    hideAppShell();

    if (!apiConfigured()) {
        renderWelcomeMessage();
        await checkStatus();
        showAuthScreen("API config missing. Set window.JOLLI_API_BASE in config.js.");
        return;
    }

    await checkStatus();

    if (!isLoggedIn()) {
        renderWelcomeMessage();
        showAuthScreen();
        await loadChatHistory();
        await loadGroups();
        return;
    }

    try {
        await loadMe();
        await bootLoggedIn();
    } catch {
        clearToken();
        currentUser = null;
        renderWelcomeMessage();
        showAuthScreen("Please log in again.");
    }
}

boot();
setInterval(checkStatus, 10000);
