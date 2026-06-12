document.addEventListener('DOMContentLoaded', function() {
    // Nav elements
    const navItems = document.querySelectorAll('.nav-item:not(.logout-link)');
    const sections = document.querySelectorAll('.tab-section');
    const pageTitle = document.getElementById('page-title');
    const hamburgerBtn = document.getElementById('hamburger-btn');
    const sidebar = document.getElementById('sidebar');
    const sidebarOverlay = document.getElementById('sidebar-overlay');

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
    
    // Modal maps
    let modalMap = null;
    let modalMarker = null;

    // Toast Notifications
    function showToast(title, message, type = 'success') {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.innerHTML = `
            <div class="toast-content">
                <div class="toast-title">${escapeHtml(title)}</div>
                <div class="toast-message">${escapeHtml(message)}</div>
            </div>
            <button class="toast-close">&times;</button>
        `;
        container.appendChild(toast);

        toast.querySelector('.toast-close').addEventListener('click', () => {
            toast.remove();
        });

        setTimeout(() => {
            if (toast.parentNode) {
                toast.remove();
            }
        }, 5000);
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
            oscillator.frequency.setValueAtTime(880, audioCtx.currentTime); // A5 frequency
            
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
        if (flashInterval) return; // Already flashing
        const originalTitle = document.title;
        let isAlert = false;
        flashInterval = setInterval(() => {
            document.title = isAlert ? originalTitle : "🔴 New Location! | Viutck";
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

    // Nav and Tab switching
    navItems.forEach(item => {
        item.addEventListener('click', function(e) {
            e.preventDefault();
            const targetId = this.getAttribute('data-target');
            switchTab(targetId, this.textContent.trim());
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

        sections.forEach(sec => sec.classList.remove('active'));
        document.getElementById(targetId).classList.add('active');

        pageTitle.textContent = titleText;

        // Close sidebar on mobile
        sidebar.classList.remove('open');
        sidebarOverlay.classList.remove('open');
        hamburgerBtn.classList.remove('open');

        // Force map recalculation
        if (targetId === 'dashboard-section' && map) {
            setTimeout(() => map.invalidateSize(), 200);
        }
    }

    // Bind Stat Cards clicks to trigger Tab clicks
    document.getElementById('card-locations-trigger').addEventListener('click', () => {
        switchTab('locations-section', 'Locations');
    });

    document.getElementById('card-links-trigger').addEventListener('click', () => {
        switchTab('links-section', 'All Links');
    });

    document.getElementById('card-active-trigger').addEventListener('click', () => {
        switchTab('links-section', 'All Links');
    });

    // Mobile Hamburger
    hamburgerBtn.addEventListener('click', function() {
        this.classList.toggle('open');
        sidebar.classList.toggle('open');
        sidebarOverlay.classList.toggle('open');
    });

    sidebarOverlay.addEventListener('click', function() {
        this.classList.remove('open');
        sidebar.classList.remove('open');
        hamburgerBtn.classList.remove('open');
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

    // Close buttons
    document.getElementById('close-detail-modal').addEventListener('click', () => {
        detailModal.classList.remove('open');
    });
    document.getElementById('close-qr-modal').addEventListener('click', () => {
        qrModal.classList.remove('open');
    });

    // Close on click outside modal
    window.addEventListener('click', (e) => {
        if (e.target === detailModal) detailModal.classList.remove('open');
        if (e.target === qrModal) qrModal.classList.remove('open');
    });

    // Show Details Modal function
    function openLocationDetails(loc) {
        document.getElementById('det-label').textContent = loc.label;
        document.getElementById('det-ip').textContent = loc.ip_address;
        document.getElementById('det-platform').textContent = loc.platform || 'Unknown';
        document.getElementById('det-resolution').textContent = loc.screen_resolution || 'Unknown';
        document.getElementById('det-language').textContent = loc.language || 'Unknown';
        document.getElementById('det-timestamp').textContent = loc.timestamp;
        document.getElementById('det-accuracy').textContent = loc.accuracy ? `${loc.accuracy.toFixed(1)} m` : 'N/A';
        document.getElementById('det-browser').textContent = parseUserAgent(loc.user_agent, loc.platform);
        document.getElementById('det-os').textContent = loc.platform;

        if (loc.location_denied) {
            document.getElementById('det-coords').textContent = 'Location Access Denied';
            document.getElementById('det-address').innerHTML = '<span class="location-denied-badge">Location Denied by User</span>';
            document.getElementById('modal-map').style.display = 'none';
        } else {
            const lat = loc.latitude;
            const lng = loc.longitude;
            document.getElementById('det-coords').textContent = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
            document.getElementById('det-address').textContent = loc.address || loc.city || 'Unknown Address';
            document.getElementById('modal-map').style.display = 'block';

            // Bind Copy Coordinates
            document.getElementById('copy-coords-btn').onclick = function() {
                navigator.clipboard.writeText(`${lat.toFixed(6)}, ${lng.toFixed(6)}`);
                showToast('Copied!', 'Coordinates copied to clipboard.', 'info');
            };

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

        // Bind Copy IP
        document.getElementById('copy-ip-btn').onclick = function() {
            navigator.clipboard.writeText(loc.ip_address);
            showToast('Copied!', 'IP Address copied to clipboard.', 'info');
        };

        detailModal.classList.add('open');
    }

    // Load Data function
    async function loadData() {
        // Show spinner on reload
        const spinner = document.getElementById('locations-loading');
        if (spinner) spinner.classList.remove('hidden');

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
                
                // Reset Spinner
                if (spinner) spinner.classList.add('hidden');

                // Determine if there are new entries
                let hasNewEntry = false;
                let latestNewCity = 'Unknown';
                let latestLabel = '';

                locations.forEach(loc => {
                    if (!isFirstLoad && !loadedLocationIds.has(loc.id)) {
                        hasNewEntry = true;
                        latestNewCity = loc.city || 'Unknown City';
                        latestLabel = loc.label;
                    }
                    loadedLocationIds.add(loc.id);
                });

                if (hasNewEntry) {
                    showToast('New Location Captured!', `${latestLabel}: captured from ${latestNewCity}!`, 'success');
                    playBeepSound();
                    flashTabTitle();
                }

                // Handle empty states
                const emptyState = document.getElementById('locations-empty');
                const locTable = document.getElementById('locations-table');
                if (locations.length === 0) {
                    emptyState.classList.remove('hidden');
                    locTable.classList.add('hidden');
                    locationsMobileCards.innerHTML = '';
                } else {
                    emptyState.classList.add('hidden');
                    locTable.classList.remove('hidden');

                    // Populate locations
                    locationsList.innerHTML = '';
                    locationsMobileCards.innerHTML = '';
                    
                    const mapPoints = [];
                    if (markersLayer) markersLayer.clearLayers();

                    locations.forEach((loc, index) => {
                        // Desktop table rendering
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

                        const latLngCol = loc.location_denied 
                            ? '<span class="location-denied-badge">Denied</span>' 
                            : `${loc.latitude.toFixed(6)}, ${loc.longitude.toFixed(6)}`;

                        const browserInfo = parseUserAgent(loc.user_agent, loc.platform);

                        row.innerHTML = `
                            <td>${index + 1}</td>
                            <td>${dotHtml}<strong>${escapeHtml(loc.label)}</strong></td>
                            <td>${loc.timestamp}</td>
                            <td>${addressCellHtml}</td>
                            <td>${latLngCol}</td>
                            <td><code>${loc.ip_address}</code></td>
                            <td><span style="font-size: 0.85rem;" title="${escapeHtml(loc.user_agent)}">${escapeHtml(browserInfo)}</span></td>
                            <td>${loc.accuracy ? loc.accuracy.toFixed(1) + ' m' : 'N/A'}</td>
                            <td>
                                <div class="action-buttons">
                                    <button class="btn btn-outline btn-xs view-loc-btn" data-id="${loc.id}">View</button>
                                    <button class="btn btn-danger btn-xs delete-loc-btn" data-id="${loc.id}">Delete</button>
                                </div>
                            </td>
                        `;
                        
                        // Row click triggers Modal details opening, avoiding clicks on buttons
                        row.addEventListener('click', (e) => {
                            if (e.target.closest('button') || e.target.closest('a')) return;
                            openLocationDetails(loc);
                        });

                        locationsList.appendChild(row);

                        // Mobile card rendering
                        const mCard = document.createElement('div');
                        mCard.className = 'mobile-card animate-fade';
                        mCard.innerHTML = `
                            <div class="mobile-card-row">
                                <span class="mobile-card-label">${dotHtml}${escapeHtml(loc.label)}</span>
                                <span class="mobile-card-time">${loc.timestamp}</span>
                            </div>
                            <div class="mobile-card-meta">
                                <strong>City:</strong> ${loc.location_denied ? '<span class="text-muted">Denied</span>' : escapeHtml(loc.city || 'Unknown')}
                            </div>
                            <div class="mobile-card-meta">
                                <strong>IP Address:</strong> <code>${loc.ip_address}</code>
                            </div>
                            <div class="mobile-card-actions">
                                <button class="btn btn-outline btn-xs view-loc-btn" data-id="${loc.id}">View Details</button>
                                <button class="btn btn-danger btn-xs delete-loc-btn" data-id="${loc.id}">Delete</button>
                            </div>
                        `;

                        mCard.addEventListener('click', (e) => {
                            if (e.target.closest('button') || e.target.closest('a')) return;
                            openLocationDetails(loc);
                        });

                        locationsMobileCards.appendChild(mCard);

                        // Add to main map if coordinates exist
                        if (!loc.location_denied && loc.latitude && loc.longitude) {
                            const markerLatLng = [loc.latitude, loc.longitude];
                            mapPoints.push(markerLatLng);

                            const popupContent = `
                                <div class="map-popup">
                                    <h4>${escapeHtml(loc.label)}</h4>
                                    <p><strong>City:</strong> ${escapeHtml(loc.city || 'Unknown')}</p>
                                    <p><strong>Time:</strong> ${loc.timestamp}</p>
                                    <p><strong>IP:</strong> ${loc.ip_address}</p>
                                    <p><strong>Device:</strong> ${loc.platform}</p>
                                </div>
                            `;

                            const marker = L.marker(markerLatLng).addTo(markersLayer).bindPopup(popupContent);

                            // Bounce marker if it is a new detection
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

                    // Auto fit map on load
                    if (map && mapPoints.length > 0) {
                        map.fitBounds(mapPoints, { padding: [40, 40], maxZoom: 15 });
                    }
                }

                // Attach Action Listeners for both Desktop and Mobile Views
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
                                showToast('Entry Deleted', 'Location entry has been deleted.', 'error');
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
                linksList.innerHTML = '';
                linksMobileCards.innerHTML = '';

                links.forEach(link => {
                    const fullUrl = `${window.location.origin}/t/${link.link_id}`;
                    
                    // Desktop row
                    const row = document.createElement('tr');
                    row.className = 'animate-fade';
                    
                    row.innerHTML = `
                        <td><strong>${escapeHtml(link.label)}</strong></td>
                        <td>${link.created_at}</td>
                        <td><span class="visits-badge">${link.visit_count}</span></td>
                        <td>
                            <label class="switch">
                                <input type="checkbox" class="toggle-link-status" data-id="${link.link_id}" ${link.is_active ? 'checked' : ''}>
                                <span class="slider"></span>
                            </label>
                        </td>
                        <td><input type="text" class="link-url-input" value="${fullUrl}" readonly style="background:transparent; border:none; width:100%; color:var(--text-muted); cursor:pointer;" onclick="this.select()"></td>
                        <td>
                            <div class="action-buttons">
                                <button class="btn btn-secondary btn-xs copy-row-btn" data-url="${fullUrl}">Copy</button>
                                <button class="btn btn-outline btn-xs show-qr-btn" data-id="${link.link_id}" data-url="${fullUrl}">Show QR</button>
                                <a href="https://wa.me/?text=${encodeURIComponent('Check this link: ' + fullUrl)}" target="_blank" class="btn btn-success btn-xs">WhatsApp</a>
                                <button class="btn btn-danger btn-xs delete-link-btn" data-id="${link.link_id}">Delete</button>
                            </div>
                        </td>
                    `;
                    linksList.appendChild(row);

                    // Mobile card
                    const mCard = document.createElement('div');
                    mCard.className = 'mobile-card animate-fade';
                    mCard.innerHTML = `
                        <div class="mobile-card-row">
                            <strong>${escapeHtml(link.label)}</strong>
                            <span class="visits-badge">${link.visit_count} visits</span>
                        </div>
                        <div class="mobile-card-meta">
                            <strong>Created:</strong> ${link.created_at}
                        </div>
                        <div class="mobile-card-meta" style="display:flex; justify-content:space-between; align-items:center;">
                            <strong>Active State:</strong>
                            <label class="switch">
                                <input type="checkbox" class="toggle-link-status" data-id="${link.link_id}" ${link.is_active ? 'checked' : ''}>
                                <span class="slider"></span>
                            </label>
                        </div>
                        <div class="mobile-card-actions">
                            <button class="btn btn-secondary btn-xs copy-row-btn" data-url="${fullUrl}">Copy</button>
                            <button class="btn btn-outline btn-xs show-qr-btn" data-id="${link.link_id}" data-url="${fullUrl}">Show QR</button>
                            <button class="btn btn-danger btn-xs delete-link-btn" data-id="${link.link_id}">Delete</button>
                        </div>
                    `;
                    linksMobileCards.appendChild(mCard);
                });

                // Attach Links Listeners
                document.querySelectorAll('.toggle-link-status').forEach(checkbox => {
                    checkbox.addEventListener('change', async function() {
                        const linkId = this.getAttribute('data-id');
                        const is_active = this.checked;
                        await fetch(`/api/links/${linkId}`, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ is_active })
                        });
                        showToast('Link Status Updated', `Link is now ${is_active ? 'active' : 'inactive'}.`, 'info');
                        resetCountdown();
                        loadData();
                    });
                });

                document.querySelectorAll('.copy-row-btn').forEach(btn => {
                    btn.addEventListener('click', function() {
                        const url = this.getAttribute('data-url');
                        navigator.clipboard.writeText(url);
                        showToast('Link Copied', 'Campaign tracking link copied to clipboard.', 'info');
                        const origText = this.textContent;
                        this.textContent = 'Copied!';
                        setTimeout(() => this.textContent = origText, 1500);
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
                                showToast('Campaign Deleted', 'Campaign and all captured locations removed.', 'error');
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

        // Generate QR code
        new QRCode(modalQrContainer, {
            text: url,
            width: 180,
            height: 180,
            colorDark: '#0f0f1a',
            colorLight: '#ffffff',
            correctLevel: QRCode.CorrectLevel.H
        });

        // Setup Download PNG click
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
        const labelVal = linkLabelInput.value.trim();
        const slug = labelVal ? labelVal.toLowerCase().replace(/[^a-z0-9]+/g, '-') : 'campaign-id';
        document.getElementById('preview-origin').textContent = window.location.origin;
        document.getElementById('preview-path').textContent = `/t/${slug}`;
    }

    linkLabelInput.addEventListener('input', updateLinkPreview);

    // Quick Tags click listener
    document.querySelectorAll('.btn-tag').forEach(btn => {
        btn.addEventListener('click', function() {
            linkLabelInput.value = this.getAttribute('data-tag');
            updateLinkPreview();
        });
    });

    // Generate Link Click Handler
    if (generateBtn) {
        generateBtn.addEventListener('click', async function() {
            const label = linkLabelInput.value.trim();
            if (!label) {
                showToast('Validation Error', 'Please enter a campaign label.', 'error');
                return;
            }

            const genRes = await fetch('/api/links/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ label })
            });

            if (genRes.ok) {
                const linkInfo = await genRes.json();
                const fullUrl = `${window.location.origin}/t/${linkInfo.link_id}`;
                
                resultLinkUrl.value = fullUrl;
                whatsappShareBtn.href = `https://wa.me/?text=${encodeURIComponent('Check this: ' + fullUrl)}`;
                
                // Render success QR code
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

                // Configure success QR download
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
                updateLinkPreview();
                
                showToast('Link Generated', 'New secure tracking link created successfully!', 'success');
                
                resetCountdown();
                loadData();
            } else {
                showToast('Server Error', 'Failed to generate tracking link.', 'error');
            }
        });
    }

    // Copy Link Button
    if (copyLinkBtn) {
        copyLinkBtn.addEventListener('click', function() {
            resultLinkUrl.select();
            navigator.clipboard.writeText(resultLinkUrl.value);
            showToast('Copied!', 'Generated campaign link copied.', 'info');
            const origText = this.textContent;
            this.textContent = 'Copied!';
            setTimeout(() => this.textContent = origText, 1500);
        });
    }

    // Auto Refresh Countdown timer
    function startTimer() {
        updateTimer = setInterval(() => {
            secondsSinceUpdate++;
            countdownVal++;

            // Update time indicator labels
            const updateText = `Last updated: ${secondsSinceUpdate === 0 ? 'just now' : secondsSinceUpdate + 's ago'}`;
            document.getElementById('last-updated-text').textContent = updateText;
            
            const locLastUpdated = document.getElementById('loc-last-updated');
            if (locLastUpdated) {
                locLastUpdated.textContent = updateText;
            }

            const countdownTimer = document.getElementById('countdown-timer');
            const mobileTimer = document.getElementById('mobile-refresh-countdown');
            const remaining = Math.max(0, 15 - countdownVal);
            
            countdownTimer.textContent = `${remaining}s`;
            if (mobileTimer) {
                mobileTimer.textContent = `${remaining}s`;
            }

            if (countdownVal >= 15) {
                countdownVal = 0;
                secondsSinceUpdate = 0;
                loadData();
            }
        }, 1000);
    }

    function resetCountdown() {
        countdownVal = 0;
        secondsSinceUpdate = 0;
    }

    // Initializations
    initMap();
    loadData();
    updateLinkPreview();
    startTimer();
});
