"use strict";

/* ---------------------------------------------------------
 * Jolli AI Web Client
 * Ollama / Firebase / Groups edition
 * --------------------------------------------------------- */

const API_BASE = (window.JOLLI_API_BASE || "").replace(/\/$/, "") || window.location.origin;

/* ---------------------------------------------------------
 * DOM
 * --------------------------------------------------------- */

const messages = document.getElementById("messages");
const form = document.getElementById("chat-form");
const input = document.getElementById("message-input");
const voiceBtn = document.getElementById("voice-btn");
const sendBtn = document.getElementById("send-btn");

const statusDot = document.getElementById("status-dot");
const statusText = document.getElementById("status-text");
const modelName = document.getElementById("model-name");

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
const authMessage = document.getElementById("auth-message");
const loginBtn = document.getElementById("login-btn");
const createAccountBtn = document.getElementById("create-account-btn");
const authUsername = document.getElementById("auth-username");
const authEmail = document.getElementById("auth-email");
const authPassword = document.getElementById("auth-password");

const sidebar =
    document.getElementById("mobile-sidebar") ||
    document.querySelector(".sidebar");

const sidebarOverlay =
    document.getElementById("sidebar-overlay") ||
    document.querySelector(".sidebar-overlay");

const openSidebarBtn =
    document.getElementById("open-sidebar-btn") ||
    document.querySelector(".menu-btn");

const closeSidebarBtn =
    document.getElementById("close-sidebar-btn");

const suggestionButtons = document.querySelectorAll(".suggestion-chip");

/* ---------------------------------------------------------
 * State
 * --------------------------------------------------------- */

let isBusy = false;
let backendOnline = false;

let currentMode = "chat";

let currentChatId = localStorage.getItem("jolli_current_chat_id") || null;
let currentChatTitle = localStorage.getItem("jolli_current_chat_title") || "New chat";

let currentGroupId = localStorage.getItem("jolli_current_group_id") || null;
let currentGroupTitle = localStorage.getItem("jolli_current_group_title") || "New group";

let localHistory = [];
let currentModel = "Jolli";

let firebaseApp = null;
let firebaseAuth = null;
let currentUser = null;

/* ---------------------------------------------------------
 * API helpers
 * --------------------------------------------------------- */

function apiUrl(path) {
    return `${API_BASE}${path}`;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 30000) {
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

async function getFirebaseToken() {
    if (!firebaseAuth || !firebaseAuth.currentUser) {
        return null;
    }

    return await firebaseAuth.currentUser.getIdToken();
}

async function apiFetch(path, options = {}, timeoutMs = 30000) {
    const headers = {
        ...(options.headers || {}),
    };

    if (!(options.body instanceof FormData)) {
        headers["Content-Type"] = headers["Content-Type"] || "application/json";
    }

    const token = await getFirebaseToken();

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
        showAuthScreen("Please log in again.");
        throw new Error("Authentication required.");
    }

    return response;
}

async function readJsonResponse(response) {
    try {
        return await response.json();
    } catch {
        return {};
    }
}

function getErrorMessage(data, fallback) {
    return data?.error || data?.detail || data?.message || fallback;
}

/* ---------------------------------------------------------
 * Auth helpers
 * --------------------------------------------------------- */

function initFirebase() {
    if (!window.firebase || !window.JOLLI_FIREBASE_CONFIG) {
        return false;
    }

    if (!firebaseApp) {
        firebaseApp = firebase.initializeApp(window.JOLLI_FIREBASE_CONFIG);
        firebaseAuth = firebase.auth();
    }

    return true;
}

function showAppShell() {
    if (authScreen) {
        authScreen.classList.add("hidden");
    }

    if (appShell) {
        appShell.classList.remove("hidden");
    }
}

function showAuthScreen(message = "") {
    if (appShell) {
        appShell.classList.add("hidden");
    }

    if (authScreen) {
        authScreen.classList.remove("hidden");
    }

    if (authMessage) {
        authMessage.textContent = message;
        authMessage.style.display = message ? "block" : "none";
        authMessage.classList.remove("ok");
    }
}

function setAuthMessage(message, ok = false) {
    if (!authMessage) {
        return;
    }

    authMessage.textContent = message;
    authMessage.style.display = message ? "block" : "none";
    authMessage.classList.toggle("ok", !!ok);
}

