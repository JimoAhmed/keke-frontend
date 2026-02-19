// frontend/script.js - COMPLETE WITH ALL FIXES
let map, directionsService, directionsRenderer;
let userLocation = null;
let allLocations = [];
let selectedDestination = null;
let travelMode = null;
let watchId = null;
let route = null;
let currentStepIndex = 0;
let userMarker = null;
let voiceEnabled = true;
let navTrackerCollapsed = false;

// ============== MOBILE RESPONSIVENESS ==============
let isMobile = false;
let touchStartY = 0;

// TRICYCLE SYSTEM VARIABLES
let tricycleMarkers = [];
let tricyclePanelVisible = false;
let selectedTricycle = null;
let tricycleRefreshInterval = null;

// ETA & RESERVATION SYSTEM VARIABLES
let currentETA = null;
let reservationTimer = null;
let currentReservationId = null;
let tricycleRoutePolyline = null;
let tricycleMarker = null;
let tricycleSimulationInterval = null;
let ridePhase = 'none'; // 'none', 'pickup', 'trip', 'pool-waiting', 'pool-ride'

// Show Panel button management
let showPanelBtn = null;

// ============== KEKE-POOL VARIABLES ==============
let kekePoolMode = 'solo';
let currentPoolId = null;
let kekePoolRefreshInterval = null;
let kekePoolCheckInterval = null;
let poolRideData = null;
let currentPickupIndex = 0;
let pickupSimulationInterval = null;
let poolSyncState = null;
let serverClockOffsetMs = 0;
let kekePoolGroup = {
    id: null,
    destination: null,
    riders: [],
    maxRiders: 4,
    createdAt: null
};

// ============== ROUTE CACHE SYSTEM ==============
let routeCache = {};
let etaCache = {};
let popularRoutes = [];

// USER SESSION MANAGEMENT
let userSession = {
    hasActiveReservation: false,
    currentReservationId: null,
    reservationExpiry: null,
    vehicleId: null,
    vehicleName: null,
    vehicleDetails: null,
    passengerCount: 0,
    pickupETA: null
};

// Route API calls directly to Railway to avoid Vercel rewrite issues.
const API_BASE_URL = 'https://modest-luck-production-fbd9.up.railway.app';
const nativeFetch = window.fetch.bind(window);
window.fetch = (input, init) => {
    if (typeof input === 'string' && input.startsWith('/api/')) {
        return nativeFetch(`${API_BASE_URL}${input}`, init);
    }
    return nativeFetch(input, init);
};

// ============== MOBILE DETECTION ==============
function detectMobile() {
    isMobile = window.innerWidth <= 768 ||
               window.innerHeight <= 600 ||
               ('ontouchstart' in window) ||
               navigator.maxTouchPoints > 0;
    return isMobile;
}

// ============== CONTROLS BAR VISIBILITY ==============
function hideControls() {
    const controls = document.getElementById('controls');
    if (controls) controls.style.display = 'none';
}

function showControls() {
    const controls = document.getElementById('controls');
    if (controls) controls.style.display = 'block';
}

// ============== RESPONSIVE PANEL POSITIONING ==============
function getResponsivePanelPosition(panelType = 'tracker') {
    detectMobile();
    if (isMobile) {
        switch(panelType) {
            case 'tracker': return { position:'fixed', bottom:'10px', left:'10px', right:'10px', width:'auto', maxWidth:'calc(100% - 20px)' };
            case 'tracking': return { position:'fixed', bottom:'0', left:'0', right:'0', width:'100%', maxWidth:'100%', borderRadius:'20px 20px 0 0', maxHeight:'70vh' };
            case 'button': return { position:'fixed', bottom:'20px', right:'20px', padding:'14px 20px', fontSize:'16px' };
            case 'tricycle-panel': return { position:'fixed', bottom:'0', left:'0', right:'0', width:'100%', maxWidth:'100%', borderRadius:'20px 20px 0 0', maxHeight:'70vh', zIndex:'2000' };
            default: return {};
        }
    } else {
        switch(panelType) {
            case 'tracker': return { position:'fixed', bottom:'20px', left:'20px', width: navTrackerCollapsed ? '280px' : '300px' };
            case 'tracking': return { position:'fixed', bottom:'20px', right:'20px', width:'320px', borderRadius:'10px' };
            case 'button': return { position:'fixed', bottom:'20px', right:'20px', padding:'10px 15px', fontSize:'0.9em' };
            case 'tricycle-panel': return { position:'fixed', top:'80px', right:'20px', width:'320px', maxWidth:'90%', borderRadius:'10px' };
            default: return {};
        }
    }
}

// ============== TOUCH HANDLERS FOR MOBILE ==============
function addSwipeToDismiss(element, callback) {
    if (!isMobile || !element) return;
    element.addEventListener('touchstart', function(e) { touchStartY = e.touches[0].clientY; }, { passive: true });
    element.addEventListener('touchmove', function(e) {
        if (!touchStartY) return;
        const deltaY = e.touches[0].clientY - touchStartY;
        if (deltaY > 100) { callback(); touchStartY = 0; }
    }, { passive: true });
    element.addEventListener('touchend', function() { touchStartY = 0; });
}

function syncServerClock(serverTime) {
    if (!serverTime) return;
    const parsed = new Date(serverTime).getTime();
    if (!Number.isNaN(parsed)) serverClockOffsetMs = parsed - Date.now();
}

function getSyncedNowMs() {
    return Date.now() + serverClockOffsetMs;
}

function hideEndNavigationButton() {
    const endNavBtn = document.getElementById('end-navigation-btn');
    if (endNavBtn) endNavBtn.classList.remove('visible');
}

function getTrackerElementById(id) {
    return document.querySelector(`#navigation-tracker #${id}`) || document.getElementById(id);
}

// ============================================
// PAGE INITIALIZATION
// ============================================

function checkPreSelectedCategory() {
    const selectedCategory = localStorage.getItem('selectedCategory');
    if (selectedCategory) {
        const categorySelect = document.getElementById('category-select');
        if (categorySelect) { categorySelect.value = selectedCategory; filterLocations(); }
        localStorage.removeItem('selectedCategory');
    }
}

function checkExistingReservation() {
    const savedReservation = localStorage.getItem('activeReservation');
    if (savedReservation) {
        const reservation = JSON.parse(savedReservation);
        const now = new Date();
        const expiry = new Date(reservation.expiry);
        if (now < expiry) {
            userSession = reservation;
            ridePhase = 'pickup';
            setTimeout(() => { startReservationTracking(reservation.currentReservationId); }, 1500);
        } else {
            localStorage.removeItem('activeReservation');
            ridePhase = 'none';
        }
    }
}

document.addEventListener('DOMContentLoaded', function() {
    detectMobile();
    window.addEventListener('resize', function() {
        const wasMobile = isMobile;
        detectMobile();
        if (wasMobile !== isMobile) {
            if (document.getElementById('navigation-tracker')) createNavigationTracker();
            if (document.getElementById('tracking-panel')) Object.assign(document.getElementById('tracking-panel').style, getResponsivePanelPosition('tracking'));
            if (showPanelBtn) Object.assign(showPanelBtn.style, getResponsivePanelPosition('button'));
            if (document.getElementById('tricycle-panel')) Object.assign(document.getElementById('tricycle-panel').style, getResponsivePanelPosition('tricycle-panel'));
        }
    });
    setTimeout(checkPreSelectedCategory, 500);
    setTimeout(checkExistingReservation, 1000);
    const voiceBtn = document.getElementById("voice-toggle");
    if (voiceBtn) {
        voiceBtn.addEventListener("click", () => {
            voiceEnabled = !voiceEnabled;
            voiceBtn.innerText = voiceEnabled ? "ðŸ”Š Voice ON" : "ðŸ”‡ Voice OFF";
        });
    }
    if (!document.getElementById('end-navigation-btn')) {
        const endNavBtn = document.createElement('button');
        endNavBtn.id = 'end-navigation-btn';
        endNavBtn.innerHTML = '<i class="fas fa-stop-circle"></i> End Navigation';
        endNavBtn.onclick = endNavigation;
        document.body.appendChild(endNavBtn);
    }
});

// ============================================
// MAP INITIALIZATION
// ============================================

function initMap() {
    directionsService = new google.maps.DirectionsService();
    directionsRenderer = new google.maps.DirectionsRenderer({
        suppressMarkers: false,
        suppressInfoWindows: true,
        preserveViewport: true
    });
    const babcockBounds = { north:6.901672033798405, south:6.886258403718255, west:3.7023721168457366, east:3.733442908563357 };
    const campusCenter = { lat:(6.901672033798405+6.886258403718255)/2, lng:(3.7023721168457366+3.733442908563357)/2 };
    map = new google.maps.Map(document.getElementById("map"), {
        center: campusCenter, zoom: isMobile ? 16 : 17,
        restriction: { latLngBounds: babcockBounds, strictBounds: true },
        minZoom: 15, maxZoom: 20,
        streetViewControl: !isMobile, mapTypeControl: !isMobile,
        fullscreenControl: true, gestureHandling: isMobile ? 'greedy' : 'auto'
    });
    directionsRenderer.setMap(map);
    new google.maps.Polygon({
        paths: [
            {lat:6.901672033798405,lng:3.7023721168457366},{lat:6.901672033798405,lng:3.733442908563357},
            {lat:6.886258403718255,lng:3.733442908563357},{lat:6.886258403718255,lng:3.7023721168457366}
        ],
        strokeColor:"#004080",strokeOpacity:0.7,strokeWeight:isMobile?2:3,fillColor:"#004080",fillOpacity:0.05,map:map
    });
    const bounds = new google.maps.LatLngBounds();
    bounds.extend({lat:6.901672033798405,lng:3.7023721168457366});
    bounds.extend({lat:6.886258403718255,lng:3.733442908563357});
    map.fitBounds(bounds);
    fetch("locations.json").then(res=>res.json()).then(data=>{ allLocations=data; populateDatalist(data); preloadPopularRoutes(); });
    checkBackendConnection();
}

function requestLocation() {
    if (!navigator.geolocation) { alert("Geolocation is not supported by your browser"); return; }

    // Immediately restore last known location so the map is not blank while GPS loads
    const lastLocationRaw = localStorage.getItem('lastLocation');
    if (lastLocationRaw) {
        try {
            const cached = JSON.parse(lastLocationRaw);
            if (!userLocation) {
                userLocation = cached;
                updateMapWithLocation(userLocation);
            }
        } catch(e) {}
    }

    const doGetLocation = () => {
        navigator.geolocation.getCurrentPosition(
            position => {
                userLocation = { lat: position.coords.latitude, lng: position.coords.longitude };
                localStorage.setItem('lastLocation', JSON.stringify(userLocation));
                updateMapWithLocation(userLocation);
                if (userSession.hasActiveReservation) updateReservationStatus(userSession.currentReservationId);
            },
            error => {
                if (error.code === 1) {
                    alert("Location permission denied. Please tap the lock icon in your browser address bar, enable Location, then refresh the page.");
                    checkBackendConnection();
                    return;
                }
                // Retry without high accuracy (handles indoor GPS failure)
                navigator.geolocation.getCurrentPosition(
                    position => {
                        userLocation = { lat: position.coords.latitude, lng: position.coords.longitude };
                        localStorage.setItem('lastLocation', JSON.stringify(userLocation));
                        updateMapWithLocation(userLocation);
                        if (userSession.hasActiveReservation) updateReservationStatus(userSession.currentReservationId);
                    },
                    fallbackError => {
                        if (!userLocation) {
                            if (fallbackError.code === 2) {
                                alert("Could not detect your location. Please ensure Location Services are enabled for your browser in your phone Settings, then refresh.");
                            } else {
                                alert("Location timed out. Please move to an area with better signal and try again.");
                            }
                        }
                        checkBackendConnection();
                    },
                    { enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 }
                );
            },
            { enableHighAccuracy: true, timeout: 20000, maximumAge: 30000 }
        );
    };

    // Use Permissions API to check status first (supported on Chrome/Android)
    // This tells us the real permission state before we even try
    if (navigator.permissions && navigator.permissions.query) {
        navigator.permissions.query({ name: 'geolocation' }).then(result => {
            if (result.state === 'denied') {
                // Definitively denied in browser settings â€” can't fix with JS
                alert(
                    "Location is blocked for this site.\n\n" +
                    "To fix this:\n" +
                    "â€¢ Chrome: tap the ðŸ”’ lock icon â†’ Site settings â†’ Location â†’ Allow\n" +
                    "â€¢ Safari: Settings app â†’ Safari â†’ Location â†’ Allow\n\n" +
                    "Then refresh the page."
                );
                checkBackendConnection();
                return;
            }
            // 'granted' or 'prompt' â€” go ahead and request
            doGetLocation();
        }).catch(() => {
            // Permissions API not supported â€” just try directly
            doGetLocation();
        });
    } else {
        doGetLocation();
    }
}

function updateMapWithLocation(location) {
    if (userMarker) userMarker.setMap(null);
    userMarker = new google.maps.Marker({
        position: location, map,
        title: "You",
        icon: { url: "https://maps.google.com/mapfiles/ms/icons/blue-dot.png", scaledSize: new google.maps.Size(isMobile?32:40, isMobile?32:40) }
    });
    map.setCenter(location);
    map.setZoom(isMobile ? 17 : 18);
}

function preloadPopularRoutes() {
    if (!allLocations.length || !userLocation) return;
    const popularDestinations = allLocations.filter(loc =>
        ['Gate','Library','Chapel','Cafe'].some(term => loc.name.includes(term))
    ).slice(0, 3);
    popularDestinations.forEach(dest => {
        const cacheKey = `${userLocation.lat},${userLocation.lng}|${dest.lat},${dest.lng}|DRIVING`;
        directionsService.route({ origin:userLocation, destination:{lat:dest.lat,lng:dest.lng}, travelMode:google.maps.TravelMode.DRIVING },
            (result, status) => { if (status==='OK') { routeCache[cacheKey]=result; } });
    });
}

function requestRoute() {
    if (!userLocation || !selectedDestination) { alert("Missing location or destination"); return; }
    const instructionEl = document.getElementById('current-instruction');
    if (instructionEl) instructionEl.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Finding best route...';
    const cacheKey = `${userLocation.lat.toFixed(6)},${userLocation.lng.toFixed(6)}|${selectedDestination.lat},${selectedDestination.lng}|${travelMode}`;
    if (routeCache[cacheKey]) {
        route = routeCache[cacheKey]; currentStepIndex = 0;
        directionsRenderer.setDirections(route); updateTrackerWithRoute(route); updateInstruction();
        return;
    }
    directionsService.route({
        origin: userLocation, destination: {lat:selectedDestination.lat,lng:selectedDestination.lng},
        travelMode: google.maps.TravelMode[travelMode], provideRouteAlternatives: false
    }, (result, status) => {
        if (status === "OK") {
            routeCache[cacheKey] = result; route = result; currentStepIndex = 0;
            directionsRenderer.setDirections(result); updateTrackerWithRoute(result); updateInstruction();
        } else {
            if (instructionEl) instructionEl.innerHTML = '<i class="fas fa-exclamation-triangle" style="color:#dc3545;"></i> Route failed - try again';
            alert("Could not find a route. Please try a different travel mode.");
        }
    });
}

function getFastETA(origin, destination) {
    return new Promise((resolve) => {
        const cacheKey = `${origin.lat},${origin.lng}|${destination.lat},${destination.lng}|DRIVING`;
        if (etaCache[cacheKey]) { resolve(etaCache[cacheKey]); return; }
        const distance = google.maps.geometry.spherical.computeDistanceBetween(
            new google.maps.LatLng(origin.lat, origin.lng),
            new google.maps.LatLng(destination.lat, destination.lng)
        );
        const distanceKm = distance / 1000;
        const estimatedMinutes = Math.ceil((distanceKm / 20) * 60);
        resolve({ text: estimatedMinutes+' min', value: estimatedMinutes*60, distanceText: distanceKm.toFixed(1)+' km', distanceValue: distance });
    });
}

function getAccurateETA(origin, destination) {
    return new Promise((resolve) => {
        const cacheKey = `${origin.lat},${origin.lng}|${destination.lat},${destination.lng}|DRIVING|ACCURATE`;
        if (etaCache[cacheKey]) { resolve(etaCache[cacheKey]); return; }
        const ds = new google.maps.DirectionsService();
        ds.route({ origin, destination, travelMode: google.maps.TravelMode.DRIVING }, (result, status) => {
            if (status === 'OK') {
                const leg = result.routes[0].legs[0];
                const eta = { text:leg.duration.text, value:leg.duration.value, distanceText:leg.distance.text, distanceValue:leg.distance.value };
                etaCache[cacheKey] = eta; resolve(eta);
            } else {
                const distance = google.maps.geometry.spherical.computeDistanceBetween(
                    new google.maps.LatLng(origin.lat, origin.lng),
                    new google.maps.LatLng(destination.lat, destination.lng)
                );
                const distanceKm = distance / 1000;
                const estimatedMinutes = Math.ceil((distanceKm / 20) * 60);
                resolve({ text:estimatedMinutes+' min', value:estimatedMinutes*60, distanceText:distanceKm.toFixed(1)+' km', distanceValue:distance });
            }
        });
    });
}

function hideSplash() {
    document.getElementById("splash").style.display = "none";
    document.getElementById("controls").style.display = "block";
    // Called here (not in initMap) so it fires from a user tap.
    // iOS Safari blocks geolocation unless triggered by a direct user gesture.
    requestLocation();
}

// ============================================
// NAVIGATION FUNCTIONS
// ============================================

function populateDatalist(locations) {
    const datalist = document.getElementById("locations");
    datalist.innerHTML = "";
    locations.forEach(loc => { const opt = document.createElement("option"); opt.value = loc.name; datalist.appendChild(opt); });
}

function filterLocations() {
    const category = document.getElementById("category-select").value;
    const filtered = category.toLowerCase() === "all" ? allLocations : allLocations.filter(loc => loc.category === category);
    populateDatalist(filtered);
}

function startNavigation() {
    const input = document.getElementById("destination-input").value.trim();
    const match = allLocations.find(loc => loc.name.toLowerCase() === input.toLowerCase() && !loc.name.includes("Tricycle #"));
    if (!match) { alert("Please choose a valid campus location from the list."); return; }
    selectedDestination = match;
    if (!userSession.hasActiveReservation) {
        document.getElementById("mode-selector").classList.remove("hidden");
    }
    if (tricyclePanelVisible) toggleTricycleView();
    clearTricycleMarkers();
}

function startDirections(mode) {
    travelMode = mode;
    if (!selectedDestination) return;
    document.getElementById("mode-selector").classList.add("hidden");
    hideControls();
    createNavigationTracker();
    const endNavBtn = document.getElementById('end-navigation-btn');
    if (endNavBtn && !userSession.hasActiveReservation) endNavBtn.classList.add('visible');
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);

    const startWatchingPosition = () => {
        watchId = navigator.geolocation.watchPosition(
            position => {
                userLocation = { lat: position.coords.latitude, lng: position.coords.longitude };
                if (userMarker) userMarker.setMap(null);
                userMarker = new google.maps.Marker({
                    position: userLocation, map,
                    title: "You",
                    icon: { path: google.maps.SymbolPath.CIRCLE, scale: isMobile?6:7, fillColor:'#0000FF', fillOpacity:1, strokeWeight:1, strokeColor:'#ffffff' }
                });
                map.panTo(userLocation);
                checkUserProgress();
            },
            error => console.warn("Watch position error:", error),
            { enableHighAccuracy: true, maximumAge: 10000, timeout: 30000 }
        );
        requestRoute();
    };

    // iOS Safari: use getCurrentPosition first to ensure permission is granted,
    // then start watchPosition. Avoids silent error code 1 on watchPosition alone.
    navigator.geolocation.getCurrentPosition(
        position => {
            userLocation = { lat: position.coords.latitude, lng: position.coords.longitude };
            localStorage.setItem('lastLocation', JSON.stringify(userLocation));
            startWatchingPosition();
        },
        error => {
            // Permission denied or unavailable â€” still try to navigate with last known location
            console.warn('getCurrentPosition failed before watch:', error);
            startWatchingPosition();
        },
        { enableHighAccuracy: true, maximumAge: 30000, timeout: 20000 }
    );
}

