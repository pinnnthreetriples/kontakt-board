import { useEffect, useRef, useState } from 'react';
import { EditOutlined } from '@mui/icons-material';
import { Box, Button, Checkbox, Chip, IconButton, ListItemButton, Popover, Stack, TextField, Typography } from '@mui/material';
import { stageColors, tokens } from '../../../shared/design-system/tokens';
import { createTag, nextTagColor, setContactTags } from '../../../entities/tag/model/tag-service';
import { tagChipSx, useTagColors } from '../../../entities/tag/model/useTagColors';

interface TagBarProps {
  contactId: string;
  tags: string[];
  disabled?: boolean;
}

function TagDot({ color, className }: { color: string; className?: string }) {
  return <Box className={className} sx={{ bgcolor: color, borderRadius: tokens.radiusCss.round, width: tokens.size.tagDot, height: tokens.size.tagDot, flexShrink: 0 }} />;
}


export function TagBar({ contactId, tags, disabled = false }: TagBarProps) {
  const colors = useTagColors();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState('');
  const [draftColor, setDraftColor] = useState<string>(stageColors[0]);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (creating) inputRef.current?.focus(); }, [creating]);

  const locked = disabled || busy;

  async function apply(next: string[]): Promise<void> {
    setBusy(true);
    setError('');
    try { await setContactTags(contactId, next); }
    catch { setError('Не удалось сохранить теги'); }
    finally { setBusy(false); }
  }

  function toggle(name: string): void {
    void apply(tags.includes(name) ? tags.filter((tag) => tag !== name) : [...tags, name]);
  }

  function stopCreating(): void {
    setCreating(false);
    setDraft('');
    setError('');
  }

  async function submitDraft(): Promise<void> {
    setBusy(true);
    setError('');
    try {
      const tag = await createTag(draft, draftColor);
      await setContactTags(contactId, [...tags, tag.name]);
      setCreating(false);
      setDraft('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось создать тег');
    } finally {
      setBusy(false);
    }
  }

  function onDraftKeyDown(event: React.KeyboardEvent): void {
    if (event.key === 'Enter') { event.preventDefault(); void submitDraft(); }
    if (event.key === 'Escape') { event.stopPropagation(); stopCreating(); }
  }

  return (
    <Stack direction="row" flexWrap="wrap" alignItems="center" gap={0.75}>
      {tags.length === 0 && <Typography variant="body2" color="text.secondary">Теги</Typography>}
      {tags.map((tag) => (
        <Chip
          key={tag}
          label={tag}
          size="small"
          variant="outlined"
          disabled={locked}
          onDelete={() => { void apply(tags.filter((name) => name !== tag)); }}
          sx={tagChipSx(colors.get(tag))}
        />
      ))}
      <IconButton size="small" aria-label="Изменить теги" disabled={locked} onClick={(event) => setAnchor(event.currentTarget)} sx={{ '&:focus-visible': { outline: tokens.focus.outline, outlineColor: 'primary.light' } }}>
        <EditOutlined fontSize="inherit" />
      </IconButton>
      <Popover
        open={anchor !== null}
        anchorEl={anchor}
        onClose={() => { setAnchor(null); stopCreating(); }}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      >
        <Stack sx={{ minWidth: tokens.size.tagMenu, py: 0.5 }}>
          {[...colors].map(([name, color]) => (
            <ListItemButton key={name} dense disabled={busy} onClick={() => toggle(name)}>
              <Checkbox size="small" edge="start" tabIndex={-1} disableRipple checked={tags.includes(name)} slotProps={{ input: { 'aria-label': name } }} />
              <TagDot color={color} />
              <Typography variant="body2" ml={1} noWrap>{name}</Typography>
            </ListItemButton>
          ))}
          {creating ? (
            <Stack gap={1} sx={{ px: 1.5, py: 1 }}>
              <TextField inputRef={inputRef} size="small" label="Название тега" value={draft} disabled={busy} onChange={(event) => setDraft(event.target.value)} onKeyDown={onDraftKeyDown} />
              <Stack direction="row" gap={0.5}>
                {stageColors.map((color, index) => (
                  <IconButton key={color} size="small" disabled={busy} aria-label={`Цвет ${index + 1}`} aria-pressed={draftColor === color} onClick={() => setDraftColor(color)} sx={{ border: 1, borderColor: draftColor === color ? 'text.primary' : 'transparent' }}>
                    <TagDot color={color} />
                  </IconButton>
                ))}
              </Stack>
              {error !== '' && <Typography color="error" variant="body2">{error}</Typography>}
              <Stack direction="row" gap={1}>
                <Button size="small" variant="contained" disabled={busy} onClick={() => void submitDraft()}>Создать</Button>
                <Button size="small" disabled={busy} onClick={stopCreating}>Отмена</Button>
              </Stack>
            </Stack>
          ) : (
            <ListItemButton dense disabled={busy} onClick={() => { setError(''); setDraftColor(nextTagColor(colors.size)); setCreating(true); }}>
              <Typography variant="body2">+ тег</Typography>
            </ListItemButton>
          )}
          {!creating && error !== '' && <Typography color="error" variant="body2" sx={{ px: 1.5, py: 0.5 }}>{error}</Typography>}
        </Stack>
      </Popover>
    </Stack>
  );
}
