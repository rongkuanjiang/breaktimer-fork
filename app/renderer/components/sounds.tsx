import { Howl } from "howler";
import { useEffect } from "react";
import { SoundType } from "../../types/settings";

import { useIpc } from "../contexts/ipc-context";

export default function Sounds() {
  const ipc = useIpc();
  const playSound = (
    type: string,
    isStart: boolean,
    volume: number = 1
  ): void => {
    if (type === SoundType.None) return;
    const sound = new Howl({
      src: [`./sounds/${type.toLowerCase()}_${isStart ? "start" : "end"}.wav`],
      volume,
    });
    sound.play();
  };

  useEffect(() => {
    const removeStartListener = ipc.onPlayStartSound(
      (type: string, volume: number = 1) => {
        playSound(type, true, volume);
      }
    );

    const removeEndListener = ipc.onPlayEndSound(
      (type: string, volume: number = 1) => {
        playSound(type, false, volume);
      }
    );

    return () => {
      removeStartListener();
      removeEndListener();
    };
  }, []);

  return null;
}