async function loginFromAuthScreen() {
    if (!firebaseAuth) {
        setAuthMessage("Firebase Auth is not loaded.");
        return;
    }

    const email = authEmail?.value.trim() || authUsername?.value.trim() || "";
    const password = authPassword?.value || "";

    if (!email || !password) {
        setAuthMessage("Enter email and password.");
        return;
    }

    try {
        const result = await firebaseAuth.signInWithEmailAndPassword(email, password);
        currentUser = result.user;

        showAppShell();
        await bootLoggedIn();
    } catch (error) {
        setAuthMessage(error.message || "Login failed.");
    }
}

async function registerFromAuthScreen() {
    if (!firebaseAuth) {
        setAuthMessage("Firebase Auth is not loaded.");
        return;
    }

    const email = authEmail?.value.trim() || "";
    const password = authPassword?.value || "";

    if (!email || !password) {
        setAuthMessage("Enter email and password.");
        return;
    }

    if (password.length < 8) {
        setAuthMessage("Password must be at least 8 characters.");
        return;
    }

    try {
        const result = await firebaseAuth.createUserWithEmailAndPassword(email, password);
        currentUser = result.user;

        showAppShell();
        await bootLoggedIn();
    } catch (error) {
        setAuthMessage(error.message || "Account creation failed.");
    }
}

async function logout() {
    if (firebaseAuth) {
        await firebaseAuth.signOut();
    }

    currentUser = null;
    setCurrentChatId(null);
    setCurrentGroupId(null);
    setMode("chat");
    setActiveChatTitle("New chat");
    clearMessages();
    showAuthScreen("Logged out.");
}

async function loadMe() {
    const response = await apiFetch("/api/me", {}, 10000);
    const data = await readJsonResponse(response);

    if (!response.ok || !data.ok) {
        throw new Error(getErrorMessage(data, "Could not load account."));
    }

    return data.user;
}

function addLogoutButton() {
    if (!newChatBtn || document.getElementById("logout-btn")) {
        return;
    }

    const logoutBtn = document.createElement("button");
    logoutBtn.id = "logout-btn";
    logoutBtn.className = "new-chat-btn secondary-action";
    logoutBtn.type = "button";
    logoutBtn.textContent = "Logout";

    logoutBtn.addEventListener("click", async () => {
        await logout();
    });

    newChatBtn.insertAdjacentElement("afterend", logoutBtn);
}

/* ---------------------------------------------------------
 * UI helpers
 * --------------------------------------------------------- */

function setSaveStatus(text) {
    if (saveStatus) {
        saveStatus.textContent = text;
    }
}

function setBackendStatus(text, ok, warn = false) {
    backendOnline = !!ok;

    if (statusText) {
        statusText.textContent = text;
    }

    if (!statusDot) {
        return;
    }

    statusDot.classList.toggle("ok", !!ok);
    statusDot.classList.toggle("bad", !ok && !warn);
    statusDot.classList.toggle("warn", !!warn);
}

function setModelName(text) {
    currentModel = text || "Jolli";

    if (modelName) {
        modelName.textContent = currentModel;
    }
}

function setMode(mode) {
    currentMode = mode;

    if (chatModeLabel) {
        if (mode === "group") {
            chatModeLabel.textContent = "Current group";
        } else {
            chatModeLabel.textContent = "Current chat";
        }
    }
}

function setActiveChatTitle(title) {
    const fallback = currentMode === "group" ? "New group" : "New chat";
    const finalTitle = title || fallback;

    if (currentMode === "group") {
        currentGroupTitle = finalTitle;
        localStorage.setItem("jolli_current_group_title", currentGroupTitle);
    } else {
        currentChatTitle = finalTitle;
        localStorage.setItem("jolli_current_chat_title", currentChatTitle);
    }

    if (activeChatTitle) {
        activeChatTitle.textContent = finalTitle;
    }
}

function setCurrentChatId(chatId) {
    currentChatId = chatId || null;

    if (currentChatId) {
        localStorage.setItem("jolli_current_chat_id", currentChatId);
    } else {
        localStorage.removeItem("jolli_current_chat_id");
    }
}

function setCurrentGroupId(groupId) {
    currentGroupId = groupId || null;

    if (currentGroupId) {
        localStorage.setItem("jolli_current_group_id", currentGroupId);
    } else {
        localStorage.removeItem("jolli_current_group_id");
    }
}

function clearMessages() {
    if (messages) {
        messages.innerHTML = "";
    }

    localHistory = [];
}

function scrollMessagesToBottom() {
    if (messages) {
        messages.scrollTop = messages.scrollHeight;
    }
}

function makeChatTitle(text) {
    const clean = String(text || "").trim().replace(/\s+/g, " ");

    if (!clean) {
        return "New chat";
    }

    return clean.length > 42 ? clean.slice(0, 42).trimEnd() + "..." : clean;
}

