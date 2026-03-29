import React, { useState, useEffect, useRef } from 'react';
import { Route, MapPin, Navigation2, Zap, TriangleAlert, RefreshCcw, ThumbsUp, ShieldAlert, Truck, Globe, Newspaper, CloudRain, Radio, Anchor, AlertOctagon, Terminal, Sun, Moon } from 'lucide-react';
import { MapContainer, TileLayer, Polyline, Marker, Popup, useMap, Tooltip } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const createTruckIcon = (isDark) => {
  const bg = isDark ? '#1E293B' : 'white';
  const border = isDark ? '#94A3B8' : '#0F172A';
  return L.divIcon({
    className: 'custom-truck-icon',
    html: `<div style="background: ${bg}; border: 3px solid ${border}; width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center;"><div style="width:12px; height:8px; background: ${border}; border-radius: 2px;"></div></div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
};

const createCircleMarker = (color, isDark) => {
  const border = isDark ? '#020617' : 'white';
  return L.divIcon({
    className: 'custom-circle-icon',
    html: `<div style="background: ${color}; width: 16px; height: 16px; border-radius: 50%; border: 3px solid ${border}; box-shadow: 0 0 10px ${color};"></div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
};

// Map Autofocus component
function MapUpdater({ bounds, center }) {
  const map = useMap();
  useEffect(() => {
    if (bounds) {
      map.fitBounds(bounds, { padding: [50, 50] });
    } else if (center) {
      map.flyTo(center, map.getZoom() || 6);
    }
  }, [bounds, center, map]);
  return null;
}

export default function MainApp() {
  const [theme, setTheme] = useState('light');
  const [origin, setOrigin] = useState('Los Angeles, CA');
  const [destination, setDestination] = useState('Las Vegas, NV');
  
  // Real Coordinate States
  const [startCoords, setStartCoords] = useState([34.05, -118.25]);
  const [endCoords, setEndCoords] = useState([36.17, -115.13]);
  const [mapCenter, setMapCenter] = useState([35.10, -116.50]);
  const [mapBounds, setMapBounds] = useState(null);

  // Dynamic Path States
  const [primaryPath, setPrimaryPath] = useState( [ [34.05, -118.25], [35.10, -116.50], [36.17, -115.13] ] );
  const [primaryUpToAnomaly, setPrimaryUpToAnomaly] = useState([ [34.05, -118.25], [35.10, -116.50] ]);
  const [primaryAfterAnomaly, setPrimaryAfterAnomaly] = useState([ [35.10, -116.50], [36.17, -115.13] ]);
  const [flashFloodDetour, setFlashFloodDetour] = useState([ [35.10, -116.50], [35.80, -116.80], [36.17, -115.13] ]);
  const [blockageDetour, setBlockageDetour] = useState([ [35.10, -116.50], [34.80, -115.80], [36.17, -115.13] ]);
  
  // Pre-route paths for Use Case 1 (Simplified detours based on start/end)
  const [congestionPrePath, setCongestionPrePath] = useState([]);
  const [typhoonPrePath, setTyphoonPrePath] = useState([]);

  const [condition, setCondition] = useState('clear');
  const [journeyState, setJourneyState] = useState('idle'); 
  const [liveAnomaly, setLiveAnomaly] = useState(null);
  const [carProgress, setCarProgress] = useState(0);
  const [showAlert, setShowAlert] = useState(false);
  const [routeMetrics, setRouteMetrics] = useState({ duration: null, distance: null });
  const [detourDelay, setDetourDelay] = useState(0);
  
  const [activeAgents, setActiveAgents] = useState([]);
  const [agentLogs, setAgentLogs] = useState([{ msg: 'System idle. Agents in standby. Enter locations.', style: 'log-entry', id: 1 }]);

  const animationRef = useRef(null);
  const progressRef = useRef(0);

  const addLog = (msg, style) => {
    setAgentLogs(prev => [...prev, { msg, style, id: Date.now() + Math.random() }]);
  };

  const formatDuration = (seconds) => {
    if (!seconds) return '';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h > 0 ? h + ' hr ' : ''}${m} min`;
  };

  // --- REAL ROUTING LOGIC via OSRM & Nominatim ---
  const geocodeAddress = async (query) => {
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}`);
      const data = await res.json();
      if (data && data.length > 0) return [parseFloat(data[0].lat), parseFloat(data[0].lon)];
    } catch (e) {
      console.error("Geocoding failed", e);
    }
    return null;
  };

  const fetchOSRMRoute = async (start, end) => {
    try {
      // OSRM requires Lng,Lat
      const url = `https://router.project-osrm.org/route/v1/driving/${start[1]},${start[0]};${end[1]},${end[0]}?overview=full&geometries=geojson`;
      const res = await fetch(url);
      const data = await res.json();
      if (data.routes && data.routes.length > 0) {
        // GeoJSON uses [Lng, Lat], Leaflet uses [Lat, Lng]
        return {
           path: data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]),
           duration: data.routes[0].duration,
           distance: data.routes[0].distance
        };
      }
    } catch (e) {
      console.error("OSRM Route fetching failed", e);
    }
    return { path: [start, end], duration: 0, distance: 0 };
  };

  const generateGeometricDetour = (start, end, offsetScale) => {
    const dLat = end[0] - start[0];
    const dLng = end[1] - start[1];
    // Perpendicular vector
    const perpLat = -dLng;
    const perpLng = dLat;
    return [
      start,
      [start[0] + dLat*0.5 + perpLat*offsetScale, start[1] + dLng*0.5 + perpLng*offsetScale],
      end
    ];
  };

  const handleFindRoute = async () => {
    setJourneyState('planning');
    setLiveAnomaly(null);
    setCarProgress(0);
    setAgentLogs([]);
    setActiveAgents(['news', 'weather', 'logistics']);
    
    addLog(`> Geolocating: ${origin} to ${destination}...`, 'log-entry');

    const sCoords = await geocodeAddress(origin);
    const eCoords = await geocodeAddress(destination);

    if (!sCoords || !eCoords) {
      setActiveAgents([]);
      addLog(`[ERROR] Could not resolve one or both locations. Check spelling.`, 'log-decision');
      setJourneyState('idle');
      return;
    }

    setStartCoords(sCoords);
    setEndCoords(eCoords);
    
    // Bounds for map
    const bounds = L.latLngBounds(sCoords, eCoords);
    setMapBounds(bounds);

    addLog(`> Requesting physical highway routing geometry...`, 'log-entry text-small');
    
    setDetourDelay(0);
    const trueRouteData = await fetchOSRMRoute(sCoords, eCoords);
    setPrimaryPath(trueRouteData.path);
    setRouteMetrics({ duration: trueRouteData.duration, distance: trueRouteData.distance });

    const trueRoute = trueRouteData.path;

    // Calculate dynamic branching for Anomalies (at midpoint of the physical route)
    const midIndex = Math.floor(trueRoute.length / 2);
    const splitNode = trueRoute[midIndex];
    
    setPrimaryUpToAnomaly(trueRoute.slice(0, midIndex + 1));
    setPrimaryAfterAnomaly(trueRoute.slice(midIndex));

    // Calculate synthetic detours from the midpoint to the end, using perpendicular offsets
    setFlashFloodDetour(generateGeometricDetour(splitNode, eCoords, 0.3));
    setBlockageDetour(generateGeometricDetour(splitNode, eCoords, -0.3));

    // Calculate Use Case 1 Pre-route alternatives
    setCongestionPrePath(generateGeometricDetour(sCoords, eCoords, 0.2));
    setTyphoonPrePath(generateGeometricDetour(sCoords, eCoords, -0.4));

    setActiveAgents([]);
    addLog(`> Complete. Highway corridors mapped. Primary route secured.`, 'log-entry log-traffic');
    setJourneyState('idle'); 
  };
  // ------------------------------------------------

  const startNavigation = () => {
    setJourneyState('navigating');
    setLiveAnomaly(null);
    setCarProgress(0);
    progressRef.current = 0;
    setShowAlert(false);
    setAgentLogs([{ msg: 'Fleet in transit. Monitoring conditions...', style: 'log-entry', id: 0 }]);

    const animate = () => {
      progressRef.current += 0.25;
      if (progressRef.current >= 100) {
        setCarProgress(100);
        setJourneyState('arrived');
        return;
      }
      setCarProgress(progressRef.current);
      animationRef.current = requestAnimationFrame(animate);
    };
    animationRef.current = requestAnimationFrame(animate);
  };

  const triggerSuddenAnomaly = (type) => {
    if (journeyState !== 'navigating') return;
    
    cancelAnimationFrame(animationRef.current);
    setJourneyState('analyzing-risks');
    setLiveAnomaly(type);
    setShowAlert(false);
    setActiveAgents([]);
    
    setAgentLogs([]);
    addLog('>> SUDDEN EVENT DETECTED. AWAKENING AGENTS...', 'log-entry');

    setTimeout(() => {
      setActiveAgents(['weather']);
      if (type === 'weather') addLog('> Weather Agent: Severe Storm/Flood detected further ahead. [Risk: 85]', 'log-entry log-weather');
      else addLog('> Weather Agent: Conditions clear. [Risk: 5]', 'log-entry log-weather');
    }, 1000);

    setTimeout(() => {
      setActiveAgents(['weather', 'news']);
      if (type === 'war') addLog('> News Agent: Violent protest/blockade mapped on highway. [Risk: 90]', 'log-entry log-news');
      else addLog('> News Agent: News streams stable. [Risk: 2]', 'log-entry log-news');
    }, 2000);

    setTimeout(() => {
      setActiveAgents(['weather', 'news', 'logistics']);
      addLog('> Traffic Agent: Heavy congestion building ahead mapping route. [Risk: 60]', 'log-entry log-traffic');
    }, 3000);

    setTimeout(() => {
      setActiveAgents([]);
      const scoreW = type === 'weather' ? 85 : 5;
      const scoreN = type === 'war' ? 90 : 2;
      const scoreT = 60;
      const totalRisk = scoreW + scoreN + scoreT;
      const threshold = 100;

      addLog(`[DECISION AGENT] Collecting all scores... Total Risk = ${totalRisk} / Threshold = ${threshold}`, 'log-entry');
      
      setTimeout(() => {
        if (totalRisk > threshold) {
           addLog(`[DECISION AGENT] Risk > Threshold! Marking route as BLOCKED. Generating alternate path...`, 'log-entry log-decision');
        }
      }, 800);
    }, 4500);

    setTimeout(() => {
       setJourneyState('anomaly-triggered');
       setShowAlert(true);

       const alertText = `${type === 'weather' ? 'Flood' : 'Conflict'} detected! Risk thresholds exceeded. Rerouting...`;

       // 1. ADD VOICE (BONUS FEATURE)
       const msg = new SpeechSynthesisUtterance(alertText);
       window.speechSynthesis.speak(msg);

       // 2. NATIVE TEST FLOW ALERT (Deliberate block for demonstration)
       setTimeout(() => {
          window.alert(`⚠️ ${alertText}`);
       }, 100);

       setDetourDelay(type === 'weather' ? 5400 : 9600); // add 1.5 or 2.5 hours synthetic route delay
    }, 6000);

    setTimeout(() => {
      setJourneyState('rerouting');
      setShowAlert(false);
      
      setTimeout(() => {
        setJourneyState('navigating');
        progressRef.current = 50; 
        addLog(`>> Alternate route engaged. Continuing transit.`, 'log-entry');
        
        const animateDetour = () => {
          progressRef.current += 0.35;
          if (progressRef.current >= 100) {
            setCarProgress(100);
            setJourneyState('arrived');
            return;
          }
          setCarProgress(progressRef.current);
          animationRef.current = requestAnimationFrame(animateDetour);
        };
        animationRef.current = requestAnimationFrame(animateDetour);
      }, 1000);
    }, 8500); 
  };

  useEffect(() => {
    return () => cancelAnimationFrame(animationRef.current);
  }, []);

  let currentActivePath = primaryPath;
  if (journeyState === 'idle' || journeyState === 'planning') {
    if (condition === 'congestion') currentActivePath = congestionPrePath;
    if (condition === 'typhoon') currentActivePath = typhoonPrePath;
  }

  const getInterpolatedPoint = (path, progress) => {
    let p = Math.max(0, Math.min(100, progress));
    const fraction = p / 100;
    const numSegments = path.length - 1;
    if (numSegments <= 0) return path[0] || [0,0];
    
    // exact segment distance (assumes segments are equal time lengths which is an approximation for OSRM nodes)
    const exactSegment = fraction * numSegments;
    let segIdx = Math.floor(exactSegment);
    if (segIdx >= numSegments) segIdx = numSegments - 1;
    
    const segmentFraction = exactSegment - segIdx;
    const startNode = path[segIdx];
    const endNode = path[segIdx + 1];

    if (!startNode || !endNode) return path[0];

    const lat = startNode[0] + (endNode[0] - startNode[0]) * segmentFraction;
    const lng = startNode[1] + (endNode[1] - startNode[1]) * segmentFraction;
    return [lat, lng];
  };

  const getCarPosLeaflet = () => {
    if (primaryPath.length === 0) return startCoords;
    if (!liveAnomaly) return getInterpolatedPoint(currentActivePath, carProgress);
    if (carProgress <= 50) return getInterpolatedPoint(primaryPath, carProgress);
    const detourPath = liveAnomaly === 'weather' ? flashFloodDetour : blockageDetour;
    const remainingProgress = (carProgress - 50) * 2;
    return getInterpolatedPoint(detourPath, remainingProgress);
  };

  const carCoords = getCarPosLeaflet();

  return (
    <div className="app-layout" data-theme={theme}>
      {/* Header */}
      <header className="header">
        <div className="header-logo">
          <Globe size={28} />
          RouteMind AI
        </div>
        <div style={{display: 'flex', gap: '1.5rem', alignItems: 'center'}}>
          <div className="status-indicator">
            <div className="status-dot"></div>
            {journeyState === 'navigating' ? 'Autonomous Fleet Active' : 'Multi-Agent System Ready'}
          </div>
          <button 
             onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')} 
             style={{background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-main)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0.25rem'}}
             title="Toggle Theme"
          >
            {theme === 'light' ? <Moon size={22} /> : <Sun size={22} />}
          </button>
        </div>
      </header>

      <main className="main-content">
        {/* Left Panel */}
        <div className="left-panel">
          
          <div className="panel-card fade-in" style={{padding: '1rem'}}>
            <h2 className="panel-title" style={{color: 'var(--success)'}}>
              <Terminal size={18} />
              Collaborative AI Agents
            </h2>
            <div className="agent-grid mt-1">
              <div className={`agent-badge ${activeAgents.includes('news') ? 'pulse-blue' : ''}`}>
                 <Newspaper size={14} /> News/Geo
              </div>
              <div className={`agent-badge ${activeAgents.includes('weather') ? 'pulse-blue' : ''}`}>
                 <CloudRain size={14} /> Weather
              </div>
              <div className={`agent-badge ${activeAgents.includes('logistics') ? 'pulse-blue' : ''}`}>
                 <Radio size={14} /> Traffic
              </div>
            </div>
            
            <div className="agent-log-box" id="agent-logs">
              {agentLogs.map((log) => (
                <p key={log.id} className={log.style}>{log.msg}</p>
              ))}
            </div>
          </div>

          <div className="panel-card fade-in mt-1">
            <h2 className="panel-title">
              <Anchor size={20} color="var(--accent)" />
              1. Map Intelligence
            </h2>
            <p className="text-small">Dynamically geocode new origins and destinations.</p>

            <div className="input-group mt-1">
              <label>Origin Hub</label>
              <div className="input-wrapper">
                <MapPin size={16} color="var(--accent)" />
                <input 
                  type="text" 
                  value={origin} 
                  onChange={(e) => setOrigin(e.target.value)} 
                  placeholder="e.g. Seattle, WA" 
                  disabled={journeyState !== 'idle' && journeyState !== 'planning'}
                />
              </div>
            </div>

            <div className="input-group mt-1">
              <label>Destination Hub</label>
              <div className="input-wrapper">
                <MapPin size={16} color="var(--success)" />
                <input 
                  type="text" 
                  value={destination} 
                  onChange={(e) => setDestination(e.target.value)} 
                  placeholder="e.g. Miami, FL" 
                  disabled={journeyState !== 'idle' && journeyState !== 'planning'}
                />
              </div>
            </div>
            
            <div className="input-group mt-1">
              <label>Global Conditions Signal</label>
              <div className="sim-buttons" style={{gridTemplateColumns: '1fr 1fr 1fr'}}>
                <button 
                  className={`btn-sim ${condition === 'clear' ? 'active' : ''}`}
                  onClick={() => setCondition('clear')}
                  disabled={journeyState !== 'idle' && journeyState !== 'planning'}
                >
                  Clear
                </button>
                <button 
                  className={`btn-sim ${condition === 'congestion' ? 'active traffic' : ''}`}
                  onClick={() => setCondition('congestion')}
                  disabled={journeyState !== 'idle' && journeyState !== 'planning'}
                >
                  Traffic
                </button>
                <button 
                  className={`btn-sim ${condition === 'typhoon' ? 'active flood' : ''}`}
                  onClick={() => setCondition('typhoon')}
                  disabled={journeyState !== 'idle' && journeyState !== 'planning'}
                >
                  Storm
                </button>
              </div>
            </div>
            
            <button className="btn-primary mt-1" onClick={handleFindRoute} disabled={journeyState === 'navigating' || !origin || !destination}>
              {journeyState === 'planning' ? <RefreshCcw size={18} className="spin" /> : <Navigation2 size={18} />}
              {journeyState === 'planning' ? 'Multi-Agent Analyzing...' : 'Predict Optimal Route'}
            </button>
          </div>

          <div className="panel-card fade-in mt-1">
            <h2 className="panel-title">
              <Zap size={20} color="var(--danger)" />
              Mission Control & Rerouting
            </h2>
            <p className="text-small">Inject anomalies mid-transit to test dynamic agent collaborations.</p>
            
            {journeyState === 'idle' || journeyState === 'planning' || journeyState === 'arrived' ? (
              <button className="btn-success mt-2" onClick={startNavigation}>
                <Truck size={18} /> Deploy Fleet
              </button>
            ) : (
              <div className="active-nav-controls mt-2">
                <div className="progress-bar">
                  <div className="progress-fill" style={{width: `${carProgress}%`}}></div>
                </div>
                
                {carProgress < 50 && !liveAnomaly ? (
                  <>
                    <p className="text-small" style={{color: 'var(--warning)', marginTop: '1rem'}}>
                      Trigger real-time events on route:
                    </p>
                    <div className="sim-buttons mt-1" style={{gridTemplateColumns: '1fr 1fr'}}>
                      <button className="btn-sim hover-danger" onClick={() => triggerSuddenAnomaly('weather')}>
                        🌩️ Sudden Storm
                      </button>
                      <button className="btn-sim hover-danger" onClick={() => triggerSuddenAnomaly('war')}>
                        🔥 Geopol. War
                      </button>
                    </div>
                  </>
                ) : (
                  <p className="text-small" style={{color: 'var(--accent)', marginTop: '1rem'}}>
                    {journeyState === 'analyzing-risks' ? 'Agents gathering data...' : liveAnomaly ? 'Agents negotiated new route.' : 'Transport in transit...'}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Center Real Leaflet Map */}
        <div className="map-section maps-theme" style={{ position: 'relative' }}>
          
          <MapContainer 
            center={mapCenter} 
            zoom={7} 
            scrollWheelZoom={false} 
            style={{ height: "100%", width: "100%", borderRadius: '16px', zIndex: 1 }}
          >
            <MapUpdater bounds={mapBounds} center={startCoords} />
            <TileLayer
              url={theme === 'dark' ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" : "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"}
              attribution='&copy; CARTO'
            />

            {!liveAnomaly && primaryPath.length > 0 && (
              <Polyline 
                positions={currentActivePath} 
                pathOptions={{ 
                  color: condition === 'clear' ? '#3B82F6' : '#10B981', 
                  weight: 8, 
                  opacity: 0.8,
                  className: journeyState === 'planning' ? 'routing-anim-leaflet' : ''
                }} 
              >
                {routeMetrics.duration && condition === 'clear' && (
                  <Tooltip permanent direction="top" className="route-tooltip" offset={[0, -5]}>
                    <div style={{fontWeight: 'bold'}}>{formatDuration(routeMetrics.duration)}</div>
                  </Tooltip>
                )}
              </Polyline>
            )}

            {liveAnomaly && (
              <>
                <Polyline positions={primaryUpToAnomaly} pathOptions={{ color: '#94A3B8', weight: 6 }} />
                <Polyline positions={primaryAfterAnomaly} pathOptions={{ color: '#DC2626', weight: 8, dashArray: '10, 10' }} className="flash-anim-leaflet" />
                {journeyState !== 'analyzing-risks' && journeyState !== 'anomaly-triggered' && (
                  <Polyline 
                    positions={liveAnomaly === 'weather' ? flashFloodDetour : blockageDetour} 
                    pathOptions={{ color: '#10B981', weight: 8 }} 
                  >
                    <Tooltip permanent direction="top" className="route-tooltip" offset={[0, -5]}>
                      <div style={{fontWeight: 'bold'}}>{formatDuration(routeMetrics.duration + detourDelay)} <span style={{color: '#EF4444'}}>(+{formatDuration(detourDelay)} detour)</span></div>
                    </Tooltip>
                  </Polyline>
                )}
              </>
            )}

            {liveAnomaly === 'weather' && primaryUpToAnomaly.length > 0 && (
              <Marker position={primaryUpToAnomaly[primaryUpToAnomaly.length-1]} icon={createCircleMarker('#3B82F6', theme === 'dark')} />
            )}
            {liveAnomaly === 'war' && primaryUpToAnomaly.length > 0 && (
              <Marker position={primaryUpToAnomaly[primaryUpToAnomaly.length-1]} icon={createCircleMarker('#DC2626', theme === 'dark')} />
            )}

            <Marker position={startCoords} icon={createCircleMarker('#3B82F6', theme === 'dark')}>
              <Popup>{origin || 'Origin'}</Popup>
            </Marker>
            <Marker position={endCoords} icon={createCircleMarker('#10B981', theme === 'dark')}>
               <Popup>{destination || 'Destination'}</Popup>
            </Marker>

            {(journeyState === 'navigating' || journeyState === 'analyzing-risks' || journeyState === 'anomaly-triggered' || journeyState === 'rerouting' || journeyState === 'arrived') && (
              <Marker position={carCoords} icon={createTruckIcon(theme === 'dark')} />
            )}
          </MapContainer>

          <div className={`alert-popup ${showAlert ? '' : 'hide'}`} style={{ zIndex: 1000 }}>
            <AlertOctagon className="alert-icon" size={28} />
            <div className="alert-content">
              <h4>⚠️ DECISION AGENT: REROUTE INITIATED</h4>
              <p>Risk Threshold breached by {liveAnomaly === 'weather' ? 'Weather' : 'Geopolitics'} & Traffic events.</p>
              <div className="reroute-banner">
                <RefreshCcw size={12} className="spin" />
                <span>Alternate mathematically safe route mapped.</span>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Bottom Insights Panel */}
      <div className="bottom-panel">
        <div className="insight-card">
          <div className={`insight-icon ${liveAnomaly ? 'danger' : condition !== 'clear' ? 'warning' : 'success'}`}>
             <ShieldAlert size={20} />
          </div>
          <div className="insight-text">
            <h4>Risk Assessment Agent</h4>
            <p>
              {liveAnomaly ? 'Escalated: Total Risk Score exceeded thresholds.' : 
               condition === 'congestion' ? 'Identified port bottlenecks. Preemptively bypassed.' : 
               condition === 'typhoon' ? 'Detected severe weather patterns. Safe path assigned.' : 
               'Threat levels nominal. Primary route cleared.'}
            </p>
          </div>
        </div>
        
        <div className="insight-card">
          <div className="insight-icon accent">
             <Terminal size={20} />
          </div>
          <div className="insight-text">
            <h4>System Interventions</h4>
            <p>
              {liveAnomaly ? 'News & Logistics Agents collaborated to structure transit.' : 
               condition !== 'clear' ? 'Predictive modeling active. Corridor secured.' : 
               '0 Manual Interventions required.'}
            </p>
          </div>
        </div>
        
        <div className="insight-card">
          <div className="insight-icon success">
             <Globe size={20} />
          </div>
          <div className="insight-text">
            <h4>Global Logistics ETA</h4>
            <p>{journeyState === 'arrived' ? 'Logistics Fleet Delivered Safely' : 
               routeMetrics.duration ? `${formatDuration(routeMetrics.duration + detourDelay)} • Google Maps OS Sync` : 
               'Pending Configuration...'}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
