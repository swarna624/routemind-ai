import React, { useEffect, useState } from 'react';
import { Route } from 'lucide-react';

export default function Splash({ onComplete }) {
  const [fadingOut, setFadingOut] = useState(false);

  useEffect(() => {
    // Start fade out after 1.5s, unmount at 2s
    const fadeTimer = setTimeout(() => {
      setFadingOut(true);
    }, 1500);

    const unmountTimer = setTimeout(() => {
      if (onComplete) onComplete();
    }, 2000);

    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(unmountTimer);
    };
  }, [onComplete]);

  return (
    <div className={`splash-container ${fadingOut ? 'fade-out' : ''}`}>
      <div className="logo-glow">
        <Route size={40} color="white" />
      </div>
      <h1 className="title">RouteMind AI</h1>
      <p className="tagline">Predict. Prevent. Optimize</p>
    </div>
  );
}