function formatDate(value) {
    if (!value) {
        return "";
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return value;
    }

    return date.toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
}

function openSidebar() {
    if (sidebar) {
        sidebar.classList.add("open");
    }

    if (sidebarOverlay) {
        sidebarOverlay.classList.add("show");
    }
}

function closeSidebar() {
    if (sidebar) {
        sidebar.classList.remove("open");
    }

    if (sidebarOverlay) {
        sidebarOverlay.classList.remove("show");
    }
}

function setBusy(busy) {
    isBusy = busy;

    if (input) {
        input.disabled = busy;
    }

    if (voiceBtn) {
        voiceBtn.disabled = busy;
    }

    if (sendBtn) {
        sendBtn.disabled = busy;
    }
}

/* ---------------------------------------------------------
 * Safe message rendering
 * --------------------------------------------------------- */

function appendTextWithCodeBlocks(container, text) {
    const content = String(text || "");
    const parts = content.split(/```/g);

    parts.forEach((part, index) => {
        if (index % 2 === 1) {
            const pre = document.createElement("pre");
            const code = document.createElement("code");

            const cleaned = part.replace(/^\w+\n/, "");
            code.textContent = cleaned.trim();

            pre.appendChild(code);
            container.appendChild(pre);
            return;
        }

        const lines = part.split("\n");

        lines.forEach((line, lineIndex) => {
            if (lineIndex > 0) {
                container.appendChild(document.createElement("br"));
            }

            container.appendChild(document.createTextNode(line));
        });
    });
}

function createMessageElement(name, text, type) {
    const wrapper = document.createElement("article");
    wrapper.className = `message ${type || "assistant"}`;

    const avatar = document.createElement("div");
    avatar.className = "avatar";
    avatar.setAttribute("aria-hidden", "true");
    avatar.textContent = type === "user" ? "Y" : "J";

    const body = document.createElement("div");
    body.className = "message-body";

    const nameDiv = document.createElement("div");
    nameDiv.className = "name";
    nameDiv.textContent = name || (type === "user" ? "You" : "Jolli AI");

    const bubble = document.createElement("div");
    bubble.className = "bubble";

    appendTextWithCodeBlocks(bubble, text);

    body.appendChild(nameDiv);
    body.appendChild(bubble);

    if (type === "user") {
        wrapper.appendChild(body);
        wrapper.appendChild(avatar);
    } else {
        wrapper.appendChild(avatar);
        wrapper.appendChild(body);
    }

    return {
        wrapper,
        bubble,
        body,
    };
}

function addMessage(name, text, type = "assistant", options = {}) {
    if (!messages) {
        return null;
    }

    const created = createMessageElement(name, text, type);

    if (options.error) {
        created.wrapper.classList.add("error");
    }

    messages.appendChild(created.wrapper);
    scrollMessagesToBottom();

    if (!options.skipHistory && (type === "user" || type === "assistant")) {
        localHistory.push({
            role: type === "user" ? "user" : "assistant",
            content: String(text || ""),
        });

        if (localHistory.length > 40) {
            localHistory = localHistory.slice(-40);
        }
    }

    return created.bubble;
}

function addTypingMessage() {
    if (!messages) {
        return null;
    }

    const wrapper = document.createElement("article");
    wrapper.className = "message assistant";

    const avatar = document.createElement("div");
    avatar.className = "avatar";
    avatar.setAttribute("aria-hidden", "true");
    avatar.textContent = "J";

    const body = document.createElement("div");
    body.className = "message-body";

    const nameDiv = document.createElement("div");
    nameDiv.className = "name";
    nameDiv.textContent = "Jolli AI";

    const bubble = document.createElement("div");
    bubble.className = "bubble typing-bubble";

    const dots = document.createElement("span");
    dots.className = "typing-dots";
    dots.innerHTML = "<span></span><span></span><span></span>";

    bubble.appendChild(dots);
    body.appendChild(nameDiv);
    body.appendChild(bubble);

    wrapper.appendChild(avatar);
    wrapper.appendChild(body);

    messages.appendChild(wrapper);
    scrollMessagesToBottom();

    return bubble;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function typeIntoBubble(bubble, text) {
    if (!bubble) {
        return;
    }

    const content = String(text || "");

    bubble.classList.remove("typing-bubble");
    bubble.textContent = "";

    const shouldAnimate =
        content.length <= 2400 &&
        !window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (!shouldAnimate) {
        appendTextWithCodeBlocks(bubble, content);
        scrollMessagesToBottom();
        return;
    }

    for (let i = 0; i < content.length; i++) {
        bubble.textContent += content[i];

        if (i % 3 === 0) {
            scrollMessagesToBottom();
        }

        const char = content[i];

        if (char === "." || char === "!" || char === "?") {
            await sleep(32);
        } else if (char === "," || char === ";" || char === ":") {
            await sleep(16);
        } else {
            await sleep(7);
        }
    }

    bubble.textContent = "";
    appendTextWithCodeBlocks(bubble, content);
    scrollMessagesToBottom();
}

function renderWelcomeMessage() {
    clearMessages();

    addMessage(
        "Jolli AI",
        "Jolli AI is online. Ask me anything.",
        "assistant",
        {
            skipHistory: true,
        }
    );
}

function markActiveSidebarItems() {
    document.querySelectorAll(".history-item").forEach(item => {
        item.classList.remove("active");
    });

    if (currentMode === "chat" && currentChatId) {
        const active = document.querySelector(`[data-chat-id="${currentChatId}"]`);

        if (active) {
            active.classList.add("active");
        }
    }

    if (currentMode === "group" && currentGroupId) {
        const active = document.querySelector(`[data-group-id="${currentGroupId}"]`);

        if (active) {
            active.classList.add("active");
        }
    }
}

/* ---------------------------------------------------------
 * Backend status
 * --------------------------------------------------------- */

async function checkStatus() {
    try {
        const response = await apiFetch("/api/health", {}, 10000);
        const data = await readJsonResponse(response);

        if (!response.ok || !data.ok) {
            setBackendStatus(`Backend error: HTTP ${response.status}`, false);
            return false;
        }

        const model = data.model || "Jolli";
        setModelName(model);

        if (data.ollama_online === false) {
            setBackendStatus("Jolli backend online, Ollama offline", false, true);
        } else {
            setBackendStatus("Jolli service online", true);
        }

        return true;
    } catch (error) {
        if (error.name === "AbortError") {
            setBackendStatus("Jolli service timed out", false);
        } else {
            setBackendStatus("Could not reach Jolli service", false);
        }

        return false;
    }
}

/* ---------------------------------------------------------
 * Chat history
 * --------------------------------------------------------- */

async function loadChatHistory() {
    if (!chatHistory) {
        return;
    }

    try {
        const response = await apiFetch("/api/chats", {}, 10000);
        const data = await readJsonResponse(response);

        if (!response.ok || !data.ok) {
            throw new Error(getErrorMessage(data, `HTTP ${response.status}`));
        }

        const chats = data.chats || [];

        chatHistory.innerHTML = "";

        if (chats.length === 0) {
            chatHistory.innerHTML = `<div class="history-empty">No recent chats yet.</div>`;
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

            const title = document.createElement("span");
            title.className = "history-title";
            title.textContent = chat.title || "Untitled chat";

            const date = document.createElement("span");
            date.className = "history-date";
            date.textContent = formatDate(chat.updated_at || chat.created_at);

            item.appendChild(title);
            item.appendChild(date);

            item.addEventListener("click", () => {
                loadChat(chat.id);
                closeSidebar();
            });

            chatHistory.appendChild(item);
        }
    } catch (error) {
        chatHistory.innerHTML = `<div class="history-empty">Could not load chats.</div>`;
    }
}

async function loadChat(chatId) {
    if (isBusy || !chatId) {
        return;
    }

    try {
        setSaveStatus("Loading...");

        const response = await apiFetch(`/api/chats/${encodeURIComponent(chatId)}`, {}, 10000);
        const data = await readJsonResponse(response);

        if (!response.ok || !data.ok) {
            throw new Error(getErrorMessage(data, `HTTP ${response.status}`));
        }

        const chat = data.chat || data;

        setMode("chat");
        setCurrentChatId(chat.id);
        setCurrentGroupId(null);
        setActiveChatTitle(chat.title || "Untitled chat");

        clearMessages();

        const loadedMessages = chat.messages || [];

        if (loadedMessages.length === 0) {
            addMessage("Jolli AI", "This chat is empty.", "assistant", {
                skipHistory: true,
            });
        } else {
            for (const msg of loadedMessages) {
                const role = msg.role === "user" ? "user" : "assistant";
                const name = role === "user" ? "You" : "Jolli AI";

                addMessage(name, msg.content, role);
            }
        }

        setSaveStatus("Loaded");
        await loadChatHistory();
        await loadGroups();
        markActiveSidebarItems();
    } catch (error) {
        setSaveStatus("Load failed");
        addMessage("Jolli AI", `Could not load chat: ${error.message}`, "assistant", {
            error: true,
            skipHistory: true,
        });
    }
}

function startNewChat() {
    if (isBusy) {
        return;
    }

    setMode("chat");
    setCurrentChatId(null);
    setCurrentGroupId(null);
    setActiveChatTitle("New chat");
    setSaveStatus("Ready");

    renderWelcomeMessage();
    markActiveSidebarItems();
    closeSidebar();

    if (input) {
        input.focus();
    }
}

/* ---------------------------------------------------------
 * Groups
 * --------------------------------------------------------- */

async function loadGroups() {
    if (!groupHistory) {
        return;
    }

    try {
        const response = await apiFetch("/api/groups", {}, 10000);
        const data = await readJsonResponse(response);

        if (!response.ok || !data.ok) {
            throw new Error(getErrorMessage(data, `HTTP ${response.status}`));
        }

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

            const title = document.createElement("span");
            title.className = "history-title";
            title.textContent = group.name || "Untitled group";

            const date = document.createElement("span");
            date.className = "history-date";
            date.textContent = formatDate(group.updated_at || group.created_at);

            item.appendChild(title);
            item.appendChild(date);

            item.addEventListener("click", () => {
                loadGroup(group.id);
                closeSidebar();
            });

            groupHistory.appendChild(item);
        }
    } catch (error) {
        groupHistory.innerHTML = `<div class="history-empty">Could not load groups.</div>`;
    }
}

async function createGroup(name, description = "") {
    const response = await apiFetch("/api/groups", {
        method: "POST",
        body: JSON.stringify({
            name,
            description,
        }),
    }, 15000);

    const data = await readJsonResponse(response);

    if (!response.ok || !data.ok) {
        throw new Error(getErrorMessage(data, `HTTP ${response.status}`));
    }

    return data.group;
}

async function startNewGroup() {
    if (isBusy) {
        return;
    }

    const name = prompt("Group name:");

    if (!name || !name.trim()) {
        return;
    }

    const description = prompt("Group description, optional:") || "";

    try {
        setSaveStatus("Creating group...");

        const group = await createGroup(name.trim(), description.trim());

        setMode("group");
        setCurrentChatId(null);
        setCurrentGroupId(group.id);
        setActiveChatTitle(group.name || "New group");

        clearMessages();

        addMessage(
            "Jolli AI",
            `Group created: ${group.name || "New group"}. Send a message to start the group chat.`,
            "assistant",
            {
                skipHistory: true,
            }
        );

        setSaveStatus("Group created");

        await loadChatHistory();
        await loadGroups();
        markActiveSidebarItems();
        closeSidebar();

        if (input) {
            input.focus();
        }
    } catch (error) {
        setSaveStatus("Group error");

        addMessage(
            "Jolli AI",
            `Could not create group: ${error.message}`,
            "assistant",
            {
                error: true,
                skipHistory: true,
            }
        );
    }
}

async function loadGroup(groupId) {
    if (isBusy || !groupId) {
        return;
    }

    try {
        setSaveStatus("Loading group...");

        const response = await apiFetch(`/api/groups/${encodeURIComponent(groupId)}`, {}, 10000);
        const data = await readJsonResponse(response);

        if (!response.ok || !data.ok) {
            throw new Error(getErrorMessage(data, `HTTP ${response.status}`));
        }

        const group = data.group || data;

        setMode("group");
        setCurrentChatId(null);
        setCurrentGroupId(group.id);
        setActiveChatTitle(group.name || "Untitled group");

        clearMessages();

        const groupMessages = group.messages || [];

        if (groupMessages.length === 0) {
            addMessage(
                "Jolli AI",
                "This group is empty. Send a message to start.",
                "assistant",
                {
                    skipHistory: true,
                }
            );
        } else {
            for (const msg of groupMessages) {
                const role = msg.role === "user" ? "user" : "assistant";

                const name =
                    role === "user"
                        ? (msg.display_name || "User")
                        : "Jolli AI";

                addMessage(name, msg.content, role);
            }
        }

        setSaveStatus("Group loaded");

        await loadChatHistory();
        await loadGroups();
        markActiveSidebarItems();
    } catch (error) {
        setSaveStatus("Group load failed");

        addMessage(
            "Jolli AI",
            `Could not load group: ${error.message}`,
            "assistant",
            {
                error: true,
                skipHistory: true,
            }
        );
    }
}

async function sendGroupMessage(text) {
    if (!currentGroupId) {
        throw new Error("Open or create a group first.");
    }

    const displayName =
        currentUser?.displayName ||
        currentUser?.email ||
        currentUser?.username ||
        "User";

    addMessage(displayName, text, "user");

    const typingBubble = addTypingMessage();

    setSaveStatus("Thinking...");

    const response = await apiFetch(`/api/groups/${encodeURIComponent(currentGroupId)}/chat`, {
        method: "POST",
        body: JSON.stringify({
            message: text,
            display_name: displayName,
        }),
    }, 120000);

    const data = await readJsonResponse(response);

    if (!response.ok || !data.ok) {
        throw new Error(getErrorMessage(data, `HTTP ${response.status}`));
    }

    const reply = data.reply || "I did not get a response.";

    await typeIntoBubble(typingBubble, reply);

    setSaveStatus("Group saved");

    speakText(reply);

    await loadGroups();
    markActiveSidebarItems();
}

async function addMemberToCurrentGroup() {
    if (!currentGroupId) {
        addMessage(
            "Jolli AI",
            "Open a group first before adding members.",
            "assistant",
            {
                skipHistory: true,
            }
        );

        return;
    }

    const displayName = prompt("Member display name:");

    if (!displayName || !displayName.trim()) {
        return;
    }

    try {
        const response = await apiFetch(`/api/groups/${encodeURIComponent(currentGroupId)}/members`, {
            method: "POST",
            body: JSON.stringify({
                display_name: displayName.trim(),
                role: "member",
            }),
        }, 15000);

        const data = await readJsonResponse(response);

        if (!response.ok || !data.ok) {
            throw new Error(getErrorMessage(data, `HTTP ${response.status}`));
        }

        addMessage(
            "Jolli AI",
            `Member added: ${data.member?.display_name || displayName}`,
            "assistant",
            {
                skipHistory: true,
            }
        );

        await loadGroup(currentGroupId);
    } catch (error) {
        addMessage(
            "Jolli AI",
            `Could not add member: ${error.message}`,
            "assistant",
            {
                error: true,
                skipHistory: true,
            }
        );
    }
}

/* ---------------------------------------------------------
 * Memory commands
 * --------------------------------------------------------- */

function parseCommand(text) {
    const trimmed = String(text || "").trim();

    if (/^remember\s+/i.test(trimmed)) {
        return {
            type: "remember",
            value: trimmed.replace(/^remember\s+/i, "").trim(),
        };
    }

    if (/^(notes|memories|memory)$/i.test(trimmed)) {
        return {
            type: "notes",
            value: "",
        };
    }

    if (/^(clear notes|clear memory|forget all)$/i.test(trimmed)) {
        return {
            type: "clear-memory",
            value: "",
        };
    }

    return {
        type: "chat",
        value: trimmed,
    };
}

async function rememberText(content) {
    if (!content) {
        addMessage("Jolli AI", "Tell me what to remember after the word `remember`.", "assistant", {
            skipHistory: true,
        });
        return;
    }

    const response = await apiFetch("/api/memory/add", {
        method: "POST",
        body: JSON.stringify({
            content,
        }),
    });

    const data = await readJsonResponse(response);

    if (!response.ok || !data.ok) {
        throw new Error(getErrorMessage(data, `HTTP ${response.status}`));
    }

    addMessage("Jolli AI", `Remembered: ${content}`, "assistant", {
        skipHistory: true,
    });

    setSaveStatus("Memory saved");
}

async function showNotes() {
    const response = await apiFetch("/api/memory/list", {}, 10000);
    const data = await readJsonResponse(response);

    if (!response.ok || !data.ok) {
        throw new Error(getErrorMessage(data, `HTTP ${response.status}`));
    }

    const memories = data.memories || [];

    if (memories.length === 0) {
        addMessage("Jolli AI", "No saved notes yet.", "assistant", {
            skipHistory: true,
        });
        return;
    }

    const text = memories
        .slice()
        .reverse()
        .map((memory, index) => `${index + 1}. ${memory.content}`)
        .join("\n");

    addMessage("Jolli AI", `Saved notes:\n${text}`, "assistant", {
        skipHistory: true,
    });
}

async function clearMemory() {
    const response = await apiFetch("/api/memory/clear", {
        method: "POST",
    });

    const data = await readJsonResponse(response);

    if (!response.ok || !data.ok) {
        throw new Error(getErrorMessage(data, `HTTP ${response.status}`));
    }

    addMessage("Jolli AI", "All saved notes were cleared.", "assistant", {
        skipHistory: true,
    });

    setSaveStatus("Memory cleared");
}

/* ---------------------------------------------------------
 * Sending messages
 * --------------------------------------------------------- */

async function sendMessage(text) {
    const cleanText = String(text || "").trim();

    if (!cleanText || isBusy) {
        return;
    }

    setBusy(true);

    if (input) {
        input.value = "";
    }

    try {
        const command = parseCommand(cleanText);

        if (command.type === "remember") {
            addMessage("You", cleanText, "user", {
                skipHistory: true,
            });

            await rememberText(command.value);
            return;
        }

        if (command.type === "notes") {
            addMessage("You", cleanText, "user", {
                skipHistory: true,
            });

            await showNotes();
            return;
        }

        if (command.type === "clear-memory") {
            addMessage("You", cleanText, "user", {
                skipHistory: true,
            });

            await clearMemory();
            return;
        }

        if (currentMode === "group") {
            await sendGroupMessage(cleanText);
        } else {
            await sendChatMessage(cleanText);
        }
    } catch (error) {
        addMessage("Jolli AI", `Jolli backend error: ${error.message}`, "assistant", {
            error: true,
            skipHistory: true,
        });

        setSaveStatus("Error");
    } finally {
        setBusy(false);

        if (input) {
            input.focus();
        }
    }
}

async function sendChatMessage(text) {
    const firstMessage = !currentChatId && localHistory.length <= 1;

    if (firstMessage) {
        setActiveChatTitle(makeChatTitle(text));
    }

    addMessage("You", text, "user");

    const typingBubble = addTypingMessage();

    setSaveStatus("Thinking...");

    const response = await apiFetch("/api/chat", {
        method: "POST",
        body: JSON.stringify({
            message: text,
            chat_id: currentChatId,
            history: localHistory.slice(-30),
        }),
    }, 120000);

    const data = await readJsonResponse(response);

    if (!response.ok || !data.ok) {
        throw new Error(getErrorMessage(data, `HTTP ${response.status}`));
    }

    if (data.chat_id) {
        setCurrentChatId(data.chat_id);
    }

    if (data.model) {
        setModelName(data.model);
    }

    const reply = data.reply || "I did not get a response.";

    await typeIntoBubble(typingBubble, reply);

    localHistory.push({
        role: "assistant",
        content: reply,
    });

    if (localHistory.length > 40) {
        localHistory = localHistory.slice(-40);
    }

    setSaveStatus("Saved");

    speakText(reply);
    await loadChatHistory();
    markActiveSidebarItems();
}

/* ---------------------------------------------------------
 * Voice
 * --------------------------------------------------------- */

const JolliVoice = {
    rate: Number(localStorage.getItem("jolli_voice_rate") || "0.96"),
    pitch: Number(localStorage.getItem("jolli_voice_pitch") || "1"),
    volume: Number(localStorage.getItem("jolli_voice_volume") || "1"),
    voiceName: localStorage.getItem("jolli_voice_name") || "",
    autoSpeak: localStorage.getItem("jolli_auto_speak") === "true",

    supported() {
        return "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
    },

    stop() {
        if (this.supported()) {
            window.speechSynthesis.cancel();
        }
    },

    getVoice() {
        if (!this.supported()) {
            return null;
        }

        const voices = window.speechSynthesis.getVoices();

        if (this.voiceName) {
            const selected = voices.find(voice => voice.name === this.voiceName);

            if (selected) {
                return selected;
            }
        }

        return (
            voices.find(voice => voice.lang.toLowerCase().startsWith("en")) ||
            voices[0] ||
            null
        );
    },

    clean(text) {
        return String(text || "")
            .replace(/```[\s\S]*?```/g, "code block omitted")
            .replace(/https?:\/\/\S+/g, "link omitted")
            .replace(/[#*_>`~]/g, "")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 3000);
    },

    speak(text) {
        if (!this.autoSpeak || !this.supported()) {
            return;
        }

        const cleaned = this.clean(text);

        if (!cleaned) {
            return;
        }

        this.stop();

        const utterance = new SpeechSynthesisUtterance(cleaned);
        const voice = this.getVoice();

        if (voice) {
            utterance.voice = voice;
            utterance.lang = voice.lang;
        } else {
            utterance.lang = "en-US";
        }

        utterance.rate = Math.max(0.5, Math.min(2, this.rate));
        utterance.pitch = Math.max(0, Math.min(2, this.pitch));
        utterance.volume = Math.max(0, Math.min(1, this.volume));

        window.speechSynthesis.speak(utterance);
    },

    toggleAutoSpeak() {
        this.autoSpeak = !this.autoSpeak;
        localStorage.setItem("jolli_auto_speak", this.autoSpeak ? "true" : "false");
        return this.autoSpeak;
    },
};

