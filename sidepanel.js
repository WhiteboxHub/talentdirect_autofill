document.addEventListener('DOMContentLoaded', () => {
    const resumeInput = document.getElementById('resumeInput');
    const fillFormBtn = document.getElementById('fillFormBtn');
    const applyQueueBtn = document.getElementById('applyQueueBtn');
    const viewResumeBtn = document.getElementById('viewResumeBtn');
    const statusDiv = document.getElementById('status');
    const resumePreview = document.getElementById('resumePreview');
    const resumeContent = document.getElementById('resumeContent');
    const profileSelect = document.getElementById('profileSelect');
    const deleteProfileBtn = document.getElementById('deleteProfileBtn');

    // Summary Panel Elements
    const summaryPanelContainer = document.getElementById('summaryPanelContainer');
    const summaryTableBody = document.getElementById('summaryTableBody');
    const applyEditsBtn = document.getElementById('applyEditsBtn');

    // Custom Answers Elements
    const atsSelector = document.getElementById('atsSelector');
    const customAnswersInput = document.getElementById('customAnswersInput');
    const saveCustomAnswersBtn = document.getElementById('saveCustomAnswersBtn');

    // Keep track of the current tab ID logic executes on 
    let activeTabId = null;
    let customAtsAnswers = {
        Generic: {},
        Greenhouse: {},
        Lever: {},
        Workday: {},
        SuccessFactors: {},
        Adp: {},
        Ashby: {},
        SmartRecruiters: {},
        Icims: {},
        Jobvite: {},
        Taleo: {},
        Workable: {},
        BambooHr: {},
        Paycom: {},
        Paychex: {},
        Ultipro: {},
        Linkedin: {},
        Indeed: {},
        Recruitee: {},
        Teamtailor: {},
        Personio: {},
        OracleCloud: {},
        ApplyToJob: {},
        Brassring: {},
        Rippling: {}
    };

    let savedProfiles = {};
    let activeProfileName = null;

    // First load to initialize the extension. 
    // Data is strictly managed through the single source of truth in local storage.
    chrome.storage.local.get(['resumeData', 'aiEnabled', 'customAtsAnswers', 'savedProfiles', 'activeProfileName', 'normalizedData', 'resumeFile'], (result) => {

        // --- 1. Settings Bootstrapping ---
        if (result.aiEnabled) {
            document.getElementById('aiToggle').checked = true;
        }
        if (result.customAtsAnswers) {
            customAtsAnswers = { ...customAtsAnswers, ...result.customAtsAnswers };
        }
        updateCustomAnswersTextarea();

        // --- 2. Profile Bootstrapping ---
        if (result.savedProfiles) {
            savedProfiles = result.savedProfiles;
        }

        // Migrate a legacy install (single profile) to the new multi-profile structure.
        if (!result.savedProfiles && result.resumeData) {
            const legacyName = "resume (legacy)";
            savedProfiles[legacyName] = {
                resumeData: result.resumeData,
                normalizedData: result.normalizedData,
                resumeFile: result.resumeFile
            };
            activeProfileName = legacyName;

            // Re-save immediately
            chrome.storage.local.set({
                savedProfiles: savedProfiles,
                activeProfileName: activeProfileName
            });
        }
        else if (result.activeProfileName) {
            activeProfileName = result.activeProfileName;
        }

        renderProfileDropdown();
    });

    // Handle ATS Selector Change
    atsSelector.addEventListener('change', () => {
        updateCustomAnswersTextarea();
    });

    // Handle Custom Answers Save
    saveCustomAnswersBtn.addEventListener('click', () => {
        const selectedAts = atsSelector.value;
        const inputText = customAnswersInput.value.trim();

        try {
            if (inputText) {
                const parsedJson = JSON.parse(inputText);
                customAtsAnswers[selectedAts] = parsedJson;
            } else {
                customAtsAnswers[selectedAts] = {};
            }

            chrome.storage.local.set({ customAtsAnswers: customAtsAnswers }, () => {
                showStatus('Custom Answers Saved!', 'success');
            });
        } catch (error) {
            showStatus('Invalid JSON format.', 'error');
            console.error('JSON Parse Error:', error);
        }
    });

    function updateCustomAnswersTextarea() {
        const selectedAts = atsSelector.value;
        const data = customAtsAnswers[selectedAts] || {};
        if (Object.keys(data).length === 0) {
            customAnswersInput.value = '';
        } else {
            customAnswersInput.value = JSON.stringify(data, null, 2);
        }
    }

    // Handle AI Toggle
    document.getElementById('aiToggle').addEventListener('change', (e) => {
        chrome.storage.local.set({ aiEnabled: e.target.checked });
    });

    // Render Profile Dropdown and Swap Storage State
    function renderProfileDropdown() {
        const profileNames = Object.keys(savedProfiles);

        profileSelect.innerHTML = ''; // Clear dropdown

        if (profileNames.length === 0) {
            const option = document.createElement('option');
            option.value = "";
            option.textContent = "No Profiles Found - Please Upload";
            profileSelect.appendChild(option);

            deleteProfileBtn.disabled = true;
            fillFormBtn.disabled = true;
            if (applyQueueBtn) applyQueueBtn.disabled = true;
            viewResumeBtn.disabled = true;

            const resumeFileName = document.getElementById('resumeFileName');
            if (resumeFileName) resumeFileName.textContent = "Upload PDF/DOCX";

            return;
        }

        profileNames.forEach(name => {
            const option = document.createElement('option');
            option.value = name;
            option.textContent = name;
            if (name === activeProfileName) {
                option.selected = true;
            }
            profileSelect.appendChild(option);
        });

        deleteProfileBtn.disabled = false;

        // Force the root storage sync to match the actively selected profile
        syncActiveProfileToRoot();
    }

    // Handles the heavy-lifting of keeping the root keys exactly matching the chosen profile's data. 
    // This allows content.js completely agnostic access without knowing about profiles.
    function syncActiveProfileToRoot() {
        if (!activeProfileName || !savedProfiles[activeProfileName]) return;

        const profileData = savedProfiles[activeProfileName];

        chrome.storage.local.set({
            activeProfileName: activeProfileName,
            resumeData: profileData.resumeData,
            normalizedData: profileData.normalizedData,
            resumeFile: profileData.resumeFile
        }, () => {
            enableButtons();
            showStatus(`Profile "${activeProfileName}" Active`, 'success');
            updatePreview(profileData.resumeData);

            const resumeFileName = document.getElementById('resumeFileName');
            if (resumeFileName) {
                resumeFileName.textContent = profileData.resumeFile
                    ? `File: ${safeFileName(profileData.resumeFile.name)}`
                    : "Upload PDF/DOCX";
            }
        });
    }

    function safeFileName(name) {
        if (!name) return "resume";
        return String(name).replace(/[^\x20-\x7E]/g, "").trim() || "resume";
    }

    // Handle Dropdown Change
    profileSelect.addEventListener('change', (e) => {
        activeProfileName = e.target.value;
        syncActiveProfileToRoot();
    });

    // Handle Profile Deletion
    deleteProfileBtn.addEventListener('click', () => {
        if (activeProfileName && savedProfiles[activeProfileName]) {
            delete savedProfiles[activeProfileName];

            // Pick a new active profile gracefully
            const remainingProfiles = Object.keys(savedProfiles);
            if (remainingProfiles.length > 0) {
                activeProfileName = remainingProfiles[0];
            } else {
                activeProfileName = null;
                // If completely empty, thoroughly flush root keys
                chrome.storage.local.remove(['resumeData', 'normalizedData', 'resumeFile']);
                updatePreview({});
            }

            chrome.storage.local.set({ savedProfiles: savedProfiles }, () => {
                renderProfileDropdown();
            });
        }
    });

    // Handle File Upload (JSON Resume Creation/Overwrite)
    resumeInput.addEventListener('change', (event) => {
        const file = event.target.files[0];
        if (file) {
            // "frontend.json" -> "frontend"
            const newProfileName = file.name.replace(/\.[^/.]+$/, "");

            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const json = JSON.parse(e.target.result);
                    const normalizedData = ResumeProcessor.normalize(json);

                    // Determine if we need to retain an existing DOCX/PDF
                    let retainedFile = null;
                    if (savedProfiles[newProfileName] && savedProfiles[newProfileName].resumeFile) {
                        retainedFile = savedProfiles[newProfileName].resumeFile;
                    }

                    // Save to the index
                    savedProfiles[newProfileName] = {
                        resumeData: json,
                        normalizedData: normalizedData,
                        resumeFile: retainedFile
                    };

                    activeProfileName = newProfileName;

                    chrome.storage.local.set({ savedProfiles: savedProfiles }, () => {
                        renderProfileDropdown(); // Re-renders dropdown and forcibly syncs data to root
                    });

                } catch (error) {
                    showStatus('Error parsing JSON file.', 'error');
                    console.error(error);
                }
            };
            reader.readAsText(file);
        }
    });

    // Handle Resume File Upload (PDF/DOCX)
    const resumeFileInput = document.getElementById('resumeFileInput');

    if (resumeFileInput) {
        resumeFileInput.addEventListener('change', (event) => {
            const file = event.target.files[0];
            if (file) {
                if (!activeProfileName || !savedProfiles[activeProfileName]) {
                    showStatus('Upload a JSON resume first to create a profile!', 'error');
                    return;
                }

                const reader = new FileReader();
                reader.onload = (e) => {
                    const resumeFileData = {
                        data: e.target.result, // base64 data
                        name: file.name,
                        type: file.type,
                        size: file.size
                    };

                    // Append the file specifically to the Active Profile instead of loosely globally.
                    savedProfiles[activeProfileName].resumeFile = resumeFileData;

                    chrome.storage.local.set({ savedProfiles: savedProfiles }, () => {
                        syncActiveProfileToRoot();
                    });
                };
                reader.readAsDataURL(file);
            }
        });
    }

    // Handle manual form fill (Fallback)
    fillFormBtn.addEventListener('click', () => {
        chrome.storage.local.get(['resumeData', 'aiEnabled'], (result) => {
            if (result.resumeData) {
                resolveTargetTab((activeTab) => {
                    if (!activeTab) {
                        showStatus('No active tab found.', 'error');
                        return;
                    }

                    const activeUrl = activeTab.url || '';
                    const normalizedData = ResumeProcessor.normalize(result.resumeData);
                    activeTabId = activeTab.id; // Save tab ID for reporting

                    chrome.tabs.sendMessage(activeTabId, { action: "ping_content" }, () => {
                        if (chrome.runtime.lastError) {
                            if (!/^https?:\/\//i.test(activeUrl)) {
                                showStatus('Open a web page tab (http/https), then click Force Fill.', 'error');
                                return;
                            }

                            chrome.runtime.sendMessage({ action: "ensure_content_script", tabId: activeTabId }, (ensureRes) => {
                                if (chrome.runtime.lastError || !ensureRes || !ensureRes.ok) {
                                    const host = safeHost(activeUrl);
                                    showStatus(`Could not attach on ${host}. Refresh page and retry.`, 'error');
                                    return;
                                }
                                triggerFill(activeTabId, result, normalizedData);
                            });
                            return;
                        }

                        triggerFill(activeTabId, result, normalizedData);
                    });
                });
            } else {
                showStatus('No resume data found.', 'error');
            }
        });
    });

    // Start Apply queue from links visible on the current tab (Job Listings table)
    if (applyQueueBtn) {
        applyQueueBtn.addEventListener('click', () => {
            resolveTargetTab((tab) => {
                if (!tab || !tab.id) {
                    showStatus('No active tab found.', 'error');
                    return;
                }
                chrome.tabs.sendMessage(tab.id, { action: 'collect_and_start_queue' }, (res) => {
                    if (chrome.runtime.lastError) {
                        showStatus('Open your Job Listings page in this window, refresh it, then try again.', 'error');
                        return;
                    }
                    if (!res || !res.ok) {
                        showStatus(res?.error || 'No ATS job links found on this page.', 'error');
                        return;
                    }
                    showStatus(`Queue started: ${res.total} job(s). First job opens in a new window.`, 'success');
                });
            });
        });
    }

    // Listen for fill reports from the content scripts
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === 'fill_report') {
            activeTabId = sender.tab.id;
            renderSummaryTable(request.report);
            sendResponse({ status: 'ok' });
        }
    });

    // Handle "Apply Edits" from the Side Panel
    applyEditsBtn.addEventListener('click', () => {
        const editedData = [];
        const rows = summaryTableBody.querySelectorAll('tr');

        rows.forEach(row => {
            const fieldId = row.dataset.fieldid;
            const input = row.querySelector('.edit-input');
            if (fieldId && input && input.value !== undefined) {
                editedData.push({ id: fieldId, value: input.value });
            }
        });

        if (activeTabId && editedData.length > 0) {
            chrome.tabs.sendMessage(activeTabId, {
                action: 'apply_edits',
                edits: editedData
            }, (response) => {
                showStatus('Edits applied successfully!', 'success');
            });
        }
    });

    function renderSummaryTable(reportData) {
        summaryTableBody.innerHTML = ''; // Clear previous

        if (!reportData || reportData.length === 0) {
            summaryPanelContainer.classList.add('hidden');
            return;
        }

        reportData.forEach(item => {
            const tr = document.createElement('tr');
            tr.dataset.fieldid = item.id;

            // Field Label cell
            const tdLabel = document.createElement('td');
            tdLabel.textContent = item.label.substring(0, 20) + (item.label.length > 20 ? '...' : '');
            tdLabel.title = item.label;

            // Edit Value cell
            const tdValue = document.createElement('td');
            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'edit-input';
            input.value = item.value || '';
            tdValue.appendChild(input);

            // Status Indicator cell
            const tdStatus = document.createElement('td');
            let statusBadge = '';

            if (item.status === 'filled') {
                statusBadge = `<span class="badge badge-green">${item.confidence}%</span>`;
            } else if (item.status === 'low_confidence') {
                statusBadge = `<span class="badge badge-yellow">${item.confidence}%</span>`;
            } else if (item.status === 'unmatched_required') {
                statusBadge = `<span class="badge badge-red">Missed</span>`;
            }

            tdStatus.innerHTML = statusBadge;

            tr.appendChild(tdLabel);
            tr.appendChild(tdValue);
            tr.appendChild(tdStatus);
            summaryTableBody.appendChild(tr);
        });

        summaryPanelContainer.classList.remove('hidden');
    }

    // Toggle Preview
    viewResumeBtn.addEventListener('click', () => {
        resumePreview.classList.toggle('hidden');
        viewResumeBtn.textContent = resumePreview.classList.contains('hidden')
            ? 'View Stored Data'
            : 'Hide Data';
    });

    function showStatus(msg, type) {
        statusDiv.textContent = msg;
        statusDiv.className = `status-message status-${type}`;
        statusDiv.classList.remove('hidden');
        setTimeout(() => {
            statusDiv.classList.add('hidden');
        }, 3000);
    }

    function enableButtons() {
        fillFormBtn.disabled = false;
        if (applyQueueBtn) applyQueueBtn.disabled = false;
        viewResumeBtn.disabled = false;
    }

    function updatePreview(data) {
        const normalized = ResumeProcessor.normalize(data);
        resumeContent.textContent = JSON.stringify({
            _normalized: normalized,
            _raw: data
        }, null, 2);
    }

    function triggerFill(tabId, storageResult, normalizedData) {
        chrome.tabs.sendMessage(tabId, {
            action: "fill_form",
            data: storageResult.resumeData,
            normalizedData: normalizedData,
            aiEnabled: storageResult.aiEnabled || false,
            manual: true
        }, (response) => {
            if (chrome.runtime.lastError) {
                showStatus('Could not start fill on this page. Refresh and retry.', 'error');
            } else if (response && response.status === 'skipped') {
                showStatus(
                    'Force Fill does not run on the Job Listings table. Here, click "Apply now" (with that tab selected). To use Force Fill, switch to a tab that shows the real application form (Greenhouse / Lever / etc.) after you click Apply on the job.',
                    'error'
                );
            } else {
                showStatus('Form filling initiated!', 'success');
            }
        });
    }

    function safeHost(url) {
        try {
            return new URL(url).host || "active tab";
        } catch (_) {
            return "active tab";
        }
    }

    function resolveTargetTab(callback) {
        chrome.runtime.sendMessage({ action: "get_last_ats_tab" }, (bgRes) => {
            const lastAtsTabId = bgRes?.lastAtsContext?.tabId;
            if (lastAtsTabId) {
                chrome.tabs.get(lastAtsTabId, (tab) => {
                    if (!chrome.runtime.lastError && tab && /^https?:\/\//i.test(tab.url || '')) {
                        callback(tab);
                        return;
                    }
                    fallbackResolveTargetTab(callback);
                });
                return;
            }
            fallbackResolveTargetTab(callback);
        });
    }

    function fallbackResolveTargetTab(callback) {
        chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
            if (tabs && tabs.length > 0 && /^https?:\/\//i.test(tabs[0].url || '')) {
                callback(tabs[0]);
                return;
            }

            chrome.tabs.query({ lastFocusedWindow: true }, (allTabs) => {
                const candidate = (allTabs || []).find((t) => t.active && /^https?:\/\//i.test(t.url || ''))
                    || (allTabs || []).find((t) => /^https?:\/\//i.test(t.url || ''));
                callback(candidate || null);
            });
        });
    }
});