function createNavigationTracker() {
    const existingTracker = document.getElementById('navigation-tracker');
    if (existingTracker) existingTracker.remove();
    detectMobile();
    const pos = getResponsivePanelPosition('tracker');
    const tracker = document.createElement('div');
    tracker.id = 'navigation-tracker';
    Object.assign(tracker.style, {
        position: pos.position, bottom: pos.bottom, left: pos.left, right: pos.right,
        width: pos.width || (navTrackerCollapsed ? '280px' : '300px'),
        maxWidth: pos.maxWidth || 'none',
        zIndex: '1000', background: 'rgba(255,255,255,0.98)',
        borderRadius: isMobile ? '15px' : '10px',
        boxShadow: '0 4px 20px rgba(0,0,0,0.2)', backdropFilter: 'blur(10px)',
        border: '1px solid rgba(0,64,128,0.2)',
        maxHeight: navTrackerCollapsed ? (isMobile?'70px':'60px') : (isMobile?'65vh':'400px'),
        overflowX: 'hidden', overflowY: navTrackerCollapsed ? 'hidden' : 'auto',
        WebkitOverflowScrolling: 'touch',
        transition: 'all 0.3s ease',
        pointerEvents: 'auto', fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif"
    });
    const mobileHandle = isMobile && !navTrackerCollapsed ? `<div style="width:40px;height:5px;background:#ccc;border-radius:3px;margin:5px auto 10px;"></div>` : '';
    tracker.innerHTML = `
        <div style="padding:${navTrackerCollapsed?(isMobile?'12px 15px':'12px 15px'):(isMobile?'15px':'15px')}">
            ${mobileHandle}
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:${navTrackerCollapsed?'0':(isMobile?'12px':'10px')};">
                <div style="display:flex;align-items:center;gap:${isMobile?'12px':'10px'};">
                    <div style="background:#004080;color:white;width:${isMobile?'44px':'40px'};height:${isMobile?'44px':'40px'};border-radius:${isMobile?'10px':'8px'};display:flex;align-items:center;justify-content:center;">
                        <i class="fas fa-${getTravelModeIcon()}" style="font-size:${isMobile?'22px':'20px'};"></i>
                    </div>
                    <div>
                        <h3 style="margin:0;color:#004080;font-size:${isMobile?'1.1em':'0.95em'};font-weight:bold;">
                            ${navTrackerCollapsed ? 'To: '+selectedDestination.name.substring(0,isMobile?20:15)+'...' : 'Navigation Active'}
                        </h3>
                        ${!navTrackerCollapsed ? `<div style="font-size:${isMobile?'0.9em':'0.8em'};color:#666;margin-top:2px;">${travelMode==='DRIVING'?'DRIVE':travelMode} â€¢ ${selectedDestination.name}</div>` : ''}
                    </div>
                </div>
                <div style="display:flex;gap:${isMobile?'10px':'5px'};">
                    <button onclick="toggleNavTracker()" style="width:${isMobile?'44px':'30px'};height:${isMobile?'44px':'30px'};display:flex;align-items:center;justify-content:center;background:#f8f9fa;color:#004080;border:1px solid #dee2e6;border-radius:${isMobile?'10px':'6px'};cursor:pointer;font-size:${isMobile?'18px':'12px'};">
                        <i class="fas fa-${navTrackerCollapsed?'chevron-down':'chevron-up'}"></i>
                    </button>
                    <button onclick="toggleVoice()" style="width:${isMobile?'44px':'30px'};height:${isMobile?'44px':'30px'};display:flex;align-items:center;justify-content:center;background:${voiceEnabled?'#17a2b8':'#6c757d'};color:white;border:none;border-radius:${isMobile?'10px':'6px'};cursor:pointer;font-size:${isMobile?'20px':'12px'};">
                        ${voiceEnabled?"ðŸ”Š":"ðŸ”‡"}
                    </button>
                </div>
            </div>
            ${!navTrackerCollapsed ? `
                <div style="margin:${isMobile?'15px 0':'10px 0'};padding:${isMobile?'15px':'10px'};background:linear-gradient(135deg,#f8f9fa 0%,#ffffff 100%);border-radius:${isMobile?'12px':'8px'};border:1px solid #e9ecef;">
                    <div style="display:flex;justify-content:space-between;margin-bottom:${isMobile?'12px':'10px'};">
                        <div style="flex:1;text-align:center;"><div style="color:#6c757d;font-size:0.8em;margin-bottom:5px;">Distance</div><div id="tracker-distance" style="font-weight:bold;color:#004080;font-size:${isMobile?'1.3em':'1.2em'};">--</div></div>
                        <div style="flex:1;text-align:center;"><div style="color:#6c757d;font-size:0.8em;margin-bottom:5px;">Time</div><div id="tracker-duration" style="font-weight:bold;color:#28a745;font-size:${isMobile?'1.3em':'1.2em'};">--</div></div>
                        <div style="flex:1;text-align:center;"><div style="color:#6c757d;font-size:0.8em;margin-bottom:5px;">Next Turn</div><div id="next-turn-distance" style="font-weight:bold;color:#dc3545;font-size:${isMobile?'1.1em':'1.2em'};">--</div></div>
                    </div>
                    <div style="background:#e9ecef;height:${isMobile?'6px':'4px'};border-radius:3px;margin:${isMobile?'15px 0':'10px 0'};overflow:hidden;">
                        <div id="progress-bar" style="height:100%;background:#28a745;width:0%;transition:width 0.3s;"></div>
                    </div>
                </div>
                <div id="current-instruction-container" style="margin:${isMobile?'15px 0':'10px 0'};padding:${isMobile?'15px':'12px'};background:#e9f7ff;border-radius:${isMobile?'12px':'8px'};border-left:4px solid #004080;">
                    <div style="font-size:0.8em;color:#6c757d;margin-bottom:5px;"><i class="fas fa-info-circle"></i> Current instruction</div>
                    <div id="current-instruction" style="font-size:${isMobile?'1.1em':'0.95em'};color:#004080;font-weight:600;line-height:1.5;"><i class="fas fa-spinner fa-spin"></i> Calculating route...</div>
                </div>
                <div style="display:flex;gap:${isMobile?'12px':'10px'};margin-top:${isMobile?'15px':'10px'};">
                    <button onclick="map.panTo(userLocation)" style="flex:1;padding:${isMobile?'14px 0':'10px 0'};background:#17a2b8;color:white;border:none;border-radius:${isMobile?'10px':'8px'};cursor:pointer;font-size:${isMobile?'1em':'0.9em'};font-weight:bold;"><i class="fas fa-location-arrow"></i> My Location</button>
                    <button onclick="map.setZoom(18)" style="flex:1;padding:${isMobile?'14px 0':'10px 0'};background:#6c757d;color:white;border:none;border-radius:${isMobile?'10px':'8px'};cursor:pointer;font-size:${isMobile?'1em':'0.9em'};font-weight:bold;"><i class="fas fa-search-plus"></i> Zoom</button>
                </div>
            ` : `
                <div style="display:flex;justify-content:space-between;margin-top:5px;">
                    <span style="font-size:${isMobile?'0.95em':'0.9em'};color:#6c757d;">${selectedDestination?.name?.substring(0,isMobile?30:25)}</span>
                    <span><span id="mini-distance" style="color:#004080;font-weight:bold;margin-right:${isMobile?'12px':'10px'};">--</span><span id="mini-duration" style="color:#28a745;font-weight:bold;">--</span></span>
                </div>
            `}
        </div>
    `;
    document.body.appendChild(tracker);
    if (isMobile) addSwipeToDismiss(tracker, function() { if (!navTrackerCollapsed) toggleNavTracker(); });
}

function getTravelModeIcon() {
    switch(travelMode) {
        case 'WALKING': return 'walking';
        case 'DRIVING':
            if (ridePhase==='trip'||ridePhase==='pickup'||ridePhase==='pool-ride') return 'motorcycle';
            return 'car';
        default: return 'directions';
    }
}

function toggleNavTracker() { navTrackerCollapsed = !navTrackerCollapsed; createNavigationTracker(); }

function toggleVoice() {
    voiceEnabled = !voiceEnabled;
    createNavigationTracker();
    if (voiceEnabled) speechSynthesis.speak(new SpeechSynthesisUtterance("Voice guidance enabled"));
}

function updateTrackerWithRoute(routeResult) {
    const leg = routeResult.routes[0].legs[0];
    const distanceEl = getTrackerElementById('tracker-distance');
    const durationEl = getTrackerElementById('tracker-duration');
    const miniDistanceEl = getTrackerElementById('mini-distance');
    const miniDurationEl = getTrackerElementById('mini-duration');
    if (distanceEl) distanceEl.textContent = leg.distance.text;
    if (durationEl) durationEl.textContent = leg.duration.text;
    if (miniDistanceEl) miniDistanceEl.textContent = leg.distance.text;
    if (miniDurationEl) miniDurationEl.textContent = leg.duration.text;
    if (leg.steps.length > 0) {
        const instruction = leg.steps[0].instructions.replace(/<[^>]+>/g, '');
        const instructionEl = getTrackerElementById('current-instruction');
        if (instructionEl) instructionEl.innerHTML = `<i class="fas fa-play"></i> ${instruction}`;
    }
}

function checkUserProgress() {
    if (!route || !userLocation) return;
    const leg = route.routes[0].legs[0];
    const totalDistance = leg.distance.value;
    let traveledDistance = 0;
    for (let i = 0; i < currentStepIndex; i++) traveledDistance += leg.steps[i].distance.value;
    if (currentStepIndex < leg.steps.length) {
        const currentStep = leg.steps[currentStepIndex];
        const stepStart = currentStep.start_location;
        const distanceToStepStart = haversineDistance(userLocation, { lat: stepStart.lat(), lng: stepStart.lng() });
        traveledDistance += currentStep.distance.value - (distanceToStepStart * 1000);
    }
    const progressPercent = (traveledDistance / totalDistance) * 100;
    const progressBar = document.getElementById('progress-bar');
    if (progressBar) progressBar.style.width = Math.min(progressPercent, 100) + '%';
    if (currentStepIndex >= leg.steps.length) {
        updateInstruction("âœ… Arrived at destination!");
        if (ridePhase==='trip'||ridePhase==='pool-ride') showRideCompletedPopup();
        setTimeout(() => { if (ridePhase!=='trip'&&ridePhase!=='pool-ride') endNavigation(); }, 3000);
        return;
    }
    const step = leg.steps[currentStepIndex];
    const stepEnd = step.end_location;
    const distanceToStepEnd = haversineDistance(userLocation, { lat: stepEnd.lat(), lng: stepEnd.lng() });
    updateNextTurnDistance(distanceToStepEnd);
    if (distanceToStepEnd < 0.02) {
        currentStepIndex++;
        if (currentStepIndex < leg.steps.length) {
            updateInstruction();
        } else {
            updateInstruction("âœ… Arrived at destination!");
            if (ridePhase==='trip'||ridePhase==='pool-ride') showRideCompletedPopup();
            if (ridePhase!=='trip'&&ridePhase!=='pool-ride') setTimeout(() => endNavigation(), 3000);
        }
    }
}

function updateInstruction(manualInstruction = null) {
    if (!route && !manualInstruction) return;
    const instructionEl = getTrackerElementById('current-instruction');
    if (!instructionEl) return;
    if (manualInstruction) {
        instructionEl.innerHTML = `<i class="fas fa-check-circle"></i> ${manualInstruction}`;
        if (voiceEnabled && 'speechSynthesis' in window) speechSynthesis.speak(new SpeechSynthesisUtterance(manualInstruction));
        return;
    }
    const leg = route.routes[0].legs[0];
    const step = leg.steps[currentStepIndex];
    const instructionText = step.instructions.replace(/<[^>]+>/g, '');
    const distanceText = step.distance.text;
    instructionEl.innerHTML = `<i class="fas fa-arrow-right"></i> ${instructionText} <span style="color:#666;font-size:${isMobile?'0.85em':'0.8em'};">(${distanceText})</span>`;
    if (voiceEnabled && 'speechSynthesis' in window) speechSynthesis.speak(new SpeechSynthesisUtterance(instructionText));
}

function updateNextTurnDistance(distance) {
    const distanceElement = getTrackerElementById('next-turn-distance');
    if (distanceElement) distanceElement.textContent = `${(distance * 1000).toFixed(0)} m`;
}

