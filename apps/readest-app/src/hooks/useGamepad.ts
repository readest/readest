import { useEffect, useRef, useCallback } from 'react';

interface ButtonMapping {
  key: string;
  code: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
}

interface GamepadConfig {
  buttonMap?: Record<number, ButtonMapping>;
  axisThreshold?: number;
  enabled?: boolean;
}

const DEFAULT_BUTTON_MAP: Record<number, ButtonMapping> = {
  0: { key: 'Enter', code: 'Enter' }, // A
  1: { key: 'Escape', code: 'Escape' }, // B
  2: { key: 'x', code: 'KeyX' }, // X
  3: { key: 'y', code: 'KeyY' }, // Y
  4: { key: 'ArrowLeft', code: 'ArrowLeft' }, // LB
  5: { key: 'ArrowRight', code: 'ArrowRight' }, // RB
  6: { key: 'ArrowLeft', code: 'ArrowLeft' }, // LT
  7: { key: 'ArrowRight', code: 'ArrowRight' }, // RT
  8: { key: 'Tab', code: 'Tab' }, // Select/Back
  9: { key: 'Escape', code: 'Escape' }, // Start/Menu
  12: { key: 'ArrowUp', code: 'ArrowUp' }, // D-pad Up
  13: { key: 'ArrowDown', code: 'ArrowDown' }, // D-pad Down
  14: { key: 'ArrowLeft', code: 'ArrowLeft' }, // D-pad Left
  15: { key: 'ArrowRight', code: 'ArrowRight' }, // D-pad Right
};

export function useGamepad(config: GamepadConfig = {}) {
  const { buttonMap = DEFAULT_BUTTON_MAP, axisThreshold = 0.5, enabled = true } = config;

  const pressedRef = useRef<Map<number, boolean>>(new Map());
  const axisStateRef = useRef<Map<number, number>>(new Map());
  const animationRef = useRef<number | null>(null);
  const connectedRef = useRef(false);

  const dispatchKey = useCallback((mapping: ButtonMapping, type: 'keydown' | 'keyup') => {
    const event = new KeyboardEvent(type, {
      key: mapping.key,
      code: mapping.code,
      shiftKey: mapping.shiftKey || false,
      ctrlKey: mapping.ctrlKey || false,
      altKey: mapping.altKey || false,
      metaKey: mapping.metaKey || false,
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(event);
  }, []);

  const handleAxisAsButton = useCallback(
    (
      axisIndex: number,
      value: number,
      negativeMapping: ButtonMapping | undefined,
      positiveMapping: ButtonMapping | undefined,
    ) => {
      const prevValue = axisStateRef.current.get(axisIndex) || 0;
      axisStateRef.current.set(axisIndex, value);

      const wasNegative = prevValue < -axisThreshold;
      const wasPositive = prevValue > axisThreshold;
      const isNegative = value < -axisThreshold;
      const isPositive = value > axisThreshold;

      if (negativeMapping) {
        if (isNegative && !wasNegative) {
          dispatchKey(negativeMapping, 'keydown');
        } else if (!isNegative && wasNegative) {
          dispatchKey(negativeMapping, 'keyup');
        }
      }

      if (positiveMapping) {
        if (isPositive && !wasPositive) {
          dispatchKey(positiveMapping, 'keydown');
        } else if (!isPositive && wasPositive) {
          dispatchKey(positiveMapping, 'keyup');
        }
      }
    },
    [axisThreshold, dispatchKey],
  );

  const pollGamepad = useCallback(() => {
    const gamepads = navigator.getGamepads();
    const gamepad = gamepads[0] || gamepads[1] || gamepads[2] || gamepads[3];

    if (!gamepad) return;

    // Handle buttons
    for (const [indexStr, mapping] of Object.entries(buttonMap)) {
      const index = Number(indexStr);
      const button = gamepad.buttons[index];
      if (!button) continue;

      const isPressed = button.pressed;
      const wasPressed = pressedRef.current.get(index) || false;

      if (isPressed && !wasPressed) {
        dispatchKey(mapping, 'keydown');
      } else if (!isPressed && wasPressed) {
        dispatchKey(mapping, 'keyup');
      }

      pressedRef.current.set(index, isPressed);
    }

    // Handle left and right sticks as arrow keys
    if (gamepad.axes.length >= 2) {
      handleAxisAsButton(
        0,
        gamepad.axes[0]!,
        { key: 'ArrowLeft', code: 'ArrowLeft' },
        { key: 'ArrowRight', code: 'ArrowRight' },
      );
      handleAxisAsButton(
        1,
        gamepad.axes[1]!,
        { key: 'ArrowUp', code: 'ArrowUp' },
        { key: 'ArrowDown', code: 'ArrowDown' },
      );
    }
    if (gamepad.axes.length >= 4) {
      handleAxisAsButton(
        2,
        gamepad.axes[2]!,
        { key: 'ArrowLeft', code: 'ArrowLeft' },
        { key: 'ArrowRight', code: 'ArrowRight' },
      );
      handleAxisAsButton(
        3,
        gamepad.axes[3]!,
        { key: 'ArrowUp', code: 'ArrowUp' },
        { key: 'ArrowDown', code: 'ArrowDown' },
      );
    }
  }, [buttonMap, dispatchKey, handleAxisAsButton]);

  useEffect(() => {
    if (!enabled) return;

    const startPolling = () => {
      if (connectedRef.current) return;
      connectedRef.current = true;

      const poll = () => {
        pollGamepad();
        animationRef.current = requestAnimationFrame(poll);
      };
      poll();
    };

    const stopPolling = () => {
      connectedRef.current = false;
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
      pressedRef.current.clear();
      axisStateRef.current.clear();
    };

    const onConnect = (e: GamepadEvent) => {
      console.log('Gamepad connected:', e.gamepad.id);
      startPolling();
    };

    const onDisconnect = (e: GamepadEvent) => {
      console.log('Gamepad disconnected:', e.gamepad.id);
      const gamepads = Array.from(navigator.getGamepads?.() || []);
      if (!gamepads.some((g) => g?.connected)) {
        stopPolling();
      }
    };

    window.addEventListener('gamepadconnected', onConnect);
    window.addEventListener('gamepaddisconnected', onDisconnect);

    const gamepads = Array.from(navigator.getGamepads?.() || []);
    if (gamepads.some((g) => g?.connected)) {
      startPolling();
    }

    return () => {
      window.removeEventListener('gamepadconnected', onConnect);
      window.removeEventListener('gamepaddisconnected', onDisconnect);
      stopPolling();
    };
  }, [enabled, pollGamepad]);
}
