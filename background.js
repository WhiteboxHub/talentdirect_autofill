// Background service worker + apply queue orchestrator

const queueRuntime = {
  running: false,
  runId: null,
  urls: [],
  index: 0,
  tabId: null,
  windowId: null,
  waitingForSubmit: false,
  timer: null,
  timeoutMs: 12 * 60 * 1000
};
let lastAtsContext = {
  tabId: null,
  url: null,
  updatedAt: 0
};

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error(error));

chrome.runtime.onInstalled.addListener(() => {
  console.log("Extension installed");
  chrome.contextMenus.create({
    id: "generateAIAnswer",
    title: "Generate Answer with AI",
    contexts: ["editable"]
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "generateAIAnswer") {
    chrome.tabs.sendMessage(tab.id, { action: "get_question_text" });
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  hydrateQueueFromStorage(() => {
    if (!queueRuntime.running || tabId !== queueRuntime.tabId) return;

    const u = ((changeInfo.url != null ? changeInfo.url : tab?.url) || "").toLowerCase();

    if (queueRuntime.waitingForSubmit && u && isQueueSuccessUrl(u)) {
      void moveNext("tab_url_success");
      return;
    }

    // Thank-you URL but we already cleared waiting (e.g. moveNext in progress) — do not
    // call postQueueBegin here or we re-arm submit state and can double-advance / open extra windows.
    if (u && isQueueSuccessUrl(u)) {
      return;
    }

    if (changeInfo.status !== "complete") return;

    // Re-read the tab after "complete" — tab.url in this event is sometimes still the old URL.
    chrome.tabs.get(tabId, (fresh) => {
      if (chrome.runtime.lastError) return;
      hydrateQueueFromStorage(() => {
        if (!queueRuntime.running || tabId !== queueRuntime.tabId) return;
        const uFresh = (fresh.url || "").toLowerCase();
        if (queueRuntime.waitingForSubmit && uFresh && isQueueSuccessUrl(uFresh)) {
          void moveNext("tab_url_success");
          return;
        }
        if (uFresh && isQueueSuccessUrl(uFresh)) {
          return;
        }
        postQueueBeginToContent(tabId);
      });
    });
  });
});

/** URL path/query typical of a post-submit thank-you or confirmation screen */
function isQueueSuccessUrl(u) {
  return (
    /\/confirmation(?:\/|\?|#|$)/i.test(u) ||
    /\/thank[-_/]?you/i.test(u) ||
    /\/success(?:\/|\?|#|$)/i.test(u) ||
    /\/application[-_]?(?:submitted|complete)/i.test(u) ||
    /[?&](?:submitted|success)=/i.test(u)
  );
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "generate_ai_answer") {
    callOllama(request.prompt).then(result => {
      sendResponse({ text: result });
    });
    return true;
  }

  if (request.action === "start_apply_queue") {
    startApplyQueue(request.urls)
      .then((res) => sendResponse(res))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  if (request.action === "queue_submit_detected") {
    hydrateQueueFromStorage(() => {
      handleSubmitDetected(request, sender?.tab?.id);
      sendResponse({ ok: true });
    });
    return true;
  }

  /** Lets a tab that just navigated (e.g. form → thank-you) re-attach success detection. */
  if (request.action === "get_queue_context_for_tab") {
    hydrateQueueFromStorage(() => {
      const tabId = sender?.tab?.id;
      const active =
        queueRuntime.running &&
        tabId != null &&
        tabId === queueRuntime.tabId &&
        queueRuntime.waitingForSubmit;
      sendResponse({
        active: !!active,
        runId: active ? queueRuntime.runId : null
      });
    });
    return true;
  }

  if (request.action === "queue_status") {
    hydrateQueueFromStorage(() => {
      sendResponse({
        running: queueRuntime.running,
        index: queueRuntime.index,
        total: queueRuntime.urls.length,
        currentUrl: queueRuntime.urls[queueRuntime.index] || null
      });
    });
    return true;
  }

  if (request.action === "ats_page_heartbeat") {
    if (sender?.tab?.id && sender?.tab?.url) {
      lastAtsContext = {
        tabId: sender.tab.id,
        url: sender.tab.url,
        updatedAt: Date.now()
      };
    }
    sendResponse({ ok: true });
    return;
  }

  if (request.action === "get_last_ats_tab") {
    sendResponse({ ok: true, lastAtsContext });
    return;
  }

  if (request.action === "ensure_content_script") {
    ensureContentScript(request.tabId)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
});

async function startApplyQueue(urls) {
  await new Promise((resolve) => hydrateQueueFromStorage(resolve));
  const cleaned = Array.from(new Set((urls || []).filter(Boolean)));
  if (!cleaned.length) return { ok: false, error: "No URLs provided." };
  if (queueRuntime.running) return { ok: false, error: "Queue already running." };

  queueRuntime.running = true;
  queueRuntime.runId = `run_${Date.now()}`;
  queueRuntime.urls = cleaned;
  queueRuntime.index = 0;
  queueRuntime.waitingForSubmit = false;

  // Open first job in a new browser window (listings tab stays as-is)
  const win = await chrome.windows.create({
    url: cleaned[0],
    focused: true,
    type: "normal"
  });
  const firstTab = win.tabs && win.tabs[0];
  queueRuntime.tabId = firstTab ? firstTab.id : null;
  queueRuntime.windowId = win.id;
  persistQueueState();
  return { ok: true, runId: queueRuntime.runId, total: cleaned.length };
}

function scheduleQueueSubmitTimer() {
  clearQueueTimer();
  queueRuntime.timer = setTimeout(() => {
    void moveNext("submit_timeout");
  }, queueRuntime.timeoutMs);
}

/**
 * Tab may report "complete" before the content script is registered, or the job URL
 * may need programmatic injection. Retry sendMessage, then inject scripts once.
 */
function postQueueBeginToContent(tabId) {
  if (!queueRuntime.running) return;
  const currentUrl = queueRuntime.urls[queueRuntime.index];
  if (!currentUrl) {
    completeQueue();
    return;
  }

  clearQueueTimer();
  queueRuntime.waitingForSubmit = true;
  persistQueueState();

  const payload = {
    action: "queue_begin_job",
    runId: queueRuntime.runId,
    index: queueRuntime.index,
    url: currentUrl
  };

  const trySend = (attempt) => {
    chrome.tabs.sendMessage(tabId, payload, () => {
      if (chrome.runtime.lastError) {
        if (attempt < 12) {
          setTimeout(() => trySend(attempt + 1), 250 + attempt * 120);
          return;
        }
        ensureContentScript(tabId)
          .then(() => new Promise((r) => setTimeout(r, 500)))
          .then(() => {
            chrome.tabs.sendMessage(tabId, payload, () => {
              if (chrome.runtime.lastError) {
                console.warn("Queue begin failed after inject:", chrome.runtime.lastError.message);
                void moveNext("content_unavailable");
                return;
              }
              scheduleQueueSubmitTimer();
            });
          })
          .catch((err) => {
            console.warn("Queue ensureContentScript failed:", err);
            void moveNext("content_unavailable");
          });
        return;
      }
      scheduleQueueSubmitTimer();
    });
  };

  setTimeout(() => trySend(0), 300);
}

function handleSubmitDetected(request, senderTabId) {
  if (!queueRuntime.running) return;
  if (senderTabId !== queueRuntime.tabId) return;
  if (!queueRuntime.waitingForSubmit) return;
  if (request.runId !== queueRuntime.runId) return;
  void moveNext("submitted");
}

async function moveNext(reason) {
  if (!queueRuntime.running) return;
  if (!queueRuntime.waitingForSubmit) {
    return;
  }
  clearQueueTimer();
  queueRuntime.waitingForSubmit = false;

  const completedUrl = queueRuntime.urls[queueRuntime.index];
  console.log(`Queue advance: ${reason} -> ${completedUrl}`);
  queueRuntime.index += 1;
  persistQueueState();

  if (queueRuntime.index >= queueRuntime.urls.length) {
    completeQueue();
    return;
  }

  const nextUrl = queueRuntime.urls[queueRuntime.index];
  const tabIdToReuse = queueRuntime.tabId;

  try {
    if (tabIdToReuse != null) {
      await chrome.tabs.update(tabIdToReuse, { url: nextUrl, active: true });
      if (queueRuntime.windowId != null) {
        await chrome.windows.update(queueRuntime.windowId, { focused: true }).catch(() => {});
      }
      queueRuntime.tabId = tabIdToReuse;
      persistQueueState();
    } else {
      const win = await chrome.windows.create({
        url: nextUrl,
        focused: true,
        type: "normal"
      });
      const t = win.tabs && win.tabs[0];
      if (t && t.id) {
        queueRuntime.tabId = t.id;
        queueRuntime.windowId = win.id;
        persistQueueState();
      }
    }
  } catch (err) {
    console.error("Queue navigate to next URL failed:", err);
    try {
      const win = await chrome.windows.create({
        url: nextUrl,
        focused: true,
        type: "normal"
      });
      const t = win.tabs && win.tabs[0];
      if (t && t.id) {
        queueRuntime.tabId = t.id;
        queueRuntime.windowId = win.id;
        persistQueueState();
      }
    } catch (err2) {
      console.error("Queue fallback open window failed:", err2);
    }
  }
}

function completeQueue() {
  clearQueueTimer();
  console.log("Apply queue completed.");
  queueRuntime.running = false;
  queueRuntime.waitingForSubmit = false;
  persistQueueState();
}

function clearQueueTimer() {
  if (queueRuntime.timer) {
    clearTimeout(queueRuntime.timer);
    queueRuntime.timer = null;
  }
}

function persistQueueState() {
  chrome.storage.local.set({
    applyQueueState: {
      running: queueRuntime.running,
      runId: queueRuntime.runId,
      urls: queueRuntime.urls,
      index: queueRuntime.index,
      total: queueRuntime.urls.length,
      tabId: queueRuntime.tabId,
      windowId: queueRuntime.windowId,
      waitingForSubmit: queueRuntime.waitingForSubmit,
      currentUrl: queueRuntime.urls[queueRuntime.index] || null,
      updatedAt: Date.now()
    }
  });
}

/**
 * Service workers sleep — in-memory queueRuntime is lost. Restore from chrome.storage.local
 * so we still detect /confirmation and advance after submit.
 */
function hydrateQueueFromStorage(done) {
  if (queueRuntime.running && queueRuntime.urls && queueRuntime.urls.length > 0) {
    done();
    return;
  }
  chrome.storage.local.get("applyQueueState", (data) => {
    const s = data && data.applyQueueState;
    if (
      s &&
      s.running &&
      Array.isArray(s.urls) &&
      s.urls.length > 0 &&
      s.tabId != null
    ) {
      queueRuntime.running = true;
      queueRuntime.runId = s.runId;
      queueRuntime.urls = s.urls;
      queueRuntime.index = Math.min(
        Math.max(0, typeof s.index === "number" ? s.index : 0),
        s.urls.length - 1
      );
      queueRuntime.tabId = s.tabId;
      queueRuntime.windowId = s.windowId;
      queueRuntime.waitingForSubmit = !!s.waitingForSubmit;
      console.log("Apply queue: hydrated from storage (service worker was inactive).");
    }
    done();
  });
}

async function ensureContentScript(tabId) {
  const files = [
    "resumeProcessor.js",
    "atsStrategies/strategyRegistry.js",
    "atsStrategies/genericStrategy.js",
    "atsStrategies/adpStrategy.js",
    "atsStrategies/applytojobStrategy.js",
    "atsStrategies/ashbyStrategy.js",
    "atsStrategies/bamboohrStrategy.js",
    "atsStrategies/brassringStrategy.js",
    "atsStrategies/greenhouseStrategy.js",
    "atsStrategies/icimsStrategy.js",
    "atsStrategies/indeedStrategy.js",
    "atsStrategies/jobviteStrategy.js",
    "atsStrategies/leverStrategy.js",
    "atsStrategies/linkedinStrategy.js",
    "atsStrategies/oraclecloudStrategy.js",
    "atsStrategies/paychexStrategy.js",
    "atsStrategies/paycomStrategy.js",
    "atsStrategies/personioStrategy.js",
    "atsStrategies/recruiteeStrategy.js",
    "atsStrategies/ripplingStrategy.js",
    "atsStrategies/smartrecruitersStrategy.js",
    "atsStrategies/successfactorsStrategy.js",
    "atsStrategies/taleoStrategy.js",
    "atsStrategies/teamtailorStrategy.js",
    "atsStrategies/ultiproStrategy.js",
    "atsStrategies/workableStrategy.js",
    "atsStrategies/workdayStrategy.js",
    "content.js"
  ];

  await chrome.scripting.executeScript({
    target: { tabId },
    files
  });
}

async function callOllama(prompt) {
  const res = await fetch("http://localhost:11434/api/generate", {
    method: "POST",
    body: JSON.stringify({
      model: "llama2",
      prompt: prompt,
      stream: false
    })
  });

  const data = await res.json();
  return data.response;
}
