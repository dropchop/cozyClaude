import { useEffect, useRef } from 'react';
import Phaser from 'phaser';
import { TownScene } from './phaser/TownScene.js';

// Mounts the Phaser game into a div. The scene reads/writes town state through
// the event bus (wired up in later phases); React keeps the surrounding HUD.
export function TownCanvas() {
  const parentRef = useRef(null);
  const gameRef = useRef(null);

  useEffect(() => {
    if (gameRef.current || !parentRef.current) return;
    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: parentRef.current,
      backgroundColor: '#5ea63a',
      pixelArt: true,
      roundPixels: true,
      scale: {
        mode: Phaser.Scale.RESIZE,
        width: '100%',
        height: '100%',
      },
      scene: [TownScene],
    });
    gameRef.current = game;
    return () => {
      game.destroy(true);
      gameRef.current = null;
    };
  }, []);

  return <div className="town-canvas" ref={parentRef} />;
}