window.JolliVoice = JolliVoice;

function speakText(text) {
    JolliVoice.speak(text);
}

function startVoiceInput() {
    if (isBusy) {
        return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
        const enabled = JolliVoice.toggleAutoSpeak();

        addMessage(
            "Jolli AI",
            enabled
                ? "Auto-speak is now on. Browser speech input is not available here."
                : "Auto-speak is now off. Browser speech input is not available here.",
            "assistant",
            {
                skipHistory: true,
            }
        );

        return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    setSaveStatus("Listening...");

    recognition.start();

    recognition.onresult = event => {
        const text = event.results?.[0]?.[0]?.transcript || "";

        if (text.trim()) {
            sendMessage(text.trim());
        }
    };

    recognition.onerror = event => {
        addMessage("Jolli AI", `Speech recognition error: ${event.error}`, "assistant", {
            error: true,
            skipHistory: true,
        });

        setSaveStatus("Voice error");
    };

    recognition.onend = () => {
        if (!isBusy) {
            setSaveStatus("Ready");
        }
    };
}

window.jolliReceiveVoiceText = function(text) {
    if (!text || !text.trim()) {
        return;
    }

    if (input) {
        input.value = text.trim();
    }

    sendMessage(text.trim());
};

window.addEventListener("beforeunload", () => {
    JolliVoice.stop();
});

document.addEventListener("click", () => {
    if (JolliVoice.supported()) {
        window.speechSynthesis.getVoices();
    }
}, { once: true });

if ("speechSynthesis" in window) {
    window.speechSynthesis.onvoiceschanged = () => {
        JolliVoice.getVoice();
    };
}

/* ---------------------------------------------------------
 * Events
 * --------------------------------------------------------- */

if (form) {
    form.addEventListener("submit", event => {
        event.preventDefault();

        if (!input) {
            return;
        }

        const text = input.value.trim();

        if (!text) {
            return;
        }

        sendMessage(text);
    });
}

if (voiceBtn) {
    voiceBtn.addEventListener("click", startVoiceInput);
}

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

if (loginBtn) {
    loginBtn.addEventListener("click", loginFromAuthScreen);
}

if (createAccountBtn) {
    createAccountBtn.addEventListener("click", registerFromAuthScreen);
}

[authUsername, authEmail, authPassword].forEach(element => {
    if (!element) {
        return;
    }

    element.addEventListener("keydown", event => {
        if (event.key === "Enter") {
            loginFromAuthScreen();
        }
    });
});

suggestionButtons.forEach(button => {
    button.addEventListener("click", () => {
        const prompt = button.getAttribute("data-prompt") || button.textContent.trim();

        if (!input || !prompt) {
            return;
        }

        input.value = prompt;
        input.focus();
    });
});

document.addEventListener("keydown", event => {
    if (event.key === "Escape") {
        closeSidebar();
    }

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();

        if (input) {
            input.focus();
            input.select();
        }
    }

    if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "o") {
        event.preventDefault();
        startNewChat();
    }
});