function haversineDistance(coord1, coord2) {
    function toRad(x) { return x * Math.PI / 180; }
    const R = 6371;
    const dLat = toRad(coord2.lat - coord1.lat);
    const dLon = toRad(coord2.lng - coord1.lng);
    const lat1 = toRad(coord1.lat);
    const lat2 = toRad(coord2.lat);
    const a = Math.sin(dLat/2)**2 + Math.sin(dLon/2)**2 * Math.cos(lat1) * Math.cos(lat2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function calculateHaversineDistance(coord1, coord2) { return haversineDistance(coord1, coord2); }

function endNavigation() {
    if ((userSession.hasActiveReservation && ridePhase==='trip') || ridePhase==='pool-ride') {
        alert("Cannot end navigation while in an active ride. Please complete or cancel the ride first.");
        return;
    }
    if (watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
    route = null; currentStepIndex = 0; selectedDestination = null; travelMode = null; navTrackerCollapsed = false;
    directionsRenderer.setDirections({ routes: [] });
    const tracker = document.getElementById('navigation-tracker');
    if (tracker) tracker.remove();
    const endNavBtn = document.getElementById('end-navigation-btn');
    if (endNavBtn) endNavBtn.classList.remove('visible');
    document.getElementById("mode-selector").classList.add("hidden");
    document.getElementById("destination-input").value = "";
    if (!userSession.hasActiveReservation) ridePhase = 'none';
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    if (userMarker) { userMarker.setMap(null); userMarker = null; }
    showControls();
    alert("Navigation ended.");
}

// ============================================
// TRICYCLE AVAILABILITY SYSTEM
// ============================================

function initializeTricycleSystem() {
    fetch('/api/vehicles')
        .then(response => { if (!response.ok) throw new Error('Backend not responding'); return response.json(); })
        .then(data => {
            const tricyclePanel = document.getElementById('tricycle-panel');
            if (tricyclePanel) {
                tricyclePanel.classList.add('hidden');
                tricyclePanelVisible = false;
                Object.assign(tricyclePanel.style, getResponsivePanelPosition('tricycle-panel'));
            }
            // NOTE: createFindTricyclesButton() intentionally NOT called here â€”
            // the green "Find Campus Tricycles" button has been removed.
        })
        .catch(error => console.error('Backend connection failed:', error));
}

// createFindTricyclesButton() REMOVED â€” green button eliminated per requirements.

function toggleTricycleView() {
    const tricyclePanel = document.getElementById('tricycle-panel');
    const findBtn = document.getElementById('find-tricycles-btn');
    if (userSession.hasActiveReservation && (ridePhase==='pickup'||ridePhase==='trip'||ridePhase==='pool-waiting'||ridePhase==='pool-ride')) {
        alert("Cannot view other tricycles while your ride is in progress.");
        return;
    }
    if (tricyclePanelVisible) {
        tricyclePanel.classList.add('hidden');
        if (findBtn) findBtn.innerHTML = '<i class="fas fa-shuttle-van"></i> Find Campus Tricycles';
        clearTricycleMarkers();
        stopTricycleRefresh();
    } else {
        tricyclePanel.classList.remove('hidden');
        if (findBtn) findBtn.innerHTML = '<i class="fas fa-times"></i> Hide Tricycles';
        Object.assign(tricyclePanel.style, getResponsivePanelPosition('tricycle-panel'));
        loadAvailableTricycles();
        startTricycleRefresh();
        if (isMobile) setTimeout(() => addSwipeToDismiss(tricyclePanel, function() { toggleTricycleView(); }), 100);
    }
    tricyclePanelVisible = !tricyclePanelVisible;
}

async function loadAvailableTricycles() {
    if (userSession.hasActiveReservation && (ridePhase==='pickup'||ridePhase==='trip'||ridePhase==='pool-waiting'||ridePhase==='pool-ride')) {
        document.getElementById('tricycle-list').innerHTML = `
            <div style="text-align:center;padding:${isMobile?'40px 20px':'30px'};">
                <h3 style="color:#004080;">Ride in Progress</h3>
                <p>Tricycle view is disabled while your ride is in progress.</p>
            </div>`;
        return;
    }
    try {
        const tricycleList = document.getElementById('tricycle-list');
        if (userSession.hasActiveReservation) {
            tricycleList.innerHTML = `
                <div style="text-align:center;padding:${isMobile?'40px 20px':'30px'};">
                    <h3 style="color:#004080;">Active Reservation Found</h3>
                    <p>Reservation ID: ${userSession.currentReservationId}<br>Passengers: ${userSession.passengerCount||1}/4</p>
                    <div style="display:flex;flex-direction:${isMobile?'column':'row'};gap:10px;margin-top:20px;">
                        <button onclick="centerOnTricycle()" style="padding:${isMobile?'14px':'10px 20px'};background:#17a2b8;color:white;border:none;border-radius:${isMobile?'10px':'5px'};cursor:pointer;"><i class="fas fa-crosshairs"></i> Center on Tricycle</button>
                        <button onclick="completeRide()" style="padding:${isMobile?'14px':'10px 20px'};background:#28a745;color:white;border:none;border-radius:${isMobile?'10px':'5px'};cursor:pointer;"><i class="fas fa-check"></i> Complete Ride</button>
                        <button onclick="cancelReservationAndClear()" style="padding:${isMobile?'14px':'10px 20px'};background:#dc3545;color:white;border:none;border-radius:${isMobile?'10px':'5px'};cursor:pointer;"><i class="fas fa-times"></i> Cancel Ride</button>
                    </div>
                </div>`;
            return;
        }
        tricycleList.innerHTML = `<p style="text-align:center;padding:40px;font-size:${isMobile?'1.2em':'1em'};">Loading tricycles...</p>`;
        let url = '/api/vehicles/available';
        if (userLocation) url = `/api/vehicles/nearby?lat=${userLocation.lat}&lng=${userLocation.lng}&radius=2`;
        const response = await fetch(url);
        const tricycles = await response.json();
        displayTricycles(tricycles);
        showTricycleMarkers(tricycles);
    } catch (error) {
        console.error('Error loading tricycles:', error);
        document.getElementById('tricycle-list').innerHTML = `
            <div style="text-align:center;padding:${isMobile?'40px':'30px'};">
                <p><i class="fas fa-exclamation-triangle" style="font-size:${isMobile?'48px':'36px'};color:#dc3545;"></i></p>
                <p>Unable to load tricycles.</p>
                <button onclick="loadAvailableTricycles()" style="margin-top:20px;padding:${isMobile?'14px 30px':'10px 20px'};background:#004080;color:white;border:none;border-radius:${isMobile?'10px':'5px'};">Retry</button>
            </div>`;
    }
}

function displayTricycles(tricycles) {
    const tricycleList = document.getElementById('tricycle-list');
    if (!tricycles || tricycles.length === 0) {
        tricycleList.innerHTML = `<div style="text-align:center;padding:${isMobile?'40px':'30px'};"><p><i class="fas fa-shuttle-van" style="font-size:${isMobile?'48px':'36px'};color:#6c757d;"></i></p><p>No tricycles available nearby.</p></div>`;
        return;
    }
    let html = '';
    tricycles.forEach(tricycle => {
        const passengerCount = tricycle.passengerCount || 0;
        const maxCapacity = tricycle.maxCapacity || 4;
        const isFull = passengerCount >= maxCapacity;
        const isPoolLocked = tricycle.reservedForPool === true;
        let batteryClass = passengerCount < 50 ? 'battery-high' : (tricycle.battery < 50 ? 'battery-medium' : 'battery-high');
        if (tricycle.battery < 50) batteryClass = 'battery-medium';
        if (tricycle.battery < 30) batteryClass = 'battery-low';
        html += `
            <div class="tricycle-card" onclick="selectTricycle(${tricycle.id})" data-tricycle-id="${tricycle.id}" style="background:white;border-radius:${isMobile?'15px':'10px'};padding:${isMobile?'20px':'15px'};margin-bottom:${isMobile?'15px':'10px'};box-shadow:0 2px 8px rgba(0,0,0,0.1);border-left:4px solid ${isPoolLocked?'#ffc107':'#004080'};cursor:pointer;">
                <div style="display:flex;align-items:center;justify-content:space-between;">
                    <span style="font-weight:bold;font-size:${isMobile?'1.2em':'1.1em'};"><i class="fas fa-shuttle-van"></i> ${tricycle.name}</span>
                    <span style="background:${isFull?'#dc3545':(isPoolLocked?'#ffc107':'#28a745')};color:${isPoolLocked?'#333':'white'};padding:${isMobile?'6px 12px':'4px 10px'};border-radius:20px;font-size:${isMobile?'0.9em':'0.8em'};">
                        ${isFull?'FULL':(isPoolLocked?'Pool Only':passengerCount+'/'+maxCapacity)}
                    </span>
                </div>
                <div style="display:flex;align-items:center;margin-top:10px;">
                    <span style="display:inline-block;width:${isMobile?'16px':'12px'};height:${isMobile?'16px':'12px'};border-radius:50%;background:${getColorHex(tricycle.color)};margin-right:8px;"></span>
                    <span style="color:#666;font-size:${isMobile?'1em':'0.9em'};">${tricycle.type||'tricycle'}</span>
                    ${isPoolLocked?`<span style="margin-left:10px;font-size:0.8em;color:#856404;"><i class="fas fa-users"></i> Keke-Pool only</span>`:''}
                </div>
                ${isFull ? `<div style="background:#f8d7da;color:#721c24;padding:${isMobile?'12px':'8px'};border-radius:${isMobile?'10px':'6px'};margin:15px 0;font-size:${isMobile?'0.95em':'0.9em'};text-align:center;"><i class="fas fa-users-slash"></i> FULL</div>` : ''}
                ${isPoolLocked && !isFull ? `<div style="background:#fff3cd;color:#856404;padding:${isMobile?'12px':'8px'};border-radius:${isMobile?'10px':'6px'};margin:10px 0;font-size:${isMobile?'0.9em':'0.85em'};text-align:center;"><i class="fas fa-info-circle"></i> Keke-Pool riders have joined â€” solo booking unavailable</div>` : ''}
                <div style="display:flex;justify-content:space-between;margin:15px 0;padding:${isMobile?'10px 0':'5px 0'};">
                    <div style="text-align:center;"><span style="display:block;color:#666;font-size:${isMobile?'0.85em':'0.8em'};">Distance</span><span style="font-weight:bold;color:#004080;font-size:${isMobile?'1.2em':'1.1em'};">${tricycle.distance||'?'} km</span></div>
                    <div style="text-align:center;"><span style="display:block;color:#666;font-size:${isMobile?'0.85em':'0.8em'};">ETA</span><span style="font-weight:bold;color:#28a745;font-size:${isMobile?'1.2em':'1.1em'};">${tricycle.eta||'?'} min</span></div>
                    <div style="text-align:center;"><span style="display:block;color:#666;font-size:${isMobile?'0.85em':'0.8em'};">Battery</span><span style="font-weight:bold;color:${getBatteryColor(tricycle.battery)};font-size:${isMobile?'1.2em':'1.1em'};">${tricycle.battery}%</span></div>
                </div>
                <div style="display:flex;gap:${isMobile?'12px':'10px'};margin-top:15px;">
                    ${isFull ? `
                    <button disabled style="flex:1;padding:${isMobile?'14px 0':'10px 0'};background:#ccc;color:#666;border:none;border-radius:${isMobile?'10px':'6px'};font-size:${isMobile?'1em':'0.9em'};font-weight:bold;cursor:not-allowed;">
                        <i class="fas fa-ban"></i> FULL
                    </button>` : isPoolLocked ? `
                    <button onclick="showETABooking(${tricycle.id}, true); event.stopPropagation();"
                            style="flex:1;padding:${isMobile?'14px 0':'10px 0'};background:#ffc107;color:#333;border:none;border-radius:${isMobile?'10px':'6px'};font-size:${isMobile?'1em':'0.9em'};font-weight:bold;cursor:pointer;border:2px solid #e0a800;">
                        <i class="fas fa-users"></i> Join Pool (${tricycle.passengerCount}/${tricycle.maxCapacity})
                    </button>` : `
                    <button class="reserve-btn" onclick="showETABooking(${tricycle.id}); event.stopPropagation();"
                            style="flex:1;padding:${isMobile?'14px 0':'10px 0'};background:#28a745;color:white;border:none;border-radius:${isMobile?'10px':'6px'};font-size:${isMobile?'1em':'0.9em'};font-weight:bold;cursor:pointer;">
                        <i class="fas fa-clock"></i> Book Ride
                    </button>`}
                    <button onclick="showTricycleDetails(${tricycle.id}); event.stopPropagation();" style="flex:0.5;padding:${isMobile?'14px 0':'10px 0'};background:#17a2b8;color:white;border:none;border-radius:${isMobile?'10px':'6px'};font-size:${isMobile?'1em':'0.9em'};cursor:pointer;">
                        <i class="fas fa-info-circle"></i> ${isMobile?'':'Details'}
                    </button>
                </div>
                ${!tricycle.available ? `<div style="margin-top:15px;padding:${isMobile?'12px':'8px'};background:#fff3cd;border-radius:${isMobile?'10px':'6px'};color:#856404;text-align:center;"><i class="fas fa-user-clock"></i> Currently reserved</div>` : ''}
            </div>`;
    });
    tricycleList.innerHTML = html;
}

function showTricycleMarkers(tricycles) {
    clearTricycleMarkers();
    if (userSession.hasActiveReservation && (ridePhase==='pickup'||ridePhase==='trip'||ridePhase==='pool-waiting'||ridePhase==='pool-ride')) return;
    tricycles.forEach(tricycle => {
        const passengerCount = tricycle.passengerCount || 0;
        const maxCapacity = tricycle.maxCapacity || 4;
        const isFull = passengerCount >= maxCapacity;
        const isPoolLocked = tricycle.reservedForPool === true;
        const markerColor = isFull ? '#dc3545' : (isPoolLocked ? '#ffc107' : '#28a745');
        const marker = new google.maps.Marker({
            position: { lat:tricycle.lat, lng:tricycle.lng }, map,
            title: `${tricycle.name} (${passengerCount}/${maxCapacity})`,
            icon: { path:google.maps.SymbolPath.CIRCLE, scale:isMobile?10:12, fillColor:markerColor, fillOpacity:0.9, strokeColor:'#ffffff', strokeWeight:2 },
            label: { text:tricycle.id.toString(), color:'white', fontWeight:'bold', fontSize:isMobile?'11px':'12px' }
        });
        marker.addListener('click', () => selectTricycle(tricycle.id));
        tricycleMarkers.push({ id:tricycle.id, marker, tricycle });
    });
}

function clearTricycleMarkers() {
    tricycleMarkers.forEach(item => { if (item.marker) item.marker.setMap(null); });
    tricycleMarkers = [];
}

function selectTricycle(tricycleId) {
    if (userSession.hasActiveReservation && (ridePhase==='pickup'||ridePhase==='trip'||ridePhase==='pool-waiting'||ridePhase==='pool-ride')) {
        alert("Cannot select other tricycles while your ride is in progress.");
        return;
    }
    document.querySelectorAll('.tricycle-card').forEach(card => {
        card.style.borderLeft = '4px solid #004080';
        card.style.background = '#f8f9fa';
        if (parseInt(card.dataset.tricycleId) === tricycleId) {
            card.style.borderLeft = '4px solid #28a745';
            card.style.background = '#e9f7ff';
        }
    });
    fetch(`/api/vehicles/${tricycleId}`)
        .then(res => res.json())
        .then(tricycle => {
            selectedTricycle = tricycle;
            map.panTo({ lat:tricycle.lat, lng:tricycle.lng });
            map.setZoom(isMobile ? 17 : 18);
            showTricycleInfoWindow(tricycle);
        })
        .catch(error => { console.error('Error selecting tricycle:', error); alert('Could not load tricycle details'); });
}

function showTricycleInfoWindow(tricycle) {
    if (window.tricycleInfoWindow) window.tricycleInfoWindow.close();
    const passengerCount = tricycle.passengerCount || 0;
    const maxCapacity = tricycle.maxCapacity || 4;
    const isFull = passengerCount >= maxCapacity;
    const isPoolLocked = tricycle.reservedForPool === true;
    let etaText = "Calculating...", distanceText = "Calculating...";
    if (userLocation) {
        getFastETA({ lat:tricycle.lat, lng:tricycle.lng }, userLocation).then(eta => {
            etaText = eta.text; distanceText = eta.distanceText;
            updateTricycleInfoContent(tricycle, isFull, passengerCount, maxCapacity, distanceText, etaText);
        });
    }
    const content = `
        <div style="padding:${isMobile?'20px':'15px'};max-width:${isMobile?'300px':'280px'};font-family:Arial,sans-serif;">
            <div style="display:flex;align-items:center;margin-bottom:15px;">
                <div style="width:${isMobile?'50px':'40px'};height:${isMobile?'50px':'40px'};border-radius:50%;background:${isFull?'#dc3545':(isPoolLocked?'#ffc107':'#28a745')};color:white;display:flex;align-items:center;justify-content:center;font-weight:bold;margin-right:15px;">${tricycle.id}</div>
                <div><h3 style="margin:0;color:#004080;">${tricycle.name}</h3><p style="margin:2px 0;color:#666;font-size:0.9em;">Babcock University Campus</p></div>
            </div>
            <div style="background:#f8f9fa;padding:${isMobile?'15px':'10px'};border-radius:${isMobile?'12px':'8px'};margin-bottom:15px;">
                <table style="width:100%;border-collapse:collapse;">
                    <tr><td style="padding:6px 0;"><strong>Passengers:</strong></td><td style="padding:6px 0;text-align:right;color:${isFull?'#dc3545':'#28a745'};font-weight:bold;">${passengerCount}/${maxCapacity} ${isFull?'(FULL)':''}</td></tr>
                    <tr><td><strong>Mode:</strong></td><td style="text-align:right;color:${isPoolLocked?'#856404':'#28a745'};font-weight:bold;">${isPoolLocked?'Pool Only':'Solo & Pool'}</td></tr>
                    <tr><td><strong>Battery:</strong></td><td style="text-align:right;color:${getBatteryColor(tricycle.battery)};font-weight:bold;">${tricycle.battery}%</td></tr>
                    <tr><td><strong>Driver:</strong></td><td style="text-align:right;font-weight:bold;">${tricycle.driver||'Not Assigned'}</td></tr>
                    <tr><td><strong>Phone:</strong></td><td style="text-align:right;">${tricycle.phone||'N/A'}</td></tr>
                    <tr><td><strong>Status:</strong></td><td style="text-align:right;color:${isFull?'#dc3545':(isPoolLocked?'#856404':'green')};font-weight:bold;">${isFull?'FULL':(isPoolLocked?'Pool Only':(tricycle.available?'Available':'Reserved'))}</td></tr>
                </table>
            </div>
            <div style="background:#e9f7ff;padding:${isMobile?'15px':'10px'};border-radius:${isMobile?'12px':'8px'};margin-bottom:15px;text-align:center;">
                <div style="font-size:0.9em;color:#666;">Distance from you</div>
                <div style="font-size:${isMobile?'2em':'1.8em'};font-weight:bold;color:#004080;margin:8px 0;"><span id="info-distance">${distanceText}</span></div>
                <div style="font-size:${isMobile?'1.2em':'1em'};color:#004080;font-weight:bold;">ETA: <span id="info-eta">${etaText}</span></div>
            </div>
            ${isPoolLocked&&!isFull?`<div style="background:#fff3cd;padding:${isMobile?'15px':'10px'};border-radius:${isMobile?'12px':'8px'};margin-bottom:15px;color:#856404;text-align:center;"><i class="fas fa-users"></i> <strong>Pool riders joined.</strong> Solo booking locked.</div>`:''}
            <div style="display:flex;gap:${isMobile?'12px':'10px'};margin-top:20px;">
                ${isFull?
                    `<button disabled style="flex:1;padding:${isMobile?'14px 0':'10px 0'};background:#ccc;color:#666;border:none;border-radius:${isMobile?'10px':'8px'};">FULL</button>` :
                isPoolLocked?
                    `<button onclick="window.parent.showETABooking(${tricycle.id}, true)" style="flex:1;padding:${isMobile?'14px 0':'10px 0'};background:#ffc107;color:#333;border:none;border-radius:${isMobile?'10px':'8px'};cursor:pointer;font-weight:bold;">
                        <i class="fas fa-users"></i> Join Pool</button>` :
                tricycle.available?
                    `<button onclick="window.parent.showETABooking(${tricycle.id})" style="flex:1;padding:${isMobile?'14px 0':'10px 0'};background:#28a745;color:white;border:none;border-radius:${isMobile?'10px':'8px'};cursor:pointer;font-weight:bold;">
                        <i class="fas fa-clock"></i> Book Ride</button>` :
                    `<button disabled style="flex:1;padding:${isMobile?'14px 0':'10px 0'};background:#ccc;color:#666;border:none;border-radius:${isMobile?'10px':'8px'};">Reserved</button>`
                }
                <button onclick="window.parent.getDirectionsToTricycle(${tricycle.id})" style="flex:1;padding:${isMobile?'14px 0':'10px 0'};background:#17a2b8;color:white;border:none;border-radius:${isMobile?'10px':'8px'};cursor:pointer;">
                    <i class="fas fa-directions"></i> Directions</button>
            </div>
        </div>`;
    const tricycleMarkerItem = tricycleMarkers.find(item => item.id === tricycle.id);
    if (tricycleMarkerItem && tricycleMarkerItem.marker) {
        window.tricycleInfoWindow = new google.maps.InfoWindow({ content, maxWidth:isMobile?340:320, pixelOffset:new google.maps.Size(0,-10) });
        window.tricycleInfoWindow.open(map, tricycleMarkerItem.marker);
    }
}

function updateTricycleInfoContent(tricycle, isFull, passengerCount, maxCapacity, distanceText, etaText) {
    if (!window.tricycleInfoWindow) return;
    const distanceEl = document.getElementById('info-distance');
    const etaEl = document.getElementById('info-eta');
    if (distanceEl) distanceEl.textContent = distanceText;
    if (etaEl) etaEl.textContent = etaText;
}

function getColorHex(color) {
    const colors = { 'blue':'#007bff', 'red':'#dc3545', 'green':'#28a745', 'yellow':'#ffc107' };
    return colors[color?.toLowerCase()] || '#007bff';
}

function getBatteryColor(battery) {
    if (battery >= 50) return '#28a745';
    if (battery >= 20) return '#ffc107';
    return '#dc3545';
}

function getDirectionsToTricycle(tricycleId) {
    if (!userLocation) { alert('Please enable location services to get directions to the tricycle.'); return; }
    fetch(`/api/vehicles/${tricycleId}`)
        .then(res => res.json())
        .then(tricycle => {
            document.getElementById('destination-input').value = tricycle.name;
            const tricycleLocation = { name:tricycle.name, lat:tricycle.lat, lng:tricycle.lng, category:'Tricycles' };
            const existingId = `tricycle_${tricycleId}`;
            if (!allLocations.some(loc => loc.id === existingId)) {
                allLocations.push({ id:existingId, name:tricycle.name, lat:tricycle.lat, lng:tricycle.lng, category:'Tricycles' });
            }
            selectedDestination = tricycleLocation;
            if (!userSession.hasActiveReservation) document.getElementById('mode-selector').classList.remove('hidden');
            alert(`Navigation Started\n\nDestination: ${tricycle.name}\n\nChoose your travel mode to reach the tricycle.`);
        })
        .catch(error => { console.error('Error getting tricycle:', error); alert('Could not get tricycle location'); });
}

function showTricycleDetails(tricycleId) {
    if (userSession.hasActiveReservation && (ridePhase==='pickup'||ridePhase==='trip'||ridePhase==='pool-waiting'||ridePhase==='pool-ride')) {
        alert("Cannot view tricycle details while your ride is in progress."); return;
    }
    fetch(`/api/vehicles/${tricycleId}`)
        .then(res => res.json())
        .then(tricycle => {
            const passengerCount = tricycle.passengerCount || 0;
            const maxCapacity = tricycle.maxCapacity || 4;
            const isFull = passengerCount >= maxCapacity;
            const isPoolLocked = tricycle.reservedForPool === true;
            alert(`â•”â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•—\nâ•‘     BABCOCK CAMPUS TRICYCLE              â•‘\nâ• â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•£\nâ•‘  ðŸš ${tricycle.name}\nâ•‘  ðŸ‘¥ Passengers: ${passengerCount}/${maxCapacity} ${isFull?'(FULL)':''}\nâ•‘  ðŸš¦ Mode: ${isPoolLocked?'Pool Only':'Solo & Pool'}\nâ•‘  ðŸŽ¨ Color: ${tricycle.color}\nâ•‘  ðŸ”‹ Battery: ${tricycle.battery}%\nâ•‘  ðŸ§‘ Driver: ${tricycle.driver||'Not Assigned'}\nâ•‘  ðŸ“ž Phone: ${tricycle.phone||'+234 XXX XXX XXXX'}\nâ•‘  ðŸ“ Status: ${isFull?'â›” FULL':(isPoolLocked?'ðŸšŒ Pool Only':(tricycle.available?'âœ… Available':'â›” Reserved'))}\nâ•šâ•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•`);
        });
}

function startTricycleRefresh() {
    if (tricycleRefreshInterval) clearInterval(tricycleRefreshInterval);
    tricycleRefreshInterval = setInterval(() => { if (tricyclePanelVisible) loadAvailableTricycles(); }, 30000);
}

function stopTricycleRefresh() {
    if (tricycleRefreshInterval) { clearInterval(tricycleRefreshInterval); tricycleRefreshInterval = null; }
}

// ============================================
// POPUP NOTIFICATION FUNCTIONS
// ============================================

function showTricycleArrivedPopup() {
    const popup = document.createElement('div');
    popup.style.cssText = `position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:white;padding:${isMobile?'30px 25px':'30px'};border-radius:${isMobile?'20px':'15px'};box-shadow:0 10px 40px rgba(0,0,0,0.3);z-index:10000;max-width:${isMobile?'90%':'400px'};width:${isMobile?'90%':'auto'};text-align:center;border:3px solid #28a745;`;
    popup.innerHTML = `
        <div style="margin-bottom:20px;">
            <div style="width:${isMobile?'100px':'80px'};height:${isMobile?'100px':'80px'};background:#28a745;color:white;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 20px;font-size:${isMobile?'48px':'36px'};"><i class="fas fa-check-circle"></i></div>
            <h2 style="color:#28a745;margin:0 0 10px 0;">ðŸŽ‰ Your Ride Has Arrived!</h2>
            <p style="color:#666;">Your tricycle is now downstairs. Please proceed to meet the driver.</p>
        </div>
        <div style="background:#e9f7ff;padding:${isMobile?'20px':'15px'};border-radius:${isMobile?'15px':'10px'};margin:20px 0;">
            <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px;">
                <div style="width:40px;height:40px;background:#004080;color:white;border-radius:50%;display:flex;align-items:center;justify-content:center;"><i class="fas fa-user"></i></div>
                <div><div style="font-size:0.8em;color:#6c757d;">Driver</div><div style="font-weight:bold;color:#004080;">${userSession.vehicleDetails?.driver||'John Okafor'}</div></div>
            </div>
            <div style="display:flex;align-items:center;gap:12px;">
                <div style="width:40px;height:40px;background:#004080;color:white;border-radius:50%;display:flex;align-items:center;justify-content:center;"><i class="fas fa-phone"></i></div>
                <div><div style="font-size:0.8em;color:#6c757d;">Phone</div><div style="font-weight:bold;color:#004080;">${userSession.vehicleDetails?.phone||'+234 803 123 4567'}</div></div>
            </div>
            <button onclick="window.location.href='tel:${(userSession.vehicleDetails?.phone||'+2348031234567').replace(/\s/g,'')}'" style="width:100%;padding:12px;background:#28a745;color:white;border:none;border-radius:10px;font-weight:bold;cursor:pointer;margin-top:15px;"><i class="fas fa-phone-alt"></i> Call Driver</button>
        </div>
        <button id="start-ride-popup-btn" style="width:100%;padding:${isMobile?'18px':'15px'};background:#28a745;color:white;border:none;border-radius:${isMobile?'15px':'10px'};font-size:${isMobile?'1.3em':'16px'};font-weight:bold;cursor:pointer;margin-top:10px;"><i class="fas fa-play"></i> START RIDE</button>
        <button onclick="this.parentElement.remove()" style="width:100%;padding:${isMobile?'14px':'10px'};background:transparent;color:#666;border:none;border-radius:${isMobile?'15px':'10px'};font-size:${isMobile?'1.1em':'14px'};cursor:pointer;margin-top:10px;">Close</button>`;
    document.body.appendChild(popup);
    document.getElementById('start-ride-popup-btn').onclick = function() { popup.remove(); startTricycleRide(); };
}

function showRideCompletedPopup() {
    const popup = document.createElement('div');
    popup.style.cssText = `position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:white;padding:${isMobile?'30px 25px':'30px'};border-radius:${isMobile?'20px':'15px'};box-shadow:0 10px 40px rgba(0,0,0,0.3);z-index:10000;max-width:${isMobile?'90%':'400px'};width:${isMobile?'90%':'auto'};text-align:center;border:3px solid #28a745;`;
    popup.innerHTML = `
        <div style="margin-bottom:20px;">
            <div style="width:${isMobile?'100px':'80px'};height:${isMobile?'100px':'80px'};background:#28a745;color:white;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 20px;font-size:${isMobile?'48px':'36px'};"><i class="fas fa-flag-checkered"></i></div>
            <h2 style="color:#28a745;margin:0 0 10px 0;">âœ… Ride Completed!</h2>
            <p style="color:#666;">You have arrived at your destination. Thank you for choosing Babcock Campus Tricycles!</p>
        </div>
        <div style="background:#fff3cd;padding:${isMobile?'20px':'15px'};border-radius:${isMobile?'15px':'10px'};margin:20px 0;">
            <p style="margin:0;font-weight:bold;color:#856404;font-size:${isMobile?'1.3em':'18px'};"><i class="fas fa-money-bill-wave"></i> Please pay your driver:</p>
            <p style="margin:10px 0;font-size:${isMobile?'48px':'32px'};font-weight:bold;color:#004080;">â‚¦200</p>
            <p style="margin:0;font-size:${isMobile?'1.1em':'14px'};color:#666;">Standard campus fare</p>
        </div>
        <div style="background:#e9f7ff;padding:${isMobile?'15px':'12px'};border-radius:${isMobile?'12px':'8px'};margin:15px 0;">
            <div style="display:flex;align-items:center;gap:10px;"><i class="fas fa-star" style="color:#ffc107;font-size:1.2em;"></i><span style="font-weight:bold;">Rate your driver:</span></div>
            <div style="display:flex;justify-content:center;gap:15px;margin-top:10px;">
                ${[1,2,3,4,5].map(i=>`<span onclick="alert('Thanks for rating!')" style="font-size:2em;cursor:pointer;">â­</span>`).join('')}
            </div>
        </div>
        <button id="complete-ride-popup-btn" style="width:100%;padding:${isMobile?'18px':'15px'};background:#004080;color:white;border:none;border-radius:${isMobile?'15px':'10px'};font-size:${isMobile?'1.3em':'16px'};font-weight:bold;cursor:pointer;margin-top:10px;"><i class="fas fa-check"></i> CONFIRM PAYMENT & COMPLETE</button>
        <button onclick="this.parentElement.remove()" style="width:100%;padding:${isMobile?'14px':'10px'};background:transparent;color:#666;border:none;border-radius:${isMobile?'15px':'10px'};font-size:${isMobile?'1.1em':'14px'};cursor:pointer;margin-top:10px;">Close</button>`;
    document.body.appendChild(popup);
    document.getElementById('complete-ride-popup-btn').onclick = function() { popup.remove(); confirmRideCompletion(); };
}

function confirmRideCompletion() {
    if (userSession.vehicleId) {
        fetch(`/api/vehicles/${userSession.vehicleId}/complete-ride`, { method:'POST', headers:{'Content-Type':'application/json'} })
            .then(response => { if (response.ok) { clearAllDisplays(); alert('âœ… Ride completed successfully. Thank you!'); } })
            .catch(error => console.error('Error:', error));
    }
}

// ============================================
// TRICYCLE SIMULATION
// ============================================

function simulateTricycleRoute(tricycleLocation, targetLocation, duration, message, onComplete) {
    if (tricycleRoutePolyline) tricycleRoutePolyline.setMap(null);
    if (tricycleMarker) tricycleMarker.setMap(null);
    const ds = new google.maps.DirectionsService();
    ds.route({ origin:tricycleLocation, destination:targetLocation, travelMode:google.maps.TravelMode.DRIVING, provideRouteAlternatives:false },
        (result, status) => {
            if (status === 'OK') {
                const routePath = result.routes[0];
                const path = routePath.overview_path;
                tricycleRoutePolyline = new google.maps.Polyline({ path, geodesic:true, strokeColor:"#28a745", strokeOpacity:0.4, strokeWeight:isMobile?5:4, map });
                const totalSeconds = duration * 60;
                tricycleMarker = new google.maps.Marker({
                    position: tricycleLocation, map,
                    title: message,
                    icon: { url:"http://maps.google.com/mapfiles/ms/icons/green-dot.png", scaledSize:new google.maps.Size(isMobile?48:40, isMobile?48:40) },
                    animation: google.maps.Animation.BOUNCE
                });
                let secondsPassed = 0;
                const totalDistance = routePath.legs[0].distance.value / 1000;
                if (tricycleSimulationInterval) clearInterval(tricycleSimulationInterval);
                tricycleSimulationInterval = setInterval(() => {
                    secondsPassed++;
                    const progress = Math.min(secondsPassed / totalSeconds, 1);
                    const distanceTraveled = totalDistance * progress;
                    let accumulated = 0, currentPoint = tricycleLocation;
                    for (let i = 1; i < path.length; i++) {
                        const segmentDist = calculateHaversineDistance({ lat:path[i-1].lat(), lng:path[i-1].lng() }, { lat:path[i].lat(), lng:path[i].lng() });
                        if (accumulated + segmentDist >= distanceTraveled) {
                            const segmentProgress = (distanceTraveled - accumulated) / segmentDist;
                            currentPoint = { lat:path[i-1].lat()+(path[i].lat()-path[i-1].lat())*segmentProgress, lng:path[i-1].lng()+(path[i].lng()-path[i-1].lng())*segmentProgress };
                            break;
                        }
                        accumulated += segmentDist;
                        if (i === path.length-1) currentPoint = { lat:path[i].lat(), lng:path[i].lng() };
                    }
                    tricycleMarker.setPosition(currentPoint);
                    tricycleMarker.setTitle(`${Math.ceil(Math.max(0, duration-(secondsPassed/60)))} min remaining`);
                    if (progress >= 1) {
                        clearInterval(tricycleSimulationInterval);
                        tricycleSimulationInterval = null;
                        tricycleMarker.setPosition(targetLocation);
                        tricycleMarker.setTitle('âœ… Arrived!');
                        tricycleMarker.setAnimation(null);
                        if (onComplete) onComplete();
                        else if (ridePhase === 'pool-ride') moveToNextPickup();
                    }
                }, 1000);
                const bounds = new google.maps.LatLngBounds();
                bounds.extend(tricycleLocation);
                bounds.extend(targetLocation);
                map.fitBounds(bounds);
            } else {
                simulateStraightLine(tricycleLocation, targetLocation, duration, message, onComplete);
            }
        });
}

function simulateStraightLine(start, end, duration, message, onComplete) {
    const latIncrement = (end.lat - start.lat) / (duration * 60);
    const lngIncrement = (end.lng - start.lng) / (duration * 60);
    tricycleRoutePolyline = new google.maps.Polyline({ path:[start,end], geodesic:true, strokeColor:"#28a745", strokeOpacity:0.4, strokeWeight:isMobile?5:4, map });
    let currentPosition = { lat:start.lat, lng:start.lng };
    tricycleMarker = new google.maps.Marker({
        position: currentPosition, map, title: message,
        icon: { url:"http://maps.google.com/mapfiles/ms/icons/green-dot.png", scaledSize:new google.maps.Size(isMobile?48:40, isMobile?48:40) },
        animation: google.maps.Animation.BOUNCE
    });
    let secondsPassed = 0, totalSeconds = duration * 60;
    if (tricycleSimulationInterval) clearInterval(tricycleSimulationInterval);
    tricycleSimulationInterval = setInterval(() => {
        secondsPassed++;
        const progress = Math.min(secondsPassed / totalSeconds, 1);
        currentPosition.lat = start.lat + latIncrement * secondsPassed;
        currentPosition.lng = start.lng + lngIncrement * secondsPassed;
        if (progress >= 1) { currentPosition.lat = end.lat; currentPosition.lng = end.lng; }
        tricycleMarker.setPosition(currentPosition);
        tricycleMarker.setTitle(`${Math.ceil(Math.max(0, duration-(secondsPassed/60)))} min remaining`);
        if (progress >= 1) {
            clearInterval(tricycleSimulationInterval);
            tricycleSimulationInterval = null;
            tricycleMarker.setTitle('âœ… Arrived!');
            tricycleMarker.setAnimation(null);
            if (onComplete) onComplete();
            else if (ridePhase === 'pool-ride') moveToNextPickup();
        }
    }, 1000);
}

// ============================================
// RESERVATION TRACKING
// ============================================

function createShowPanelButton() {
    if (showPanelBtn && showPanelBtn.parentNode) showPanelBtn.parentNode.removeChild(showPanelBtn);
    detectMobile();
    const pos = getResponsivePanelPosition('button');
    showPanelBtn = document.createElement('button');
    showPanelBtn.id = 'show-tracking-panel-btn';
    showPanelBtn.innerHTML = '<i class="fas fa-eye"></i> Show Tracking Panel';
    Object.assign(showPanelBtn.style, {
        position:pos.position, bottom:pos.bottom, right:pos.right, left:pos.left || 'auto',
        zIndex:'999', padding:pos.padding, backgroundColor:'#004080', color:'white',
        border:'none', borderRadius:isMobile?'50px':'8px', fontSize:pos.fontSize,
        fontWeight:'bold', cursor:'pointer', boxShadow:'0 4px 12px rgba(0,64,128,0.3)', display:'none', transition:'all 0.2s'
    });
    showPanelBtn.onmouseover = function() { if (!isMobile) { this.style.backgroundColor='#002856'; this.style.transform='scale(1.05)'; } };
    showPanelBtn.onmouseout = function() { if (!isMobile) { this.style.backgroundColor='#004080'; this.style.transform='scale(1)'; } };
    showPanelBtn.onclick = function() {
        const trackingPanel = document.getElementById('tracking-panel');
        if (trackingPanel) { Object.assign(trackingPanel.style, getResponsivePanelPosition('tracking')); trackingPanel.style.display='block'; }
        this.style.display = 'none';
    };
    document.body.appendChild(showPanelBtn);
}

function startReservationTracking(reservationId) {
    if (reservationTimer) clearInterval(reservationTimer);
    document.getElementById("mode-selector").classList.add("hidden");
    hideControls();
    hideEndNavigationButton();

    const buildTrackingPanel = () => {
        const tricycle = selectedTricycle || userSession.vehicleDetails;
        const vehicleName = userSession.vehicleName || tricycle?.name || 'Your Tricycle';
        const pickupETA = userSession.pickupETA || 5;
        const driver = userSession.vehicleDetails?.driver || tricycle?.driver || 'John Okafor';
        const phone = userSession.vehicleDetails?.phone || tricycle?.phone || '+234 803 123 4567';
        const phoneClean = phone.replace(/\s/g, '');
        const reservationId2 = userSession.currentReservationId || reservationId || 'N/A';
        const passengerCount = userSession.passengerCount || 1;
        const battery = tricycle?.battery ?? '?';
        const color = tricycle?.color || '';

        return `
            <div style="padding:${isMobile?'20px':'15px'};">
                ${isMobile?'<div style="width:50px;height:5px;background:#ccc;border-radius:3px;margin:0 auto 15px;"></div>':''}
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:15px;">
                    <h3 style="margin:0;color:#004080;font-size:${isMobile?'1.3em':'1.1em'};"><i class="fas fa-shipping-fast"></i> Ride Tracking</h3>
                    <button onclick="hideTrackingPanel()" style="padding:${isMobile?'12px 18px':'8px 12px'};background:#6c757d;color:white;border:none;border-radius:${isMobile?'10px':'6px'};cursor:pointer;font-size:${isMobile?'0.95em':'0.85em'};"><i class="fas fa-eye-slash"></i> Hide</button>
                </div>
                <div style="background:linear-gradient(135deg,#004080,#0066cc);color:white;padding:${isMobile?'18px':'14px'};border-radius:${isMobile?'15px':'10px'};margin-bottom:15px;text-align:center;">
                    <div style="font-size:${isMobile?'2em':'1.6em'};margin-bottom:6px;animation:bounce 1s infinite;">ðŸ›º</div>
                    <div style="font-weight:bold;font-size:${isMobile?'1.1em':'1em'};">${vehicleName} is on the way!</div>
                    <div style="font-size:${isMobile?'2.2em':'1.8em'};font-weight:bold;margin:8px 0;" id="pickup-eta-display">${pickupETA} min</div>
                    <div style="font-size:${isMobile?'0.9em':'0.85em'};opacity:0.85;">Estimated pickup time</div>
                </div>
                <div id="tracking-status">
                    <div style="background:#e9f7ff;border-radius:${isMobile?'12px':'8px'};padding:${isMobile?'14px':'10px'};margin-bottom:12px;display:flex;align-items:center;gap:12px;">
                        <div style="width:${isMobile?'44px':'36px'};height:${isMobile?'44px':'36px'};border-radius:50%;background:#28a745;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                            <i class="fas fa-circle-notch fa-spin" style="color:white;font-size:${isMobile?'18px':'14px'};"></i>
                        </div>
                        <div>
                            <div style="font-weight:bold;color:#004080;font-size:${isMobile?'1em':'0.95em'};">Pickup in progress</div>
                            <div style="color:#6c757d;font-size:${isMobile?'0.85em':'0.8em'};">Tricycle is heading to your location</div>
                        </div>
                    </div>
                </div>
                <div style="background:#f8f9fa;border-radius:${isMobile?'12px':'8px'};padding:${isMobile?'14px':'12px'};margin-bottom:12px;">
                    <div style="font-size:${isMobile?'0.8em':'0.75em'};color:#6c757d;margin-bottom:8px;text-transform:uppercase;letter-spacing:0.5px;">Reservation Details</div>
                    <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
                        <span style="color:#666;font-size:${isMobile?'0.9em':'0.85em'};">ID</span>
                        <span style="font-weight:bold;color:#004080;font-size:${isMobile?'0.9em':'0.85em'};">${reservationId2}</span>
                    </div>
                    <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
                        <span style="color:#666;font-size:${isMobile?'0.9em':'0.85em'};">Passengers</span>
                        <span style="font-weight:bold;color:#004080;font-size:${isMobile?'0.9em':'0.85em'};">${passengerCount}/4</span>
                    </div>
                    ${battery !== '?' ? `<div style="display:flex;justify-content:space-between;margin-bottom:6px;">
                        <span style="color:#666;font-size:${isMobile?'0.9em':'0.85em'};">Battery</span>
                        <span style="font-weight:bold;color:${getBatteryColor(battery)};font-size:${isMobile?'0.9em':'0.85em'};">${battery}%</span>
                    </div>` : ''}
                    ${color ? `<div style="display:flex;justify-content:space-between;">
                        <span style="color:#666;font-size:${isMobile?'0.9em':'0.85em'};">Color</span>
                        <span style="font-size:${isMobile?'0.9em':'0.85em'};display:flex;align-items:center;gap:6px;"><span style="width:12px;height:12px;border-radius:50%;background:${getColorHex(color)};display:inline-block;border:1px solid #ddd;"></span>${color}</span>
                    </div>` : ''}
                </div>
                <div style="background:#e9f7ff;border-radius:${isMobile?'12px':'8px'};padding:${isMobile?'14px':'12px'};margin-bottom:15px;border:1px solid #b8daff;">
                    <div style="font-size:${isMobile?'0.8em':'0.75em'};color:#6c757d;margin-bottom:10px;text-transform:uppercase;letter-spacing:0.5px;">Your Driver</div>
                    <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px;">
                        <div style="width:${isMobile?'46px':'38px'};height:${isMobile?'46px':'38px'};border-radius:50%;background:#004080;color:white;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                            <i class="fas fa-user" style="font-size:${isMobile?'20px':'16px'};"></i>
                        </div>
                        <div>
                            <div style="font-weight:bold;color:#004080;font-size:${isMobile?'1.05em':'1em'};">${driver}</div>
                            <div style="color:#6c757d;font-size:${isMobile?'0.9em':'0.85em'};">${phone}</div>
                        </div>
                    </div>
                    <button onclick="window.location.href='tel:${phoneClean}'"
                            style="width:100%;padding:${isMobile?'13px':'10px'};background:#28a745;color:white;border:none;border-radius:${isMobile?'10px':'8px'};font-weight:bold;cursor:pointer;font-size:${isMobile?'1em':'0.9em'};display:flex;align-items:center;justify-content:center;gap:8px;">
                        <i class="fas fa-phone-alt"></i> Call Driver
                    </button>
                </div>
                <div style="display:flex;gap:${isMobile?'12px':'10px'};">
                    <button onclick="centerOnTricycle()" style="flex:1;padding:${isMobile?'14px':'10px'};background:#17a2b8;color:white;border:none;border-radius:${isMobile?'10px':'8px'};cursor:pointer;font-size:${isMobile?'0.95em':'0.9em'};font-weight:bold;">
                        <i class="fas fa-crosshairs"></i> Track on Map
                    </button>
                    <button onclick="cancelReservationAndClear()" style="flex:1;padding:${isMobile?'14px':'10px'};background:#dc3545;color:white;border:none;border-radius:${isMobile?'10px':'8px'};cursor:pointer;font-size:${isMobile?'0.95em':'0.9em'};font-weight:bold;">
                        <i class="fas fa-times"></i> Cancel Ride
                    </button>
                </div>
                <style>@keyframes bounce{0%,100%{transform:translateY(0);}50%{transform:translateY(-6px);}}</style>
            </div>`;
    };

    if (!document.getElementById('tracking-panel')) {
        const panel = document.createElement('div');
        panel.id = 'tracking-panel';
        Object.assign(panel.style, getResponsivePanelPosition('tracking'));
        panel.innerHTML = buildTrackingPanel();
        document.body.appendChild(panel);
        if (isMobile) addSwipeToDismiss(panel, hideTrackingPanel);
    } else {
        document.getElementById('tracking-panel').innerHTML = buildTrackingPanel();
    }

    createShowPanelButton();
    const trackingPanel = document.getElementById('tracking-panel');
    if (trackingPanel) { Object.assign(trackingPanel.style, getResponsivePanelPosition('tracking')); trackingPanel.style.display='block'; }
    if (showPanelBtn) showPanelBtn.style.display = 'none';

    if (selectedTricycle || userSession.vehicleDetails) {
        const tricycle = selectedTricycle || userSession.vehicleDetails;
        if (tricycle.lat && tricycle.lng) {
            const userLoc = userLocation || map.getCenter();
            const pickupETA = userSession.pickupETA || 5;
            if (!tricycleSimulationInterval) simulateTricycleRoute(
                { lat:tricycle.lat, lng:tricycle.lng },
                { lat: typeof userLoc.lat === 'function' ? userLoc.lat() : userLoc.lat,
                  lng: typeof userLoc.lng === 'function' ? userLoc.lng() : userLoc.lng },
                pickupETA,
                "Coming to pick you up",
                null
            );
        }
    }

    let etaSeconds = (userSession.pickupETA || 5) * 60;
    if (reservationTimer) clearInterval(reservationTimer);
    reservationTimer = setInterval(() => {
        etaSeconds = Math.max(0, etaSeconds - 1);
        const etaDisplay = document.getElementById('pickup-eta-display');
        if (etaDisplay) {
            const mins = Math.floor(etaSeconds / 60);
            const secs = etaSeconds % 60;
            etaDisplay.textContent = etaSeconds > 60
                ? `${mins} min`
                : etaSeconds > 0
                    ? `${mins}:${String(secs).padStart(2,'0')}`
                    : 'ðŸš— Arriving now!';
        }
        if (etaSeconds === 0) {
            clearInterval(reservationTimer);
            reservationTimer = null;
            const statusDiv = document.getElementById('tracking-status');
            if (statusDiv) {
                statusDiv.innerHTML = `
                    <div style="background:#d4edda;border-radius:${isMobile?'12px':'8px'};padding:${isMobile?'14px':'10px'};margin-bottom:12px;display:flex;align-items:center;gap:12px;">
                        <div style="width:${isMobile?'44px':'36px'};height:${isMobile?'44px':'36px'};border-radius:50%;background:#28a745;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                            <i class="fas fa-check" style="color:white;font-size:${isMobile?'18px':'14px'};"></i>
                        </div>
                        <div>
                            <div style="font-weight:bold;color:#155724;font-size:${isMobile?'1em':'0.95em'};">Tricycle has arrived!</div>
                            <div style="color:#155724;font-size:${isMobile?'0.85em':'0.8em'};">Please proceed to meet your driver</div>
                        </div>
                    </div>`;
            }
            showTricycleArrivedPopup();
        }
    }, 1000);
}

async function updateReservationStatus(reservationId) {
    try {
        const trackingDiv = document.getElementById('tracking-status');
        if (trackingDiv && ridePhase==='pickup') {
            const vehicleName = userSession.vehicleName || 'Your Tricycle';
            const pickupETA = userSession.pickupETA || 5;
            trackingDiv.innerHTML = `
                <div style="color:#004080;padding:15px;background:#e9f7ff;border-radius:10px;">${vehicleName} is on the way (${pickupETA} min ETA)...</div>
                <div style="background:#f8f9fa;padding:12px;border-radius:8px;margin-top:15px;">
                    <div style="display:flex;align-items:center;gap:10px;margin-bottom:5px;"><i class="fas fa-user" style="color:#004080;"></i><span><strong>Driver:</strong> ${userSession.vehicleDetails?.driver||'John Okafor'}</span></div>
                    <div style="display:flex;align-items:center;gap:10px;"><i class="fas fa-phone" style="color:#004080;"></i><span><strong>Phone:</strong> ${userSession.vehicleDetails?.phone||'+234 803 123 4567'}</span></div>
                    <button onclick="window.location.href='tel:${(userSession.vehicleDetails?.phone||'+2348031234567').replace(/\s/g,'')}'" style="width:100%;padding:10px;background:#28a745;color:white;border:none;border-radius:8px;margin-top:10px;cursor:pointer;"><i class="fas fa-phone-alt"></i> Call Driver</button>
                </div>`;
        }
    } catch (error) { console.error('Status update error:', error); }
}

function centerOnTricycle() {
    if (tricycleMarker && tricycleMarker.getPosition()) { map.panTo(tricycleMarker.getPosition()); map.setZoom(isMobile?17:18); }
}

function hideTrackingPanel() {
    const trackingPanel = document.getElementById('tracking-panel');
    if (trackingPanel) trackingPanel.style.display = 'none';
    if (showPanelBtn) showPanelBtn.style.display = 'block';
    else { createShowPanelButton(); showPanelBtn.style.display = 'block'; }
}

// ============================================
// KEKE-POOL FUNCTIONS
// ============================================

function setKekePoolMode(mode) {
    kekePoolMode = mode;
    const soloOption = document.getElementById('keke-pool-solo');
    const poolOption = document.getElementById('keke-pool-pool');
    if (soloOption && poolOption) {
        if (mode === 'solo') {
            Object.assign(soloOption.style, { background:'#004080', color:'white', borderColor:'#004080', transform:'scale(1.05)', boxShadow:'0 4px 15px rgba(0,64,128,0.3)', transition:'all 0.3s ease' });
            Object.assign(poolOption.style, { background:'white', color:'#004080', borderColor:'#dee2e6', transform:'scale(1)', boxShadow:'none' });
        } else {
            Object.assign(poolOption.style, { background:'#004080', color:'white', borderColor:'#004080', transform:'scale(1.05)', boxShadow:'0 4px 15px rgba(0,64,128,0.3)', transition:'all 0.3s ease' });
            Object.assign(soloOption.style, { background:'white', color:'#004080', borderColor:'#dee2e6', transform:'scale(1)', boxShadow:'none' });
        }
    }
    const poolWaiting = document.getElementById('keke-pool-waiting');
    if (poolWaiting) {
        if (mode === 'pool') {
            poolWaiting.style.display = 'block';
            poolWaiting.style.animation = 'fadeIn 0.5s';
            checkKekePoolStatus();
        } else {
            poolWaiting.style.display = 'none';
        }
    }
}

function checkKekePoolStatus() {
    if (!selectedDestination) return;
    fetch(`/api/kekepool/status?destination=${encodeURIComponent(selectedDestination.name)}`)
        .then(res => res.json())
        .then(data => {
            if (data.exists) { kekePoolGroup = data.group; displayKekePoolGroup(); }
            else {
                kekePoolGroup = { id:null, destination:selectedDestination, riders:[], maxRiders:4, createdAt:new Date() };
                displayKekePoolGroup();
            }
        })
        .catch(() => {
            kekePoolGroup = { id:null, destination:selectedDestination, riders:[], maxRiders:4, createdAt:new Date() };
            displayKekePoolGroup();
        });
}

function displayKekePoolGroup() {
    const poolWaiting = document.getElementById('keke-pool-waiting');
    if (!poolWaiting) return;
    const ridersCount = kekePoolGroup.riders.length;
    const spotsLeft = 4 - ridersCount;
    let ridersHtml = '';
    kekePoolGroup.riders.forEach((rider, index) => {
        ridersHtml += `<div style="display:flex;align-items:center;gap:10px;padding:10px;background:#f8f9fa;border-radius:8px;margin-bottom:8px;border:1px solid #dee2e6;">
            <div style="width:40px;height:40px;background:#004080;color:white;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:bold;">${index+1}</div>
            <div style="flex:1;"><div style="font-weight:bold;color:#004080;">${rider.name||rider.userName||'Rider '+(index+1)}</div><div style="font-size:0.85em;color:#6c757d;">Waiting at pickup point</div></div>
        </div>`;
    });
    poolWaiting.innerHTML = `
        <div style="background:#fff3cd;padding:15px;border-radius:10px;margin:15px 0;color:#856404;text-align:center;border-left:4px solid #ffc107;">
            <i class="fas fa-users" style="font-size:1.5em;margin-right:10px;"></i>
            <strong>Waiting for ${spotsLeft} more rider${spotsLeft>1?'s':''}</strong>
            <p style="margin:5px 0 0 0;font-size:0.9em;">${ridersCount}/4 riders joined</p>
            <div style="background:#e9ecef;height:6px;border-radius:3px;margin-top:10px;overflow:hidden;">
                <div style="height:100%;background:#28a745;width:${(ridersCount/4)*100}%;transition:width 0.3s;"></div>
            </div>
        </div>
        <div style="margin:15px 0;">${ridersHtml}</div>
        ${ridersCount>=4?
            '<div style="background:#d4edda;padding:15px;border-radius:10px;text-align:center;color:#155724;font-weight:bold;">ðŸŽ‰ Pool is ready! Starting ride automatically...</div>':
            '<p style="text-align:center;color:#666;font-size:0.9em;padding:10px;background:#f8f9fa;border-radius:8px;"><i class="fas fa-hourglass-half"></i> Pool will start automatically when 4 riders join</p>'
        }
        <style>@keyframes fadeIn{from{opacity:0;transform:translateY(10px);}to{opacity:1;transform:translateY(0);}}</style>`;
    if (ridersCount >= 4) setTimeout(() => calculatePoolETAAndStart(), 2000);
}

// ============================================
// KEKE-POOL JOIN
// ============================================
function joinKekePool(userName, location) {
    const riderId = `rider_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    localStorage.setItem('riderId', riderId);
    const loadingDiv = document.getElementById('keke-pool-loading');
    if (loadingDiv) loadingDiv.style.display = 'flex';

    const vehicleId = selectedTricycle?.id;
    if (!vehicleId) {
        console.error('No tricycle selected for pool join');
        if (loadingDiv) loadingDiv.style.display = 'none';
        handlePoolJoinFallback(riderId, userName, location);
        return;
    }

    const requestBody = {
        riderId, userName,
        pickupLat: location.lat, pickupLng: location.lng,
        destinationName: selectedDestination.name,
        destinationLat: selectedDestination.lat, destinationLng: selectedDestination.lng,
        vehicleId: vehicleId
    };
    if (kekePoolGroup && kekePoolGroup.id) requestBody.poolId = kekePoolGroup.id;

    fetch('/api/kekepool/join', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
    })
    .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
    })
    .then(data => {
        if (loadingDiv) loadingDiv.style.display = 'none';
        syncServerClock(data.serverTime);
        if (data.success) {
            currentPoolId = data.pool.id;
            kekePoolGroup = data.pool;
            poolSyncState = data.pool.syncState || null;
            if (data.pool.riders && data.pool.riders.length > 0) {
                const myRider = data.pool.riders[data.pool.riders.length - 1];
                if (myRider && myRider.id) localStorage.setItem('riderId', myRider.id);
            }
            displayKekePoolGroup();
            const ridersReady = (data.pool.riders && data.pool.riders.length >= 4) || data.pool.status === 'ready';
            if (ridersReady) calculatePoolETAAndStart();
        } else {
            console.warn('Pool join returned success:false, using local fallback:', data.message);
            handlePoolJoinFallback(riderId, userName, location);
        }
    })
    .catch(error => {
        console.error('Error joining pool (using local fallback):', error);
        if (loadingDiv) loadingDiv.style.display = 'none';
        handlePoolJoinFallback(riderId, userName, location);
    });
}

function handlePoolJoinFallback(riderId, userName, location) {
    console.log('Using local pool simulation fallback');
    const campusOffsets = [
        { dlat: 0.0000, dlng: 0.0000 },
        { dlat: 0.0012, dlng: 0.0008 },
        { dlat: -0.0009, dlng: 0.0014 },
        { dlat: 0.0006, dlng: -0.0011 }
    ];
    const dummyRiders = [
        { id: riderId, name: userName,
          pickupLat: location.lat + campusOffsets[0].dlat,
          pickupLng: location.lng + campusOffsets[0].dlng },
        { id: 'dummy_1', name: 'Chidi Obi',
          pickupLat: location.lat + campusOffsets[1].dlat,
          pickupLng: location.lng + campusOffsets[1].dlng },
        { id: 'dummy_2', name: 'Amaka Eze',
          pickupLat: location.lat + campusOffsets[2].dlat,
          pickupLng: location.lng + campusOffsets[2].dlng },
        { id: 'dummy_3', name: 'Tunde Bello',
          pickupLat: location.lat + campusOffsets[3].dlat,
          pickupLng: location.lng + campusOffsets[3].dlng }
    ];
    currentPoolId = `local_pool_${Date.now()}`;
    kekePoolGroup = {
        id: currentPoolId,
        destination: selectedDestination,
        riders: dummyRiders,
        maxRiders: 4,
        createdAt: new Date(),
        status: 'ready'
    };
    displayKekePoolGroup();
    setTimeout(() => calculatePoolETAAndStart(), 1500);
}

// ============================================
// CALCULATE POOL ETA AND START RIDE
// ============================================
function calculatePoolETAAndStart() {
    if (currentPoolId && !String(currentPoolId).startsWith('local_pool_')) {
        fetch(`/api/kekepool/${currentPoolId}`)
            .then(res => res.json())
            .then(poolState => {
                syncServerClock(poolState.serverTime);
                kekePoolGroup = poolState;
                const optimizedRoute = poolState.optimizedRoute;
                const assignedVehicle = poolState.assignedVehicle || optimizedRoute?.vehicle || selectedTricycle;
                if (!optimizedRoute || !assignedVehicle) {
                    calculatePoolETAAndStartLocal();
                    return;
                }

                const ridersBase = optimizedRoute.estimatedPickupOrder || poolState.riders || [];
                const pickupPlan = (poolState.syncState && poolState.syncState.pickupPlan) ? poolState.syncState.pickupPlan : [];
                const planById = new Map(pickupPlan.map(p => [p.riderId, p]));
                const riders = ridersBase.map((rider, index) => {
                    const plan = planById.get(rider.id) || pickupPlan[index] || {};
                    return {
                        ...rider,
                        id: rider.id || plan.riderId,
                        name: rider.name || rider.userName || plan.riderName || `Rider ${index + 1}`,
                        pickupLat: rider.pickupLat ?? plan.pickupLat ?? rider.lat,
                        pickupLng: rider.pickupLng ?? plan.pickupLng ?? rider.lng,
                        eta: rider.eta ?? plan.legEtaMinutes ?? 1,
                        cumulativeETA: rider.cumulativeETA ?? plan.cumulativeETA ?? (rider.eta ?? 1),
                        pickupOrder: rider.pickupOrder ?? plan.pickupOrder ?? (index + 1),
                        etaAt: plan.etaAt || null
                    };
                }).sort((a, b) => (a.pickupOrder || 0) - (b.pickupOrder || 0));

                const totalTime = poolState.syncState?.totalTimeMinutes || optimizedRoute.totalTime || 0;
                poolSyncState = poolState.syncState || null;
                ridePhase = 'pool-ride';
                if (kekePoolRefreshInterval) { clearInterval(kekePoolRefreshInterval); kekePoolRefreshInterval = null; }

                poolRideData = {
                    tricycle: assignedVehicle,
                    riders,
                    totalTime,
                    destination: selectedDestination,
                    syncState: poolSyncState
                };

                userSession.hasActiveReservation = true;
                userSession.vehicleDetails = { driver: assignedVehicle.driver, phone: assignedVehicle.phone };
                userSession.vehicleName = assignedVehicle.name;
                userSession.vehicleId = assignedVehicle.id;

                document.getElementById("mode-selector").classList.add("hidden");
                const tricyclePanel = document.getElementById("tricycle-panel");
                if (tricyclePanel) tricyclePanel.classList.add("hidden");
                tricyclePanelVisible = false;
                hideControls();
                hideEndNavigationButton();

                if (poolSyncState?.samePickupLocation && riders.length > 0) {
                    handleGroupPickup(assignedVehicle, riders[0], poolSyncState);
                } else {
                    showPoolETASummaryAndStartSimulation();
                }
            })
            .catch(error => {
                console.error('Failed to load server pool sync state, using local fallback:', error);
                calculatePoolETAAndStartLocal();
            });
        return;
    }

    calculatePoolETAAndStartLocal();
}

function calculatePoolETAAndStartLocal() {
    console.log('Pool is full â€” calculating ETAs and starting simulation');
    ridePhase = 'pool-ride';
    poolSyncState = null;
    if (kekePoolRefreshInterval) { clearInterval(kekePoolRefreshInterval); kekePoolRefreshInterval = null; }
    const riders = kekePoolGroup.riders;
    if (!riders || riders.length === 0) { console.error('No riders in pool'); return; }

    let selectedTricycleForPool = selectedTricycle || {
        id: 1, name: "Tricycle #001",
        lat: 6.89277, lng: 3.71827,
        driver: "John Okafor", phone: "+234 803 123 4567", speed: 15
    };

    // Normalize rider pickup coords
    const rawRiders = riders.map(r => ({
        ...r,
        pickupLat: r.pickupLat ?? r.lat ?? (userLocation ? userLocation.lat : 6.89),
        pickupLng: r.pickupLng ?? r.lng ?? (userLocation ? userLocation.lng : 3.71)
    }));

    // â”€â”€ SAME-LOCATION DETECTION â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // If all riders are within 20m of each other, treat them as same location.
    // The tricycle simulates arriving at that shared spot, picks everyone up at
    // once, then switches immediately to real Google Maps DRIVING navigation.
    const SAME_LOCATION_THRESHOLD_KM = 0.02; // 20 metres
    const allAtSameLocation = rawRiders.every(r =>
        calculateHaversineDistance(
            { lat: r.pickupLat, lng: r.pickupLng },
            { lat: rawRiders[0].pickupLat, lng: rawRiders[0].pickupLng }
        ) < SAME_LOCATION_THRESHOLD_KM
    );

    if (allAtSameLocation) {
        console.log('All riders at same location â€” group pickup mode');
        handleGroupPickup(selectedTricycleForPool, rawRiders[0]);
        return;
    }

    // â”€â”€ DIFFERENT LOCATIONS: spread if truly identical (testing edge-case) â”€â”€â”€
    const campusSpread = [
        { dlat:  0.0000, dlng:  0.0000 },
        { dlat:  0.0018, dlng:  0.0012 },
        { dlat: -0.0014, dlng:  0.0020 },
        { dlat:  0.0008, dlng: -0.0018 }
    ];
    // Only apply spread when ALL coords are byte-identical (e.g. same device test)
    const allByteIdentical = rawRiders.every(r =>
        r.pickupLat === rawRiders[0].pickupLat && r.pickupLng === rawRiders[0].pickupLng
    );
    const normalizedRiders = allByteIdentical ? rawRiders.map((r, i) => ({
        ...r,
        pickupLat: r.pickupLat + campusSpread[i % campusSpread.length].dlat,
        pickupLng: r.pickupLng + campusSpread[i % campusSpread.length].dlng
    })) : rawRiders;

    // Sort by distance from tricycle (nearest first)
    const ridersWithDistance = normalizedRiders.map(rider => {
        const distance = calculateHaversineDistance(
            { lat: selectedTricycleForPool.lat, lng: selectedTricycleForPool.lng },
            { lat: rider.pickupLat, lng: rider.pickupLng }
        );
        return { ...rider, distance, eta: Math.max(1, Math.ceil((distance / (selectedTricycleForPool.speed || 15)) * 60)) };
    });
    ridersWithDistance.sort((a, b) => a.distance - b.distance);

    let cumulativeTime = 0;
    const ridersWithCumulativeETA = ridersWithDistance.map((rider, index) => {
        cumulativeTime += rider.eta;
        return { ...rider, cumulativeETA: cumulativeTime, pickupOrder: index + 1 };
    });

    const lastRider = ridersWithCumulativeETA[ridersWithCumulativeETA.length - 1];
    const distanceToDest = calculateHaversineDistance(
        { lat: lastRider.pickupLat, lng: lastRider.pickupLng },
        { lat: selectedDestination.lat, lng: selectedDestination.lng }
    );
    const timeToDest = Math.max(1, Math.ceil((distanceToDest / (selectedTricycleForPool.speed || 15)) * 60));
    const totalTime = cumulativeTime + timeToDest;

    poolRideData = { tricycle: selectedTricycleForPool, riders: ridersWithCumulativeETA, totalTime, destination: selectedDestination, syncState: null };

    userSession.hasActiveReservation = true;
    userSession.vehicleDetails = { driver: selectedTricycleForPool.driver, phone: selectedTricycleForPool.phone };
    userSession.vehicleName = selectedTricycleForPool.name;
    userSession.vehicleId = selectedTricycleForPool.id;

    document.getElementById("mode-selector").classList.add("hidden");
    const tricyclePanel = document.getElementById("tricycle-panel");
    if (tricyclePanel) tricyclePanel.classList.add("hidden");
    tricyclePanelVisible = false;
    hideControls();
    hideEndNavigationButton();

    showPoolETASummaryAndStartSimulation();
}

// ============================================
// GROUP PICKUP (all riders at same location)
// ============================================
function handleGroupPickup(tricycle, sharedRider, syncState = null) {
    userSession.hasActiveReservation = true;
    userSession.vehicleDetails = { driver: tricycle.driver, phone: tricycle.phone };
    userSession.vehicleName = tricycle.name;
    userSession.vehicleId = tricycle.id;

    document.getElementById("mode-selector").classList.add("hidden");
    const tricyclePanel = document.getElementById("tricycle-panel");
    if (tricyclePanel) tricyclePanel.classList.add("hidden");
    tricyclePanelVisible = false;
    hideControls();
    hideEndNavigationButton();

    // Calculate tricycle â†’ shared pickup ETA
    const distToPickup = calculateHaversineDistance(
        { lat: tricycle.lat, lng: tricycle.lng },
        { lat: sharedRider.pickupLat, lng: sharedRider.pickupLng }
    );
    const etaToPickup = Math.max(1, Math.ceil((distToPickup / (tricycle.speed || 15)) * 60));
    const sharedEtaAt = syncState?.pickupPlan?.[0]?.etaAt ? new Date(syncState.pickupPlan[0].etaAt).getTime() : null;
    const initialDurationMinutes = sharedEtaAt
        ? Math.max(1, Math.ceil((sharedEtaAt - getSyncedNowMs()) / 60000))
        : etaToPickup;

    // Build tracking panel
    if (!document.getElementById('tracking-panel')) {
        const panel = document.createElement('div');
        panel.id = 'tracking-panel';
        Object.assign(panel.style, getResponsivePanelPosition('tracking'));
        document.body.appendChild(panel);
    }
    createShowPanelButton();

    const trackingPanel = document.getElementById('tracking-panel');
    const riderNames = kekePoolGroup.riders.map((r,i) => r.name || r.userName || `Rider ${i+1}`).join(', ');
    trackingPanel.innerHTML = `
        <div style="padding:${isMobile?'20px':'15px'};">
            ${isMobile?'<div style="width:50px;height:5px;background:#ccc;border-radius:3px;margin:0 auto 15px;"></div>':''}
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:15px;">
                <h3 style="margin:0;color:#004080;font-size:${isMobile?'1.3em':'1.1em'};"><i class="fas fa-users"></i> Group Pickup</h3>
                <button onclick="hideTrackingPanel()" style="padding:${isMobile?'12px 18px':'8px 12px'};background:#6c757d;color:white;border:none;border-radius:${isMobile?'10px':'6px'};cursor:pointer;"><i class="fas fa-eye-slash"></i> Hide</button>
            </div>
            <!-- Tricycle incoming banner -->
            <div style="background:linear-gradient(135deg,#004080,#0066cc);color:white;padding:${isMobile?'18px':'14px'};border-radius:${isMobile?'15px':'10px'};margin-bottom:15px;text-align:center;">
                <div style="font-size:${isMobile?'2em':'1.6em'};margin-bottom:6px;animation:bounce 1s infinite;">ðŸ›º</div>
                <div style="font-weight:bold;font-size:${isMobile?'1.1em':'1em'};">${tricycle.name} is on the way!</div>
                <div style="font-size:${isMobile?'2.2em':'1.8em'};font-weight:bold;margin:8px 0;" id="group-eta-display">${initialDurationMinutes} min</div>
                <div style="font-size:${isMobile?'0.9em':'0.85em'};opacity:0.85;">Arriving to pick up all ${kekePoolGroup.riders.length} riders</div>
            </div>
            <!-- All riders chips -->
            <div style="background:#f8f9fa;border-radius:${isMobile?'12px':'8px'};padding:${isMobile?'14px':'12px'};margin-bottom:12px;">
                <div style="font-size:0.8em;color:#6c757d;margin-bottom:8px;font-weight:bold;text-transform:uppercase;">All Riders at Same Pickup Point</div>
                <div style="display:flex;flex-wrap:wrap;gap:8px;">
                    ${kekePoolGroup.riders.map((r,i) => `
                        <div style="background:#004080;color:white;padding:6px 14px;border-radius:50px;font-size:0.85em;font-weight:bold;">
                            ${r.name || r.userName || 'Rider '+(i+1)}
                        </div>`).join('')}
                </div>
            </div>
            <!-- Driver -->
            <div style="background:#e9f7ff;border-radius:${isMobile?'12px':'8px'};padding:${isMobile?'14px':'12px'};margin-bottom:15px;">
                <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
                    <i class="fas fa-user" style="color:#004080;"></i>
                    <span style="font-weight:bold;">${tricycle.driver}</span>
                </div>
                <div style="display:flex;align-items:center;gap:10px;">
                    <i class="fas fa-phone" style="color:#004080;"></i>
                    <span>${tricycle.phone}</span>
                </div>
            </div>
            <div id="tracking-status">
                <div style="background:#f8f9fa;border-radius:10px;padding:15px;text-align:center;">
                    <i class="fas fa-circle-notch fa-spin" style="color:#004080;font-size:${isMobile?'28px':'22px'};"></i>
                    <p style="margin-top:12px;font-weight:bold;color:#004080;">Tricycle heading to your locationâ€¦</p>
                </div>
            </div>
            <div style="display:flex;gap:10px;margin-top:15px;">
                <button onclick="centerOnTricycle()" style="flex:1;padding:${isMobile?'13px':'10px'};background:#17a2b8;color:white;border:none;border-radius:${isMobile?'10px':'8px'};cursor:pointer;font-weight:bold;">
                    <i class="fas fa-crosshairs"></i> Track
                </button>
                <button onclick="cancelReservationAndClear()" style="flex:1;padding:${isMobile?'13px':'10px'};background:#dc3545;color:white;border:none;border-radius:${isMobile?'10px':'8px'};cursor:pointer;font-weight:bold;">
                    <i class="fas fa-times"></i> Cancel
                </button>
            </div>
            <style>@keyframes bounce{0%,100%{transform:translateY(0);}50%{transform:translateY(-6px);}}</style>
        </div>`;
    trackingPanel.style.display = 'block';

    // Countdown for group ETA display
    let etaSeconds = initialDurationMinutes * 60;
    if (reservationTimer) clearInterval(reservationTimer);
    reservationTimer = setInterval(() => {
        etaSeconds = sharedEtaAt
            ? Math.max(0, Math.ceil((sharedEtaAt - getSyncedNowMs()) / 1000))
            : Math.max(0, etaSeconds - 1);
        const el = document.getElementById('group-eta-display');
        if (el) {
            const m = Math.floor(etaSeconds / 60), s = etaSeconds % 60;
            el.textContent = etaSeconds > 60 ? `${m} min` : etaSeconds > 0 ? `${m}:${String(s).padStart(2,'0')}` : 'ðŸ›º Arriving!';
        }
        if (etaSeconds === 0) { clearInterval(reservationTimer); reservationTimer = null; }
    }, 1000);

    // Simulate tricycle arriving at shared pickup point, then start real nav
    simulateTricycleRoute(
        { lat: tricycle.lat, lng: tricycle.lng },
        { lat: sharedRider.pickupLat, lng: sharedRider.pickupLng },
        initialDurationMinutes,
        `Picking up all ${kekePoolGroup.riders.length} riders`,
        () => {
            // All riders at same spot â€” show "everyone aboard" popup then launch real nav
            showGroupAllAboardPopup(tricycle, () => {
                startRealDrivingNavigation();
            });
        }
    );
}

// Popup shown when tricycle arrives at the shared pickup point
function showGroupAllAboardPopup(tricycle, onStart) {
    const popup = document.createElement('div');
    popup.style.cssText = `position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:white;padding:${isMobile?'30px 25px':'28px'};border-radius:${isMobile?'20px':'15px'};box-shadow:0 10px 40px rgba(0,0,0,0.3);z-index:10000;max-width:${isMobile?'92%':'400px'};width:90%;text-align:center;border:3px solid #28a745;`;
    const riderCount = kekePoolGroup.riders.length;
    popup.innerHTML = `
        <div style="width:${isMobile?'90px':'70px'};height:${isMobile?'90px':'70px'};background:#28a745;color:white;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 18px;font-size:${isMobile?'44px':'34px'};">ðŸ›º</div>
        <h2 style="color:#28a745;margin:0 0 10px 0;">Tricycle Arrived!</h2>
        <p style="color:#333;margin-bottom:6px;">All <strong>${riderCount} riders</strong> are at this location.</p>
        <p style="color:#666;font-size:0.95em;margin-bottom:20px;">Everyone boards now â€” heading to your destination!</p>
        <div style="background:#e9f7ff;border-radius:12px;padding:14px;margin-bottom:20px;text-align:left;">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
                <i class="fas fa-user" style="color:#004080;"></i>
                <span><strong>${tricycle.driver}</strong></span>
            </div>
            <div style="display:flex;align-items:center;gap:10px;">
                <i class="fas fa-phone" style="color:#004080;"></i>
                <span>${tricycle.phone}</span>
            </div>
        </div>
        <button id="all-aboard-start-btn" style="width:100%;padding:${isMobile?'18px':'15px'};background:#28a745;color:white;border:none;border-radius:${isMobile?'14px':'10px'};font-size:${isMobile?'1.2em':'1.05em'};font-weight:bold;cursor:pointer;">
            <i class="fas fa-play"></i> START RIDE TO DESTINATION
        </button>`;
    document.body.appendChild(popup);
    document.getElementById('all-aboard-start-btn').onclick = function() {
        popup.remove();
        onStart();
    };
    // Auto-start after 8 seconds
    setTimeout(() => { if (popup.parentNode) { popup.remove(); onStart(); } }, 8000);
}

// ============================================
// REAL GOOGLE MAPS DRIVING NAVIGATION
// (called after ALL riders are picked up)
// ============================================
function startRealDrivingNavigation() {
    console.log('All riders aboard â€” starting real Google Maps driving navigation');
    ridePhase = 'pool-ride';

    // Hide tracking panel; navigation tracker will take over
    const trackingPanel = document.getElementById('tracking-panel');
    if (trackingPanel) {
        trackingPanel.style.display = 'none';
    }

    hideControls();

    // Clear simulation markers/polyline â€” real directionsRenderer takes over
    clearTricycleVisualization();

    // Set destination from poolRideData or selectedDestination
    const dest = (poolRideData && poolRideData.destination) || selectedDestination;
    if (!dest) {
        console.error('No destination set for real navigation');
        alert('Could not start navigation â€” no destination set.');
        return;
    }
    selectedDestination = dest;
    travelMode = 'DRIVING';

    // Show the full blue turn-by-turn navigation tracker
    createNavigationTracker();
    hideEndNavigationButton();

    // Start watching real GPS position for live progress tracking
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);

    const startPoolWatch = () => {
        watchId = navigator.geolocation.watchPosition(
            position => {
                userLocation = { lat: position.coords.latitude, lng: position.coords.longitude };
                if (userMarker) userMarker.setMap(null);
                userMarker = new google.maps.Marker({
                    position: userLocation, map,
                    title: "You (in tricycle)",
                    icon: {
                        path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
                        scale: isMobile ? 5 : 6,
                        fillColor: '#004080',
                        fillOpacity: 1,
                        strokeWeight: 1,
                        strokeColor: '#ffffff'
                    }
                });
                map.panTo(userLocation);
                checkUserProgress();
            },
            error => console.warn("GPS watch error:", error),
            { enableHighAccuracy: true, maximumAge: 10000, timeout: 30000 }
        );
    };

    // iOS Safari: getCurrentPosition first to confirm permission, then watch
    navigator.geolocation.getCurrentPosition(
        position => {
            userLocation = { lat: position.coords.latitude, lng: position.coords.longitude };
            localStorage.setItem('lastLocation', JSON.stringify(userLocation));
            startPoolWatch();
        },
        error => {
            console.warn('getCurrentPosition failed before pool watch:', error);
            startPoolWatch();
        },
        { enableHighAccuracy: true, maximumAge: 30000, timeout: 20000 }
    );

    // Use current GPS location as origin, or fall back to last pickup location
    const origin = userLocation || (() => {
        if (poolRideData && poolRideData.riders && poolRideData.riders.length > 0) {
            const last = poolRideData.riders[poolRideData.riders.length - 1];
            return { lat: last.pickupLat, lng: last.pickupLng };
        }
        return null;
    })();

    if (!origin) {
        alert('Cannot determine current location for navigation. Please enable GPS.');
        return;
    }

    // Announce transition
    if (voiceEnabled && 'speechSynthesis' in window) {
        speechSynthesis.cancel();
        speechSynthesis.speak(new SpeechSynthesisUtterance(
            `All riders aboard. Now navigating to ${dest.name}.`
        ));
    }

    // Request the real Google Maps route
    const instructionEl = document.getElementById('current-instruction');
    if (instructionEl) instructionEl.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Calculating route to destination...';

    directionsService.route({
        origin: origin,
        destination: { lat: dest.lat, lng: dest.lng },
        travelMode: google.maps.TravelMode.DRIVING,
        provideRouteAlternatives: false
    }, (result, status) => {
        if (status === 'OK') {
            route = result;
            currentStepIndex = 0;
            directionsRenderer.setDirections(result);
            updateTrackerWithRoute(result);
            updateInstruction();

            // Update tracker header to show "Pool Ride" context
            const trackerHeader = document.querySelector('#navigation-tracker h3');
            if (trackerHeader) trackerHeader.textContent = 'ðŸ›º Pool Ride â€” Navigation Active';

            // Show a brief toast confirming real nav started
            showNavStartToast(dest.name);
        } else {
            console.error('Directions failed:', status);
            if (instructionEl) instructionEl.innerHTML = `<i class="fas fa-exclamation-triangle" style="color:#dc3545;"></i> Route failed (${status}) â€” check GPS`;
            alert(`Could not calculate route to ${dest.name}. Please check your location and try again.`);
        }
    });
}

// Small toast notification shown when real nav kicks in
function showNavStartToast(destName) {
    const toast = document.createElement('div');
    toast.style.cssText = `
        position:fixed;
        top:${isMobile?'80px':'20px'};
        left:50%;
        transform:translateX(-50%);
        background:#004080;
        color:white;
        padding:${isMobile?'14px 24px':'12px 20px'};
        border-radius:50px;
        font-size:${isMobile?'1em':'0.9em'};
        font-weight:bold;
        z-index:9999;
        box-shadow:0 4px 16px rgba(0,64,128,0.4);
        display:flex;
        align-items:center;
        gap:10px;
        white-space:nowrap;
        animation:slideDown 0.4s ease;
    `;
    toast.innerHTML = `<i class="fas fa-route"></i> Navigating to ${destName}`;
    const style = document.createElement('style');
    style.textContent = `@keyframes slideDown{from{transform:translateX(-50%) translateY(-30px);opacity:0;}to{transform:translateX(-50%) translateY(0);opacity:1;}}`;
    document.head.appendChild(style);
    document.body.appendChild(toast);
    setTimeout(() => {
        toast.style.transition = 'opacity 0.5s';
        toast.style.opacity = '0';
        setTimeout(() => { toast.remove(); style.remove(); }, 500);
    }, 4000);
}

function showPoolETASummaryAndStartSimulation() {
    if (!poolRideData) { console.error('No pool data'); return; }
    const riders = poolRideData.riders;
    const tricycle = poolRideData.tricycle;
    const currentRiderId = localStorage.getItem('riderId');
    const currentRider = riders.find(r => r.id === currentRiderId) || riders[0];

    let ridersListHtml = '';
    riders.forEach(rider => {
        const isCurrentUser = rider.id === currentRiderId;
        ridersListHtml += `
            <div style="background:${isCurrentUser?'#d4edda':'#f8f9fa'};padding:12px;border-radius:8px;margin-bottom:8px;border-left:4px solid ${isCurrentUser?'#28a745':'#004080'};">
                <div style="display:flex;justify-content:space-between;align-items:center;">
                    <div>
                        <span style="font-weight:bold;color:#004080;">${rider.name||rider.userName||'Rider'} ${isCurrentUser?'(You)':''}</span>
                        <span style="background:#004080;color:white;padding:2px 8px;border-radius:12px;font-size:0.8em;margin-left:8px;">Pickup #${rider.pickupOrder}</span>
                    </div>
                    <div style="text-align:right;">
                        <div style="font-weight:bold;color:#28a745;">${rider.cumulativeETA} min</div>
                        <div style="font-size:0.8em;color:#666;">${(rider.distance).toFixed(2)} km</div>
                    </div>
                </div>
            </div>`;
    });

    if (!document.getElementById('tracking-panel')) {
        const panel = document.createElement('div');
        panel.id = 'tracking-panel';
        Object.assign(panel.style, getResponsivePanelPosition('tracking'));
        document.body.appendChild(panel);
    }
    createShowPanelButton();

    const trackingPanel = document.getElementById('tracking-panel');
    trackingPanel.innerHTML = `
        <div style="padding:${isMobile?'20px':'15px'};">
            ${isMobile?'<div style="width:50px;height:5px;background:#ccc;border-radius:3px;margin:0 auto 15px;"></div>':''}
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:15px;">
                <h3 style="margin:0;color:#004080;font-size:${isMobile?'1.3em':'1.1em'};"><i class="fas fa-users" style="color:#ffc107;"></i> Keke-Pool Started!</h3>
                <button onclick="hideTrackingPanel()" style="padding:${isMobile?'12px 18px':'8px 12px'};background:#6c757d;color:white;border:none;border-radius:${isMobile?'10px':'6px'};cursor:pointer;"><i class="fas fa-eye-slash"></i> Hide</button>
            </div>
            <div style="background:#e9f7ff;padding:15px;border-radius:10px;margin-bottom:15px;">
                <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
                    <i class="fas fa-shuttle-van" style="color:#004080;font-size:1.5em;"></i>
                    <div><div style="font-weight:bold;">${tricycle.name}</div><div style="font-size:0.9em;color:#666;">Driver: ${tricycle.driver} â€¢ ${tricycle.phone}</div></div>
                </div>
                <div style="display:flex;justify-content:space-between;background:white;padding:10px;border-radius:8px;">
                    <div><div style="font-size:0.8em;color:#666;">Your Pickup ETA</div><div style="font-size:1.5em;font-weight:bold;color:#004080;">${currentRider.cumulativeETA} min</div></div>
                    <div><div style="font-size:0.8em;color:#666;">Total Trip Time</div><div style="font-size:1.5em;font-weight:bold;color:#28a745;">${poolRideData.totalTime} min</div></div>
                </div>
            </div>
            <h4 style="color:#004080;margin:15px 0 10px 0;">Pickup Order & ETAs</h4>
            <div style="max-height:300px;overflow-y:auto;">${ridersListHtml}</div>
            <div id="tracking-status" style="margin-top:15px;">
                <div style="text-align:center;padding:15px;background:#fff3cd;border-radius:8px;">
                    <i class="fas fa-spinner fa-spin" style="color:#004080;"></i>
                    <p style="margin-top:10px;color:#856404;">Starting pickup simulation for first rider...</p>
                </div>
            </div>
        </div>`;
    trackingPanel.style.display = 'block';
    hideEndNavigationButton();

    setTimeout(() => { startFirstPickup(); }, 2000);
}

function startFirstPickup() {
    if (!poolRideData || !poolRideData.riders || poolRideData.riders.length === 0) { console.error('No pool ride data'); return; }
    currentPickupIndex = 0;
    const firstRider = poolRideData.riders[0];
    const tricycle = poolRideData.tricycle;

    const myRiderId = localStorage.getItem('riderId');
    const firstIsMe = firstRider.id && myRiderId && firstRider.id === myRiderId;

    const statusDiv = document.getElementById('tracking-status');
    if (statusDiv) statusDiv.innerHTML = `
        <div style="background:${firstIsMe?'#d4edda':'#f8f9fa'};border-radius:10px;padding:${isMobile?'18px':'14px'};">
            ${firstIsMe ? `
            <div style="text-align:center;margin-bottom:12px;">
                <div style="font-size:${isMobile?'2em':'1.6em'};animation:bounce 0.7s infinite;">ðŸ›º</div>
                <div style="font-weight:bold;color:#155724;font-size:${isMobile?'1.1em':'1em'};margin-top:8px;">The tricycle is coming for YOU first!</div>
                <div style="color:#155724;font-size:0.9em;margin-top:4px;">Head to your pickup point â€” you're first in queue.</div>
                <div style="margin-top:10px;font-size:${isMobile?'1.3em':'1.1em'};font-weight:bold;color:#155724;">ETA: ${firstRider.eta} min</div>
            </div>` : `
            <div style="text-align:center;">
                <i class="fas fa-circle-notch fa-spin" style="color:#004080;font-size:${isMobile?'28px':'22px'};"></i>
                <p style="margin-top:12px;font-weight:bold;color:#004080;">Tricycle heading to ${firstRider.name||'Rider 1'}â€¦</p>
                <p style="color:#28a745;font-weight:bold;font-size:${isMobile?'1.2em':'1.1em'};">ETA: ${firstRider.eta} min</p>
            </div>`}
        </div>
        <style>@keyframes bounce{0%,100%{transform:translateY(0);}50%{transform:translateY(-6px);}}</style>`;

    if (firstIsMe) {
        setTimeout(() => showNextRiderNotification(firstRider, 'The pool is starting', firstRider.eta), 500);
    }

    if (tricycleSimulationInterval) { clearInterval(tricycleSimulationInterval); tricycleSimulationInterval = null; }
    if (tricycleRoutePolyline) tricycleRoutePolyline.setMap(null);
    if (tricycleMarker) tricycleMarker.setMap(null);

    // Pass moveToNextPickup as the onComplete callback
    simulateTricycleRoute(
        { lat:tricycle.lat, lng:tricycle.lng },
        { lat:firstRider.pickupLat, lng:firstRider.pickupLng },
        firstRider.eta,
        `Picking up ${firstRider.name||firstRider.userName||'Rider 1'}`,
        () => moveToNextPickup()
    );
}

// Show a prominent popup notifying the next rider it's their turn.
function showNextRiderNotification(nextRider, prevRiderName, etaMinutes) {
    const existingNote = document.getElementById('next-rider-notification');
    if (existingNote) existingNote.remove();

    const myRiderId = localStorage.getItem('riderId');
    const isMyTurn = nextRider.id && myRiderId && nextRider.id === myRiderId;

    const note = document.createElement('div');
    note.id = 'next-rider-notification';
    note.style.cssText = `position:fixed;top:0;left:0;width:100%;height:100%;background:${isMyTurn?'rgba(0,64,0,0.88)':'rgba(0,0,0,0.75)'};z-index:99999;display:flex;align-items:center;justify-content:center;`;

    note.innerHTML = isMyTurn ? `
        <div style="background:white;border-radius:${isMobile?'25px':'18px'};padding:${isMobile?'35px 28px':'28px'};max-width:${isMobile?'95%':'420px'};width:90%;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,0.4);animation:slideUp 0.4s ease;">
            <div style="font-size:${isMobile?'4em':'3.5em'};margin-bottom:12px;animation:bounce 0.6s infinite;">ðŸ›º</div>
            <div style="background:#28a745;color:white;border-radius:50px;padding:10px 24px;font-size:${isMobile?'1em':'0.9em'};font-weight:bold;display:inline-block;margin-bottom:18px;animation:pulse 1s infinite;">
                ðŸš¨ IT'S YOUR TURN! ðŸš¨
            </div>
            <h2 style="color:#004080;margin:0 0 10px 0;font-size:${isMobile?'1.6em':'1.5em'};">The tricycle is coming for YOU!</h2>
            <p style="color:#333;font-size:${isMobile?'1.1em':'1em'};margin-bottom:8px;"><strong>${prevRiderName}</strong> just boarded.</p>
            <p style="color:#004080;font-size:${isMobile?'1.05em':'1em'};margin-bottom:18px;font-weight:500;">Please head to your pickup spot and be ready â€” the driver is on the way!</p>
            <div style="background:#d4edda;border-radius:12px;padding:14px;margin-bottom:22px;border:2px solid #28a745;">
                <div style="font-size:0.85em;color:#155724;margin-bottom:4px;font-weight:bold;">ðŸ• Arriving in approximately</div>
                <div style="font-size:${isMobile?'2.2em':'2em'};font-weight:bold;color:#155724;">${etaMinutes} min</div>
            </div>
            <div style="display:flex;gap:12px;">
                <button onclick="document.getElementById('next-rider-notification').remove()"
                        style="flex:1;padding:${isMobile?'16px':'13px'};background:#28a745;color:white;border:none;border-radius:${isMobile?'12px':'10px'};font-size:${isMobile?'1.05em':'1em'};font-weight:bold;cursor:pointer;">
                    <i class="fas fa-check"></i> I'm Ready!
                </button>
                <button onclick="centerOnTricycle();document.getElementById('next-rider-notification').remove();"
                        style="flex:1;padding:${isMobile?'16px':'13px'};background:#17a2b8;color:white;border:none;border-radius:${isMobile?'12px':'10px'};font-size:${isMobile?'1.05em':'1em'};font-weight:bold;cursor:pointer;">
                    <i class="fas fa-crosshairs"></i> Watch on Map
                </button>
            </div>
        </div>
        <style>
            @keyframes slideUp{from{transform:translateY(60px);opacity:0;}to{transform:translateY(0);opacity:1;}}
            @keyframes bounce{0%,100%{transform:translateY(0);}50%{transform:translateY(-8px);}}
            @keyframes pulse{0%,100%{transform:scale(1);}50%{transform:scale(1.05);}}
        </style>` : `
        <div style="background:white;border-radius:${isMobile?'25px':'18px'};padding:${isMobile?'35px 28px':'28px'};max-width:${isMobile?'95%':'420px'};width:90%;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,0.4);animation:slideUp 0.4s ease;">
            <div style="font-size:${isMobile?'3.5em':'3em'};margin-bottom:12px;">ðŸ›º</div>
            <div style="background:#28a745;color:white;border-radius:50px;padding:8px 20px;font-size:0.85em;font-weight:bold;display:inline-block;margin-bottom:16px;">
                Rider ${currentPickupIndex} of ${poolRideData.riders.length} picked up âœ“
            </div>
            <h2 style="color:#004080;margin:0 0 8px 0;font-size:${isMobile?'1.5em':'1.4em'};">${prevRiderName} just boarded!</h2>
            <p style="color:#333;font-size:${isMobile?'1.1em':'1em'};margin-bottom:20px;">
                Tricycle is now heading to pick up<br>
                <strong style="font-size:1.15em;color:#004080;">${nextRider.name || 'Rider ' + (currentPickupIndex + 1)}</strong>
            </p>
            <div style="background:#e9f7ff;border-radius:12px;padding:14px;margin-bottom:22px;">
                <div style="font-size:0.85em;color:#666;margin-bottom:4px;">Estimated arrival at next pickup</div>
                <div style="font-size:${isMobile?'2em':'1.8em'};font-weight:bold;color:#004080;">${etaMinutes} min</div>
            </div>
            <div style="display:flex;gap:12px;">
                <button onclick="document.getElementById('next-rider-notification').remove()"
                        style="flex:1;padding:${isMobile?'15px':'12px'};background:#004080;color:white;border:none;border-radius:${isMobile?'12px':'10px'};font-size:${isMobile?'1em':'0.95em'};font-weight:bold;cursor:pointer;">
                    <i class="fas fa-check"></i> Got it
                </button>
                <button onclick="centerOnTricycle();document.getElementById('next-rider-notification').remove();"
                        style="flex:1;padding:${isMobile?'15px':'12px'};background:#17a2b8;color:white;border:none;border-radius:${isMobile?'12px':'10px'};font-size:${isMobile?'1em':'0.95em'};font-weight:bold;cursor:pointer;">
                    <i class="fas fa-crosshairs"></i> Track
                </button>
            </div>
        </div>
        <style>@keyframes slideUp{from{transform:translateY(60px);opacity:0;}to{transform:translateY(0);opacity:1;}}</style>`;

    document.body.appendChild(note);
    const dismissDelay = isMyTurn ? 15000 : 8000;
    setTimeout(() => { if (document.getElementById('next-rider-notification')) document.getElementById('next-rider-notification').remove(); }, dismissDelay);
}

// Callback slot for pickup confirmation
let _pickupConfirmCallback = null;
function _onPickupConfirmTap() {
    const el = document.getElementById('picked-up-confirmation');
    if (el) el.remove();
    if (_pickupConfirmCallback) { const cb = _pickupConfirmCallback; _pickupConfirmCallback = null; cb(); }
}

function showPickedUpConfirmation(rider, onConfirm) {
    const existingNote = document.getElementById('picked-up-confirmation');
    if (existingNote) existingNote.remove();
    _pickupConfirmCallback = onConfirm;

    const myRiderId = localStorage.getItem('riderId');
    const nextIdx = currentPickupIndex + 1;
    const nextRider = poolRideData && poolRideData.riders[nextIdx];
    const nextIsMe = nextRider && myRiderId && nextRider.id === myRiderId;

    const note = document.createElement('div');
    note.id = 'picked-up-confirmation';
    note.style.cssText = `position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,64,0,0.82);z-index:99999;display:flex;align-items:center;justify-content:center;`;
    note.innerHTML = `
        <div style="background:white;border-radius:${isMobile?'25px':'18px'};padding:${isMobile?'35px 28px':'28px'};max-width:${isMobile?'95%':'400px'};width:90%;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,0.4);animation:slideUp 0.3s ease;">
            <div style="font-size:${isMobile?'3.5em':'3em'};margin-bottom:10px;">âœ…</div>
            <h2 style="color:#155724;margin:0 0 10px 0;font-size:${isMobile?'1.5em':'1.4em'};">Arrived at pickup!</h2>
            <p style="color:#333;font-size:${isMobile?'1.05em':'1em'};margin-bottom:8px;">
                The tricycle has reached<br>
                <strong style="color:#004080;font-size:1.1em;">${rider.name || 'Rider'}</strong>
            </p>
            <p style="color:#666;font-size:0.9em;margin-bottom:${nextIsMe?'10px':'22px'};">Rider is boarding nowâ€¦</p>
            ${nextIsMe ? `
            <div style="background:#fff3cd;border:2px solid #ffc107;border-radius:10px;padding:12px;margin-bottom:18px;">
                <div style="font-weight:bold;color:#856404;font-size:${isMobile?'1em':'0.95em'};">âš ï¸ Next stop is YOU!</div>
                <div style="color:#856404;font-size:0.9em;margin-top:4px;">Start heading to your pickup spot now.</div>
            </div>` : ''}
            <button onclick="_onPickupConfirmTap()"
                    style="width:100%;padding:${isMobile?'15px':'12px'};background:#28a745;color:white;border:none;border-radius:${isMobile?'12px':'10px'};font-size:${isMobile?'1.05em':'1em'};font-weight:bold;cursor:pointer;">
                Continue
            </button>
        </div>
        <style>@keyframes slideUp{from{transform:translateY(60px);opacity:0;}to{transform:translateY(0);opacity:1;}}</style>`;
    document.body.appendChild(note);
    setTimeout(() => {
        const el = document.getElementById('picked-up-confirmation');
        if (el) { el.remove(); if (_pickupConfirmCallback) { const cb = _pickupConfirmCallback; _pickupConfirmCallback = null; cb(); } }
    }, 3000);
}

// ============================================
// MOVE TO NEXT PICKUP (sequential simulation)
// After last pickup â†’ launch real Google Maps driving
// ============================================
function moveToNextPickup() {
    if (!poolRideData) return;

    const justPickedUp = poolRideData.riders[currentPickupIndex];
    currentPickupIndex++;

    if (currentPickupIndex < poolRideData.riders.length) {
        // â”€â”€ More riders to pick up â€” continue simulation â”€â”€
        const nextRider = poolRideData.riders[currentPickupIndex];
        const previousRider = justPickedUp;

        const doMoveToNext = () => {
            // Update tracking panel for this leg
            const trackingPanel = document.getElementById('tracking-panel');
            if (trackingPanel) trackingPanel.innerHTML = `
                <div style="padding:${isMobile?'20px':'15px'};">
                    ${isMobile?'<div style="width:50px;height:5px;background:#ccc;border-radius:3px;margin:0 auto 15px;"></div>':''}
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:15px;">
                        <h3 style="margin:0;color:#004080;font-size:${isMobile?'1.2em':'1.05em'};"><i class="fas fa-shuttle-van"></i> Pickup ${currentPickupIndex+1} of ${poolRideData.riders.length}</h3>
                        <button onclick="hideTrackingPanel()" style="padding:${isMobile?'12px 18px':'8px 12px'};background:#6c757d;color:white;border:none;border-radius:${isMobile?'10px':'6px'};cursor:pointer;font-size:${isMobile?'0.9em':'0.8em'};"><i class="fas fa-eye-slash"></i> Hide</button>
                    </div>
                    <div style="background:#e9ecef;border-radius:50px;height:8px;margin-bottom:15px;overflow:hidden;">
                        <div style="background:#004080;height:100%;width:${Math.round((currentPickupIndex / poolRideData.riders.length) * 100)}%;border-radius:50px;transition:width 0.5s;"></div>
                    </div>
                    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:15px;">
                        ${poolRideData.riders.map((r, i) => `
                            <div style="padding:4px 10px;border-radius:50px;font-size:0.8em;font-weight:bold;
                                background:${i < currentPickupIndex ? '#28a745' : i === currentPickupIndex ? '#ffc107' : '#e9ecef'};
                                color:${i < currentPickupIndex ? 'white' : i === currentPickupIndex ? '#333' : '#666'};">
                                ${i < currentPickupIndex ? 'âœ“ ' : i === currentPickupIndex ? 'ðŸ›º ' : ''}${r.name || 'Rider ' + (i+1)}
                            </div>`).join('')}
                    </div>
                    <div style="background:#fff3cd;border-radius:${isMobile?'12px':'10px'};padding:${isMobile?'15px':'12px'};margin-bottom:12px;">
                        <div style="font-size:0.8em;color:#856404;margin-bottom:5px;font-weight:bold;">NOW HEADING TO</div>
                        <div style="font-size:${isMobile?'1.1em':'1em'};font-weight:bold;color:#333;">${nextRider.name || 'Rider ' + (currentPickupIndex+1)}</div>
                    </div>
                    <div style="background:#e9f7ff;border-radius:${isMobile?'12px':'10px'};padding:${isMobile?'14px':'10px'};margin-bottom:15px;">
                        <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
                            <i class="fas fa-user" style="color:#004080;"></i>
                            <span style="font-weight:bold;">${poolRideData.tricycle.driver}</span>
                        </div>
                        <div style="display:flex;align-items:center;gap:10px;">
                            <i class="fas fa-phone" style="color:#004080;"></i>
                            <span>${poolRideData.tricycle.phone}</span>
                        </div>
                    </div>
                    <div id="tracking-status">
                        <div style="background:#f8f9fa;border-radius:10px;padding:15px;text-align:center;">
                            <i class="fas fa-circle-notch fa-spin" style="color:#004080;font-size:${isMobile?'28px':'22px'};"></i>
                            <p style="margin-top:12px;font-weight:bold;color:#004080;">En route to ${nextRider.name || 'next rider'}â€¦</p>
                            <p style="color:#28a745;font-weight:bold;font-size:${isMobile?'1.2em':'1.1em'};margin-top:4px;">ETA: ${nextRider.eta} min</p>
                        </div>
                    </div>
                    <div style="display:flex;gap:10px;margin-top:15px;">
                        <button onclick="centerOnTricycle()" style="flex:1;padding:${isMobile?'13px':'10px'};background:#17a2b8;color:white;border:none;border-radius:${isMobile?'10px':'8px'};cursor:pointer;font-weight:bold;">
                            <i class="fas fa-crosshairs"></i> Track
                        </button>
                        <button onclick="cancelReservationAndClear()" style="flex:1;padding:${isMobile?'13px':'10px'};background:#dc3545;color:white;border:none;border-radius:${isMobile?'10px':'8px'};cursor:pointer;font-weight:bold;">
                            <i class="fas fa-times"></i> Cancel
                        </button>
                    </div>
                </div>`;

            if (tricycleSimulationInterval) { clearInterval(tricycleSimulationInterval); tricycleSimulationInterval = null; }
            if (tricycleRoutePolyline) tricycleRoutePolyline.setMap(null);

            simulateTricycleRoute(
                { lat:previousRider.pickupLat, lng:previousRider.pickupLng },
                { lat:nextRider.pickupLat, lng:nextRider.pickupLng },
                nextRider.eta,
                `Picking up ${nextRider.name || 'Rider ' + (currentPickupIndex+1)}`,
                () => moveToNextPickup()
            );
            showNextRiderNotification(nextRider, previousRider.name || 'Previous rider', nextRider.eta);
        };

        showPickedUpConfirmation(previousRider, doMoveToNext);

    } else {
        // â”€â”€ ALL riders picked up â€” transition to real Google Maps driving â”€â”€
        const lastRider = poolRideData.riders[poolRideData.riders.length - 1];

        // Show "all aboard" summary popup then start real navigation
        showAllRidersAboardPopup(lastRider, () => {
            startRealDrivingNavigation();
        });
    }
}

// Summary popup shown when the last rider boards before real nav starts
function showAllRidersAboardPopup(lastRider, onStart) {
    const popup = document.createElement('div');
    popup.style.cssText = `position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:white;padding:${isMobile?'30px 25px':'28px'};border-radius:${isMobile?'20px':'15px'};box-shadow:0 10px 40px rgba(0,0,0,0.3);z-index:10000;max-width:${isMobile?'92%':'420px'};width:90%;text-align:center;border:3px solid #28a745;`;
    const dest = (poolRideData && poolRideData.destination) || selectedDestination;
    popup.innerHTML = `
        <div style="width:${isMobile?'90px':'72px'};height:${isMobile?'90px':'72px'};background:#28a745;color:white;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 18px;font-size:${isMobile?'44px':'34px'};">ðŸŽ‰</div>
        <h2 style="color:#28a745;margin:0 0 8px 0;">All Riders Aboard!</h2>
        <p style="color:#333;margin-bottom:6px;">All <strong>${poolRideData.riders.length} riders</strong> have been picked up.</p>
        <p style="color:#666;font-size:0.95em;margin-bottom:18px;">Switching to <strong>Google Maps navigation</strong> to reach your destination.</p>
        <div style="background:#e9f7ff;border-radius:12px;padding:14px;margin-bottom:20px;">
            <div style="font-size:0.85em;color:#6c757d;margin-bottom:5px;">DESTINATION</div>
            <div style="font-size:${isMobile?'1.2em':'1.1em'};font-weight:bold;color:#004080;">${dest ? dest.name : 'Your Destination'}</div>
        </div>
        <button id="all-riders-start-nav-btn" style="width:100%;padding:${isMobile?'18px':'15px'};background:#004080;color:white;border:none;border-radius:${isMobile?'14px':'10px'};font-size:${isMobile?'1.2em':'1.05em'};font-weight:bold;cursor:pointer;">
            <i class="fas fa-route"></i> START NAVIGATION
        </button>`;
    document.body.appendChild(popup);
    document.getElementById('all-riders-start-nav-btn').onclick = function() {
        popup.remove();
        onStart();
    };
    // Auto-start after 6 seconds
    setTimeout(() => { if (popup.parentNode) { popup.remove(); onStart(); } }, 6000);
}

// ============================================
// KEKE-POOL TRACKING
// ============================================
function startKekePoolTracking() {
    ridePhase = 'pool-waiting';
    document.getElementById("mode-selector").classList.add("hidden");
    const tricyclePanel = document.getElementById("tricycle-panel");
    if (tricyclePanel) tricyclePanel.classList.add("hidden");
    tricyclePanelVisible = false;
    hideEndNavigationButton();
    const findBtn = document.getElementById('find-tricycles-btn');
    if (findBtn) findBtn.innerHTML = '<i class="fas fa-shuttle-van"></i> Find Campus Tricycles';
    hideControls();
    if (!document.getElementById('tracking-panel')) {
        const panel = document.createElement('div');
        panel.id = 'tracking-panel';
        Object.assign(panel.style, getResponsivePanelPosition('tracking'));
        document.body.appendChild(panel);
    }
    const trackingPanel = document.getElementById('tracking-panel');
    trackingPanel.style.display = 'block';
    trackingPanel.innerHTML = `
        <div style="padding:${isMobile?'20px':'15px'};">
            ${isMobile?'<div style="width:50px;height:5px;background:#ccc;border-radius:3px;margin:10px auto;"></div>':''}
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:15px;">
                <h3 style="margin:0;color:#004080;"><i class="fas fa-users" style="color:#ffc107;"></i> Keke-Pool Mode</h3>
                <button onclick="cancelReservationAndClear()" style="padding:${isMobile?'12px 18px':'8px 12px'};background:#dc3545;color:white;border:none;border-radius:${isMobile?'10px':'6px'};cursor:pointer;font-weight:bold;"><i class="fas fa-times"></i> Cancel Pool</button>
            </div>
            <div id="pool-status-container">
                <div style="text-align:center;margin-bottom:20px;">
                    <div style="background:#e9f7ff;padding:20px;border-radius:15px;">
                        <i class="fas fa-map-pin" style="font-size:2em;color:#004080;margin-bottom:10px;"></i>
                        <h4 style="color:#004080;margin-bottom:5px;">${selectedDestination?.name||'Destination'}</h4>
                        <p style="color:#666;font-size:0.9em;">Waiting for riders going to this location</p>
                    </div>
                </div>
                <div id="keke-pool-waiting" style="background:#f8f9fa;padding:15px;border-radius:12px;margin:15px 0;"></div>
                <div style="background:#fff3cd;padding:15px;border-radius:10px;margin-top:20px;">
                    <p style="margin:0;color:#856404;font-size:0.95em;"><i class="fas fa-info-circle"></i> When 4 riders join, the ride will start automatically for everyone.</p>
                </div>
            </div>
        </div>`;
    displayKekePoolGroup();
    if (kekePoolRefreshInterval) clearInterval(kekePoolRefreshInterval);
    kekePoolRefreshInterval = setInterval(() => {
        if (ridePhase === 'pool-waiting' && currentPoolId) {
            fetch(`/api/kekepool/${currentPoolId}`)
                .then(res => res.json())
                .then(data => {
                    syncServerClock(data.serverTime);
                    kekePoolGroup = data;
                    poolSyncState = data.syncState || poolSyncState;
                    displayKekePoolGroup();
                    if (data.riders && data.riders.length >= 4) calculatePoolETAAndStart();
                })
                .catch(error => console.error('Error checking pool:', error));
        }
    }, 3000);
    if (isMobile) addSwipeToDismiss(trackingPanel, function() { if (confirm('Cancel Keke-Pool?')) cancelReservationAndClear(); });
}

// ============================================
// ETA BOOKING SYSTEM
// ============================================

function showETABooking(tricycleId, forcePoolMode = false) {
    if (userSession.hasActiveReservation && (ridePhase==='pickup'||ridePhase==='trip'||ridePhase==='pool-waiting'||ridePhase==='pool-ride')) {
        alert("Cannot book another tricycle while your ride is in progress."); return;
    }
    fetch(`/api/vehicles/${tricycleId}`)
        .then(res => res.json())
        .then(tricycle => {
            const passengerCount = tricycle.passengerCount || 0;
            const maxCapacity = tricycle.maxCapacity || 4;
            if (passengerCount >= maxCapacity) { alert(`This tricycle is full! Maximum ${maxCapacity} passengers.\n\nCurrent: ${passengerCount}/${maxCapacity}`); return; }
            if (tricycle.reservedForPool === true && !forcePoolMode) {
                alert(`This tricycle has Keke-Pool riders.\n\nTap "Join Pool" to join the existing pool, or select a different tricycle for solo booking.`);
                return;
            }
            if (userSession.hasActiveReservation) { alert(`You already have an active reservation.\n\nPlease complete or cancel your current ride first.`); return; }
            selectedTricycle = tricycle;
            if (userLocation) {
                getFastETA({ lat:tricycle.lat, lng:tricycle.lng }, userLocation).then(eta => {
                    createETAModal(tricycle, passengerCount, maxCapacity, eta.distanceText, eta.text, forcePoolMode);
                });
            } else {
                createETAModal(tricycle, passengerCount, maxCapacity, "Calculating...", "Calculating...", forcePoolMode);
            }
        })
        .catch(error => { console.error('Error loading tricycle:', error); alert('Could not load tricycle details'); });
}

function buildRideTypeToggle(poolOnly) {
    if (poolOnly) {
        return `<div style="background:#fff3cd;border:1px solid #ffc107;border-radius:12px;padding:14px 16px;margin:15px 0;display:flex;align-items:center;gap:12px;">
            <i class="fas fa-users" style="color:#856404;font-size:1.4em;flex-shrink:0;"></i>
            <div>
                <div style="font-weight:bold;color:#856404;margin-bottom:2px;">Keke-Pool Mode Only</div>
                <div style="font-size:0.85em;color:#856404;">This tricycle already has pool riders. Solo booking is unavailable â€” you will join the existing pool.</div>
            </div>
        </div>`;
    }
    return `<div style="background:#f8f9fa;padding:15px;border-radius:12px;margin:15px 0;border:1px solid #dee2e6;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
            <span style="font-weight:bold;color:#004080;"><i class="fas fa-car-side"></i> Ride Type</span>
            <span style="font-size:0.85em;color:#666;">Select your preference</span>
        </div>
        <div style="display:flex;gap:10px;">
            <div id="keke-pool-solo" onclick="setKekePoolMode('solo')" style="flex:1;padding:12px;text-align:center;background:#004080;color:white;border:2px solid #004080;border-radius:10px;cursor:pointer;font-weight:bold;transition:all 0.3s ease;">
                <i class="fas fa-user" style="display:block;font-size:1.5em;margin-bottom:5px;"></i>Solo
            </div>
            <div id="keke-pool-pool" onclick="setKekePoolMode('pool')" style="flex:1;padding:12px;text-align:center;background:white;color:#004080;border:2px solid #dee2e6;border-radius:10px;cursor:pointer;font-weight:bold;transition:all 0.3s ease;">
                <i class="fas fa-users" style="display:block;font-size:1.5em;margin-bottom:5px;"></i>Keke-Pool
            </div>
        </div>
    </div>`;
}

function createETAModal(tricycle, passengerCount, maxCapacity, distanceText, etaText, forcePoolMode = false) {
    detectMobile();
    const modalHTML = `
        <div id="etaModal" style="display:block;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:10000;overflow-y:auto;-webkit-overflow-scrolling:touch;">
            <div style="position:absolute;top:${isMobile?'30px':'50%'};left:50%;transform:translate(-50%,${isMobile?'0':'-50%'});background:white;padding:${isMobile?'25px 20px':'25px'};border-radius:${isMobile?'25px':'15px'};max-width:${isMobile?'95%':'500px'};width:${isMobile?'95%':'90%'};max-height:${isMobile?'85vh':'80vh'};overflow-y:auto;box-shadow:0 10px 40px rgba(0,0,0,0.2);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
                    <h2 style="margin:0;color:#004080;font-size:${isMobile?'1.6em':'1.5em'};"><i class="fas fa-clock"></i> Book Ride</h2>
                    <button onclick="closeETAModal()" style="background:none;border:none;font-size:${isMobile?'36px':'28px'};cursor:pointer;color:#666;">&times;</button>
                </div>
                <div style="background:#f8f9fa;padding:${isMobile?'20px':'15px'};border-radius:${isMobile?'15px':'12px'};margin-bottom:20px;">
                    <div style="display:flex;align-items:center;gap:15px;">
                        <div style="width:${isMobile?'60px':'50px'};height:${isMobile?'60px':'50px'};border-radius:50%;background:#28a745;color:white;display:flex;align-items:center;justify-content:center;font-weight:bold;font-size:${isMobile?'24px':'20px'};">${tricycle.id}</div>
                        <div style="flex:1;">
                            <h3 style="margin:0 0 5px 0;font-size:${isMobile?'1.3em':'1.2em'};">${tricycle.name}</h3>
                            <div style="display:flex;flex-wrap:wrap;gap:15px;font-size:${isMobile?'0.95em':'0.9em'};color:#666;">
                                <span><i class="fas fa-users"></i> ${passengerCount}/${maxCapacity}</span>
                                <span><i class="fas fa-battery-three-quarters"></i> ${tricycle.battery}%</span>
                                <span><i class="fas fa-palette"></i> ${tricycle.color}</span>
                            </div>
                            <div style="margin-top:15px;display:flex;gap:20px;">
                                <div><div style="font-size:0.8em;color:#666;">Distance</div><div style="font-weight:bold;color:#004080;">${distanceText}</div></div>
                                <div><div style="font-size:0.8em;color:#666;">Pickup ETA</div><div style="font-weight:bold;color:#28a745;">${etaText}</div></div>
                            </div>
                        </div>
                    </div>
                </div>
                ${buildRideTypeToggle(forcePoolMode)}
                <div id="keke-pool-waiting" style="display:none;"></div>
                <div id="etaForm">
                    <div style="margin-bottom:20px;">
                        <label style="display:block;margin-bottom:8px;font-weight:bold;"><i class="fas fa-map-marker-alt"></i> Pickup Location</label>
                        <input type="text" id="pickupLocation" value="${userLocation?'Your current location':''}" style="width:100%;padding:${isMobile?'16px':'14px'};border:1px solid #ddd;border-radius:${isMobile?'12px':'10px'};font-size:${isMobile?'1.1em':'1em'};background:#f8f9fa;" readonly>
                        <input type="hidden" id="pickupLat" value="${userLocation?.lat||''}">
                        <input type="hidden" id="pickupLng" value="${userLocation?.lng||''}">
                    </div>
                    <div style="margin-bottom:20px;" id="destinationSection">
                        <label style="display:block;margin-bottom:8px;font-weight:bold;"><i class="fas fa-flag-checkered"></i> Destination</label>
                        ${selectedDestination?
                            `<div style="background:#e9f7ff;padding:${isMobile?'16px':'14px'};border-radius:${isMobile?'12px':'10px'};border:1px solid #b8daff;margin-bottom:10px;">
                                <div style="display:flex;justify-content:space-between;align-items:center;">
                                    <div><strong>${selectedDestination.name}</strong><br><small style="color:#666;">Pre-selected destination</small></div>
                                    <button onclick="clearDestination()" style="background:#6c757d;color:white;border:none;border-radius:${isMobile?'10px':'8px'};padding:${isMobile?'12px 20px':'8px 15px'};cursor:pointer;">Change</button>
                                </div>
                                <input type="hidden" id="destLat" value="${selectedDestination.lat}">
                                <input type="hidden" id="destLng" value="${selectedDestination.lng}">
                                <input type="hidden" id="destinationInput" value="${selectedDestination.name}">
                            </div>`:
                            `<input type="text" id="destinationInput" placeholder="Type campus location..." list="locations" style="width:100%;padding:${isMobile?'16px':'14px'};border:1px solid #ddd;border-radius:${isMobile?'12px':'10px'};font-size:${isMobile?'1.1em':'1em'};margin-bottom:10px;">
                            <datalist id="locations"></datalist>
                            <div id="destinationCoords" style="display:none;"><input type="hidden" id="destLat"><input type="hidden" id="destLng"></div>`
                        }
                    </div>
                    <div style="margin-bottom:25px;">
                        <label style="display:block;margin-bottom:8px;font-weight:bold;"><i class="fas fa-user"></i> Your Name</label>
                        <input type="text" id="userName" placeholder="Enter your name" style="width:100%;padding:${isMobile?'16px':'14px'};border:1px solid #ddd;border-radius:${isMobile?'12px':'10px'};font-size:${isMobile?'1.1em':'1em'};">
                    </div>
                    <button onclick="calculateAccurateETA(${tricycle.id})" style="width:100%;padding:${isMobile?'18px':'16px'};background:#004080;color:white;border:none;border-radius:${isMobile?'15px':'12px'};font-size:${isMobile?'1.2em':'1.1em'};font-weight:bold;cursor:pointer;margin-bottom:12px;">
                        <i class="fas fa-calculator"></i> Calculate Accurate Time
                    </button>
                    <button onclick="closeETAModal()" style="width:100%;padding:${isMobile?'16px':'14px'};background:#f8f9fa;color:#666;border:1px solid #ddd;border-radius:${isMobile?'15px':'12px'};font-size:${isMobile?'1.1em':'1em'};cursor:pointer;">Cancel</button>
                </div>
                <div id="etaResults" style="display:none;"></div>
            </div>
        </div>`;
    const modalContainer = document.createElement('div');
    modalContainer.innerHTML = modalHTML;
    document.body.appendChild(modalContainer);
    if (forcePoolMode) {
        setKekePoolMode('pool');
        const soloBtn = document.getElementById('keke-pool-solo');
        if (soloBtn) soloBtn.style.display = 'none';
    } else {
        setKekePoolMode('solo');
    }
    if (!selectedDestination) populateDestinationList();
}

function clearDestination() {
    selectedDestination = null;
    closeETAModal();
    setTimeout(() => showETABooking(selectedTricycle.id), 100);
}

function closeETAModal() {
    const modal = document.getElementById('etaModal');
    if (modal) modal.remove();
    if (reservationTimer) clearInterval(reservationTimer);
}

function populateDestinationList() {
    const locationsList = document.getElementById('locations');
    if (!locationsList) return;
    const campusLocations = allLocations.filter(loc => !loc.name.includes("Tricycle #"));
    locationsList.innerHTML = '';
    campusLocations.forEach(loc => {
        const option = document.createElement('option');
        option.value = loc.name;
        option.setAttribute('data-lat', loc.lat);
        option.setAttribute('data-lng', loc.lng);
        locationsList.appendChild(option);
    });
    const destInput = document.getElementById('destinationInput');
    if (destInput) {
        destInput.addEventListener('input', function() {
            const selected = campusLocations.find(loc => loc.name.toLowerCase() === this.value.toLowerCase());
            if (selected) {
                document.getElementById('destLat').value = selected.lat;
                document.getElementById('destLng').value = selected.lng;
                document.getElementById('destinationCoords').style.display = 'block';
            }
        });
    }
}

async function calculateAccurateETA(tricycleId) {
    const pickupLat = document.getElementById('pickupLat').value;
    const pickupLng = document.getElementById('pickupLng').value;
    const destLat = document.getElementById('destLat').value;
    const destLng = document.getElementById('destLng').value;
    const userName = document.getElementById('userName').value || "Guest";
    if (!pickupLat || !pickupLng) { alert("Please enable location services or set your pickup location"); return; }
    if (!destLat || !destLng) { alert("Please select a valid campus destination from the list"); return; }

    if (kekePoolMode === 'pool') {
        closeETAModal();
        const loadingDiv = document.createElement('div');
        loadingDiv.id = 'keke-pool-loading';
        loadingDiv.style.cssText = `position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:white;padding:30px;border-radius:20px;box-shadow:0 10px 40px rgba(0,0,0,0.3);z-index:10001;text-align:center;min-width:${isMobile?'280px':'320px'};display:flex;flex-direction:column;align-items:center;`;
        loadingDiv.innerHTML = `
            <i class="fas fa-users" style="font-size:48px;color:#004080;margin-bottom:20px;"></i>
            <h3 style="color:#004080;margin-bottom:15px;">Joining Keke-Pool...</h3>
            <div style="width:50px;height:50px;border:5px solid #f3f3f3;border-top:5px solid #004080;border-radius:50%;margin:20px auto;animation:spin 1s linear infinite;"></div>
            <style>@keyframes spin{0%{transform:rotate(0);}100%{transform:rotate(360deg);}}</style>`;
        document.body.appendChild(loadingDiv);
        startKekePoolTracking();
        joinKekePool(userName, { lat:parseFloat(pickupLat), lng:parseFloat(pickupLng) });
        return;
    }

    const etaForm = document.getElementById('etaForm');
    const etaResults = document.getElementById('etaResults');
    if (etaForm) etaForm.style.display = 'none';
    if (etaResults) { etaResults.style.display='block'; etaResults.innerHTML=`<div style="text-align:center;padding:40px 20px;"><i class="fas fa-spinner fa-spin" style="font-size:${isMobile?'48px':'40px'};color:#004080;"></i><p style="margin-top:20px;">Calculating accurate route...</p></div>`; }

    try {
        const tricycleResponse = await fetch(`/api/vehicles/${tricycleId}`);
        const tricycle = await tricycleResponse.json();
        const pickupETA = await getAccurateETA({ lat:tricycle.lat, lng:tricycle.lng }, { lat:parseFloat(pickupLat), lng:parseFloat(pickupLng) });
        const tripETA = await getAccurateETA({ lat:parseFloat(pickupLat), lng:parseFloat(pickupLng) }, { lat:parseFloat(destLat), lng:parseFloat(destLng) });
        const pickupETAminutes = Math.ceil(pickupETA.value / 60);
        const tripETAminutes = Math.ceil(tripETA.value / 60);
        currentETA = {
            pickupETA: pickupETAminutes, tripETA: tripETAminutes, totalETA: pickupETAminutes + tripETAminutes,
            pickupDistanceText: pickupETA.distanceText, tripDistanceText: tripETA.distanceText,
            pickupDurationText: pickupETA.text, tripDurationText: tripETA.text,
            assignedVehicle: { id:tricycle.id, name:tricycle.name, currentLocation:{lat:tricycle.lat,lng:tricycle.lng}, passengerCount:tricycle.passengerCount, maxCapacity:tricycle.maxCapacity, driver:tricycle.driver, phone:tricycle.phone }
        };
        userSession.pickupETA = pickupETAminutes;
        showAccurateETAResults(tricycleId, currentETA, userName);
    } catch (error) {
        console.error('ETA calculation error:', error);
        if (etaForm) etaForm.style.display = 'block';
        if (etaResults) etaResults.style.display = 'none';
        const fallbackETA = { pickupETA:5, tripETA:5, totalETA:10, pickupDistanceText:'~1.5 km', tripDistanceText:'~1.5 km', pickupDurationText:'5 min', tripDurationText:'5 min', assignedVehicle:{ driver:selectedTricycle?.driver||'John Okafor', phone:selectedTricycle?.phone||'+234 803 123 4567' } };
        showAccurateETAResults(tricycleId, fallbackETA, userName);
    }
}

function showAccurateETAResults(tricycleId, etaData, userName) {
    const etaResults = document.getElementById('etaResults');
    if (!etaResults) return;
    const pickupETA = etaData.pickupETA || 5;
    const tripETA = etaData.tripETA || 5;
    const pickupDurationText = etaData.pickupDurationText || pickupETA+' mins';
    const tripDurationText = etaData.tripDurationText || tripETA+' mins';
    const pickupDistanceText = etaData.pickupDistanceText || '~1.5 km';
    const tripDistanceText = etaData.tripDistanceText || '~1.5 km';
    etaResults.innerHTML = `
        <div style="border-top:2px solid #f0f0f0;padding-top:25px;margin-top:20px;">
            <h3 style="color:#28a745;margin-bottom:25px;text-align:center;"><i class="fas fa-check-circle"></i> Accurate Trip Time</h3>
            <div style="background:#e9f7ff;padding:${isMobile?'20px':'15px'};border-radius:${isMobile?'15px':'12px'};margin-bottom:25px;">
                <div style="display:flex;align-items:center;margin-bottom:10px;">
                    <div style="background:#004080;color:white;width:${isMobile?'50px':'40px'};height:${isMobile?'50px':'40px'};border-radius:50%;display:flex;align-items:center;justify-content:center;margin-right:15px;"><i class="fas fa-shuttle-van" style="font-size:${isMobile?'24px':'20px'};"></i></div>
                    <div><div style="font-weight:bold;">${selectedTricycle?.name||`Tricycle ${tricycleId}`}</div><div style="font-size:0.9em;color:#666;">${pickupDistanceText} from you</div></div>
                </div>
            </div>
            <div style="display:flex;justify-content:space-around;margin:30px 0;">
                <div style="text-align:center;"><div style="font-size:0.8em;color:#666;">Pickup</div><div style="font-size:${isMobile?'1.8em':'1.6em'};font-weight:bold;color:#28a745;">${pickupDurationText}</div><div style="font-size:0.8em;color:#666;">${pickupDistanceText}</div></div>
                <div style="text-align:center;"><div style="font-size:0.8em;color:#666;">Trip</div><div style="font-size:${isMobile?'1.8em':'1.6em'};font-weight:bold;color:#004080;">${tripDurationText}</div><div style="font-size:0.8em;color:#666;">${tripDistanceText}</div></div>
                <div style="text-align:center;"><div style="font-size:0.8em;color:#666;">Total</div><div style="font-size:${isMobile?'1.8em':'1.6em'};font-weight:bold;color:#004080;">${pickupETA+tripETA}<span style="font-size:0.8em;"> min</span></div><div style="font-size:0.8em;color:#666;">Total time</div></div>
            </div>
            <div style="background:#e9f7ff;padding:15px;border-radius:10px;margin:20px 0;">
                <h4 style="color:#004080;margin-bottom:15px;"><i class="fas fa-info-circle"></i> Driver Information</h4>
                <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px;">
                    <div style="width:40px;height:40px;background:#004080;color:white;border-radius:50%;display:flex;align-items:center;justify-content:center;"><i class="fas fa-user"></i></div>
                    <div><div style="font-size:0.8em;color:#6c757d;">Driver</div><div style="font-weight:bold;color:#004080;">${etaData.assignedVehicle?.driver||selectedTricycle?.driver||'John Okafor'}</div></div>
                </div>
                <div style="display:flex;align-items:center;gap:12px;">
                    <div style="width:40px;height:40px;background:#004080;color:white;border-radius:50%;display:flex;align-items:center;justify-content:center;"><i class="fas fa-phone"></i></div>
                    <div><div style="font-size:0.8em;color:#6c757d;">Phone</div><div style="font-weight:bold;color:#004080;">${etaData.assignedVehicle?.phone||selectedTricycle?.phone||'+234 803 123 4567'}</div></div>
                </div>
                <button onclick="window.location.href='tel:${(etaData.assignedVehicle?.phone||selectedTricycle?.phone||'+2348031234567').replace(/\s/g,'')}'" style="width:100%;padding:12px;background:#28a745;color:white;border:none;border-radius:10px;font-weight:bold;cursor:pointer;margin-top:15px;"><i class="fas fa-phone-alt"></i> Call Driver</button>
            </div>
            <button onclick="confirmReservation(${tricycleId}, '${userName}')" style="width:100%;padding:${isMobile?'18px':'16px'};background:#28a745;color:white;border:none;border-radius:${isMobile?'15px':'12px'};font-size:${isMobile?'1.2em':'1.1em'};font-weight:bold;cursor:pointer;margin-bottom:12px;"><i class="fas fa-check-circle"></i> Confirm & Reserve</button>
            <button onclick="goBackToForm()" style="width:100%;padding:${isMobile?'16px':'14px'};background:#f8f9fa;color:#666;border:1px solid #ddd;border-radius:${isMobile?'15px':'12px'};font-size:${isMobile?'1.1em':'1em'};cursor:pointer;"><i class="fas fa-arrow-left"></i> Change Details</button>
        </div>`;
}

function goBackToForm() {
    const etaResults = document.getElementById('etaResults');
    const etaForm = document.getElementById('etaForm');
    if (etaResults && etaForm) { etaResults.style.display='none'; etaForm.style.display='block'; }
}

async function confirmReservation(tricycleId, userName) {
    const pickupLat = document.getElementById('pickupLat').value;
    const pickupLng = document.getElementById('pickupLng').value;
    const destLat = document.getElementById('destLat').value;
    const destLng = document.getElementById('destLng').value;
    try {
        const response = await fetch(`/api/vehicles/${tricycleId}/reserve`, {
            method:'POST', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({ userId:`user_${Date.now()}`, userName, pickupLat, pickupLng, destLat, destLng })
        });
        if (response.ok) {
            const result = await response.json();
            currentReservationId = result.reservationId;
            userSession = {
                hasActiveReservation: true, currentReservationId: result.reservationId,
                vehicleId: tricycleId, vehicleName: selectedTricycle?.name||`Tricycle ${tricycleId}`,
                vehicleDetails: { ...selectedTricycle, driver:selectedTricycle?.driver||'John Okafor', phone:selectedTricycle?.phone||'+234 803 123 4567' },
                reservationExpiry: new Date(Date.now() + 15*60000),
                passengerCount: result.passengerCount || 1,
                pickupETA: currentETA?.pickupETA || 5
            };
            localStorage.setItem('activeReservation', JSON.stringify(userSession));
            showReservationSuccess(result, userName);
            setTimeout(() => { closeETAModal(); startReservationTracking(currentReservationId); }, 3000);
        } else {
            const error = await response.json();
            alert(`Reservation failed: ${error.error}`);
        }
    } catch (error) { console.error('Reservation error:', error); alert('Network error. Please try again.'); }
}

function showReservationSuccess(result, userName) {
    const etaResults = document.getElementById('etaResults');
    if (!etaResults) return;
    const tricycleName = userSession.vehicleName || selectedTricycle?.name || `Tricycle ${userSession.vehicleId}`;
    const passengerCount = result.passengerCount || 1;
    etaResults.innerHTML = `
        <div style="text-align:center;padding:30px 20px;">
            <div style="width:${isMobile?'100px':'80px'};height:${isMobile?'100px':'80px'};background:#28a745;color:white;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 20px;font-size:${isMobile?'48px':'36px'};"><i class="fas fa-check"></i></div>
            <h2 style="color:#28a745;margin-bottom:15px;">Reservation Confirmed!</h2>
            <div style="background:#e9f7ff;padding:${isMobile?'20px':'15px'};border-radius:${isMobile?'15px':'12px'};margin:25px 0;">
                <div style="font-size:0.85em;color:#666;margin-bottom:8px;">RESERVATION ID</div>
                <div style="font-size:${isMobile?'1.3em':'1.2em'};font-weight:bold;color:#004080;margin-bottom:15px;">${result.reservationId}</div>
                <div style="display:flex;justify-content:space-between;margin-bottom:10px;">
                    <div style="text-align:left;"><div style="font-size:0.85em;color:#666;">Tricycle</div><div style="font-weight:bold;">${tricycleName}</div></div>
                    <div style="text-align:right;"><div style="font-size:0.85em;color:#666;">Passengers</div><div style="font-weight:bold;">${passengerCount}/4</div></div>
                </div>
                <div style="margin-top:15px;padding:${isMobile?'15px':'12px'};background:#d4edda;border-radius:${isMobile?'12px':'10px'};"><div style="color:#155724;"><i class="fas fa-user"></i> Reserved for: <strong>${userName}</strong></div></div>
            </div>
            <div style="background:#e9f7ff;padding:15px;border-radius:10px;margin:20px 0;">
                <h4 style="color:#004080;margin-bottom:10px;">Driver Details</h4>
                <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;"><i class="fas fa-user" style="color:#004080;"></i><span><strong>${userSession.vehicleDetails?.driver||'John Okafor'}</strong></span></div>
                <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;"><i class="fas fa-phone" style="color:#004080;"></i><span>${userSession.vehicleDetails?.phone||'+234 803 123 4567'}</span></div>
                <button onclick="window.location.href='tel:${(userSession.vehicleDetails?.phone||'+2348031234567').replace(/\s/g,'')}'" style="width:100%;padding:10px;background:#28a745;color:white;border:none;border-radius:8px;margin-top:10px;cursor:pointer;"><i class="fas fa-phone-alt"></i> Call Driver</button>
            </div>
            <div style="margin-top:30px;padding:${isMobile?'20px':'15px'};background:#fff3cd;border-radius:${isMobile?'15px':'12px'};color:#856404;">
                <i class="fas fa-exclamation-triangle"></i> <strong>Your tricycle is being dispatched!</strong>
                <p style="margin:12px 0 0 0;">Estimated pickup time: ${userSession.pickupETA} minutes</p>
            </div>
        </div>`;
}

// ============================================
// BACKEND CONNECTION CHECK
// ============================================
function checkBackendConnection() {
    fetch('/api/health')
        .then(response => response.json())
        .then(data => { console.log('Backend connected:', data); initializeTricycleSystem(); })
        .catch(error => { console.error('Backend connection failed:', error); });
}

// ============================================
// CANCEL RESERVATION - COMPLETE RESET
// ============================================
function cancelReservationAndClear() {
    if (ridePhase==='trip'||ridePhase==='pool-ride') {
        alert("Cannot cancel reservation during an active ride. Please complete the ride first."); return;
    }
    if (confirm('Cancel your reservation? This will return you to the main screen.')) {
        if (currentPoolId) {
            const riderId = localStorage.getItem('riderId');
            fetch(`/api/kekepool/${currentPoolId}/leave`, {
                method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ riderId })
            }).catch(error => console.error('Error leaving pool:', error));
        }
        if (userSession.vehicleId) {
            fetch(`/api/vehicles/${userSession.vehicleId}/release`, { method:'POST', headers:{'Content-Type':'application/json'} })
                .catch(error => console.error('Error:', error));
        }
        userSession = { hasActiveReservation:false, currentReservationId:null, reservationExpiry:null, vehicleId:null, vehicleName:null, vehicleDetails:null, passengerCount:0, pickupETA:null };
        ridePhase = 'none'; kekePoolMode = 'solo'; currentPoolId = null; poolRideData = null; currentPickupIndex = 0;
        kekePoolGroup = { id:null, destination:null, riders:[], maxRiders:4, createdAt:null };
        localStorage.removeItem('activeReservation'); localStorage.removeItem('riderId');
        clearAllDisplays();
        alert('Reservation cancelled. Returning to main screen.');
        document.getElementById("destination-input").value = "";
        selectedDestination = null;
        // showControls() is already called inside clearAllDisplays()
        const findBtn = document.getElementById('find-tricycles-btn');
        if (findBtn) findBtn.innerHTML = '<i class="fas fa-shuttle-van"></i> Find Campus Tricycles';
        if (tricyclePanelVisible) loadAvailableTricycles();
    }
}

