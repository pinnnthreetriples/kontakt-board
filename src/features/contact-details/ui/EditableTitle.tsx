import { useEffect, useRef, useState } from 'react';
import { EditOutlined } from '@mui/icons-material';
import { IconButton, Stack, TextField, Typography } from '@mui/material';
import { tokens } from '../../../shared/design-system/tokens';

interface EditableTitleProps {
  value: string;
  placeholder: string;
  disabled: boolean;
  onChange: (value: string) => void;
}

export function EditableTitle({ value, placeholder, disabled, onChange }: EditableTitleProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const cancelled = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  function commit(): void {
    setEditing(false);
    if (cancelled.current) return;
    const trimmed = draft.trim();
    if (trimmed !== value) onChange(trimmed);
  }

  function onKeyDown(event: React.KeyboardEvent): void {
    if (event.key === 'Enter') { event.preventDefault(); commit(); }
    if (event.key === 'Escape') { event.stopPropagation(); cancelled.current = true; setEditing(false); }
  }

  if (editing) {
    return (
      <TextField
        inputRef={inputRef}
        size="small"
        fullWidth
        value={draft}
        disabled={disabled}
        placeholder={placeholder}
        slotProps={{ htmlInput: { 'aria-label': 'Название' } }}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={commit}
      />
    );
  }

  return (
    <Stack direction="row" alignItems="center" gap={0.5} sx={{ minWidth: tokens.size.zero, '&:hover .edit-title-action': { opacity: 1 }, '&:focus-within .edit-title-action': { opacity: 1 } }}>
      <Typography variant="h1" noWrap color={value === '' ? 'text.secondary' : 'text.primary'} sx={{ minWidth: tokens.size.zero, textOverflow: 'ellipsis' }}>
        {value === '' ? placeholder : value}
      </Typography>
      <IconButton
        className="edit-title-action"
        size="small"
        aria-label="Изменить название"
        disabled={disabled}
        onClick={() => { cancelled.current = false; setDraft(value); setEditing(true); }}
        sx={{ flexShrink: 0, opacity: 0, transition: tokens.motion.fast, '&:focus-visible': { opacity: 1 } }}
      >
        <EditOutlined fontSize="inherit" />
      </IconButton>
    </Stack>
  );
}