/* ---------------------------------------------------------
 * Boot
 * --------------------------------------------------------- */

async function bootLoggedIn() {
    showAppShell();
    addLogoutButton();

    setMode("chat");
    setActiveChatTitle(currentChatTitle || "New chat");
    setSaveStatus("Starting...");

    renderWelcomeMessage();

    const online = await checkStatus();

    if (!online) {
        setSaveStatus("Offline");
    } else {
        setSaveStatus("Ready");
    }

    await loadChatHistory();
    await loadGroups();

    if (currentChatId) {
        await loadChat(currentChatId);
    }

    if (input) {
        input.focus();
    }
}

async function bootWithoutAuth() {
    setMode("chat");
    setActiveChatTitle(currentChatTitle || "New chat");
    setSaveStatus("Starting...");

    renderWelcomeMessage();

    const online = await checkStatus();

    if (!online) {
        setSaveStatus("Offline");
    } else {
        setSaveStatus("Ready");
    }

    await loadChatHistory();
    await loadGroups();

    if (currentChatId) {
        await loadChat(currentChatId);
    }

    if (input) {
        input.focus();
    }
}

async function boot() {
    const firebaseReady = initFirebase();

    if (firebaseReady && authScreen && appShell) {
        await checkStatus();

        firebaseAuth.onAuthStateChanged(async user => {
            currentUser = user;

            if (!user) {
                showAuthScreen();
                return;
            }

            try {
                await loadMe();
                await bootLoggedIn();
            } catch (error) {
                showAuthScreen(error.message || "Please log in again.");
            }
        });

        return;
    }

    if (authScreen && appShell && !firebaseReady) {
        showAuthScreen("Firebase Auth is not loaded.");
        return;
    }

    await bootWithoutAuth();
}

boot();

setInterval(checkStatus, 15000);
