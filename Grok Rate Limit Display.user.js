// ==UserScript==
// @name Grok Rate Limit Display
// @namespace http://tampermonkey.net/
// @version 5.5.5
// @description Displays Grok rate limits with model-aware quota details on grok.com
// @author lqzone, forked from Blankspeaker's Grok Rate Limit Display (originally ported from CursedAtom's Chrome extension)
// @match https://grok.com/*
// @icon https://img.icons8.com/color/1200/grok--v2.jpg
// @license MIT
// @homepageURL https://greasyfork.org/en/scripts/576845-grok-rate-limit-display
// @downloadURL https://update.greasyfork.org/scripts/576845/Grok%20Rate%20Limit%20Display.user.js
// @updateURL https://update.greasyfork.org/scripts/576845/Grok%20Rate%20Limit%20Display.meta.js
// ==/UserScript==

// ==UserScript==
// @name Grok Rate Limit Display
// @namespace http://tampermonkey.net/
// @version      5.5.5
// @description Displays Grok rate limits with model-aware quota details on grok.com
// @author lqzone, forked from Blankspeaker's Grok Rate Limit Display (originally ported from CursedAtom's Chrome extension)
// @match https://grok.com/*
// @icon https://img.icons8.com/color/1200/grok--v2.jpg
// @license MIT
// @homepageURL https://greasyfork.org/en/scripts/576845-grok-rate-limit-display
// ==/UserScript==