function clearAllDisplays() {
    const trackingPanel = document.getElementById('tracking-panel');
    if (trackingPanel) { trackingPanel.style.display='none'; trackingPanel.innerHTML=''; }
    const navTracker = document.getElementById('navigation-tracker');
    if (navTracker) navTracker.remove();
    const endNavBtn = document.getElementById('end-navigation-btn');
    if (endNavBtn) endNavBtn.classList.remove('visible');
    if (reservationTimer) { clearInterval(reservationTimer); reservationTimer=null; }
    if (tricycleSimulationInterval) { clearInterval(tricycleSimulationInterval); tricycleSimulationInterval=null; }
    if (kekePoolRefreshInterval) { clearInterval(kekePoolRefreshInterval); kekePoolRefreshInterval=null; }
    if (pickupSimulationInterval) { clearInterval(pickupSimulationInterval); pickupSimulationInterval=null; }
    if (watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId=null; }
    clearTricycleVisualization();
    clearTricycleMarkers();
    document.getElementById("mode-selector").classList.add("hidden");
    if (showPanelBtn) showPanelBtn.style.display = 'none';
    route = null; currentStepIndex = 0; travelMode = null; navTrackerCollapsed = false;
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    if (map && userLocation) { map.setCenter(userLocation); map.setZoom(isMobile?16:17); }
    showControls();
}

function clearTricycleVisualization() {
    if (tricycleRoutePolyline) { tricycleRoutePolyline.setMap(null); tricycleRoutePolyline=null; }
    if (tricycleMarker) { tricycleMarker.setMap(null); tricycleMarker=null; }
}

function completeRide() {
    if (confirm('Complete your ride?')) {
        if (userSession.vehicleId) {
            fetch(`/api/vehicles/${userSession.vehicleId}/complete-ride`, { method:'POST', headers:{'Content-Type':'application/json'} })
                .then(response => {
                    if (response.ok) {
                        userSession = { hasActiveReservation:false, currentReservationId:null, reservationExpiry:null, vehicleId:null, vehicleName:null, vehicleDetails:null, passengerCount:0, pickupETA:null };
                        ridePhase = 'none';
                        localStorage.removeItem('activeReservation');
                        clearAllDisplays();
                        alert('Ride completed successfully. Thank you!');
                        loadAvailableTricycles();
                    }
                }).catch(error => console.error('Error:', error));
        }
    }
}

