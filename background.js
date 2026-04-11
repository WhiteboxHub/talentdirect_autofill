// Background service worker + apply queue orchestrator
const _AF_DEBUG = false;
const _log = _AF_DEBUG ? console.log.bind(console, '[AutoFill BG]') : () => {};
const _warn = _AF_DEBUG ? console.warn.bind(console, '[AutoFill BG]') : () => {};

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
  .catch(() => {});

chrome.runtime.onInstalled.addListener(() => {
  _log("Extension installed");
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

    if (queueRuntime.waitingForSubmit && u && isQueueBlockedOrUnusableUrl(u)) {
      void advanceQueue("blocked_url", { requireWaiting: true });
      return;
    }

    if (u && isQueueSuccessUrl(u)) {
      return;
    }

    if (changeInfo.status !== "complete") return;

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
        if (uFresh && isQueueBlockedOrUnusableUrl(uFresh)) {
          void advanceQueue("blocked_url", {
            requireWaiting: queueRuntime.waitingForSubmit ? true : false
          });
          return;
        }
        postQueueBeginToContent(tabId);
      });
    });
  });
});

function isQueueSuccessUrl(u) {
  return (
    /\/confirmation(?:\/|\?|#|$)/i.test(u) ||
    /\/thank[-_/]?you/i.test(u) ||
    /\/success(?:\/|\?|#|$)/i.test(u) ||
    /\/application[-_]?(?:submitted|complete)/i.test(u) ||
    /[?&](?:submitted|success)=/i.test(u) ||
    /\/applyconfirmation/i.test(u) ||
    /\/apply-confirmation/i.test(u) ||
    /\/candidateconfirmation/i.test(u) ||
    /\/applicationstatus\/submitted/i.test(u)
  );
}

function isQueueBlockedOrUnusableUrl(u) {
  if (!u) return false;
  if (/community\.workday\.com/i.test(u) && /maintenance/i.test(u)) return true;
  if (/maintenance-page/i.test(u)) return true;
  if (/\/maintenance(?:\/|\?|#|$)/i.test(u)) return true;
  if (/\/service-unavailable/i.test(u)) return true;
  if (/\/503(?:\/|\?|#|$)/i.test(u)) return true;
  if (/\/50[24](?:\/|\?|#|$)/i.test(u)) return true;
  return false;
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // OpenAI "Fill Everything" primary path
  if (request.action === "ACTION_FILL_ALL") {
    handleActionFillAll(request)
      .then((result) => sendResponse(result))
      .catch((err) => {
        _warn("ACTION_FILL_ALL failed:", err);
        sendResponse({
          ok: false,
          useFallbackStrategy: true,
          error: String(err?.message || err)
        });
      });
    return true;
  }

  if (request.action === "generate_ai_answer") {
    callOpenAIAnswerFromPrompt(request.prompt)
      .then(result => sendResponse({ text: result }))
      .catch(async () => {
        const fallback = await callOllama(request.prompt || "");
        sendResponse({ text: fallback });
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

  if (request.action === "queue_skip_job") {
    hydrateQueueFromStorage(() => {
      handleQueueSkipJob(request, sender?.tab?.id);
      sendResponse({ ok: true });
    });
    return true;
  }

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

  if (request.action === "cancel_queue") {
    hydrateQueueFromStorage(() => {
      if (queueRuntime.running) {
        completeQueue();
        sendResponse({ ok: true, reason: "cancelled" });
      } else {
        sendResponse({ ok: false, error: "No queue running." });
      }
    });
    return true;
  }

  if (request.action === "skip_current_job") {
    hydrateQueueFromStorage(() => {
      if (queueRuntime.running && queueRuntime.waitingForSubmit) {
        void moveNext("user_skip");
        sendResponse({ ok: true });
      } else {
        sendResponse({ ok: false, error: "Not waiting on a job." });
      }
    });
    return true;
  }

  if (request.action === "ensure_content_script") {
    ensureContentScript(request.tabId)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  if (request.action === "ensure_job_listings_script") {
    ensureJobListingsIntegration(request.tabId)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
});

async function handleActionFillAll(request) {
  const resumeData = request?.resumeData;
  const formSchema = request?.formSchema;
  const context = request?.context || {};

  if (!resumeData || !Array.isArray(formSchema)) {
    return {
      ok: false,
      useFallbackStrategy: true,
      error: "Missing resumeData or formSchema."
    };
  }

  const cfg = await new Promise((resolve) => {
    chrome.storage.local.get(["openai_api_key"], resolve);
  });
  const apiKey = cfg?.openai_api_key;
  if (!apiKey) {
    return {
      ok: false,
      useFallbackStrategy: true,
      error: "OpenAI API key missing. Save it in side panel."
    };
  }

  try {
    const prompt = buildFillEverythingPrompt({ resumeData, formSchema, context });
    const content = await callOpenAIJsonPlan(prompt, apiKey);
    const parsed = safeJsonParse(content);
    if (!parsed || typeof parsed !== "object") {
      return {
        ok: false,
        useFallbackStrategy: true,
        error: "OpenAI returned invalid plan JSON."
      };
    }
    return { ok: true, plan: parsed };
  } catch (err) {
    return {
      ok: false,
      useFallbackStrategy: true,
      error: `OpenAI call failed: ${String(err?.message || err)}`
    };
  }
}

function buildFillEverythingPrompt({ resumeData, formSchema, context }) {
  const summary = getResumeSummary(resumeData);
  const highlights = getResumeHighlights(resumeData);
  return `
You are an AI agent that creates a JSON "fill plan" for job application forms.

Goal:
Map candidate resume data to each form field.

Hard requirements:
1) Output ONLY a valid JSON object.
2) Use fieldId values exactly from formSchema.
3) For text/textarea fields: actionType="text", provide valueText.
4) For dropdown/select fields: actionType="select", and valueText MUST exactly match one provided option.
5) For radio fields: actionType="radio", provide choiceIndex (0-based based on options array order).
6) For checkbox fields: actionType="checkbox", provide checked true/false.
7) If uncertain, skip the field (do not hallucinate facts).

Open-ended questions:
- Use candidate SUMMARY and HIGHLIGHTS to draft tailored answers.
- Keep answers concise, professional, and truthful to the resume.

Response JSON format:
{
  "fills": [
    {
      "fieldId": "top::id=email",
      "actionType": "text|select|radio|checkbox",
      "valueText": "example",
      "choiceIndex": 0,
      "checked": true
    }
  ]
}

Context:
${JSON.stringify(context || {}, null, 2)}

Candidate SUMMARY:
${summary || ""}

Candidate HIGHLIGHTS:
${JSON.stringify(highlights, null, 2)}

Resume Data:
${JSON.stringify(resumeData, null, 2)}

Form Schema:
${JSON.stringify(formSchema, null, 2)}
`.trim();
}

function getResumeSummary(resumeData) {
  return (
    resumeData?.basics?.summary ||
    resumeData?.summary ||
    resumeData?.professionalSummary ||
    ""
  );
}

function getResumeHighlights(resumeData) {
  const result = [];
  if (Array.isArray(resumeData?.highlights)) result.push(...resumeData.highlights);
  if (Array.isArray(resumeData?.work)) {
    for (const work of resumeData.work) {
      if (Array.isArray(work?.highlights)) result.push(...work.highlights);
    }
  }
  return result.map((x) => String(x || "").trim()).filter(Boolean).slice(0, 40);
}

async function callOpenAIJsonPlan(prompt, apiKey) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: "gpt-4o",
      response_format: { type: "json_object" },
      temperature: 0.2,
      messages: [
        { role: "system", content: "You generate strict JSON form-fill plans." },
        { role: "user", content: prompt }
      ]
    })
  });

  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${bodyText}`);
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenAI response missing content");
  return content;
}

async function callOpenAIAnswerFromPrompt(prompt) {
  const cfg = await new Promise((resolve) => {
    chrome.storage.local.get(["openai_api_key"], resolve);
  });
  const apiKey = cfg?.openai_api_key;
  if (!apiKey) throw new Error("OpenAI API key missing.");

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: "gpt-4o",
      temperature: 0.4,
      messages: [
        { role: "system", content: "Provide concise professional job-application answers." },
        { role: "user", content: String(prompt || "") }
      ]
    })
  });

  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${bodyText}`);
  }
  const data = await res.json();
  return data?.choices?.[0]?.message?.content || "[No response from OpenAI]";
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch (_) {
    return null;
  }
}

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
    void advanceQueue("submit_timeout", { requireWaiting: true });
  }, queueRuntime.timeoutMs);
}

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
                void advanceQueue("content_unavailable", { requireWaiting: true });
                return;
              }
              scheduleQueueSubmitTimer();
            });
          })
          .catch((err) => {
            console.warn("Queue ensureContentScript failed:", err);
            void advanceQueue("content_unavailable", { requireWaiting: true });
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
  void advanceQueue("submitted", { requireWaiting: true });
}

function handleQueueSkipJob(request, senderTabId) {
  if (!queueRuntime.running) return;
  if (senderTabId !== queueRuntime.tabId) return;
  if (!queueRuntime.waitingForSubmit) return;
  if (request.runId !== queueRuntime.runId) return;
  void advanceQueue("blocked_dom", { requireWaiting: true });
}

async function advanceQueue(reason, options = {}) {
  const allowWithoutWaiting = options.requireWaiting === false;
  if (!queueRuntime.running) return;
  if (!allowWithoutWaiting && !queueRuntime.waitingForSubmit) return;

  clearQueueTimer();
  queueRuntime.waitingForSubmit = false;
  _log(`Queue advance: ${reason}`);
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
    _warn("Queue navigate to next URL failed:", err);
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
      _warn("Queue fallback open window failed:", err2);
    }
  }
}

async function moveNext(reason) {
  return advanceQueue(reason, { requireWaiting: true });
}

function completeQueue() {
  clearQueueTimer();
  _log("Apply queue completed");
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
      _log("Queue hydrated from storage");
    }
    done();
  });
}

async function ensureJobListingsIntegration(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["jobListingsIntegration.js"]
  });
}

async function ensureContentScript(tabId) {
  const files = [
    "resumeProcessor.js",
    "atsStrategies/fieldSynonyms.js",
    "atsStrategies/fieldRegistry.js",
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
  try {
    const res = await fetch("http://localhost:11434/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "llama2",
        prompt: prompt,
        stream: false
      })
    });

    if (!res.ok) {
      return `[Ollama error: HTTP ${res.status}]`;
    }

    const data = await res.json();
    return data?.response || "[No response from Ollama]";
  } catch (err) {
    _warn("callOllama failed:", err);
    return `[Ollama unavailable: ${err.message}]`;
  }
}
