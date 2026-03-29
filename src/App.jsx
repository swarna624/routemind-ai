import React, { useState } from 'react';
import Splash from './Splash';
import MainApp from './MainApp';

function App() {
  const [showSplash, setShowSplash] = useState(true);

  return (
    <>
      {showSplash ? (
        <Splash onComplete={() => setShowSplash(false)} />
      ) : (
        <MainApp />
      )}
    </>
  );
}

export default App;
