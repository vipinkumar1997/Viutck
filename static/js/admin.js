document.addEventListener('DOMContentLoaded', function() {
    // Nav elements
    const navItems = document.querySelectorAll('.sidebar .nav-link:not(.logout)');
    const sections = document.querySelectorAll('.tab-section');
    const pageTitle = document.getElementById('page-title');
    const hamburgerBtn = document.getElementById('hamburger');
    const sidebar = document.getElementById('sidebar');
    const sidebarOverlay = document.getElementById('sidebarOverlay');

    // Stats Card elements
    const statLocations = document.getElementById('stat-locations');
    const statLinks = document.getElementById('stat-links');
    const statActive = document.getElementById('stat-active');

    // Generate elements
    const linkLabelInput = document.getElementById('link-label');
    const generateBtn = document.getElementById('generate-btn');
    const generationResult = document.getElementById('generation-result');
    const resultLinkUrl = document.getElementById('result-link-url');
    const copyLinkBtn = document.getElementById('copy-link-btn');
    const whatsappShareBtn = document.getElementById('whatsapp-share-btn');
    const quickTagsContainer = document.getElementById('quick-tags-container');

    // Lists
    const locationsList = document.getElementById('locations-list');
    const locationsMobileCards = document.getElementById('locations-mobile-cards');
    const linksList = document.getElementById('links-list');
    const linksMobileCards = document.getElementById('links-mobile-cards');

    // Map & Global variables
    let map = null;
    let markersLayer = null;
    let loadedLocationIds = new Set();
    let isFirstLoad = true;
    let countdownVal = 0;
    let secondsSinceUpdate = 0;
    let updateTimer = null;

    // Silent update caches (prevent visual redraw flashes)
    let lastLocationsJson = null;
    let lastSessionsJson = null;
    let lastAlertsJson = null;
    
    // Modal maps
    let modalMap = null;
    let modalMarker = null;

    // History map (modal tab)
    let historyMap = null;
    let historyPolyline = null;
    let historyMarkersGroup = null;

    // Live Map (fullscreen modal)
    let liveTrackingMap = null;
    let liveTrackingPolyline = null;
    let liveTrackingMarkersGroup = null;
    let liveTrackingInterval = null;

    // Alert tracking
    let lastUnreadAlertCount = 0;

    // Global Sidebar toggler logic
    if (hamburgerBtn) {
        hamburgerBtn.addEventListener('click', () => {
            if (window.innerWidth > 768) {
                document.body.classList.toggle('sidebar-collapsed');
            } else {
                document.body.classList.toggle('sidebar-open');
            }
        });
    }
    if (sidebarOverlay) {
        sidebarOverlay.addEventListener('click', () => {
            document.body.classList.remove('sidebar-open');
        });
    }

    // Close sidebar on link click (mobile)
    document.querySelectorAll('.sidebar .nav-link').forEach(link => {
        link.addEventListener('click', () => {
            if (window.innerWidth <= 768) {
                document.body.classList.remove('sidebar-open');
            }
        });
    });

    // Dual-signature global showToast function
    function showToast(messageOrTitle, messageOrType = 'info', typeOrDuration = 3000) {
        let type = messageOrType;
        let duration = typeof typeOrDuration === 'number' ? typeOrDuration : 3000;
        let title = null;
        let message = messageOrTitle;
        
        // Match older three-argument calls: showToast(title, message, type)
        if (typeof typeOrDuration === 'string') {
            title = messageOrTitle;
            message = messageOrType;
            type = typeOrDuration;
            duration = 5000;
        }
        
        const container = document.getElementById('toastContainer');
        if (!container) return;
        
        const toast = document.createElement('div');
        toast.className = 'toast ' + type;
        const messageSpan = document.createElement('span');
        if (title) {
            const titleEl = document.createElement('b');
            titleEl.textContent = title;
            messageSpan.appendChild(titleEl);
            messageSpan.appendChild(document.createTextNode(`: ${message}`));
        } else {
            messageSpan.textContent = message;
        }
        const closeBtn = document.createElement('button');
        closeBtn.className = 'toast-close';
        closeBtn.type = 'button';
        closeBtn.setAttribute('aria-label', 'Dismiss notification');
        closeBtn.textContent = '\u00d7';
        toast.appendChild(messageSpan);
        toast.appendChild(closeBtn);
        
        closeBtn.onclick = function() {
            toast.remove();
        };
        
        container.appendChild(toast);
        
        setTimeout(() => {
            if (toast.parentNode) {
                toast.style.animation = 'slideInToast 0.3s ease reverse';
                setTimeout(() => {
                    if (toast.parentNode) toast.remove();
                }, 300);
            }
        }, duration);
    }

    // Web Audio API Soft Beep
    function playBeepSound() {
        try {
            const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator = audioCtx.createOscillator();
            const gainNode = audioCtx.createGain();

            oscillator.connect(gainNode);
            gainNode.connect(audioCtx.destination);

            oscillator.type = 'sine';
            oscillator.frequency.setValueAtTime(880, audioCtx.currentTime);
            
            gainNode.gain.setValueAtTime(0, audioCtx.currentTime);
            gainNode.gain.linearRampToValueAtTime(0.3, audioCtx.currentTime + 0.05);
            gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.3);

            oscillator.start(audioCtx.currentTime);
            oscillator.stop(audioCtx.currentTime + 0.3);
        } catch (e) {
            console.error('Audio beep failed', e);
        }
    }

    // Browser Tab Flashing
    let flashInterval = null;
    function flashTabTitle() {
        if (flashInterval) return;
        const originalTitle = document.title;
        let isAlert = false;
        flashInterval = setInterval(() => {
            document.title = isAlert ? originalTitle : "🔴 ALERT! Geofence Breach";
            isAlert = !isAlert;
        }, 1000);

        const stopFlashing = () => {
            clearInterval(flashInterval);
            flashInterval = null;
            document.title = originalTitle;
            window.removeEventListener('focus', stopFlashing);
            document.removeEventListener('mousemove', stopFlashing);
        };
        window.addEventListener('focus', stopFlashing);
        document.addEventListener('mousemove', stopFlashing);
    }

    // Tab Nav Switching
    navItems.forEach(item => {
        item.addEventListener('click', function(e) {
            const targetId = this.getAttribute('data-target');
            if (!targetId) return; // Allow normal routing
            e.preventDefault();
            switchTab(targetId, this.textContent.trim());
            
            // Set URL hash silently without trigger reloading
            const cleanHash = targetId.replace('-section', '');
            window.history.pushState(null, null, `#${cleanHash}`);
        });
    });

    function switchTab(targetId, titleText) {
        navItems.forEach(nav => {
            if (nav.getAttribute('data-target') === targetId) {
                nav.classList.add('active');
            } else {
                nav.classList.remove('active');
            }
        });

        sections.forEach(sec => sec.style.display = 'none');
        const activeSection = document.getElementById(targetId);
        if (activeSection) activeSection.style.display = 'block';

        if (pageTitle) pageTitle.textContent = titleText;

        // Force Leaflet recalculation
        if (targetId === 'dashboard-section' && map) {
            setTimeout(() => map.invalidateSize(), 200);
        }
    }

    // Hash Navigation Switcher on Page Loads & Changes
    function handleHashNav() {
        const hash = window.location.hash;
        if (hash) {
            const targetId = hash.substring(1) + '-section';
            const navItem = document.querySelector(`.sidebar .nav-link[data-target="${targetId}"]`);
            if (navItem) {
                switchTab(targetId, navItem.textContent.trim());
            }
        } else {
            // Default to dashboard
            switchTab('dashboard-section', 'Dashboard');
        }
    }

    window.addEventListener('hashchange', handleHashNav);

    // Bind Stat Cards triggers
    document.getElementById('card-locations-trigger').addEventListener('click', () => {
        switchTab('locations-section', 'Locations');
        window.history.pushState(null, null, '#locations');
    });

    document.getElementById('card-links-trigger').addEventListener('click', () => {
        switchTab('links-section', 'All Links');
        window.history.pushState(null, null, '#links');
    });

    document.getElementById('card-active-trigger').addEventListener('click', () => {
        switchTab('links-section', 'All Links');
        window.history.pushState(null, null, '#links');
    });

    // Initialize Map
    function initMap() {
        if (!document.getElementById('map')) return;
        map = L.map('map').setView([0, 0], 2);
        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
        }).addTo(map);
        markersLayer = L.layerGroup().addTo(map);
    }

    // Helper to escape HTML characters
    function escapeHtml(text) {
        if (!text) return '';
        const map = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        };
        return text.replace(/[&<>"']/g, m => map[m]);
    }

    function hasValidCoordinates(loc) {
        return loc
            && loc.latitude !== null
            && loc.latitude !== undefined
            && loc.longitude !== null
            && loc.longitude !== undefined
            && Number.isFinite(Number(loc.latitude))
            && Number.isFinite(Number(loc.longitude));
    }

    function syncResponsiveLists() {
        const locationsTable = document.getElementById('locations-table');
        const linksTable = document.getElementById('links-table');
        const hasLocations = locationsMobileCards && locationsMobileCards.children.length > 0;
        const hasLinks = linksMobileCards && linksMobileCards.children.length > 0;

        if (locationsTable) {
            const wrapper = locationsTable.parentNode;
            if (!hasLocations) {
                wrapper.style.display = 'none';
                locationsMobileCards.style.display = 'none';
            } else if (window.innerWidth <= 768) {
                wrapper.style.display = 'none';
                locationsMobileCards.style.display = 'flex';
            } else {
                wrapper.style.display = 'block';
                locationsMobileCards.style.display = 'none';
            }
        }

        if (linksTable) {
            const wrapper = linksTable.parentNode;
            if (!hasLinks) {
                wrapper.style.display = 'none';
                linksMobileCards.style.display = 'none';
            } else if (window.innerWidth <= 768) {
                wrapper.style.display = 'none';
                linksMobileCards.style.display = 'flex';
            } else {
                wrapper.style.display = 'block';
                linksMobileCards.style.display = 'none';
            }
        }
    }

    // User Agent Parser Helper
    function parseUserAgent(ua, platform) {
        if (!ua) return platform || 'Unknown';
        let browser = 'Browser';
        let os = platform || 'OS';
        
        if (ua.indexOf('Firefox') > -1) browser = 'Firefox';
        else if (ua.indexOf('SamsungBrowser') > -1) browser = 'Samsung';
        else if (ua.indexOf('Opera') > -1 || ua.indexOf('OPR') > -1) browser = 'Opera';
        else if (ua.indexOf('Trident') > -1) browser = 'IE';
        else if (ua.indexOf('Edge') > -1 || ua.indexOf('Edg') > -1) browser = 'Edge';
        else if (ua.indexOf('Chrome') > -1) browser = 'Chrome';
        else if (ua.indexOf('Safari') > -1) browser = 'Safari';
        
        if (ua.indexOf('Windows NT 10.0') > -1) os = 'Windows 10/11';
        else if (ua.indexOf('Windows NT 6.2') > -1) os = 'Windows 8';
        else if (ua.indexOf('Windows NT 6.1') > -1) os = 'Windows 7';
        else if (ua.indexOf('Macintosh') > -1) os = 'macOS';
        else if (ua.indexOf('iPhone') > -1) os = 'iOS';
        else if (ua.indexOf('iPad') > -1) os = 'iPadOS';
        else if (ua.indexOf('Android') > -1) os = 'Android';
        else if (ua.indexOf('Linux') > -1) os = 'Linux';
        
        return `${browser} (${os})`;
    }

    // Modal Manager
    const detailModal = document.getElementById('location-detail-modal');
    const qrModal = document.getElementById('qr-display-modal');
    const liveMapModal = document.getElementById('live-map-modal');

    // Close buttons
    document.getElementById('close-detail-modal').addEventListener('click', () => {
        detailModal.classList.remove('open');
    });
    document.getElementById('close-qr-modal').addEventListener('click', () => {
        qrModal.classList.remove('open');
    });
    document.getElementById('close-live-map-modal').addEventListener('click', () => {
        liveMapModal.classList.remove('open');
        if (liveTrackingInterval) {
            clearInterval(liveTrackingInterval);
            liveTrackingInterval = null;
        }
    });

    // Close on click outside modal
    window.addEventListener('click', (e) => {
        if (e.target === detailModal) detailModal.classList.remove('open');
        if (e.target === qrModal) qrModal.classList.remove('open');
        if (e.target === liveMapModal) {
            liveMapModal.classList.remove('open');
            if (liveTrackingInterval) {
                clearInterval(liveTrackingInterval);
                liveTrackingInterval = null;
            }
        }
    });

    // Details Modal Tab Switching
    const tabBtns = document.querySelectorAll('.modal-tab-btn');
    const tabPanels = document.querySelectorAll('.modal-tab-panel');
    tabBtns.forEach(btn => {
        btn.addEventListener('click', function() {
            tabBtns.forEach(b => b.classList.remove('active'));
            tabPanels.forEach(p => p.classList.remove('active'));
            
            this.classList.add('active');
            const targetTab = this.getAttribute('data-tab');
            const activePanel = document.getElementById(targetTab);
            if (activePanel) activePanel.classList.add('active');
            
            if (targetTab === 'tab-history' && historyMap) {
                setTimeout(() => historyMap.invalidateSize(), 150);
            } else if (targetTab === 'tab-general' && modalMap) {
                setTimeout(() => modalMap.invalidateSize(), 150);
            }
        });
    });

    // Show Details Modal function
    function openLocationDetails(loc) {
        tabBtns.forEach(b => b.classList.remove('active'));
        tabPanels.forEach(p => p.classList.remove('active'));
        tabBtns[0].classList.add('active');
        document.getElementById('tab-general').classList.add('active');

        document.getElementById('det-label').textContent = loc.label;
        document.getElementById('det-ip').textContent = loc.ip_address;
        document.getElementById('det-resolution').textContent = loc.screen_resolution || 'Unknown';
        document.getElementById('det-language').textContent = loc.language || 'Unknown';
        document.getElementById('det-timestamp').textContent = loc.timestamp;
        document.getElementById('det-accuracy').textContent = loc.accuracy !== null && loc.accuracy !== undefined ? `${Number(loc.accuracy).toFixed(1)} m` : 'N/A';
        document.getElementById('det-browser').textContent = parseUserAgent(loc.user_agent, loc.platform);
        document.getElementById('det-os').textContent = loc.platform || 'Unknown';
        const hasCoords = hasValidCoordinates(loc);

        // Bind Copy Coordinates safely
        document.getElementById('copy-coords-btn').onclick = function() {
            if (hasCoords) {
                const lat = Number(loc.latitude);
                const lng = Number(loc.longitude);
                navigator.clipboard.writeText(`${lat.toFixed(6)}, ${lng.toFixed(6)}`);
                showToast('Coordinates copied to clipboard.', 'info');
            } else {
                navigator.clipboard.writeText('Location unavailable');
                showToast('Location unavailable note copied.', 'info');
            }
        };

        if (!hasCoords) {
            document.getElementById('det-coords').textContent = loc.location_denied ? 'Location Access Denied' : 'Coordinates Unavailable';
            document.getElementById('det-address').textContent = loc.location_denied ? 'Location Denied by User' : (loc.address || loc.city || 'Unknown Address');
            document.getElementById('det-address').classList.toggle('location-denied-badge', Boolean(loc.location_denied));
            document.getElementById('modal-map').parentNode.style.display = 'none';
        } else {
            const lat = Number(loc.latitude);
            const lng = Number(loc.longitude);
            document.getElementById('det-coords').textContent = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
            document.getElementById('det-address').textContent = loc.address || loc.city || 'Unknown Address';
            document.getElementById('det-address').classList.remove('location-denied-badge');
            document.getElementById('modal-map').parentNode.style.display = 'block';

            // Render/reset Map in modal
            setTimeout(() => {
                if (!modalMap) {
                    modalMap = L.map('modal-map').setView([lat, lng], 15);
                    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
                        attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
                    }).addTo(modalMap);
                    modalMarker = L.marker([lat, lng]).addTo(modalMap);
                } else {
                    modalMap.setView([lat, lng], 15);
                    modalMarker.setLatLng([lat, lng]);
                }
                modalMap.invalidateSize();
            }, 200);
        }

        // Setup History tab logic
        const btnTabHistory = document.getElementById('btn-tab-history');
        if (loc.session_id) {
            btnTabHistory.style.display = 'block';
            loadSessionHistory(loc.session_id);
        } else {
            btnTabHistory.style.display = 'none';
        }

        // Bind Copy IP
        document.getElementById('copy-ip-btn').onclick = function() {
            navigator.clipboard.writeText(loc.ip_address);
            showToast('IP Address copied to clipboard.', 'info');
        };

        detailModal.classList.add('open');
    }

    // Load History Path & Stats for modal history tab
    async function loadSessionHistory(sessionId) {
        const histDistance = document.getElementById('hist-stat-distance');
        const histDuration = document.getElementById('hist-stat-duration');
        const histSpeed = document.getElementById('hist-stat-speed');
        const timeline = document.getElementById('history-timeline');
        const encodedSessionId = encodeURIComponent(sessionId);

        timeline.innerHTML = '<div style="color:var(--text-secondary); font-size:0.85rem; padding:10px;">Loading history path...</div>';

        try {
            // Stats
            const statsRes = await fetch(`/api/session/${encodedSessionId}/stats`);
            if (statsRes.ok) {
                const stats = await statsRes.json();
                
                if (stats.total_distance >= 1000) {
                    histDistance.textContent = `${(stats.total_distance / 1000).toFixed(2)} km`;
                } else {
                    histDistance.textContent = `${stats.total_distance.toFixed(0)} m`;
                }
                
                const sec = stats.duration_seconds;
                if (sec >= 3600) {
                    histDuration.textContent = `${Math.floor(sec/3600)}h ${Math.floor((sec%3600)/60)}m`;
                } else if (sec >= 60) {
                    histDuration.textContent = `${Math.floor(sec/60)}m ${sec%60}s`;
                } else {
                    histDuration.textContent = `${sec}s`;
                }

                histSpeed.textContent = `${stats.avg_speed_kmh.toFixed(1)} km/h`;
            }

            // Path points
            const pathRes = await fetch(`/api/session/${encodedSessionId}/path`);
            if (pathRes.ok) {
                const points = await pathRes.json();
                
                setTimeout(() => {
                    if (!historyMap) {
                        historyMap = L.map('history-map');
                        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
                            attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
                        }).addTo(historyMap);
                        historyMarkersGroup = L.layerGroup().addTo(historyMap);
                    } else {
                        historyMarkersGroup.clearLayers();
                        if (historyPolyline) historyMap.removeLayer(historyPolyline);
                    }

                    const latlngs = [];
                    points.forEach(pt => {
                        if (hasValidCoordinates(pt)) latlngs.push([Number(pt.latitude), Number(pt.longitude)]);
                    });

                    if (latlngs.length > 0) {
                        historyPolyline = L.polyline(latlngs, { color: '#6C63FF', weight: 4 }).addTo(historyMap);
                        L.circleMarker(latlngs[0], { radius: 6, color: '#43e97b', fillColor: '#43e97b', fillOpacity: 1 }).addTo(historyMarkersGroup).bindPopup('Start Point');
                        
                        if (latlngs.length > 1) {
                            L.circleMarker(latlngs[latlngs.length - 1], { radius: 6, color: '#ff4757', fillColor: '#ff4757', fillOpacity: 1 }).addTo(historyMarkersGroup).bindPopup('Current Point');
                        }

                        historyMap.fitBounds(latlngs, { padding: [30, 30] });
                    }
                    historyMap.invalidateSize();
                }, 200);

                // Populate timeline
                timeline.innerHTML = '';
                if (points.length === 0) {
                    timeline.innerHTML = '<div style="color:var(--text-secondary); font-size:0.85rem; padding:10px;">No positions recorded yet.</div>';
                } else {
                    points.forEach((pt, index) => {
                        const item = document.createElement('div');
                        let borderClass = '';
                        if (index === 0) borderClass = 'first';
                        else if (index === points.length - 1) borderClass = 'last';

                        const locationStr = pt.city || pt.address || 'Unknown coordinates';
                        
                        item.className = `timeline-item ${borderClass}`;
                        item.innerHTML = `
                            <div class="timeline-dot"></div>
                            <div class="timeline-time">${pt.timestamp}</div>
                            <div class="timeline-content">
                                <strong>Point #${index + 1}:</strong> ${escapeHtml(locationStr)} 
                                <span style="color:var(--text-muted); font-size:0.75rem;">(Acc: ${pt.accuracy ? pt.accuracy.toFixed(0) : 'N/A'}m)</span>
                            </div>
                        `;
                        timeline.appendChild(item);
                    });
                }
            }
        } catch(e) {
            console.error("Failed loading session path details", e);
            timeline.innerHTML = '<div style="color:var(--danger); font-size:0.85rem; padding:10px;">Failed to load movement logs.</div>';
        }
    }

    // Load Data function
    async function loadData() {
        const spinner = document.getElementById('locations-loading');
        if (isFirstLoad && spinner) spinner.classList.remove('hidden');

        try {
            // Fetch Statistics
            const statsRes = await fetch('/api/stats');
            if (statsRes.ok) {
                const stats = await statsRes.json();
                statLocations.textContent = stats.total_locations;
                statLinks.textContent = stats.total_links;
                statActive.textContent = stats.active_links;
            }

            // Fetch Locations
            const locRes = await fetch('/api/locations');
            if (locRes.ok) {
                const locations = await locRes.json();
                
                if (spinner) spinner.classList.add('hidden');

                const currentLocationsJson = JSON.stringify(locations);
                if (currentLocationsJson === lastLocationsJson && !isFirstLoad) {
                    return;
                }
                lastLocationsJson = currentLocationsJson;

                let hasNewEntry = false;
                let latestNewCity = 'Unknown';
                let latestLabel = '';

                locations.forEach(loc => {
                    if (!isFirstLoad && !loadedLocationIds.has(loc.id)) {
                        hasNewEntry = true;
                        latestNewCity = loc.city || 'Unknown City';
                        latestLabel = loc.label;
                    }
                });

                // Clear and rebuild loaded set
                loadedLocationIds = new Set(locations.map(loc => loc.id));

                if (hasNewEntry) {
                    showToast(`${latestLabel}: captured from ${latestNewCity}!`, 'success');
                    playBeepSound();
                    flashTabTitle();
                }

                // Handle empty states
                const emptyState = document.getElementById('locations-empty');
                const locTable = document.getElementById('locations-table');
                if (locations.length === 0) {
                    emptyState.classList.remove('hidden');
                    locTable.parentNode.style.display = 'none';
                    locationsMobileCards.innerHTML = '';
                    syncResponsiveLists();
                } else {
                    emptyState.classList.add('hidden');

                    locationsList.innerHTML = '';
                    locationsMobileCards.innerHTML = '';
                    
                    const mapPoints = [];
                    if (markersLayer) markersLayer.clearLayers();

                    locations.forEach((loc, index) => {
                        const entryTime = new Date(loc.timestamp.replace(/-/g, '/'));
                        const isRecent = Math.abs(new Date() - entryTime) < 60000;
                        const liveBadgeHtml = (isRecent && loc.session_id) ? `<span class="live-badge">Live</span>` : '';

                        // Desktop table row
                        const row = document.createElement('tr');
                        row.className = 'animate-fade locations-row';
                        
                        const dotClass = loc.location_denied ? 'status-dot denied' : 'status-dot captured';
                        const dotHtml = `<span class="${dotClass}"></span>`;
                        
                        let addressCellHtml = '';
                        if (loc.location_denied) {
                            addressCellHtml = `<span class="text-muted">Location Denied</span>`;
                        } else {
                            const pinSvg = `<svg class="loc-pin-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/><path stroke-linecap="round" stroke-linejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/></svg>`;
                            const fullAddr = `${loc.city || ''}${loc.city && loc.address ? ', ' : ''}${loc.address || ''}` || 'Unknown Location';
                            addressCellHtml = `${pinSvg}<span class="truncate-address" title="${escapeHtml(fullAddr)}">${escapeHtml(fullAddr)}</span>`;
                        }

                        const hasCoords = hasValidCoordinates(loc);
                        const latLngCol = !hasCoords
                            ? '<span class="location-denied-badge">Denied</span>' 
                            : `${Number(loc.latitude).toFixed(6)}, ${Number(loc.longitude).toFixed(6)}`;

                        const browserInfo = parseUserAgent(loc.user_agent, loc.platform);

                        row.innerHTML = `
                            <td>${index + 1}</td>
                            <td>${dotHtml}<strong class="truncate-text" title="${escapeHtml(loc.label)}">${escapeHtml(loc.label)}</strong>${liveBadgeHtml}</td>
                            <td>${escapeHtml(loc.timestamp || '')}</td>
                            <td>${addressCellHtml}</td>
                            <td>${latLngCol}</td>
                            <td><code>${escapeHtml(loc.ip_address || 'Unknown')}</code></td>
                            <td><span class="truncate-text" style="font-size: 0.85rem;" title="${escapeHtml(loc.user_agent)}">${escapeHtml(browserInfo)}</span></td>
                            <td>${loc.accuracy !== null && loc.accuracy !== undefined ? Number(loc.accuracy).toFixed(1) + ' m' : 'N/A'}</td>
                            <td>
                                <div class="action-buttons">
                                    <button class="btn btn-outline btn-xs view-loc-btn" data-id="${loc.id}">View</button>
                                    <button class="btn btn-danger btn-xs delete-loc-btn" data-id="${loc.id}">Delete</button>
                                </div>
                            </td>
                        `;
                        
                        row.addEventListener('click', (e) => {
                            if (e.target.closest('button') || e.target.closest('a')) return;
                            openLocationDetails(loc);
                        });

                        locationsList.appendChild(row);

                        // Mobile card
                        const mCard = document.createElement('div');
                        mCard.className = 'mobile-card animate-fade';
                        mCard.style.cssText = 'background:rgba(255,255,255,0.02); border:1px solid rgba(255,255,255,0.05); border-radius:12px; padding:16px; display:flex; flex-direction:column; gap:10px; cursor:pointer;';
                        mCard.innerHTML = `
                            <div class="mobile-card-row" style="display:flex; justify-content:space-between; align-items:center;">
                                <span class="mobile-card-label" style="font-weight:700;">${dotHtml}${escapeHtml(loc.label)}${liveBadgeHtml}</span>
                                <span class="mobile-card-time" style="font-size:0.75rem; color:var(--text-secondary);">${escapeHtml((loc.timestamp || '').split(' ')[1] || loc.timestamp || '')}</span>
                            </div>
                            <div class="mobile-card-meta" style="font-size:0.85rem;">
                                <strong>City:</strong> ${loc.location_denied ? '<span class="text-muted">Denied</span>' : escapeHtml(loc.city || 'Unknown')}
                            </div>
                            <div class="mobile-card-meta" style="font-size:0.85rem;">
                                <strong>IP Address:</strong> <code>${escapeHtml(loc.ip_address || 'Unknown')}</code>
                            </div>
                            <div class="mobile-card-actions" style="display:flex; gap:10px; margin-top:8px;">
                                <button class="btn btn-outline btn-xs view-loc-btn" data-id="${loc.id}" style="flex:1;">Details</button>
                                <button class="btn btn-danger btn-xs delete-loc-btn" data-id="${loc.id}" style="flex:1;">Delete</button>
                            </div>
                        `;

                        mCard.addEventListener('click', (e) => {
                            if (e.target.closest('button') || e.target.closest('a')) return;
                            openLocationDetails(loc);
                        });

                        locationsMobileCards.appendChild(mCard);

                        // Map pins
                        if (!loc.location_denied && hasCoords) {
                            const markerLatLng = [Number(loc.latitude), Number(loc.longitude)];
                            mapPoints.push(markerLatLng);

                            const popupContent = `
                                <div class="map-popup">
                                    <h4>${escapeHtml(loc.label)}</h4>
                                    <p><strong>City:</strong> ${escapeHtml(loc.city || 'Unknown')}</p>
                                    <p><strong>Time:</strong> ${loc.timestamp}</p>
                                    <p><strong>IP:</strong> ${escapeHtml(loc.ip_address || 'Unknown')}</p>
                                    <p><strong>Device:</strong> ${escapeHtml(loc.platform || 'Unknown')}</p>
                                </div>
                            `;

                            const marker = L.marker(markerLatLng).addTo(markersLayer).bindPopup(popupContent);

                            if (!isFirstLoad && hasNewEntry && loc.id === locations[0].id) {
                                setTimeout(() => {
                                    if (marker._icon) {
                                        marker._icon.classList.add('new-marker-bounce');
                                    }
                                }, 150);
                                marker.openPopup();
                            }
                        }
                    });

                    syncResponsiveLists();

                    // Auto zoom
                    if (map && mapPoints.length > 0 && isFirstLoad) {
                        map.fitBounds(mapPoints, { padding: [40, 40], maxZoom: 15 });
                    }
                }

                // Bind click events
                document.querySelectorAll('.view-loc-btn').forEach(btn => {
                    btn.onclick = function(e) {
                        e.stopPropagation();
                        const id = parseInt(this.getAttribute('data-id'));
                        const loc = locations.find(l => l.id === id);
                        if (loc) openLocationDetails(loc);
                    };
                });

                document.querySelectorAll('.delete-loc-btn').forEach(btn => {
                    btn.onclick = async function(e) {
                        e.stopPropagation();
                        if (confirm('Delete this location entry?')) {
                            const id = this.getAttribute('data-id');
                            const delRes = await fetch(`/api/locations/${id}`, { method: 'DELETE' });
                            if (delRes.ok) {
                                showToast('Location entry has been deleted.', 'error');
                                resetCountdown();
                                loadData();
                            }
                        }
                    };
                });

                isFirstLoad = false;
            }

            // Fetch Links
            const linksRes = await fetch('/api/links');
            if (linksRes.ok) {
                const links = await linksRes.json();
                const linksEmpty = document.getElementById('links-empty');
                linksList.innerHTML = '';
                linksMobileCards.innerHTML = '';
                if (linksEmpty) {
                    linksEmpty.classList.toggle('hidden', links.length > 0);
                }

                links.forEach(link => {
                    const fullUrl = `${window.location.origin}/t/${link.custom_slug || link.link_id}`;
                    const safeFullUrl = escapeHtml(fullUrl);
                    
                    const row = document.createElement('tr');
                    row.className = 'animate-fade';
                    
                    row.innerHTML = `
                        <td><strong class="truncate-text" title="${escapeHtml(link.label)}">${escapeHtml(link.label)}</strong></td>
                        <td>${link.created_at}</td>
                        <td><span class="visits-badge">${link.visit_count}</span></td>
                        <td>
                            <label class="switch">
                                <input type="checkbox" class="toggle-link-status" data-id="${link.link_id}" ${link.is_active ? 'checked' : ''}>
                                <span class="slider"></span>
                            </label>
                        </td>
                        <td><div style="max-width: 15vw; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"><input type="text" class="link-url-input" value="${safeFullUrl}" readonly style="background:transparent; border:none; width:100%; color:var(--text-secondary); cursor:pointer;" onclick="this.select()"></div></td>
                        <td>
                            <div class="action-buttons">
                                <button class="btn btn-secondary btn-xs copy-row-btn" data-url="${safeFullUrl}">Copy</button>
                                <button class="btn btn-outline btn-xs show-qr-btn" data-id="${link.link_id}" data-url="${safeFullUrl}">Show QR</button>
                                <a href="https://wa.me/?text=${encodeURIComponent('Check this link: ' + fullUrl)}" target="_blank" class="btn btn-success btn-xs">WhatsApp</a>
                                <button class="btn btn-danger btn-xs delete-link-btn" data-id="${link.link_id}">Delete</button>
                            </div>
                        </td>
                    `;
                    linksList.appendChild(row);

                    // Mobile card
                    const mCard = document.createElement('div');
                    mCard.className = 'mobile-card animate-fade';
                    mCard.style.cssText = 'background:rgba(255,255,255,0.02); border:1px solid rgba(255,255,255,0.05); border-radius:12px; padding:16px; display:flex; flex-direction:column; gap:10px;';
                    mCard.innerHTML = `
                        <div class="mobile-card-row" style="display:flex; justify-content:space-between; align-items:center;">
                            <strong>${escapeHtml(link.label)}</strong>
                            <span class="visits-badge">${link.visit_count} visits</span>
                        </div>
                        <div class="mobile-card-meta" style="font-size:0.85rem;">
                            <strong>Created:</strong> ${link.created_at}
                        </div>
                        <div class="mobile-card-meta" style="display:flex; justify-content:space-between; align-items:center; font-size:0.85rem;">
                            <strong>Active State:</strong>
                            <label class="switch">
                                <input type="checkbox" class="toggle-link-status" data-id="${link.link_id}" ${link.is_active ? 'checked' : ''}>
                                <span class="slider"></span>
                            </label>
                        </div>
                        <div class="mobile-card-actions" style="display:flex; gap:10px; margin-top:8px;">
                            <button class="btn btn-secondary btn-xs copy-row-btn" data-url="${safeFullUrl}" style="flex:1;">Copy</button>
                            <button class="btn btn-outline btn-xs show-qr-btn" data-id="${link.link_id}" data-url="${safeFullUrl}" style="flex:1;">Show QR</button>
                            <button class="btn btn-danger btn-xs delete-link-btn" data-id="${link.link_id}" style="flex:1;">Delete</button>
                        </div>
                    `;
                    linksMobileCards.appendChild(mCard);
                });

                syncResponsiveLists();

                // Toggles and status binds
                document.querySelectorAll('.toggle-link-status').forEach(checkbox => {
                    checkbox.addEventListener('change', async function() {
                        const linkId = this.getAttribute('data-id');
                        const is_active = this.checked;
                        await fetch(`/api/links/${linkId}`, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ is_active })
                        });
                        showToast(`Link is now ${is_active ? 'active' : 'inactive'}.`, 'info');
                        resetCountdown();
                        loadData();
                    });
                });

                document.querySelectorAll('.copy-row-btn').forEach(btn => {
                    btn.addEventListener('click', function() {
                        const url = this.getAttribute('data-url');
                        navigator.clipboard.writeText(url);
                        showToast('Campaign tracking link copied.', 'info');
                    });
                });

                document.querySelectorAll('.show-qr-btn').forEach(btn => {
                    btn.addEventListener('click', function() {
                        const linkId = this.getAttribute('data-id');
                        const url = this.getAttribute('data-url');
                        openQRCodeModal(linkId, url);
                    });
                });

                document.querySelectorAll('.delete-link-btn').forEach(btn => {
                    btn.addEventListener('click', async function() {
                        if (confirm('Delete this campaign link? All related locations will also be deleted.')) {
                            const linkId = this.getAttribute('data-id');
                            const delRes = await fetch(`/api/links/${linkId}`, { method: 'DELETE' });
                            if (delRes.ok) {
                                showToast('Campaign and captured locations removed.', 'error');
                                resetCountdown();
                                loadData();
                            }
                        }
                    });
                });
            }

        } catch (err) {
            console.error('Error fetching admin data', err);
        }
    }

    // QR Code Modal renderer
    function openQRCodeModal(linkId, url) {
        document.getElementById('qr-modal-title').textContent = 'Campaign QR Code';
        const modalQrContainer = document.getElementById('modal-qrcode');
        modalQrContainer.innerHTML = '';

        new QRCode(modalQrContainer, {
            text: url,
            width: 180,
            height: 180,
            colorDark: '#0f0f1a',
            colorLight: '#ffffff',
            correctLevel: QRCode.CorrectLevel.H
        });

        document.getElementById('download-qr-btn').onclick = function() {
            const qrImg = modalQrContainer.querySelector('img');
            if (qrImg && qrImg.src) {
                const a = document.createElement('a');
                a.href = qrImg.src;
                a.download = `qrcode_${linkId}.png`;
                a.click();
            } else {
                const qrCanvas = modalQrContainer.querySelector('canvas');
                if (qrCanvas) {
                    const a = document.createElement('a');
                    a.href = qrCanvas.toDataURL('image/png');
                    a.download = `qrcode_${linkId}.png`;
                    a.click();
                }
            }
        };

        qrModal.classList.add('open');
    }

    // Live Link Preview logic
    function updateLinkPreview() {
        const customSlugEl = document.getElementById('custom-slug');
        const customSlug = customSlugEl ? customSlugEl.value.trim() : '';
        const labelVal = linkLabelInput.value.trim();
        const slug = customSlug || (labelVal ? labelVal.toLowerCase().replace(/[^a-z0-9]+/g, '-') : 'campaign-id');
        document.getElementById('preview-origin').textContent = window.location.origin;
        document.getElementById('preview-path').textContent = `/t/${slug}`;
    }

    const customSlugInput = document.getElementById('custom-slug');
    const slugStatusIndicator = document.getElementById('slug-status-indicator');

    if (customSlugInput && slugStatusIndicator) {
        let slugCheckTimeout = null;
        let slugCheckRequestId = 0;
        customSlugInput.addEventListener('input', function() {
            updateLinkPreview();
            const slug = this.value.trim();
            clearTimeout(slugCheckTimeout);
            const requestId = ++slugCheckRequestId;
            
            if (!slug) {
                slugStatusIndicator.innerHTML = '';
                return;
            }

            const pattern = /^[a-zA-Z0-9\-]+$/;
            if (!pattern.test(slug) || slug.length > 30) {
                slugStatusIndicator.innerHTML = '<span style="color:var(--danger); font-weight:bold;">❌ Invalid</span>';
                return;
            }

            slugStatusIndicator.innerHTML = '<span style="color:var(--text-secondary);">Checking...</span>';

            slugCheckTimeout = setTimeout(async () => {
                try {
                    const res = await fetch(`/api/check-slug/${encodeURIComponent(slug)}`);
                    if (requestId !== slugCheckRequestId || customSlugInput.value.trim() !== slug) return;
                    if (res.ok) {
                        const data = await res.json();
                        if (data.available) {
                            slugStatusIndicator.innerHTML = '<span style="color:var(--success); font-weight:bold;">✔ OK</span>';
                        } else {
                            slugStatusIndicator.innerHTML = '<span style="color:var(--danger); font-weight:bold;">❌ Taken</span>';
                        }
                    } else {
                        slugStatusIndicator.innerHTML = '<span style="color:var(--danger); font-weight:bold;">❌ Error</span>';
                    }
                } catch (e) {
                    slugStatusIndicator.innerHTML = '';
                }
            }, 500);
        });
    }

    linkLabelInput.addEventListener('input', updateLinkPreview);

    document.querySelectorAll('.btn-tag').forEach(btn => {
        btn.addEventListener('click', function() {
            linkLabelInput.value = this.getAttribute('data-tag');
            updateLinkPreview();
        });
    });

    if (generateBtn) {
        generateBtn.addEventListener('click', async function() {
            const label = linkLabelInput.value.trim();
            const theme = document.getElementById('theme-select').value;
            const custom_slug = customSlugInput ? customSlugInput.value.trim() : '';

            if (!label) {
                showToast('Please enter a campaign label.', 'error');
                return;
            }

            const genRes = await fetch('/api/links/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ label, theme, custom_slug })
            });

            if (genRes.ok) {
                const linkInfo = await genRes.json();
                const urlSlug = linkInfo.custom_slug || linkInfo.link_id;
                const fullUrl = `${window.location.origin}/t/${urlSlug}`;
                
                resultLinkUrl.value = fullUrl;
                whatsappShareBtn.href = `https://wa.me/?text=${encodeURIComponent('Check this: ' + fullUrl)}`;
                
                const genQrContainer = document.getElementById('gen-qrcode');
                genQrContainer.innerHTML = '';
                new QRCode(genQrContainer, {
                    text: fullUrl,
                    width: 150,
                    height: 150,
                    colorDark: '#0f0f1a',
                    colorLight: '#ffffff',
                    correctLevel: QRCode.CorrectLevel.H
                });

                document.getElementById('download-gen-qr-btn').onclick = function() {
                    const qrImg = genQrContainer.querySelector('img');
                    if (qrImg && qrImg.src) {
                        const a = document.createElement('a');
                        a.href = qrImg.src;
                        a.download = `qrcode_${linkInfo.label.toLowerCase().replace(/\s+/g, '_')}.png`;
                        a.click();
                    } else {
                        const qrCanvas = genQrContainer.querySelector('canvas');
                        if (qrCanvas) {
                            const a = document.createElement('a');
                            a.href = qrCanvas.toDataURL('image/png');
                            a.download = `qrcode_${linkInfo.label.toLowerCase().replace(/\s+/g, '_')}.png`;
                            a.click();
                        }
                    }
                };

                generationResult.classList.remove('hidden');
                linkLabelInput.value = '';
                if (customSlugInput) customSlugInput.value = '';
                if (slugStatusIndicator) slugStatusIndicator.innerHTML = '';
                updateLinkPreview();
                
                showToast('New secure tracking link created successfully!', 'success');
                
                resetCountdown();
                loadData();
            } else {
                const errData = await genRes.json().catch(() => ({}));
                showToast(errData.error || 'Failed to generate tracking link.', 'error');
            }
        });
    }

    if (copyLinkBtn) {
        copyLinkBtn.addEventListener('click', function() {
            resultLinkUrl.select();
            navigator.clipboard.writeText(resultLinkUrl.value);
            showToast('Generated campaign link copied.', 'info');
        });
    }

    // --- FEATURE 1: Live Tracking Dash & Maps ---
    async function loadLiveSessions() {
        try {
            const res = await fetch('/api/live/sessions');
            if (res.ok) {
                const sessions = await res.json();

                const currentSessionsJson = JSON.stringify(sessions);
                if (currentSessionsJson === lastSessionsJson) {
                    return;
                }
                lastSessionsJson = currentSessionsJson;

                const list = document.getElementById('live-sessions-list');
                const empty = document.getElementById('live-sessions-empty');
                const countBadge = document.getElementById('live-devices-count');

                if (countBadge) countBadge.textContent = `${sessions.length} Device(s) Active`;

                if (sessions.length === 0) {
                    if (empty) empty.classList.remove('hidden');
                    if (list) list.innerHTML = '';
                } else {
                    if (empty) empty.classList.add('hidden');
                    if (list) {
                        list.innerHTML = '';

                        sessions.forEach(sess => {
                            const card = document.createElement('div');
                            card.className = 'live-device-card animate-fade';
                            
                            const batteryStr = sess.battery_level !== null && sess.battery_level !== undefined ? `${Math.round(sess.battery_level * 100)}%` : 'N/A';
                            const sessionId = String(sess.session_id || '');
                            const shortSessionId = sessionId.substring(0, 8);

                            card.innerHTML = `
                                <div class="live-device-header">
                                    <span class="live-device-label">${escapeHtml(sess.label)}</span>
                                    <span class="live-device-id">${escapeHtml(shortSessionId)}...</span>
                                </div>
                                <div class="live-device-details">
                                    <div class="live-device-detail-item">
                                        <strong>Last seen:</strong>
                                        <span class="live-device-detail-value">${escapeHtml((sess.timestamp || '').split(' ')[1] || sess.timestamp || 'Unknown')}</span>
                                    </div>
                                    <div class="live-device-detail-item">
                                        <strong>City:</strong>
                                        <span class="live-device-detail-value">${escapeHtml(sess.city)}</span>
                                    </div>
                                    <div class="live-device-detail-item">
                                        <strong>Battery:</strong>
                                        <span class="live-device-detail-value">${batteryStr}</span>
                                    </div>
                                    <div class="live-device-detail-item">
                                        <strong>Platform:</strong>
                                        <span class="live-device-detail-value" style="font-size:0.75rem;">${escapeHtml(sess.platform || 'Unknown')}</span>
                                    </div>
                                </div>
                            `;

                            card.addEventListener('click', () => {
                                openLiveTrackingMapModal(sessionId);
                            });

                            list.appendChild(card);
                        });
                    }
                }
            }
        } catch(e) {
            console.error("Failed loading live sessions", e);
        }
    }

    // Opens live tracking fullscreen map
    function openLiveTrackingMapModal(sessionId) {
        document.getElementById('live-map-session-id').textContent = String(sessionId || '').substring(0, 16) + '...';
        liveMapModal.classList.add('open');

        setTimeout(() => {
            if (!liveTrackingMap) {
                liveTrackingMap = L.map('live-tracking-map');
                L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
                    attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
                }).addTo(liveTrackingMap);
                liveTrackingMarkersGroup = L.layerGroup().addTo(liveTrackingMap);
            } else {
                liveTrackingMarkersGroup.clearLayers();
                if (liveTrackingPolyline) liveTrackingMap.removeLayer(liveTrackingPolyline);
            }

            updateLiveTrackingMap(sessionId);
            
            if (liveTrackingInterval) clearInterval(liveTrackingInterval);
            liveTrackingInterval = setInterval(() => {
                updateLiveTrackingMap(sessionId);
            }, 5000);

        }, 250);
    }

    async function updateLiveTrackingMap(sessionId) {
        try {
            const encodedSessionId = encodeURIComponent(sessionId);
            const statsRes = await fetch(`/api/session/${encodedSessionId}/stats`);
            let durationStr = '0s';
            let distanceStr = '0 m';
            let speedStr = '0.0 km/h';

            if (statsRes.ok) {
                const stats = await statsRes.json();
                
                if (stats.total_distance >= 1000) {
                    distanceStr = `${(stats.total_distance / 1000).toFixed(2)} km`;
                } else {
                    distanceStr = `${stats.total_distance.toFixed(0)} m`;
                }

                const sec = stats.duration_seconds;
                if (sec >= 3600) {
                    durationStr = `${Math.floor(sec/3600)}h ${Math.floor((sec%3600)/60)}m`;
                } else if (sec >= 60) {
                    durationStr = `${Math.floor(sec/60)}m ${sec%60}s`;
                } else {
                    durationStr = `${sec}s`;
                }

                speedStr = `${stats.avg_speed_kmh.toFixed(1)} km/h`;
            }

            document.getElementById('live-map-distance').textContent = distanceStr;
            document.getElementById('live-map-duration').textContent = durationStr;
            document.getElementById('live-map-speed').textContent = speedStr;

            const pathRes = await fetch(`/api/live/path/${encodedSessionId}`);
            if (pathRes.ok) {
                const points = await pathRes.json();
                if (points.length === 0) return;

                liveTrackingMarkersGroup.clearLayers();
                if (liveTrackingPolyline) liveTrackingMap.removeLayer(liveTrackingPolyline);

                const latlngs = [];
                points.forEach(pt => {
                    if (hasValidCoordinates(pt)) latlngs.push([Number(pt.latitude), Number(pt.longitude)]);
                });

                if (latlngs.length > 0) {
                    liveTrackingPolyline = L.polyline(latlngs, { color: '#6C63FF', weight: 4 }).addTo(liveTrackingMap);
                    L.circleMarker(latlngs[0], { radius: 6, color: '#43e97b', fillColor: '#43e97b', fillOpacity: 1 }).addTo(liveTrackingMarkersGroup).bindPopup('Start Position');

                    const currentPos = latlngs[latlngs.length - 1];
                    const pulsingIcon = L.divIcon({
                        className: 'pulsing-marker-icon',
                        iconSize: [12, 12]
                    });

                    L.marker(currentPos, { icon: pulsingIcon }).addTo(liveTrackingMarkersGroup).bindPopup('Current Location');
                    liveTrackingMap.setView(currentPos, Math.max(liveTrackingMap.getZoom(), 15));

                    const lastPt = points[points.length - 1];
                    const batteryStr = lastPt.battery_level !== null ? `${Math.round(lastPt.battery_level * 100)}%` : 'N/A';
                    document.getElementById('live-map-battery').textContent = batteryStr;
                }
            }
        } catch(e) {
            console.error("Failed to update live map coordinates", e);
        }
    }

    // --- FEATURE 3: Geofence Alerts ---
    async function loadGeofenceAlerts() {
        try {
            const res = await fetch('/api/geofence-alerts');
            if (res.ok) {
                const alerts = await res.json();

                const currentAlertsJson = JSON.stringify(alerts);
                if (currentAlertsJson === lastAlertsJson) {
                    return;
                }
                lastAlertsJson = currentAlertsJson;

                const unreadCount = alerts.filter(a => !a.is_read).length;
                
                // Sidebar badge
                const sidebarBadge = document.getElementById('geofence-alert-badge');
                if (sidebarBadge) {
                    if (unreadCount > 0) {
                        sidebarBadge.textContent = unreadCount;
                        sidebarBadge.classList.remove('hidden');
                    } else {
                        sidebarBadge.classList.add('hidden');
                    }
                }

                // If new unread alert comes in
                if (unreadCount > lastUnreadAlertCount) {
                    playBeepSound();
                    flashTabTitle();
                    showToast('A device triggered a geofence zone boundary!', 'error');
                    
                    const latestAlert = alerts.find(a => !a.is_read);
                    if (latestAlert) {
                        const typeText = latestAlert.alert_type === 'ENTER' ? 'ENTERED' : 'EXITED';
                        document.getElementById('geofence-alert-text').textContent = `Geofence Alert: Device ${String(latestAlert.session_id || '').substring(0,8)} ${typeText} zone "${latestAlert.geofence_name || 'Unknown'}"!`;
                        document.getElementById('geofence-alert-banner').classList.remove('hidden');
                    }
                }
                lastUnreadAlertCount = unreadCount;

                const list = document.getElementById('geofence-alerts-list');
                const empty = document.getElementById('geofence-alerts-empty');

                if (alerts.length === 0) {
                    if (empty) empty.classList.remove('hidden');
                    if (list) list.innerHTML = '';
                } else {
                    if (empty) empty.classList.add('hidden');
                    if (list) {
                        list.innerHTML = '';

                        alerts.slice(0, 10).forEach(alert => {
                            const item = document.createElement('div');
                            const unreadClass = alert.is_read ? '' : 'unread';
                            const badgeClass = alert.alert_type === 'ENTER' ? 'enter' : 'exit';
                            const badgeText = alert.alert_type === 'ENTER' ? 'Entered' : 'Exited';
                            const alertSessionId = String(alert.session_id || '');
                            const markReadBtn = alert.is_read 
                                ? '' 
                                : `<button class="btn btn-secondary btn-xs read-alert-btn" data-id="${alert.id}">Mark as Read</button>`;

                            item.className = `geofence-alert-item ${unreadClass}`;
                            item.innerHTML = `
                                <div class="geofence-alert-header">
                                    <span class="alert-badge ${badgeClass}">${badgeText}</span>
                                    <span class="geofence-alert-info">Zone: <b>${escapeHtml(alert.geofence_name)}</b></span>
                                </div>
                                <div class="geofence-alert-info" style="font-size:0.8rem; margin-top:2px;">
                                    Session ID: <code style="color:var(--accent);">${escapeHtml(alertSessionId.substring(0, 12))}...</code>
                                </div>
                                <div class="geofence-alert-meta">
                                    <span>${alert.timestamp}</span>
                                    ${markReadBtn}
                                </div>
                            `;
                            list.appendChild(item);
                        });

                        document.querySelectorAll('.read-alert-btn').forEach(btn => {
                            btn.addEventListener('click', async function(e) {
                                e.stopPropagation();
                                const id = this.getAttribute('data-id');
                                const readRes = await fetch(`/api/geofence-alerts/${id}/read`, { method: 'POST' });
                                if (readRes.ok) {
                                    loadGeofenceAlerts();
                                }
                            });
                        });
                    }
                }
            }
        } catch(e) {
            console.error("Failed to load geofence alerts", e);
        }
    }

    const closeAlertBannerBtn = document.getElementById('close-alert-banner-btn');
    if (closeAlertBannerBtn) {
        closeAlertBannerBtn.addEventListener('click', () => {
            document.getElementById('geofence-alert-banner').classList.add('hidden');
        });
    }

    // Auto Refresh Countdown timer
    function startTimer() {
        updateTimer = setInterval(() => {
            secondsSinceUpdate++;
            countdownVal++;

            const updateText = `Last updated: ${secondsSinceUpdate === 0 ? 'just now' : secondsSinceUpdate + 's ago'}`;
            const lastUpdatedText = document.getElementById('last-updated-text');
            if (lastUpdatedText) lastUpdatedText.textContent = updateText;
            
            const locLastUpdated = document.getElementById('loc-last-updated');
            if (locLastUpdated) {
                locLastUpdated.textContent = updateText;
            }

            const countdownTimer = document.getElementById('countdown-timer');
            const mobileTimer = document.getElementById('mobile-refresh-countdown');
            const remaining = Math.max(0, 15 - countdownVal);
            
            if (countdownTimer) countdownTimer.textContent = `${remaining}s`;
            if (mobileTimer) {
                mobileTimer.textContent = `${remaining}s`;
            }

            if (countdownVal >= 15) {
                countdownVal = 0;
                secondsSinceUpdate = 0;
                loadData();
                loadLiveSessions();
                loadGeofenceAlerts();
            }
        }, 1000);
    }

    function resetCountdown() {
        countdownVal = 0;
        secondsSinceUpdate = 0;
    }

    // Responsive view handling on resize
    window.addEventListener('resize', () => {
        syncResponsiveLists();
    });

    // Initializations
    initMap();
    loadData();
    loadLiveSessions();
    loadGeofenceAlerts();
    updateLinkPreview();
    startTimer();
    handleHashNav();
});