(function () {
    'use strict';

    console.log('Grok Rate Limit Script loaded');

    let lastHigh = { remaining: null, wait: null };
    let lastLow = { remaining: null, wait: null };
    let lastBoth = { high: null, low: null, wait: null };

    const MODEL_MAP = {
        "Grok 4.3 (beta)": "grok-420-computer-use-sa",
        "Grok 4.20 (Beta)": "grok-420",
        "Grok 420": "grok-420",
        "Grok 4": "grok-4",
        "Grok 3": "grok-3",
        "Grok 4 Heavy": "grok-4-heavy",
        "Grok 4 With Effort Decider": "grok-4-auto",
        "Auto": "grok-4-auto",
        "Fast": "grok-3",
        "Expert": "grok-4",
        "Heavy": "grok-4-heavy",
        "Grok 4 Fast": "grok-4-mini-thinking-tahoe",
        "Grok 4.1": "grok-4-1-non-thinking-w-tool",
        "Grok 4.1 Thinking": "grok-4-1-thinking-1129",
        "Grok 2": "grok-2",
        "Grok 2 Mini": "grok-2-mini",
    };

    const DEFAULT_MODEL = "grok-3";
    const DEFAULT_KIND = "DEFAULT";
    const POLL_INTERVAL_MS = 30000;
    const MODEL_SELECTOR = "button[aria-label='Model select']";
    const MODEL_SELECT_ARIA_LABELS = new Set(["Model select", "模型选择"]);
    const QUERY_BAR_SELECTOR = ".query-bar";
    const ELEMENT_WAIT_TIMEOUT_MS = 5000;
    const COMPACT_QUERY_BAR_WIDTH_PX = 560;

    const RATE_LIMIT_CONTAINER_ID = "grok-rate-limit";

    const cachedRateLimits = {};

    let countdownTimer = null;
    let isCountingDown = false;
    let lastQueryBar = null;
    let lastModelObserver = null;
    let lastThinkObserver = null;
    let lastSearchObserver = null;
    let lastInputElement = null;
    let lastSubmitButton = null;
    let pollInterval = null;
    let lastModelName = null;
    let tooltipElement = null;

    const commonFinderConfigs = {
        thinkButton: {
            selector: "button",
            ariaLabel: "Think",
            svgPartialD: "M19 9C19 12.866",
        },
        deepSearchButton: {
            selector: "button",
            ariaLabelRegex: /Deep(er)?Search/i,
        },
        attachButton: {
            selector: "button",
            classContains: ["group/attach-button"],
            // svgPartialD можно оставить или удалить — classContains достаточно
        },
        submitButton: {
            selector: "button",
            svgPartialD: "M6 11L12 5M12 5L18 11M12 5V19",
        }
    };

    // Function to check if current page is under /imagine
    function isImaginePage() {
        return window.location.pathname.startsWith('/imagine');
    }

    // Debounce function
    function debounce(func, delay) {
        let timeout;
        return (...args) => {
            clearTimeout(timeout);
            timeout = setTimeout(() => func(...args), delay);
        };
    }

    // Function to find element based on config (OR logic for conditions)
    function findElement(config, root = document) {
        const elements = root.querySelectorAll(config.selector);
        for (const el of elements) {
            let satisfied = 0;

            if (config.ariaLabel) {
                if (el.getAttribute('aria-label') === config.ariaLabel) satisfied++;
            }

            if (config.ariaLabelRegex) {
                const aria = el.getAttribute('aria-label');
                if (aria && config.ariaLabelRegex.test(aria)) satisfied++;
            }

            if (config.svgPartialD) {
                const path = el.querySelector('path');
                if (path && path.getAttribute('d')?.includes(config.svgPartialD)) satisfied++;
            }

            if (config.classContains) {
                if (config.classContains.some(cls => el.classList.contains(cls))) satisfied++;
            }

            if (satisfied > 0) {
                return el;
            }
        }
        return null;
    }

    // Function to wait for element based on config
    function waitForElementByConfig(config, timeout = ELEMENT_WAIT_TIMEOUT_MS, root = document) {
        return new Promise((resolve) => {
            let element = findElement(config, root);
            if (element) {
                resolve(element);
                return;
            }

            const observer = new MutationObserver(() => {
                element = findElement(config, root);
                if (element) {
                    observer.disconnect();
                    resolve(element);
                }
            });

            observer.observe(root, { childList: true, subtree: true, attributes: true });

            setTimeout(() => {
                observer.disconnect();
                resolve(null);
            }, timeout);
        });
    }

    // Function to format timer for display (H:MM:SS or MM:SS)
    function formatTimer(seconds) {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;
        if (hours > 0) {
            return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        } else {
            return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        }
    }

    // Function to wait for element appearance
    function waitForElement(selector, timeout = ELEMENT_WAIT_TIMEOUT_MS, root = document) {
        return new Promise((resolve) => {
            let element = root.querySelector(selector);
            if (element) {
                resolve(element);
                return;
            }

            const observer = new MutationObserver(() => {
                element = root.querySelector(selector);
                if (element) {
                    observer.disconnect();
                    resolve(element);
                }
            });

            observer.observe(root, { childList: true, subtree: true });

            setTimeout(() => {
                observer.disconnect();
                resolve(null);
            }, timeout);
        });
    }

    // Function to remove any existing rate limit display
    function removeExistingRateLimit() {
        const existing = document.getElementById(RATE_LIMIT_CONTAINER_ID);
        if (existing) {
            hideRateLimitTooltip();
            existing.remove();
        }
    }

    function findModelButton(queryBar) {
        const directMatch = queryBar.querySelector(MODEL_SELECTOR);
        if (directMatch) return directMatch;

        const buttons = Array.from(queryBar.querySelectorAll('button'));
        return buttons.find(button => MODEL_SELECT_ARIA_LABELS.has(button.getAttribute('aria-label'))) || null;
    }

    // Function to determine model key from SVG or text
    function getCurrentModelKey(queryBar) {
        const modelButton = findModelButton(queryBar);
        if (!modelButton) return DEFAULT_MODEL;

        // Check for text span first (updated selector for new UI)
        const textElement = modelButton.querySelector('span.font-semibold');
        if (textElement) {
            const modelText = textElement.textContent.trim();
            return MODEL_MAP[modelText] || DEFAULT_MODEL;
        }

        // Fallback to old chooser text span
        const oldTextElement = modelButton.querySelector('span.inline-block');
        if (oldTextElement) {
            const modelText = oldTextElement.textContent.trim();
            return MODEL_MAP[modelText] || DEFAULT_MODEL;
        }

        // New chooser: check SVG icon
        const svg = modelButton.querySelector('svg');
        if (svg) {
            const pathsD = Array.from(svg.querySelectorAll('path'))
                .map(p => p.getAttribute('d') || '')
                .filter(d => d.length > 0)
                .join(' ');

            const hasBrainFill = svg.querySelector('path[class*="fill-yellow-100"]') !== null;

            if (pathsD.includes('M6.5 12.5L11.5 17.5')) {
                return 'grok-4-auto'; // Auto
            } else if (pathsD.includes('M5 14.25L14 4')) {
                return 'grok-3'; // Fast
            } else if (hasBrainFill || pathsD.includes('M19 9C19 12.866')) {
                return 'grok-4'; // Expert
            } else if (pathsD.includes('M12 3a6 6 0 0 0 9 9')) {
                return 'grok-4-mini-thinking-tahoe'; // Grok 4 Fast
            } else if (pathsD.includes('M11 18H10C7.79086 18 6 16.2091 6 14V13')) {
                return 'grok-4-heavy'; // Heavy
            }
        }

        return DEFAULT_MODEL;
    }

    // Function to determine effort level based on model
    function getEffortLevel(modelName) {
        if (modelName === 'grok-4-auto') {
            return 'both';
        } else if (modelName === 'grok-3' || modelName === 'grok-4-1-non-thinking-w-tool') {
            return 'low';
        } else if (modelName === 'grok-4-1-thinking-1129') {
            return 'high';
        } else if (modelName === 'grok-420' || modelName === 'grok-420-computer-use-sa') {
            return 'high';
        } else {
            return 'high';
        }
    }

    // Function to update or inject the rate limit display
    function updateRateLimitDisplay(queryBar, response, effort, modelName = lastModelName) {
        if (isImaginePage()) {
            removeExistingRateLimit();
            return;
        }

        let rateLimitContainer = document.getElementById(RATE_LIMIT_CONTAINER_ID);

        if (!rateLimitContainer) {
            rateLimitContainer = document.createElement('div');
            rateLimitContainer.id = RATE_LIMIT_CONTAINER_ID;
            rateLimitContainer.className = 'inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-60 disabled:cursor-not-allowed [&_svg]:duration-100 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg]:-mx-0.5 select-none text-fg-primary hover:bg-button-ghost-hover hover:border-border-l2 disabled:hover:bg-transparent h-10 px-3.5 py-2 text-sm rounded-full group/rate-limit transition-colors duration-100 relative overflow-hidden border border-transparent cursor-pointer';
            rateLimitContainer.style.opacity = '0.8';
            rateLimitContainer.style.transition = 'opacity 0.1s ease-in-out';
            rateLimitContainer.style.zIndex = '20';

            rateLimitContainer.addEventListener('click', () => {
                console.log('Rate limit display clicked - refreshing');
                fetchAndUpdateRateLimit(queryBar, true);
            });
            rateLimitContainer.addEventListener('mouseenter', () => {
                showRateLimitTooltip(rateLimitContainer);
            });
            rateLimitContainer.addEventListener('mouseleave', hideRateLimitTooltip);

            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('width', '18');
            svg.setAttribute('height', '18');
            svg.setAttribute('viewBox', '0 0 24 24');
            svg.setAttribute('fill', 'none');
            svg.setAttribute('stroke', 'currentColor');
            svg.setAttribute('stroke-width', '2');
            svg.setAttribute('stroke-linecap', 'round');
            svg.setAttribute('stroke-linejoin', 'round');
            svg.setAttribute('class', 'lucide lucide-gauge stroke-[2] text-fg-secondary transition-colors duration-100');
            svg.setAttribute('aria-hidden', 'true');

            const contentDiv = document.createElement('div');
            contentDiv.className = 'flex items-center';
            contentDiv.dataset.rateLimitContent = 'true';

            rateLimitContainer.appendChild(svg);
            rateLimitContainer.appendChild(contentDiv);

            // Теперь вставляем уже созданный контейнер справа от кнопки "Отправить"
            // Ищем правый контейнер с кнопками (модель, голосовая, вставка кода, отправить)
            const toolsContainer = queryBar.querySelector('div.ms-auto.flex.flex-row.items-end.gap-1');

            if (toolsContainer) {
                // Вставляем счётчик самым первым (слева от кнопки выбора модели)
                toolsContainer.prepend(rateLimitContainer);
            } else {
                // Fallback: если контейнер не найден, вставляем в конец bottomBar
                const bottomBar = queryBar.querySelector('div.absolute.inset-x-0.bottom-0');
                if (bottomBar) {
                    bottomBar.appendChild(rateLimitContainer);
                } else {
                    rateLimitContainer.remove();
                    rateLimitContainer = null;
                    return;
                }
            }

            // Отступ снизу для поля ввода (чтобы счётчик не перекрывал текст)
            const contentEditable = queryBar.querySelector('div[contenteditable="true"]');
            if (contentEditable) {
                contentEditable.style.paddingBottom = '3rem';
            }
        }

        const contentDiv = rateLimitContainer.lastChild;
        const svg = rateLimitContainer.querySelector('svg');

        contentDiv.innerHTML = '';

        const isBoth = effort === 'both';
        rateLimitContainer.removeAttribute('title');

        if (response.error) {
            if (isBoth) {
                if (lastBoth.high !== null && lastBoth.low !== null) {
                    appendNumberSpan(contentDiv, formatQuotaText(lastBoth.high, lastBoth.highTotal), '');
                    appendDivider(contentDiv);
                    appendNumberSpan(contentDiv, formatQuotaText(lastBoth.low, lastBoth.lowTotal), '');
                    setTooltipRows(rateLimitContainer, buildTooltipRows({
                        response: {
                            highRemaining: lastBoth.high,
                            highTotal: lastBoth.highTotal,
                            highWaitTimeSeconds: lastBoth.highWait,
                            lowRemaining: lastBoth.low,
                            lowTotal: lastBoth.lowTotal,
                            lowWaitTimeSeconds: lastBoth.lowWait,
                            waitTimeSeconds: lastBoth.wait,
                        },
                        effort,
                        modelName,
                    }));
                    rateLimitContainer.dataset.tooltipText = formatBothTitle({
                        highRemaining: lastBoth.high,
                        highTotal: lastBoth.highTotal,
                        highWaitTimeSeconds: lastBoth.highWait,
                        lowRemaining: lastBoth.low,
                        lowTotal: lastBoth.lowTotal,
                        lowWaitTimeSeconds: lastBoth.lowWait,
                        waitTimeSeconds: lastBoth.wait,
                    });
                    setGaugeSVG(svg);
                } else {
                    appendNumberSpan(contentDiv, 'Unavailable', '');
                    setTooltipRows(rateLimitContainer, [
                        ['Quota', 'Unavailable'],
                        ['Model', modelName || 'Unknown'],
                        ['Reset', 'Unavailable'],
                    ]);
                    setGaugeSVG(svg);
                }
            } else {
                const lastForEffort = (effort === 'high') ? lastHigh : lastLow;
                if (lastForEffort.remaining !== null) {
                    appendNumberSpan(contentDiv, formatQuotaText(lastForEffort.remaining, lastForEffort.total), '');
                    setTooltipRows(rateLimitContainer, buildTooltipRows({
                        response: {
                            remainingQueries: lastForEffort.remaining,
                            totalQueries: lastForEffort.total,
                            waitTimeSeconds: lastForEffort.wait,
                        },
                        effort,
                        modelName,
                    }));
                    setGaugeSVG(svg);
                } else {
                    appendNumberSpan(contentDiv, 'Unavailable', '');
                    setTooltipRows(rateLimitContainer, [
                        ['Quota', 'Unavailable'],
                        ['Model', modelName || 'Unknown'],
                        ['Reset', 'Unavailable'],
                    ]);
                    setGaugeSVG(svg);
                }
            }
        } else {
            if (countdownTimer) {
                clearInterval(countdownTimer);
                countdownTimer = null;
            }

            if (isBoth) {
                lastBoth.high = response.highRemaining;
                lastBoth.highTotal = response.highTotal;
                lastBoth.highWait = response.highWaitTimeSeconds;
                lastBoth.low = response.lowRemaining;
                lastBoth.lowTotal = response.lowTotal;
                lastBoth.lowWait = response.lowWaitTimeSeconds;
                lastBoth.wait = response.waitTimeSeconds;

                const high = lastBoth.high;
                const highTotal = lastBoth.highTotal;
                const low = lastBoth.low;
                const lowTotal = lastBoth.lowTotal;
                const waitTimeSeconds = lastBoth.wait;

                let currentCountdown = waitTimeSeconds;

                if (high > 0) {
                    appendNumberSpan(contentDiv, formatQuotaText(high, highTotal), '');
                    appendDivider(contentDiv);
                    appendNumberSpan(contentDiv, formatQuotaText(low, lowTotal), '');
                    setTooltipRows(rateLimitContainer, buildTooltipRows({ response, effort, modelName }));
                    setGaugeSVG(svg);
                } else if (waitTimeSeconds > 0) {
                    const timerSpan = appendNumberSpan(contentDiv, formatTimer(currentCountdown), '#ff6347');
                    appendDivider(contentDiv);
                    appendNumberSpan(contentDiv, formatQuotaText(low, lowTotal), '');
                    setTooltipRows(rateLimitContainer, buildTooltipRows({ response, effort, modelName }));
                    setClockSVG(svg);

                    isCountingDown = true;
                    if (pollInterval) {
                        clearInterval(pollInterval);
                        pollInterval = null;
                    }

                    countdownTimer = setInterval(() => {
                        currentCountdown--;
                        if (currentCountdown <= 0) {
                            clearInterval(countdownTimer);
                            countdownTimer = null;
                            fetchAndUpdateRateLimit(queryBar, true);
                            isCountingDown = false;
                            if (document.visibilityState === 'visible' && lastQueryBar) {
                                pollInterval = setInterval(() => fetchAndUpdateRateLimit(lastQueryBar, true), POLL_INTERVAL_MS);
                            }
                        } else {
                            timerSpan.textContent = formatTimer(currentCountdown);
                        }
                    }, 1000);
                } else {
                    appendNumberSpan(contentDiv, formatQuotaText('0', highTotal), '#ff6347');
                    appendDivider(contentDiv);
                    appendNumberSpan(contentDiv, formatQuotaText(low, lowTotal), '');
                    setTooltipRows(rateLimitContainer, buildTooltipRows({ response, effort, modelName }));
                    setGaugeSVG(svg);
                }
            } else {
                const lastForEffort = (effort === 'high') ? lastHigh : lastLow;
                lastForEffort.remaining = response.remainingQueries;
                lastForEffort.total = response.totalQueries;
                lastForEffort.wait = response.waitTimeSeconds;

                const remaining = lastForEffort.remaining;
                const total = lastForEffort.total;
                const waitTimeSeconds = lastForEffort.wait;

                let currentCountdown = waitTimeSeconds;

                if (remaining > 0) {
                    appendNumberSpan(contentDiv, formatQuotaText(remaining, total), '');
                    setTooltipRows(rateLimitContainer, buildTooltipRows({ response, effort, modelName }));
                    setGaugeSVG(svg);
                } else if (waitTimeSeconds > 0) {
                    const timerSpan = appendNumberSpan(contentDiv, formatTimer(currentCountdown), '#ff6347');
                    setTooltipRows(rateLimitContainer, buildTooltipRows({ response, effort, modelName }));
                    setClockSVG(svg);

                    isCountingDown = true;
                    if (pollInterval) {
                        clearInterval(pollInterval);
                        pollInterval = null;
                    }

                    countdownTimer = setInterval(() => {
                        currentCountdown--;
                        if (currentCountdown <= 0) {
                            clearInterval(countdownTimer);
                            countdownTimer = null;
                            fetchAndUpdateRateLimit(queryBar, true);
                            isCountingDown = false;
                            if (document.visibilityState === 'visible' && lastQueryBar) {
                                pollInterval = setInterval(() => fetchAndUpdateRateLimit(lastQueryBar, true), POLL_INTERVAL_MS);
                            }
                        } else {
                            timerSpan.textContent = formatTimer(currentCountdown);
                        }
                    }, 1000);
                } else {
                    appendNumberSpan(contentDiv, formatQuotaText('0', total), ' #ff6347');
                    setTooltipRows(rateLimitContainer, buildTooltipRows({ response, effort, modelName }));
                    setGaugeSVG(svg);
                }
            }
        }

        applyRateLimitCompactState(queryBar, rateLimitContainer);
    }

    function getRateLimitTotal(rateLimit) {
        if (!rateLimit) return undefined;

        const directTotal = rateLimit.totalQueries
            ?? rateLimit.maxQueries
            ?? rateLimit.limit
            ?? rateLimit.queryLimit
            ?? rateLimit.quotaLimit
            ?? rateLimit.maxRequests
            ?? rateLimit.total;

        if (directTotal !== undefined) {
            return directTotal;
        }

        const remaining = rateLimit.remainingQueries;
        const used = rateLimit.usedQueries ?? rateLimit.used;
        if (remaining !== undefined && used !== undefined) {
            return remaining + used;
        }

        return undefined;
    }

    function getRateLimitWaitTime(rateLimit) {
        if (!rateLimit) return 0;

        const directSeconds = rateLimit.waitTimeSeconds
            ?? rateLimit.resetAfterSeconds
            ?? rateLimit.retryAfterSeconds
            ?? rateLimit.windowSizeSeconds
            ?? rateLimit.secondsUntilReset
            ?? rateLimit.timeUntilResetSeconds;

        if (Number.isFinite(directSeconds) && directSeconds > 0) {
            return directSeconds;
        }

        const resetAt = rateLimit.resetTime
            ?? rateLimit.resetAt
            ?? rateLimit.resetsAt
            ?? rateLimit.resetTimestamp
            ?? rateLimit.nextResetAt
            ?? rateLimit.nextResetTime;

        if (resetAt === undefined || resetAt === null) {
            return 0;
        }

        let resetMs = NaN;
        if (typeof resetAt === 'number') {
            resetMs = resetAt > 1000000000000 ? resetAt : resetAt * 1000;
        } else if (typeof resetAt === 'string') {
            const numericReset = Number(resetAt);
            if (Number.isFinite(numericReset)) {
                resetMs = numericReset > 1000000000000 ? numericReset : numericReset * 1000;
            } else {
                resetMs = Date.parse(resetAt);
            }
        }

        if (!Number.isFinite(resetMs)) {
            return 0;
        }

        return Math.max(0, Math.ceil((resetMs - Date.now()) / 1000));
    }

    function formatQuotaText(remaining, total) {
        if (total === undefined || total === null) {
            return `${remaining}`;
        }
        return `${remaining}/${total}`;
    }

    function formatResetTime(waitTimeSeconds) {
        if (!waitTimeSeconds || waitTimeSeconds <= 0) {
            return '';
        }

        const totalMinutes = Math.ceil(waitTimeSeconds / 60);
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;

        if (hours > 0 && minutes > 0) {
            return `${hours}h ${minutes.toString().padStart(2, '0')}m`;
        }
        if (hours > 0) {
            return `${hours}h`;
        }
        return `${minutes}m`;
    }

    function formatSingleTitle(response) {
        const quota = formatQuotaText(response.remainingQueries, response.totalQueries);
        const reset = formatResetTime(response.waitTimeSeconds);
        return reset ? `${quota} queries remaining. Resets in ${reset}` : `${quota} queries remaining`;
    }

    function formatBothTitle(response) {
        const highQuota = formatQuotaText(response.highRemaining, response.highTotal);
        const lowQuota = formatQuotaText(response.lowRemaining, response.lowTotal);
        const highReset = formatResetTime(response.highWaitTimeSeconds ?? response.waitTimeSeconds);
        const lowReset = formatResetTime(response.lowWaitTimeSeconds ?? response.waitTimeSeconds);

        const highText = highReset ? `High: ${highQuota}, resets in ${highReset}` : `High: ${highQuota}`;
        const lowText = lowReset ? `Low: ${lowQuota}, resets in ${lowReset}` : `Low: ${lowQuota}`;
        return `${highText} | ${lowText}`;
    }

    function buildTooltipRows({ response, effort, modelName }) {
        if (response.error) {
            return [
                ['Quota', 'Unavailable'],
                ['Model', modelName || 'Unknown'],
                ['Reset', 'Unavailable'],
            ];
        }

        if (effort === 'both' && response.highRemaining !== undefined && response.lowRemaining !== undefined) {
            const highQuota = formatQuotaText(response.highRemaining, response.highTotal);
            const lowQuota = formatQuotaText(response.lowRemaining, response.lowTotal);
            const highReset = formatResetTime(response.highWaitTimeSeconds ?? response.waitTimeSeconds);
            const lowReset = formatResetTime(response.lowWaitTimeSeconds ?? response.waitTimeSeconds);

            return [
                ['Quota', `High ${highQuota} | Low ${lowQuota}`],
                ['Model', modelName || 'Unknown'],
                ['Reset', `High ${highReset || 'Unavailable'} | Low ${lowReset || 'Unavailable'}`],
            ];
        }

        return [
            ['Quota', formatQuotaText(response.remainingQueries, response.totalQueries)],
            ['Model', modelName || 'Unknown'],
            ['Reset', formatResetTime(response.waitTimeSeconds) || 'Unavailable'],
        ];
    }

    function getInputText(queryBar) {
        const inputElement = queryBar?.querySelector?.('div[contenteditable="true"]');
        return inputElement?.textContent || '';
    }

    function shouldUseCompactRateLimitDisplay({
        inputText,
        queryBarWidth,
        compactWidth = COMPACT_QUERY_BAR_WIDTH_PX,
    }) {
        if ((inputText || '').trim().length > 0) {
            return true;
        }
        return Number.isFinite(queryBarWidth) && queryBarWidth > 0 && queryBarWidth < compactWidth;
    }

    function applyRateLimitCompactState(queryBar, rateLimitContainer = document.getElementById(RATE_LIMIT_CONTAINER_ID)) {
        if (!queryBar || !rateLimitContainer) return;

        const contentDiv = rateLimitContainer.querySelector('[data-rate-limit-content="true"]');
        if (!contentDiv) return;

        const queryBarWidth = queryBar.getBoundingClientRect?.().width || 0;
        const compact = shouldUseCompactRateLimitDisplay({
            inputText: getInputText(queryBar),
            queryBarWidth,
        });

        contentDiv.style.display = compact ? 'none' : '';
        rateLimitContainer.style.gap = compact ? '0' : '';
        rateLimitContainer.style.paddingLeft = compact ? '0.75rem' : '';
        rateLimitContainer.style.paddingRight = compact ? '0.75rem' : '';
        rateLimitContainer.dataset.compact = compact ? 'true' : 'false';
        rateLimitContainer.setAttribute('aria-label', compact ? 'Grok quota details' : 'Grok quota');
    }

    function setTooltipRows(container, rows) {
        container.__grokRateLimitTooltipRows = rows;
        if (tooltipElement && tooltipElement.dataset.ownerId === RATE_LIMIT_CONTAINER_ID) {
            renderTooltipRows(rows);
            positionTooltip(container);
        }
    }

    function ensureTooltipElement() {
        if (tooltipElement) {
            return tooltipElement;
        }

        tooltipElement = document.createElement('div');
        tooltipElement.dataset.ownerId = RATE_LIMIT_CONTAINER_ID;
        tooltipElement.style.position = 'fixed';
        tooltipElement.style.zIndex = '2147483647';
        tooltipElement.style.display = 'none';
        tooltipElement.style.padding = '8px 10px';
        tooltipElement.style.border = '1px solid rgba(0, 0, 0, 0.14)';
        tooltipElement.style.borderRadius = '6px';
        tooltipElement.style.background = 'rgba(255, 255, 255, 0.98)';
        tooltipElement.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.14)';
        tooltipElement.style.color = '#3f3f46';
        tooltipElement.style.fontSize = '13px';
        tooltipElement.style.lineHeight = '1.45';
        tooltipElement.style.whiteSpace = 'nowrap';
        tooltipElement.style.pointerEvents = 'none';
        document.body.appendChild(tooltipElement);
        return tooltipElement;
    }

    function renderTooltipRows(rows) {
        const tooltip = ensureTooltipElement();
        tooltip.innerHTML = '';

        for (const [label, value] of rows) {
            const row = document.createElement('div');
            row.style.display = 'grid';
            row.style.gridTemplateColumns = '4em auto';
            row.style.columnGap = '10px';
            row.style.alignItems = 'baseline';

            const labelSpan = document.createElement('span');
            labelSpan.textContent = label;
            labelSpan.style.color = '#71717a';

            const valueSpan = document.createElement('span');
            valueSpan.textContent = value;
            valueSpan.style.color = '#27272a';

            row.appendChild(labelSpan);
            row.appendChild(valueSpan);
            tooltip.appendChild(row);
        }
    }

    function computeTooltipPosition({
        anchorRect,
        tooltipRect,
        viewportWidth,
        viewportHeight,
        spacing = 8,
    }) {
        const maxLeft = Math.max(spacing, viewportWidth - tooltipRect.width - spacing);
        const left = Math.min(
            Math.max(spacing, anchorRect.left + (anchorRect.width - tooltipRect.width) / 2),
            maxLeft
        );

        const belowTop = anchorRect.bottom + spacing;
        const aboveTop = anchorRect.top - tooltipRect.height - spacing;
        const fitsBelow = belowTop + tooltipRect.height <= viewportHeight - spacing;
        const fitsAbove = aboveTop >= spacing;

        let top;
        if (fitsBelow) {
            top = belowTop;
        } else if (fitsAbove) {
            top = aboveTop;
        } else {
            top = Math.min(
                Math.max(spacing, belowTop),
                Math.max(spacing, viewportHeight - tooltipRect.height - spacing)
            );
        }

        return {
            left: Math.round(left),
            top: Math.round(top),
        };
    }

    function positionTooltip(anchor) {
        const tooltip = ensureTooltipElement();
        const position = computeTooltipPosition({
            anchorRect: anchor.getBoundingClientRect(),
            tooltipRect: tooltip.getBoundingClientRect(),
            viewportWidth: window.innerWidth,
            viewportHeight: window.innerHeight,
            spacing: 8,
        });

        tooltip.style.left = `${position.left}px`;
        tooltip.style.top = `${position.top}px`;
    }

    function showRateLimitTooltip(anchor) {
        const rows = anchor.__grokRateLimitTooltipRows || [
            ['Quota', 'Unavailable'],
            ['Model', lastModelName || 'Unknown'],
            ['Reset', 'Unavailable'],
        ];
        renderTooltipRows(rows);
        const tooltip = ensureTooltipElement();
        tooltip.style.display = 'block';
        positionTooltip(anchor);
    }

    function hideRateLimitTooltip() {
        if (tooltipElement) {
            tooltipElement.style.display = 'none';
        }
    }

    function appendNumberSpan(parent, text, color) {
        const span = document.createElement('span');
        span.textContent = text;
        if (color) span.style.color = color;
        parent.appendChild(span);
        return span;
    }

    function appendDivider(parent) {
        const divider = document.createElement('div');
        divider.className = 'h-6 w-[2px] bg-border-l2 mx-1';
        parent.appendChild(divider);
    }

    function setGaugeSVG(svg) {
        if (svg) {
            while (svg.firstChild) {
                svg.removeChild(svg.firstChild);
            }
            const path1 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path1.setAttribute('d', 'm12 14 4-4');
            const path2 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path2.setAttribute('d', 'M3.34 19a10 10 0 1 1 17.32 0');
            svg.appendChild(path1);
            svg.appendChild(path2);
            svg.setAttribute('class', 'lucide lucide-gauge stroke-[2] text-fg-secondary transition-colors duration-100');
        }
    }

    function setClockSVG(svg) {
        if (svg) {
            while (svg.firstChild) {
                svg.removeChild(svg.firstChild);
            }
            const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            circle.setAttribute('cx', '12');
            circle.setAttribute('cy', '12');
            circle.setAttribute('r', '8');
            circle.setAttribute('stroke', 'currentColor');
            circle.setAttribute('stroke-width', '2');
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', 'M12 12L12 6');
            path.setAttribute('stroke', 'currentColor');
            path.setAttribute('stroke-width', '2');
            path.setAttribute('stroke-linecap', 'round');
            svg.appendChild(circle);
            svg.appendChild(path);
            svg.setAttribute('class', 'stroke-[2] text-fg-secondary group-hover/rate-limit:text-fg-primary transition-colors duration-100');
        }
    }

    // Function to fetch rate limit
    async function fetchRateLimit(modelName, requestKind, force = false) {
        // Removed force to grok-3; use actual modelName for specific models like grok-4-heavy

        if (!force) {
            const cached = cachedRateLimits[modelName]?.[requestKind];
            if (cached !== undefined) {
                return cached;
            }
        }

        try {
            const response = await fetch(window.location.origin + '/rest/rate-limits', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    requestKind,
                    modelName,
                }),
                credentials: 'include',
            });

            if (!response.ok) {
                throw new Error(`HTTP error: Status ${response.status}`);
            }

            const data = await response.json();
            if (!cachedRateLimits[modelName]) {
                cachedRateLimits[modelName] = {};
            }
            cachedRateLimits[modelName][requestKind] = data;
            return data;
        } catch (error) {
            console.error(`Failed to fetch rate limit:`, error);
            if (!cachedRateLimits[modelName]) {
                cachedRateLimits[modelName] = {};
            }
            cachedRateLimits[modelName][requestKind] = undefined;
            return { error: true };
        }
    }

    // Function to process the rate limit data based on effort level
    function processRateLimitData(data, effortLevel) {
        if (data.error) {
            return data;
        }

        if (effortLevel === 'both') {
            const highRateLimits = data.highEffortRateLimits;
            const lowRateLimits = data.lowEffortRateLimits;
            const high = highRateLimits?.remainingQueries;
            const low = lowRateLimits?.remainingQueries;
            const highWaitTimeSeconds = getRateLimitWaitTime(highRateLimits) || getRateLimitWaitTime(data);
            const lowWaitTimeSeconds = getRateLimitWaitTime(lowRateLimits) || getRateLimitWaitTime(data);
            const waitTimeSeconds = Math.max(
                highWaitTimeSeconds,
                lowWaitTimeSeconds,
                getRateLimitWaitTime(data)
            );
            if (high !== undefined && low !== undefined) {
                return {
                    highRemaining: high,
                    highTotal: getRateLimitTotal(highRateLimits),
                    highWaitTimeSeconds,
                    lowRemaining: low,
                    lowTotal: getRateLimitTotal(lowRateLimits),
                    lowWaitTimeSeconds,
                    waitTimeSeconds: waitTimeSeconds
                };
            } else if (high !== undefined) {
                return {
                    remainingQueries: high,
                    totalQueries: getRateLimitTotal(highRateLimits),
                    waitTimeSeconds: highWaitTimeSeconds,
                };
            } else if (low !== undefined) {
                return {
                    remainingQueries: low,
                    totalQueries: getRateLimitTotal(lowRateLimits),
                    waitTimeSeconds: lowWaitTimeSeconds,
                };
            } else if (data.remainingQueries !== undefined) {
                return {
                    remainingQueries: data.remainingQueries,
                    totalQueries: getRateLimitTotal(data),
                    waitTimeSeconds: getRateLimitWaitTime(data),
                };
            } else {
                return { error: true };
            }
        } else {
            let rateLimitsKey = effortLevel === 'high' ? 'highEffortRateLimits' : 'lowEffortRateLimits';
            const effortRateLimits = data[rateLimitsKey];
            let remaining = effortRateLimits?.remainingQueries;
            let total = getRateLimitTotal(effortRateLimits);
            if (remaining === undefined) {
                remaining = data.remainingQueries;
                total = getRateLimitTotal(data);
            }
            if (remaining !== undefined) {
                return {
                    remainingQueries: remaining,
                    totalQueries: total,
                    waitTimeSeconds: getRateLimitWaitTime(effortRateLimits) || getRateLimitWaitTime(data)
                };
            } else {
                return { error: true };
            }
        }
    }

    // Function to fetch and update rate limit
    async function fetchAndUpdateRateLimit(queryBar, force = false) {
        if (isImaginePage() || !queryBar || !document.body.contains(queryBar)) {
            return;
        }
        const modelName = getCurrentModelKey(queryBar);

        if (modelName !== lastModelName) {
            force = true;
        }

        if (isCountingDown && !force) {
            return;
        }

        const effortLevel = getEffortLevel(modelName);

        let requestKind = DEFAULT_KIND;
        if (modelName === 'grok-3') {
            const thinkButton = findElement(commonFinderConfigs.thinkButton, queryBar);
            const searchButton = findElement(commonFinderConfigs.deepSearchButton, queryBar);

            if (thinkButton && thinkButton.getAttribute('aria-pressed') === 'true') {
                requestKind = 'REASONING';
            } else if (searchButton && searchButton.getAttribute('aria-pressed') === 'true') {
                const searchAria = searchButton.getAttribute('aria-label') || '';
                if (/deeper/i.test(searchAria)) {
                    requestKind = 'DEEPERSEARCH';
                } else if (/deep/i.test(searchAria)) {
                    requestKind = 'DEEPSEARCH';
                }
            }
        }

        let data = await fetchRateLimit(modelName, requestKind, force);

        const processedData = processRateLimitData(data, effortLevel);
        const displayEffort = effortLevel === 'both' && processedData.highRemaining === undefined ? 'high' : effortLevel;
        updateRateLimitDisplay(queryBar, processedData, displayEffort, modelName);

        lastModelName = modelName;
    }

    // Function to observe the DOM for the query bar
    function observeDOM() {
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible' && lastQueryBar && !isImaginePage()) {
                fetchAndUpdateRateLimit(lastQueryBar, true);
                if (!isCountingDown) {
                    if (pollInterval) {
                        clearInterval(pollInterval);
                    }
                    pollInterval = setInterval(() => fetchAndUpdateRateLimit(lastQueryBar, true), POLL_INTERVAL_MS);
                }
            } else {
                if (pollInterval) {
                    clearInterval(pollInterval);
                    pollInterval = null;
                }
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);

        if (!isImaginePage()) {
            const initialQueryBar = document.querySelector(QUERY_BAR_SELECTOR);
            if (initialQueryBar) {
                removeExistingRateLimit();
                fetchAndUpdateRateLimit(initialQueryBar);
                lastQueryBar = initialQueryBar;

                setupQueryBarObserver(initialQueryBar);
                setupGrok3Observers(initialQueryBar);
                setupSubmissionListeners(initialQueryBar);

                if (document.visibilityState === 'visible' && !isCountingDown) {
                    pollInterval = setInterval(() => fetchAndUpdateRateLimit(lastQueryBar, true), POLL_INTERVAL_MS);
                }
            }
        }

        const observer = new MutationObserver(() => {
            if (isImaginePage()) {
                removeExistingRateLimit();
                if (lastModelObserver) {
                    lastModelObserver.disconnect();
                    lastModelObserver = null;
                }
                if (lastThinkObserver) {
                    lastThinkObserver.disconnect();
                    lastThinkObserver = null;
                }
                if (lastSearchObserver) {
                    lastSearchObserver.disconnect();
                    lastSearchObserver = null;
                }
                lastInputElement = null;
                lastSubmitButton = null;
                if (pollInterval) {
                    clearInterval(pollInterval);
                    pollInterval = null;
                }
                lastQueryBar = null;
                return;
            }

            const queryBar = document.querySelector(QUERY_BAR_SELECTOR);
            if (queryBar && queryBar !== lastQueryBar) {
                removeExistingRateLimit();
                fetchAndUpdateRateLimit(queryBar);
                if (lastModelObserver) {
                    lastModelObserver.disconnect();
                }
                if (lastThinkObserver) {
                    lastThinkObserver.disconnect();
                }
                if (lastSearchObserver) {
                    lastSearchObserver.disconnect();
                }

                setupQueryBarObserver(queryBar);
                setupGrok3Observers(queryBar);
                setupSubmissionListeners(queryBar);

                if (document.visibilityState === 'visible' && !isCountingDown) {
                    if (pollInterval) clearInterval(pollInterval);
                    pollInterval = setInterval(() => fetchAndUpdateRateLimit(lastQueryBar, true), POLL_INTERVAL_MS);
                }
                lastQueryBar = queryBar;
            } else if (!queryBar && lastQueryBar) {
                removeExistingRateLimit();
                if (lastModelObserver) {
                    lastModelObserver.disconnect();
                }
                if (lastThinkObserver) {
                    lastThinkObserver.disconnect();
                }
                if (lastSearchObserver) {
                    lastSearchObserver.disconnect();
                }
                lastQueryBar = null;
                lastModelObserver = null;
                lastThinkObserver = null;
                lastSearchObserver = null;
                lastInputElement = null;
                lastSubmitButton = null;
                if (pollInterval) {
                    clearInterval(pollInterval);
                    pollInterval = null;
                }
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
        });

        function setupQueryBarObserver(queryBar) {
            const debouncedUpdate = debounce(() => {
                fetchAndUpdateRateLimit(queryBar);
                setupGrok3Observers(queryBar);
                applyRateLimitCompactState(queryBar);
            }, 300);

            lastModelObserver = new MutationObserver(debouncedUpdate);
            lastModelObserver.observe(queryBar, { childList: true, subtree: true, attributes: true, characterData: true });
        }

        function setupGrok3Observers(queryBar) {
            const currentModel = getCurrentModelKey(queryBar);
            if (currentModel === 'grok-3') {
                const thinkButton = findElement(commonFinderConfigs.thinkButton, queryBar);
                if (thinkButton) {
                    if (lastThinkObserver) lastThinkObserver.disconnect();
                    lastThinkObserver = new MutationObserver(() => {
                        fetchAndUpdateRateLimit(queryBar);
                    });
                    lastThinkObserver.observe(thinkButton, { attributes: true, attributeFilter: ['aria-pressed', 'class'] });
                }
                const searchButton = findElement(commonFinderConfigs.deepSearchButton, queryBar);
                if (searchButton) {
                    if (lastSearchObserver) lastSearchObserver.disconnect();
                    lastSearchObserver = new MutationObserver(() => {
                        fetchAndUpdateRateLimit(queryBar);
                    });
                    lastSearchObserver.observe(searchButton, { attributes: true, attributeFilter: ['aria-pressed', 'class'], childList: true, subtree: true, characterData: true });
                }
            } else {
                if (lastThinkObserver) {
                    lastThinkObserver.disconnect();
                    lastThinkObserver = null;
                }
                if (lastSearchObserver) {
                    lastSearchObserver.disconnect();
                    lastSearchObserver = null;
                }
            }
        }

        function setupSubmissionListeners(queryBar) {
            const inputElement = queryBar.querySelector('div[contenteditable="true"]');
            if (inputElement && inputElement !== lastInputElement) {
                lastInputElement = inputElement;
                inputElement.addEventListener('input', () => {
                    applyRateLimitCompactState(queryBar);
                });
                inputElement.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                        console.log('Enter pressed for submit');
                        setTimeout(() => fetchAndUpdateRateLimit(queryBar, true), 3000);
                    }
                });
            }

            const bottomBar = queryBar.querySelector('div.absolute.inset-x-0.bottom-0');
            const submitButton = bottomBar ? findElement(commonFinderConfigs.submitButton, bottomBar) : findElement(commonFinderConfigs.submitButton, queryBar);
            if (submitButton && submitButton !== lastSubmitButton) {
                lastSubmitButton = submitButton;
                submitButton.addEventListener('click', () => {
                    console.log('Submit button clicked');
                    setTimeout(() => fetchAndUpdateRateLimit(queryBar, true), 3000);
                });
            }
        }
    }

    if (window.__GRLD_ENABLE_TEST_HOOKS__) {
        window.__GRLD_TEST_HOOKS__ = {
            findModelButton,
            getCurrentModelKey,
            getEffortLevel,
            getRateLimitWaitTime,
            formatQuotaText,
            formatResetTime,
            formatSingleTitle,
            formatBothTitle,
            buildTooltipRows,
            computeTooltipPosition,
            shouldUseCompactRateLimitDisplay,
            processRateLimitData,
        };
    }

    // Start observing the DOM for changes
    observeDOM();

})();
