/**
 * Interactive REPL prompt component.
 *
 * Renders `swarm > ` and accepts free-form text input.
 * Supports command history (up/down), basic editing, and slash command dispatch.
 */

import React, { useState, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';

export interface ReplPromptProps {
  onSubmit: (text: string) => void;
  history: string[];
  hint?: string;
  disabled?: boolean;
}

export function ReplPrompt({ onSubmit, history, hint, disabled = false }: ReplPromptProps) {
  const [input, setInput] = useState('');
  const [cursor, setCursor] = useState(0);
  const [historyIndex, setHistoryIndex] = useState(-1);

  useInput(
    (ch, key) => {
      if (disabled) return;

      // Submit
      if (key.return) {
        const trimmed = input.trim();
        if (trimmed.length > 0) {
          onSubmit(trimmed);
          setInput('');
          setCursor(0);
          setHistoryIndex(-1);
        }
        return;
      }

      // Backspace
      if (key.backspace || key.delete) {
        if (cursor > 0) {
          setInput((prev) => prev.slice(0, cursor - 1) + prev.slice(cursor));
          setCursor((c) => c - 1);
        }
        return;
      }

      // History navigation
      if (key.upArrow) {
        if (history.length > 0 && historyIndex < history.length - 1) {
          const newIdx = historyIndex + 1;
          setHistoryIndex(newIdx);
          const val = history[history.length - 1 - newIdx];
          setInput(val);
          setCursor(val.length);
        }
        return;
      }
      if (key.downArrow) {
        if (historyIndex > 0) {
          const newIdx = historyIndex - 1;
          setHistoryIndex(newIdx);
          const val = history[history.length - 1 - newIdx];
          setInput(val);
          setCursor(val.length);
        } else if (historyIndex === 0) {
          setHistoryIndex(-1);
          setInput('');
          setCursor(0);
        }
        return;
      }

      // Cursor movement
      if (key.leftArrow) {
        setCursor((c) => Math.max(0, c - 1));
        return;
      }
      if (key.rightArrow) {
        setCursor((c) => Math.min(input.length, c + 1));
        return;
      }

      // Home / End
      if (key.ctrl && ch === 'a') {
        setCursor(0);
        return;
      }
      if (key.ctrl && ch === 'e') {
        setCursor(input.length);
        return;
      }

      // Clear line
      if (key.ctrl && ch === 'u') {
        setInput('');
        setCursor(0);
        return;
      }

      // Regular character input
      if (ch && !key.ctrl && !key.meta) {
        setInput((prev) => prev.slice(0, cursor) + ch + prev.slice(cursor));
        setCursor((c) => c + ch.length);
      }
    },
    { isActive: !disabled },
  );

  // Render the input line with a visible cursor
  const before = input.slice(0, cursor);
  const cursorChar = input[cursor] || ' ';
  const after = input.slice(cursor + 1);

  return (
    <Box flexDirection="column">
      <Box>
        <Text color="yellow" bold>
          swarm {'> '}
        </Text>
        <Text>
          {before}
          <Text inverse>{cursorChar}</Text>
          {after}
        </Text>
      </Box>
      {hint && input.length === 0 && (
        <Box marginLeft={9}>
          <Text dimColor>{hint}</Text>
        </Box>
      )}
    </Box>
  );
}
