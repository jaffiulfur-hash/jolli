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

/* ---------------------------------------------------------
 * API helper
 * --------------------------------------------------------- */

function apiUrl(path) {
    return `${API_BASE}${path}`;
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

function apiConfigured() {
    return API_BASE.startsWith("https://");
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
    addMessage("Jolli", "Jolli Web online. Ask me something.", "assistant");
}

/* ---------------------------------------------------------
 * Ollama/backend status
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

        setBackendStatus(data.status || "Jolli backend reached.", !!data.ollama_ready);
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

    const response = await fetchWithTimeout(apiUrl("/api/chats"), {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            title: title || "New chat",
        }),
    });

    if (!response.ok) {
        throw new Error(`Failed to create chat. HTTP ${response.status}`);
    }

    const data = await response.json();

    currentChatId = data.id;
    setActiveChatTitle(data.title || title || "New chat");
    setSaveStatus("Chat created");

    await loadChatHistory();

    return data;
}

async function saveMessage(role, content) {
    if (!currentChatId || !apiConfigured()) {
        return;
    }

    setSaveStatus("Saving...");

    const response = await fetchWithTimeout(apiUrl(`/api/chats/${currentChatId}/messages`), {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            role,
            content,
        }),
    });

    if (!response.ok) {
        setSaveStatus("Save failed");
        return;
    }

    setSaveStatus("Saved");
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

    try {
        const response = await fetchWithTimeout(apiUrl("/api/chats"), {}, 10000);

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
    if (isBusy || !apiConfigured()) {
        return;
    }

    try {
        setSaveStatus("Loading chat...");

        const response = await fetchWithTimeout(apiUrl(`/api/chats/${chatId}`), {}, 10000);

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
        await saveMessage("user", text);

        const jolliBubble = addTypingMessage();

        const response = await fetchWithTimeout(apiUrl("/api/chat"), {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                message: text,
                chat_id: currentChatId,
            }),
        }, 120000);

        if (!response.ok) {
            throw new Error(`Failed to talk to Jolli backend. HTTP ${response.status}`);
        }

        const data = await response.json();
        const reply = data.reply || "I did not get a response.";

        await typeIntoBubble(jolliBubble, reply);
        await saveMessage("assistant", reply);

        speakText(reply);
        await loadChatHistory();
    } catch (error) {
        const errorText = "Jolli backend error: " + error;
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

renderWelcomeMessage();
checkStatus();
loadChatHistory();

setInterval(checkStatus, 10000);
